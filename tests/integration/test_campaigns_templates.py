from __future__ import annotations

from tests.conftest import Api


async def test_campaign_crud_pagination_filtering_sorting(api: Api) -> None:
    auth = await api.register("crud@example.com")
    h = api.headers(auth)
    template = await api.template(auth)
    for name in ("Alpha", "Bravo", "Charlie"):
        await api.campaign(auth, template["id"], activate=name == "Bravo", name=name)

    r = await api.client.get("/api/v1/campaigns", params={"limit": 2, "sort": "name"}, headers=h)
    page = r.json()
    assert page["total"] == 3
    assert [c["name"] for c in page["items"]] == ["Alpha", "Bravo"]
    r = await api.client.get("/api/v1/campaigns", params={"status": "active"}, headers=h)
    assert [c["name"] for c in r.json()["items"]] == ["Bravo"]
    r = await api.client.get("/api/v1/campaigns", params={"search": "char"}, headers=h)
    assert r.json()["total"] == 1
    assert (await api.client.get("/api/v1/campaigns", params={"sort": "password"}, headers=h)).status_code == 422

    alpha = next(c for c in page["items"] if c["name"] == "Alpha")
    r = await api.client.patch(
        f"/api/v1/campaigns/{alpha['id']}",
        json={"description": "updated", "rules": [{"keyword": "guide", "match_type": "keyword"}]},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["description"] == "updated"
    assert [x["keyword"] for x in r.json()["rules"]] == ["guide"]
    assert (await api.client.delete(f"/api/v1/campaigns/{alpha['id']}", headers=h)).status_code == 204
    assert (await api.client.get(f"/api/v1/campaigns/{alpha['id']}", headers=h)).status_code == 404


async def test_lifecycle_transitions(api: Api) -> None:
    auth = await api.register("life@example.com")
    h = api.headers(auth)
    template = await api.template(auth)
    campaign = await api.campaign(auth, template["id"], activate=False)
    cid = campaign["id"]
    assert campaign["status"] == "draft"

    async def go(action: str) -> int:
        return (await api.client.post(f"/api/v1/campaigns/{cid}/{action}", headers=h)).status_code

    assert await go("pause") == 409
    assert await go("activate") == 200
    assert (
        await api.client.patch(f"/api/v1/campaigns/{cid}", json={"rules": [{"keyword": "x"}]}, headers=h)
    ).status_code == 409
    assert (await api.client.delete(f"/api/v1/campaigns/{cid}", headers=h)).status_code == 409
    assert await go("pause") == 200
    assert await go("resume") == 200
    assert await go("stop") == 200
    assert await go("resume") == 409
    assert await go("activate") == 409


async def test_activation_requires_complete_configuration(api: Api) -> None:
    auth = await api.register("incomplete@example.com")
    h = api.headers(auth)
    r = await api.client.post("/api/v1/campaigns", json={"name": "Empty"}, headers=h)
    cid = r.json()["id"]
    r = await api.client.post(f"/api/v1/campaigns/{cid}/activate", headers=h)
    assert r.status_code == 422
    message = r.json()["error"]["message"]
    assert "include rule" in message and "media" in message and "action" in message

    template = await api.template(auth)
    r = await api.client.post(
        "/api/v1/campaigns",
        json={
            "name": "Missing var",
            "media_external_id": "m1",
            "rules": [{"keyword": "x"}],
            "config": {"actions": [{"type": "private_reply", "template_id": template["id"]}]},
        },
        headers=h,
    )
    r = await api.client.post(f"/api/v1/campaigns/{r.json()['id']}/activate", headers=h)
    assert r.status_code == 422
    assert r.json()["error"]["details"]["missing_variables"] == ["resource_link"]


async def test_live_campaign_cannot_activate_without_connection(api: Api) -> None:
    auth = await api.register("live@example.com")
    template = await api.template(auth)
    campaign = await api.campaign(auth, template["id"], activate=False, mode="live")
    r = await api.client.post(f"/api/v1/campaigns/{campaign['id']}/activate", headers=api.headers(auth))
    assert r.status_code == 501
    assert r.json()["error"]["code"] == "live_mode_unavailable"


async def test_live_campaign_requires_active_connection_and_permissions(api: Api, monkeypatch, sessionmaker) -> None:
    from app.core.config import InstagramMode, get_settings
    from app.models import InstagramConnection
    from app.models.enums import ConnectionAuthMethod, ConnectionStatus

    monkeypatch.setattr(get_settings(), "instagram_mode", InstagramMode.LIVE)
    auth = await api.register("perm@example.com")
    h = api.headers(auth)
    ws = (await api.client.get("/api/v1/workspaces/current", headers=h)).json()["id"]
    template = await api.template(auth)
    campaign = await api.campaign(auth, template["id"], activate=False, mode="live")
    cid = campaign["id"]
    r = await api.client.post(f"/api/v1/campaigns/{cid}/activate", headers=h)
    assert r.status_code == 422
    assert "connection" in r.json()["error"]["message"]

    async with sessionmaker() as s, s.begin():
        conn = InstagramConnection(
            workspace_id=ws,
            instagram_account_id="1784",
            auth_method=ConnectionAuthMethod.INSTAGRAM_LOGIN,
            encrypted_access_token="x",
            status=ConnectionStatus.ACTIVE,
            granted_permissions=["instagram_business_basic"],
        )
        s.add(conn)
    await api.client.patch(f"/api/v1/campaigns/{cid}", json={"connection_id": str(conn.id)}, headers=h)
    r = await api.client.post(f"/api/v1/campaigns/{cid}/activate", headers=h)
    assert r.status_code == 422
    assert r.json()["error"]["details"]["missing_permissions"] == ["instagram_business_manage_comments"]


async def test_campaign_test_endpoint_never_sends(api: Api, mock_ig) -> None:
    auth = await api.register("dry@example.com")
    template = await api.template(auth)
    campaign = await api.campaign(auth, template["id"])
    r = await api.client.post(
        f"/api/v1/campaigns/{campaign['id']}/test",
        json={"comment_text": "Course please", "username": "ana"},
        headers=api.headers(auth),
    )
    body = r.json()
    assert body["matched"] is True
    assert body["would_execute"] is True
    assert body["sent"] is False
    assert body["actions"][0]["rendered_message"] == "Hey ana! Here is your resource: https://example.com/course"
    assert mock_ig.sent == []
    r = await api.client.get("/api/v1/executions", headers=api.headers(auth))
    assert r.json()["total"] == 0


async def test_rule_validation(api: Api) -> None:
    auth = await api.register("rv@example.com")
    h = api.headers(auth)
    bad = [
        [{"keyword": "two words", "match_type": "keyword"}],
        [{"keyword": "  "}],
        [{"keyword": "a", "group_key": "g", "group_operator": "and"}, {"keyword": "b", "group_key": "g"}],
    ]
    for rules in bad:
        r = await api.client.post("/api/v1/campaigns", json={"name": "x", "rules": rules}, headers=h)
        assert r.status_code == 422, rules


async def test_template_crud_versions_and_preview(api: Api) -> None:
    auth = await api.register("tpl@example.com")
    h = api.headers(auth)
    t = await api.template(auth)
    assert t["variables"] == ["username", "resource_link"]
    assert t["version"] == 1
    r = await api.client.patch(
        f"/api/v1/templates/{t['id']}", json={"body": "Hi {{username}}, see {{resource_link}}"}, headers=h
    )
    assert r.json()["version"] == 2
    versions = (await api.client.get(f"/api/v1/templates/{t['id']}/versions", headers=h)).json()
    assert [v["version"] for v in versions] == [2, 1]
    assert versions[1]["body"].startswith("Hey")

    r = await api.client.post(
        f"/api/v1/templates/{t['id']}/preview", json={"variables": {"resource_link": "https://r"}}, headers=h
    )
    assert r.json()["rendered"] == "Hi there, see https://r"
    assert r.json()["used_fallbacks"] == ["username"]
    r = await api.client.post(f"/api/v1/templates/{t['id']}/preview", json={"variables": {}}, headers=h)
    assert r.status_code == 422

    assert (await api.client.get("/api/v1/templates", params={"type": "public_reply"}, headers=h)).json()["total"] == 0
    dup = await api.client.post(
        "/api/v1/templates", json={"name": "Course DM", "type": "public_reply", "body": "x"}, headers=h
    )
    assert dup.status_code == 409


async def test_template_validation_rejects_unsafe_input(api: Api) -> None:
    auth = await api.register("tv@example.com")
    h = api.headers(auth)
    for body in ("{{ __class__ }}", "Hi {{unknown_var}}", "Hi {{username}", "{% for x in y %}{{username}}"):
        r = await api.client.post(
            "/api/v1/templates", json={"name": body[:10], "type": "public_reply", "body": body}, headers=h
        )
        assert r.status_code == 422, body


async def test_template_in_use_cannot_be_deleted(api: Api) -> None:
    auth = await api.register("inuse@example.com")
    t = await api.template(auth)
    await api.campaign(auth, t["id"])
    r = await api.client.delete(f"/api/v1/templates/{t['id']}", headers=api.headers(auth))
    assert r.status_code == 409


async def test_template_type_must_match_action(api: Api) -> None:
    auth = await api.register("mismatch@example.com")
    public = await api.template(auth, type="public_reply")
    r = await api.client.post(
        "/api/v1/campaigns",
        json={"name": "x", "config": {"actions": [{"type": "private_reply", "template_id": public["id"]}]}},
        headers=api.headers(auth),
    )
    assert r.status_code == 422
