"""Endpoints added for the web UI: overview metrics, enriched executions, resolution, fault injection."""

from __future__ import annotations

from tests.conftest import Api


async def _campaign(api: Api, email: str):
    auth = await api.register(email)
    template = await api.template(auth)
    campaign = await api.campaign(auth, template["id"])
    return auth, campaign


async def test_overview_metrics(api: Api) -> None:
    auth, campaign = await _campaign(api, "ov@example.com")
    await api.simulate(auth, campaign["id"], comment_id="1")
    await api.simulate(auth, campaign["id"], comment_id="2", comment_text="nice")
    r = await api.client.get("/api/v1/analytics/overview", params={"days": 7}, headers=api.headers(auth))
    assert r.status_code == 200
    data = r.json()
    assert data["comments_received"] == 2
    assert data["comments_matched"] == 1
    assert data["actions"]["simulated"] == 1
    assert data["success_rate"] is None  # no live attempts yet
    assert len(data["daily"]) == 8
    assert sum(p["simulated"] for p in data["daily"]) == 1
    assert data["campaigns"]["active"] == 1
    [stats] = data["campaign_stats"]
    assert stats["campaign_id"] == campaign["id"]
    assert stats["simulated"] == 1


async def test_overview_attention_for_unknown_outcomes(api: Api) -> None:
    auth, campaign = await _campaign(api, "att@example.com")
    await api.simulate(auth, campaign["id"], comment_id="amb", fault="ambiguous")
    data = (await api.client.get("/api/v1/analytics/overview", headers=api.headers(auth))).json()
    [item] = data["attention"]
    assert item["kind"] == "failures"
    assert item["severity"] == "critical"
    assert item["campaign_id"] == campaign["id"]


async def test_executions_are_enriched_and_searchable(api: Api) -> None:
    auth, campaign = await _campaign(api, "enrich@example.com")
    await api.simulate(auth, campaign["id"], comment_id="a", username="ana_design")
    await api.simulate(auth, campaign["id"], comment_id="b", username="bob")
    h = api.headers(auth)
    page = (await api.client.get("/api/v1/executions", params={"search": "@ana"}, headers=h)).json()
    assert page["total"] == 1
    item = page["items"][0]
    assert item["campaign_name"] == "Course launch"
    assert item["lead_username"] == "ana_design"
    assert item["comment_text"] == "COURSE please send me the link"
    assert item["comment_id"] == "a"
    detail = (await api.client.get(f"/api/v1/executions/{item['id']}", headers=h)).json()
    assert detail["lead_username"] == "ana_design"


async def test_fault_injection_and_resolution(api: Api, mock_ig) -> None:
    auth, campaign = await _campaign(api, "fault@example.com")
    h = api.headers(auth)
    r = await api.simulate(auth, campaign["id"], comment_id="rl", fault="rate_limited")
    assert r.json()["executions"][0]["status"] == "retry_scheduled"
    r = await api.simulate(auth, campaign["id"], comment_id="amb", fault="ambiguous")
    unknown = r.json()["executions"][0]
    assert unknown["status"] == "unknown"
    assert mock_ig.sent == []

    # Not delivered -> failed, and now a manual retry is allowed and succeeds.
    r = await api.client.post(f"/api/v1/executions/{unknown['id']}/resolve", json={"delivered": False}, headers=h)
    assert r.json()["status"] == "failed"
    assert (await api.client.post(f"/api/v1/executions/{unknown['id']}/retry", headers=h)).status_code == 200
    assert (
        await api.client.post(f"/api/v1/executions/{unknown['id']}/resolve", json={"delivered": True}, headers=h)
    ).status_code == 409

    r = await api.simulate(auth, campaign["id"], comment_id="amb2", fault="ambiguous")
    second = r.json()["executions"][0]
    r = await api.client.post(f"/api/v1/executions/{second['id']}/resolve", json={"delivered": True}, headers=h)
    assert r.json()["status"] == "succeeded"
    other = await api.register("other-fault@example.com")
    r = await api.client.post(
        f"/api/v1/executions/{second['id']}/resolve", json={"delivered": True}, headers=api.headers(other)
    )
    assert r.status_code == 404


async def test_events_include_payload(api: Api) -> None:
    auth, campaign = await _campaign(api, "ev@example.com")
    await api.simulate(auth, campaign["id"])
    event = (await api.client.get("/api/v1/events", headers=api.headers(auth))).json()["items"][0]
    assert event["payload"]["text"] == "COURSE please send me the link"
    assert event["payload"]["username"] == "example_user"


async def test_execution_stats(api: Api) -> None:
    auth, campaign = await _campaign(api, "stats@example.com")
    await api.simulate(auth, campaign["id"], comment_id="s1")
    await api.simulate(auth, campaign["id"], comment_id="s2", fault="permanent")
    h = api.headers(auth)
    stats = (await api.client.get("/api/v1/executions/stats", headers=h)).json()
    assert stats["total"] == 2
    assert stats["simulated"] == 1
    assert stats["failed"] == 1
    assert stats["unknown"] == 0
    assert (await api.client.get("/api/v1/executions/stats", params={"simulated": "false"}, headers=h)).json()[
        "total"
    ] == 0
