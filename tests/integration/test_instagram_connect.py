from __future__ import annotations

from urllib.parse import parse_qs, urlparse

from sqlalchemy import select

from app.models import InstagramConnection
from tests.conftest import Api


async def _connect(api: Api, auth) -> dict:
    r = await api.client.get("/api/v1/instagram/connect", headers=api.headers(auth))
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "mock"
    query = parse_qs(urlparse(r.json()["authorization_url"]).query)
    r = await api.client.get(
        "/api/v1/instagram/callback", params={"code": query["code"][0], "state": query["state"][0]}
    )
    assert r.status_code == 200, r.text
    return {"connection": r.json(), "state": query["state"][0], "code": query["code"][0]}


async def test_mock_oauth_flow_and_media_sync(api: Api, sessionmaker) -> None:
    auth = await api.register("ig@example.com")
    result = await _connect(api, auth)
    connection = result["connection"]
    assert connection["status"] == "active"
    assert connection["auth_method"] == "mock"
    assert "encrypted_access_token" not in connection

    async with sessionmaker() as s:
        stored = await s.scalar(select(InstagramConnection))
    assert stored.encrypted_access_token and "mock-token" not in stored.encrypted_access_token

    accounts = (await api.client.get("/api/v1/instagram/accounts", headers=api.headers(auth))).json()
    assert [a["id"] for a in accounts] == [connection["id"]]
    media = (
        await api.client.get(
            f"/api/v1/instagram/accounts/{connection['id']}/media", params={"sync": "true"}, headers=api.headers(auth)
        )
    ).json()
    assert len(media) == 5
    assert media[0]["external_media_id"].startswith("test-media-")

    # Campaign can target synced media by ID; the external ID is derived server-side.
    template = await api.template(auth)
    campaign = await api.campaign(auth, template["id"], media_external_id=None, media_id=media[0]["id"])
    assert campaign["media_external_id"] == media[0]["external_media_id"]
    assert campaign["connection_id"] == connection["id"]


async def test_oauth_state_is_single_use_and_bound(api: Api) -> None:
    auth = await api.register("state@example.com")
    result = await _connect(api, auth)
    replay = await api.client.get(
        "/api/v1/instagram/callback", params={"code": result["code"], "state": result["state"]}
    )
    assert replay.status_code == 401
    forged = await api.client.get("/api/v1/instagram/callback", params={"code": "mock-code-x", "state": "forged"})
    assert forged.status_code == 401
    assert (await api.client.get("/api/v1/instagram/callback", params={"code": "x"})).status_code == 401


async def test_oauth_denied(api: Api) -> None:
    auth = await api.register("deny@example.com")
    r = await api.client.get("/api/v1/instagram/connect", headers=api.headers(auth))
    state = parse_qs(urlparse(r.json()["authorization_url"]).query)["state"][0]
    r = await api.client.get("/api/v1/instagram/callback", params={"state": state, "error": "access_denied"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "oauth_denied"


async def test_disconnect_and_isolation(api: Api) -> None:
    auth = await api.register("dc@example.com")
    connection = (await _connect(api, auth))["connection"]
    other = await api.register("dc-other@example.com")
    assert (
        await api.client.get(f"/api/v1/instagram/accounts/{connection['id']}/media", headers=api.headers(other))
    ).status_code == 404
    assert (
        await api.client.delete(f"/api/v1/instagram/accounts/{connection['id']}", headers=api.headers(other))
    ).status_code == 404
    assert (
        await api.client.delete(f"/api/v1/instagram/accounts/{connection['id']}", headers=api.headers(auth))
    ).status_code == 204
    accounts = (await api.client.get("/api/v1/instagram/accounts", headers=api.headers(auth))).json()
    assert accounts[0]["status"] == "revoked"
    r = await api.client.get(
        f"/api/v1/instagram/accounts/{connection['id']}/media", params={"sync": "true"}, headers=api.headers(auth)
    )
    assert r.status_code == 422
