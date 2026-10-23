"""Action execution reliability: retries, error classification, rate limits, outbox and recovery."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update

from app.core.config import get_settings
from app.models import AutomationExecution, InstagramConnection, OutboxMessage
from app.models.enums import ConnectionStatus, ErrorCategory, EventSource, ExecutionStatus, OutboxStatus
from app.services.automation_service import TOPIC_EXECUTE_ACTION
from app.services.instagram.base import parse_comment_webhook
from app.services.outbox import relay_outbox
from tests.conftest import Api
from tests.integration.live_helpers import FakeMetaClient, create_live_campaign, service, webhook_body


async def _queued(api: Api, sessionmaker, email: str, fake: FakeMetaClient, **campaign_kwargs):
    auth = await api.register(email)
    ws = (await api.client.get("/api/v1/workspaces/current", headers=api.headers(auth))).json()["id"]
    template = await api.template(auth)
    connection_id, _ = await create_live_campaign(sessionmaker, ws, template["id"], **campaign_kwargs)
    svc = service(sessionmaker, fake)
    [event] = parse_comment_webhook(webhook_body(f"c-{uuid.uuid4().hex[:6]}"))
    result = await svc.process_event((await svc.ingest(event, source=EventSource.INSTAGRAM)).event_id)
    return auth, svc, result.queued_execution_ids[0], connection_id


async def _execution(sessionmaker, execution_id) -> AutomationExecution:
    async with sessionmaker() as s:
        return await s.get(AutomationExecution, execution_id)


async def test_transient_failure_is_retried_with_backoff(api: Api, sessionmaker) -> None:
    fake = FakeMetaClient()
    _, svc, eid, _ = await _queued(api, sessionmaker, "t@example.com", fake)
    fake.fail_next(ErrorCategory.TRANSIENT)
    outcome = await svc.execute_action(eid)
    assert outcome.status is ExecutionStatus.RETRY_SCHEDULED
    execution = await _execution(sessionmaker, eid)
    assert execution.attempt_count == 1
    assert execution.error_category is ErrorCategory.TRANSIENT
    async with sessionmaker() as s:
        retry_msgs = await s.scalar(
            select(func.count()).where(
                OutboxMessage.topic == TOPIC_EXECUTE_ACTION, OutboxMessage.status == OutboxStatus.PENDING
            )
        )
    assert retry_msgs == 2  # original + scheduled retry
    outcome = await svc.execute_action(eid)
    assert outcome.status is ExecutionStatus.SUCCEEDED
    assert (await _execution(sessionmaker, eid)).attempt_count == 2
    assert len(fake.sent) == 1


async def test_retries_are_bounded(api: Api, sessionmaker, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "action_max_attempts", 3)
    fake = FakeMetaClient()
    _, svc, eid, _ = await _queued(api, sessionmaker, "b@example.com", fake)
    fake.fail_next(ErrorCategory.TRANSIENT, times=10)
    statuses = [(await svc.execute_action(eid)).status for _ in range(3)]
    assert statuses == [ExecutionStatus.RETRY_SCHEDULED, ExecutionStatus.RETRY_SCHEDULED, ExecutionStatus.FAILED]
    assert (await svc.execute_action(eid)).detail == "not runnable"


async def test_ambiguous_outcome_is_never_retried(api: Api, sessionmaker) -> None:
    fake = FakeMetaClient()
    auth, svc, eid, _ = await _queued(api, sessionmaker, "amb@example.com", fake)
    fake.fail_next(ErrorCategory.AMBIGUOUS)
    assert (await svc.execute_action(eid)).status is ExecutionStatus.UNKNOWN
    r = await api.client.post(f"/api/v1/executions/{eid}/retry", headers=api.headers(auth))
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "retry_unsafe"


async def test_timeout_is_ambiguous(api: Api, sessionmaker, monkeypatch) -> None:
    import asyncio

    fake = FakeMetaClient()
    _, svc, eid, _ = await _queued(api, sessionmaker, "slow@example.com", fake)

    async def slow(*args, **kwargs):
        await asyncio.sleep(5)

    monkeypatch.setattr(fake, "send_private_reply", slow)
    monkeypatch.setattr(svc.settings, "action_timeout_seconds", 0.05)
    outcome = await svc.execute_action(eid)
    assert outcome.status is ExecutionStatus.UNKNOWN


async def test_permanent_failure_and_safe_manual_retry(api: Api, sessionmaker) -> None:
    fake = FakeMetaClient()
    auth, svc, eid, _ = await _queued(api, sessionmaker, "perm@example.com", fake)
    fake.fail_next(ErrorCategory.PERMANENT)
    assert (await svc.execute_action(eid)).status is ExecutionStatus.FAILED
    r = await api.client.post(f"/api/v1/executions/{eid}/retry", headers=api.headers(auth))
    assert r.status_code == 200
    assert r.json()["status"] == "queued"
    assert (await svc.execute_action(eid)).status is ExecutionStatus.SUCCEEDED
    r = await api.client.post(f"/api/v1/executions/{eid}/retry", headers=api.headers(auth))
    assert r.status_code == 409  # succeeded executions are never re-sent


async def test_expired_token_fails_and_marks_connection(api: Api, sessionmaker) -> None:
    fake = FakeMetaClient()
    _, svc, eid, connection_id = await _queued(api, sessionmaker, "exp@example.com", fake)
    async with sessionmaker() as s, s.begin():
        await s.execute(update(InstagramConnection).values(token_expires_at=datetime.now(UTC) - timedelta(minutes=1)))
    outcome = await svc.execute_action(eid)
    assert outcome.status is ExecutionStatus.FAILED
    assert (await _execution(sessionmaker, eid)).error_category is ErrorCategory.AUTHORIZATION
    async with sessionmaker() as s:
        assert (await s.get(InstagramConnection, connection_id)).status is ConnectionStatus.EXPIRED
    assert fake.sent == []


async def test_revoked_authorization_from_meta(api: Api, sessionmaker) -> None:
    from app.services.instagram.base import AdapterError

    fake = FakeMetaClient()
    _, svc, eid, connection_id = await _queued(api, sessionmaker, "rev@example.com", fake)
    fake._failures.append(AdapterError("Error validating access token", ErrorCategory.AUTHORIZATION, code=190))
    assert (await svc.execute_action(eid)).status is ExecutionStatus.FAILED
    async with sessionmaker() as s:
        assert (await s.get(InstagramConnection, connection_id)).status is ConnectionStatus.EXPIRED


async def test_disconnected_account_does_not_send(api: Api, sessionmaker) -> None:
    fake = FakeMetaClient()
    _, svc, eid, _ = await _queued(api, sessionmaker, "disc@example.com", fake)
    async with sessionmaker() as s, s.begin():
        await s.execute(
            update(InstagramConnection).values(status=ConnectionStatus.REVOKED, encrypted_access_token=None)
        )
    assert (await svc.execute_action(eid)).status is ExecutionStatus.FAILED
    assert fake.sent == []


async def test_per_account_rate_limit_defers_without_failing(api: Api, sessionmaker, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "account_rate_limit_per_minute", 0)
    fake = FakeMetaClient()
    _, svc, eid, _ = await _queued(api, sessionmaker, "rl@example.com", fake)
    outcome = await svc.execute_action(eid)
    assert outcome.status is ExecutionStatus.RETRY_SCHEDULED
    execution = await _execution(sessionmaker, eid)
    assert execution.attempt_count == 0
    assert execution.error_category is ErrorCategory.RATE_LIMITED
    assert fake.sent == []


async def test_paused_after_enqueue_cancels(api: Api, sessionmaker) -> None:
    from app.models import Campaign
    from app.models.enums import CampaignStatus

    fake = FakeMetaClient()
    _, svc, eid, _ = await _queued(api, sessionmaker, "pause@example.com", fake)
    async with sessionmaker() as s, s.begin():
        await s.execute(update(Campaign).values(status=CampaignStatus.PAUSED))
    assert (await svc.execute_action(eid)).status is ExecutionStatus.CANCELLED
    assert fake.sent == []


async def test_stale_in_progress_becomes_unknown(api: Api, sessionmaker) -> None:
    fake = FakeMetaClient()
    _, svc, eid, _ = await _queued(api, sessionmaker, "stale@example.com", fake)
    async with sessionmaker() as s, s.begin():
        await s.execute(
            update(AutomationExecution).values(
                status=ExecutionStatus.IN_PROGRESS, started_at=datetime.now(UTC) - timedelta(hours=1)
            )
        )
    assert await svc.reap_stale_executions() == 1
    assert (await _execution(sessionmaker, eid)).status is ExecutionStatus.UNKNOWN


async def test_outbox_relay(api: Api, sessionmaker) -> None:
    fake = FakeMetaClient()
    await _queued(api, sessionmaker, "outbox@example.com", fake)
    published: list[tuple[str, dict]] = []
    assert await relay_outbox(sessionmaker, lambda t, p: published.append((t, p))) == 2
    assert {t for t, _ in published} == {"process_event", "execute_action"}
    assert await relay_outbox(sessionmaker, lambda t, p: published.append((t, p))) == 0


async def test_outbox_relay_keeps_messages_when_broker_down(api: Api, sessionmaker) -> None:
    await _queued(api, sessionmaker, "down@example.com", FakeMetaClient())

    def broken(topic, payload):
        raise ConnectionError("broker unavailable")

    assert await relay_outbox(sessionmaker, broken) == 0
    async with sessionmaker() as s:
        pending = await s.scalar(select(func.count()).where(OutboxMessage.status == OutboxStatus.PENDING))
    assert pending == 2


async def test_failed_event_processing_is_tracked(api: Api, sessionmaker, monkeypatch) -> None:
    import pytest

    from app.models import WebhookEvent
    from app.models.enums import EventStatus

    svc = service(sessionmaker, FakeMetaClient())
    [event] = parse_comment_webhook(webhook_body("boom"))
    ingested = await svc.ingest(event, source=EventSource.INSTAGRAM)

    async def explode(*args, **kwargs):
        raise RuntimeError("database hiccup access_token=abc")

    monkeypatch.setattr(svc, "_evaluate_event", explode)
    with pytest.raises(RuntimeError):
        await svc.process_event(ingested.event_id)
    async with sessionmaker() as s:
        stored = await s.get(WebhookEvent, ingested.event_id)
    assert stored.status is EventStatus.FAILED
    assert "abc" not in stored.error["message"]
