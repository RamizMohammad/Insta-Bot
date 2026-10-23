from __future__ import annotations

import asyncio

from sqlalchemy import func, select

from app.models import AutomationExecution, Lead, OutboxMessage, WebhookEvent
from app.models.enums import EventSource
from app.services.instagram.base import parse_comment_webhook
from tests.conftest import Api
from tests.integration.live_helpers import FakeMetaClient, create_live_campaign, service, signed, webhook_body


async def _workspace(api: Api, email: str):
    auth = await api.register(email)
    ws = (await api.client.get("/api/v1/workspaces/current", headers=api.headers(auth))).json()["id"]
    template = await api.template(auth)
    return auth, ws, template


async def test_subscription_verification(api: Api) -> None:
    ok = await api.client.get(
        "/api/v1/webhooks/instagram",
        params={"hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "1158201444"},
    )
    assert ok.status_code == 200
    assert ok.text == "1158201444"
    bad = await api.client.get(
        "/api/v1/webhooks/instagram", params={"hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1"}
    )
    assert bad.status_code == 403


async def test_signature_required(api: Api) -> None:
    raw, headers = signed(webhook_body(), secret="wrong-secret")
    r = await api.client.post("/api/v1/webhooks/instagram", content=raw, headers=headers)
    assert r.status_code == 401
    r = await api.client.post("/api/v1/webhooks/instagram", content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 401
    # Signature must cover the exact raw bytes.
    raw2, headers2 = signed(webhook_body())
    r = await api.client.post("/api/v1/webhooks/instagram", content=raw2 + b" ", headers=headers2)
    assert r.status_code == 401


async def test_webhook_persists_and_dedupes(api: Api, sessionmaker) -> None:
    raw, headers = signed(webhook_body())
    first = await api.client.post("/api/v1/webhooks/instagram", content=raw, headers=headers)
    second = await api.client.post("/api/v1/webhooks/instagram", content=raw, headers=headers)
    assert first.json() == {"received": 1, "duplicates": 0}
    assert second.json() == {"received": 0, "duplicates": 1}
    async with sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(WebhookEvent)) == 1
        assert await s.scalar(select(func.count()).select_from(OutboxMessage)) == 1
        event = await s.scalar(select(WebhookEvent))
        assert "signature" not in str(event.payload).lower()


async def test_concurrent_webhook_deliveries(api: Api, sessionmaker) -> None:
    raw, headers = signed(webhook_body())
    responses = await asyncio.gather(
        *(api.client.post("/api/v1/webhooks/instagram", content=raw, headers=headers) for _ in range(10))
    )
    assert sum(r.json()["received"] for r in responses) == 1
    async with sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(WebhookEvent)) == 1


async def test_live_pipeline_end_to_end(api: Api, sessionmaker) -> None:
    auth, ws, template = await _workspace(api, "live@example.com")
    await create_live_campaign(sessionmaker, ws, template["id"])
    raw, headers = signed(webhook_body())
    await api.client.post("/api/v1/webhooks/instagram", content=raw, headers=headers)

    fake = FakeMetaClient()
    svc = service(sessionmaker, fake)
    async with sessionmaker() as s:
        event_id = await s.scalar(select(WebhookEvent.id))
    result = await svc.process_event(event_id)
    assert result.status.value == "processed"
    [execution_id] = result.queued_execution_ids
    outcome = await svc.execute_action(execution_id)
    assert outcome.status.value == "succeeded"
    assert fake.sent[0].message == "Hey fan! Here is your resource: https://example.com/r"

    r = await api.client.get(f"/api/v1/executions/{execution_id}", headers=api.headers(auth))
    assert r.json()["status"] == "succeeded"
    assert r.json()["is_simulated"] is False
    leads = (await api.client.get("/api/v1/leads", headers=api.headers(auth))).json()
    assert leads["items"][0]["external_user_id"] == "555"
    event = (await api.client.get("/api/v1/events", headers=api.headers(auth))).json()["items"][0]
    assert event["status"] == "processed"


async def test_concurrent_processing_creates_one_action(api: Api, sessionmaker) -> None:
    _, ws, template = await _workspace(api, "conc@example.com")
    await create_live_campaign(sessionmaker, ws, template["id"])
    fake = FakeMetaClient()
    svc = service(sessionmaker, fake)
    [event] = parse_comment_webhook(webhook_body())
    ingested = await svc.ingest(event, source=EventSource.INSTAGRAM)

    results = await asyncio.gather(*(svc.process_event(ingested.event_id) for _ in range(6)))
    queued = [eid for r in results for eid in r.queued_execution_ids]
    assert len(queued) == 1
    outcomes = await asyncio.gather(*(svc.execute_action(queued[0]) for _ in range(6)))
    assert sum(o.status is not None and o.status.value == "succeeded" for o in outcomes) == 1
    assert len(fake.sent) == 1
    async with sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(AutomationExecution)) == 1
        assert (await s.scalar(select(Lead))).comment_count == 1


async def test_own_comments_and_unknown_accounts_ignored(api: Api, sessionmaker) -> None:
    _, ws, template = await _workspace(api, "own@example.com")
    svc = service(sessionmaker, FakeMetaClient())
    [unknown] = parse_comment_webhook(webhook_body("c-unknown"))
    result = await svc.process_event((await svc.ingest(unknown, source=EventSource.INSTAGRAM)).event_id)
    assert result.status.value == "ignored"

    await create_live_campaign(sessionmaker, ws, template["id"])
    from tests.integration.live_helpers import ACCOUNT_ID

    [own] = parse_comment_webhook(webhook_body("c-own", sender=ACCOUNT_ID))
    result = await svc.process_event((await svc.ingest(own, source=EventSource.INSTAGRAM)).event_id)
    assert result.status.value == "ignored"
    assert "connected account" in result.summary["reason"]


async def test_simulation_campaigns_ignore_live_webhooks(api: Api, sessionmaker) -> None:
    auth, _, template = await _workspace(api, "simonly@example.com")
    await api.campaign(auth, template["id"], media_external_id="18000000000000001")
    svc = service(sessionmaker, FakeMetaClient())
    [event] = parse_comment_webhook(webhook_body())
    result = await svc.process_event((await svc.ingest(event, source=EventSource.INSTAGRAM)).event_id)
    assert result.queued_execution_ids == []
