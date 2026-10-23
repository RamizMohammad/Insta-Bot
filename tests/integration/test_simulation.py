"""End-to-end simulation scenarios required by the spec (all through the real workflow)."""

from __future__ import annotations

import asyncio

from tests.conftest import Api


async def _setup(api: Api, email: str = "owner@example.com", **campaign_overrides):
    auth = await api.register(email)
    template = await api.template(auth)
    campaign = await api.campaign(auth, template["id"], **campaign_overrides)
    return auth, template, campaign


async def test_matching_comment_triggers_action(api: Api, mock_ig) -> None:
    auth, _, campaign = await _setup(api)
    r = await api.simulate(auth, campaign["id"])
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["duplicate"] is False
    assert data["event_status"] == "processed"
    [execution] = data["executions"]
    assert execution["status"] == "simulated"
    assert execution["is_simulated"] is True
    assert execution["action_type"] == "private_reply"
    assert execution["rendered_message"] == "Hey example_user! Here is your resource: https://example.com/course"
    assert execution["external_response_id"].startswith("sim_private_reply_")
    assert execution["matched_rules"][0]["keyword"] == "course"
    assert len(mock_ig.sent) == 1


async def test_nonmatching_comment_does_not_trigger(api: Api, mock_ig) -> None:
    auth, _, campaign = await _setup(api)
    r = await api.simulate(auth, campaign["id"], comment_text="Love this reel!")
    data = r.json()
    assert data["executions"] == []
    assert data["result"]["campaigns"][0]["matched"] is False
    assert mock_ig.sent == []


async def test_excluded_keyword_prevents_match(api: Api, mock_ig) -> None:
    auth, _, campaign = await _setup(api)
    r = await api.simulate(auth, campaign["id"], comment_text="course spam spam")
    outcome = r.json()["result"]["campaigns"][0]
    assert outcome["matched"] is False
    assert "excluded" in outcome["reason"]
    assert mock_ig.sent == []


async def test_unknown_follower_status_follows_fallback(api: Api, mock_ig) -> None:
    auth = await api.register("fallback@example.com")
    template = await api.template(auth)
    config = {
        "actions": [{"type": "private_reply", "template_id": template["id"]}],
        "variables": {"resource_link": "https://example.com"},
        "follower_requirement": "followers_only",
        "unknown_follower_fallback": "manual_review",
    }
    campaign = await api.campaign(auth, template["id"], config=config)
    r = await api.simulate(auth, campaign["id"], follower_status="unknown")
    [execution] = r.json()["executions"]
    assert execution["status"] == "manual_review"
    assert execution["evaluation"]["eligibility"]["observed"] == "unknown"
    assert mock_ig.sent == []

    r = await api.simulate(auth, campaign["id"], comment_id="c-2", follower_status="false")
    assert r.json()["executions"][0]["status"] == "skipped"
    r = await api.simulate(auth, campaign["id"], comment_id="c-3", follower_status="true")
    assert r.json()["executions"][0]["status"] == "simulated"


async def test_duplicate_events_do_not_create_duplicate_actions(api: Api, mock_ig) -> None:
    auth, _, campaign = await _setup(api)
    first = await api.simulate(auth, campaign["id"])
    second = await api.simulate(auth, campaign["id"])
    assert second.json()["duplicate"] is True
    assert second.json()["event_id"] == first.json()["event_id"]
    assert len(second.json()["executions"]) == 1
    assert len(mock_ig.sent) == 1


async def test_concurrent_duplicate_simulations_send_once(api: Api, mock_ig) -> None:
    auth, _, campaign = await _setup(api)
    responses = await asyncio.gather(*(api.simulate(auth, campaign["id"]) for _ in range(8)))
    assert all(r.status_code == 200 for r in responses)
    assert sum(not r.json()["duplicate"] for r in responses) == 1
    assert len({r.json()["event_id"] for r in responses}) == 1
    assert len(mock_ig.sent) == 1


async def test_paused_campaign_does_not_execute(api: Api, mock_ig) -> None:
    auth, _, campaign = await _setup(api)
    r = await api.client.post(f"/api/v1/campaigns/{campaign['id']}/pause", headers=api.headers(auth))
    assert r.json()["status"] == "paused"
    r = await api.simulate(auth, campaign["id"])
    data = r.json()
    assert data["executions"] == []
    assert "paused" in data["result"]["campaigns"][0]["reason"]
    assert mock_ig.sent == []


async def test_workspace_isolation_prevents_unauthorized_execution(api: Api, mock_ig) -> None:
    _, _, campaign = await _setup(api)
    intruder = await api.register("intruder@example.com")
    r = await api.simulate(intruder, campaign["id"])
    assert r.status_code == 404
    assert mock_ig.sent == []


async def test_simulated_replies_never_reach_instagram(api: Api, mock_ig, monkeypatch) -> None:
    import httpx

    calls: list[httpx.Request] = []

    async def _forbidden(self, request):  # pragma: no cover - must never run
        calls.append(request)
        raise AssertionError("network access attempted")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", _forbidden)
    auth, _, campaign = await _setup(api)
    r = await api.simulate(auth, campaign["id"])
    assert r.json()["executions"][0]["status"] == "simulated"
    assert calls == []


async def test_public_and_private_actions_with_replies_ignored(api: Api, mock_ig) -> None:
    auth = await api.register("both@example.com")
    dm = await api.template(auth)
    public = await api.template(
        auth, name="Public", type="public_reply", body="Check your DMs {{username}}!", custom_variables=[], fallbacks={}
    )
    config = {
        "actions": [
            {"type": "public_reply", "template_id": public["id"]},
            {"type": "private_reply", "template_id": dm["id"]},
        ],
        "variables": {"resource_link": "https://example.com"},
    }
    campaign = await api.campaign(auth, dm["id"], config=config)
    r = await api.simulate(auth, campaign["id"])
    statuses = sorted((e["action_type"], e["status"]) for e in r.json()["executions"])
    assert statuses == [("private_reply", "simulated"), ("public_reply", "simulated")]

    r = await api.simulate(auth, campaign["id"], comment_id="reply-1", parent_id="test-comment-001")
    assert r.json()["executions"] == []
    assert "reply" in r.json()["result"]["campaigns"][0]["reason"]
