"""Tenant isolation: every workspace resource is invisible to non-members."""

from __future__ import annotations

from tests.conftest import Api


async def test_cross_workspace_access_is_denied(api: Api) -> None:
    owner = await api.register("owner@example.com")
    template = await api.template(owner)
    campaign = await api.campaign(owner, template["id"])
    await api.simulate(owner, campaign["id"])
    intruder = await api.register("intruder@example.com")
    h = api.headers(intruder)

    # Direct object access by ID returns 404 (no existence leak).
    for path in (
        f"/api/v1/campaigns/{campaign['id']}",
        f"/api/v1/templates/{template['id']}",
        f"/api/v1/campaigns/{campaign['id']}/analytics",
    ):
        assert (await api.client.get(path, headers=h)).status_code == 404, path
    assert (
        await api.client.patch(f"/api/v1/campaigns/{campaign['id']}", json={"name": "x"}, headers=h)
    ).status_code == 404
    assert (await api.client.post(f"/api/v1/campaigns/{campaign['id']}/pause", headers=h)).status_code == 404
    assert (await api.client.delete(f"/api/v1/templates/{template['id']}", headers=h)).status_code == 404

    owner_execs = (await api.client.get("/api/v1/executions", headers=api.headers(owner))).json()
    assert owner_execs["total"] == 1
    execution_id = owner_execs["items"][0]["id"]
    assert (await api.client.get(f"/api/v1/executions/{execution_id}", headers=h)).status_code == 404
    assert (await api.client.post(f"/api/v1/executions/{execution_id}/retry", headers=h)).status_code == 404

    # Listings are scoped.
    for path in ("/api/v1/campaigns", "/api/v1/templates", "/api/v1/executions", "/api/v1/leads", "/api/v1/events"):
        assert (await api.client.get(path, headers=h)).json()["total"] == 0, path


async def test_client_supplied_workspace_id_is_verified(api: Api) -> None:
    owner = await api.register("owner2@example.com")
    owner_ws = (await api.client.get("/api/v1/workspaces/current", headers=api.headers(owner))).json()["id"]
    intruder = await api.register("intruder2@example.com")
    r = await api.client.get("/api/v1/campaigns", headers=api.headers(intruder) | {"X-Workspace-ID": owner_ws})
    assert r.status_code == 404


async def test_using_a_template_from_another_workspace_fails(api: Api) -> None:
    owner = await api.register("a@example.com")
    foreign_template = await api.template(owner)
    other = await api.register("b@example.com")
    body = {
        "name": "x",
        "media_external_id": "m",
        "config": {"actions": [{"type": "private_reply", "template_id": foreign_template["id"]}]},
        "rules": [{"keyword": "x"}],
    }
    r = await api.client.post("/api/v1/campaigns", json=body, headers=api.headers(other))
    assert r.status_code == 404


async def test_membership_roles(api: Api) -> None:
    owner = await api.register("boss@example.com")
    viewer = await api.register("viewer@example.com")
    ws = (await api.client.get("/api/v1/workspaces/current", headers=api.headers(owner))).json()["id"]
    r = await api.client.post(
        "/api/v1/workspaces/current/members",
        json={"email": "viewer@example.com", "role": "viewer"},
        headers=api.headers(owner),
    )
    assert r.status_code == 201
    vh = api.headers(viewer) | {"X-Workspace-ID": ws}
    assert (await api.client.get("/api/v1/campaigns", headers=vh)).status_code == 200
    r = await api.client.post("/api/v1/templates", headers=vh, json={"name": "n", "type": "public_reply", "body": "hi"})
    assert r.status_code == 403
    r = await api.client.post(
        "/api/v1/workspaces/current/members",
        json={"email": "x@example.com", "role": "owner"},
        headers=api.headers(owner),
    )
    assert r.status_code == 403


async def test_create_second_workspace_and_switch(api: Api) -> None:
    auth = await api.register("multi@example.com")
    h = api.headers(auth)
    r = await api.client.post("/api/v1/workspaces", json={"name": "Second"}, headers=h)
    assert r.status_code == 201
    second = r.json()["id"]
    await api.template(auth)  # goes to default workspace
    assert (await api.client.get("/api/v1/templates", headers=h | {"X-Workspace-ID": second})).json()["total"] == 0
    assert (await api.client.get("/api/v1/templates", headers=h)).json()["total"] == 1
