from __future__ import annotations

from tests.conftest import Api


async def test_leads_crud_and_filters(api: Api) -> None:
    auth = await api.register("leads@example.com")
    h = api.headers(auth)
    template = await api.template(auth)
    campaign = await api.campaign(auth, template["id"])
    await api.simulate(auth, campaign["id"], comment_id="1", username="ana")
    await api.simulate(auth, campaign["id"], comment_id="2", username="ana")
    await api.simulate(auth, campaign["id"], comment_id="3", username="bob")

    page = (await api.client.get("/api/v1/leads", headers=h)).json()
    assert page["total"] == 2
    ana = next(lead for lead in page["items"] if lead["username"] == "ana")
    assert ana["comment_count"] == 2

    r = await api.client.patch(
        f"/api/v1/leads/{ana['id']}", json={"tags": ["VIP", " vip ", "warm"], "notes": "hi"}, headers=h
    )
    assert r.json()["tags"] == ["vip", "warm"]
    assert (await api.client.get("/api/v1/leads", params={"tag": "vip"}, headers=h)).json()["total"] == 1
    assert (await api.client.get("/api/v1/leads", params={"search": "bo"}, headers=h)).json()["total"] == 1
    assert (await api.client.get("/api/v1/leads", params={"created_from": "2999-01-01T00:00:00Z"}, headers=h)).json()[
        "total"
    ] == 0
    assert (await api.client.delete(f"/api/v1/leads/{ana['id']}", headers=h)).status_code == 204
    assert (await api.client.get(f"/api/v1/leads/{ana['id']}", headers=h)).status_code == 404


async def test_execution_filters_and_analytics(api: Api) -> None:
    auth = await api.register("an@example.com")
    h = api.headers(auth)
    template = await api.template(auth)
    config = {
        "actions": [{"type": "private_reply", "template_id": template["id"]}],
        "variables": {"resource_link": "https://example.com"},
        "follower_requirement": "followers_only",
        "unknown_follower_fallback": "manual_review",
    }
    campaign = await api.campaign(auth, template["id"], config=config)
    await api.simulate(auth, campaign["id"], comment_id="a", follower_status="true")
    await api.simulate(auth, campaign["id"], comment_id="b", follower_status="unknown")
    await api.simulate(auth, campaign["id"], comment_id="c", follower_status="false")
    await api.simulate(auth, campaign["id"], comment_id="d", comment_text="nope")

    execs = (await api.client.get("/api/v1/executions", params={"campaign_id": campaign["id"]}, headers=h)).json()
    assert execs["total"] == 3
    assert (await api.client.get("/api/v1/executions", params={"status": "simulated"}, headers=h)).json()["total"] == 1
    assert (await api.client.get("/api/v1/executions", params={"simulated": "false"}, headers=h)).json()["total"] == 0

    stats = (await api.client.get(f"/api/v1/campaigns/{campaign['id']}/analytics", headers=h)).json()
    assert stats["total_executions"] == 3
    assert stats["simulated"] == 1
    assert stats["manual_review"] == 1
    assert stats["skipped"] == 1
    assert stats["succeeded"] == stats["failed"] == stats["unknown"] == stats["attempted"] == 0
    assert stats["by_action"]["private_reply"]["simulated"] == 1

    # Approving a manual-review execution re-queues it (it was never attempted, so it is safe).
    review = (await api.client.get("/api/v1/executions", params={"status": "manual_review"}, headers=h)).json()
    r = await api.client.post(f"/api/v1/executions/{review['items'][0]['id']}/retry", headers=h)
    assert r.json()["status"] == "queued"
    skipped = (await api.client.get("/api/v1/executions", params={"status": "skipped"}, headers=h)).json()
    assert (
        await api.client.post(f"/api/v1/executions/{skipped['items'][0]['id']}/retry", headers=h)
    ).status_code == 409


async def test_max_actions_per_lead(api: Api) -> None:
    auth = await api.register("cap@example.com")
    template = await api.template(auth)
    config = {
        "actions": [{"type": "private_reply", "template_id": template["id"]}],
        "variables": {"resource_link": "https://example.com"},
        "max_actions_per_lead": 1,
    }
    campaign = await api.campaign(auth, template["id"], config=config)
    first = await api.simulate(auth, campaign["id"], comment_id="x1")
    second = await api.simulate(auth, campaign["id"], comment_id="x2")
    assert first.json()["executions"][0]["status"] == "simulated"
    assert second.json()["executions"][0]["status"] == "skipped"
    assert "limit" in second.json()["executions"][0]["error_detail"]
