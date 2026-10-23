from __future__ import annotations

from app.core.config import get_settings
from tests.conftest import Api

PASSWORD = "s3cure-Passw0rd"


async def test_register_login_me(api: Api) -> None:
    auth = await api.register("Ana@Example.com")
    r = await api.client.get("/api/v1/auth/me", headers=api.headers(auth))
    assert r.status_code == 200
    assert r.json()["email"] == "ana@example.com"
    assert "password_hash" not in r.json()
    r = await api.client.get("/api/v1/workspaces", headers=api.headers(auth))
    assert [w["role"] for w in r.json()] == ["owner"]


async def test_duplicate_registration_is_generic(api: Api) -> None:
    await api.register("dup@example.com")
    r = await api.client.post("/api/v1/auth/register", json={"email": "dup@example.com", "password": PASSWORD})
    assert r.status_code == 409
    assert "already" not in r.json()["error"]["message"].lower()


async def test_weak_password_rejected(api: Api) -> None:
    r = await api.client.post("/api/v1/auth/register", json={"email": "w@example.com", "password": "aaaaaaaaaa"})
    assert r.status_code == 422


async def test_login_errors_do_not_leak_existence(api: Api) -> None:
    await api.register("known@example.com")
    unknown = await api.client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": PASSWORD})
    wrong = await api.client.post("/api/v1/auth/login", json={"email": "known@example.com", "password": "nope"})
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["error"]["message"] == wrong.json()["error"]["message"]


async def test_refresh_rotation_and_reuse_detection(api: Api) -> None:
    auth = await api.register("rot@example.com")
    first = auth["_refresh"]
    r = await api.client.post("/api/v1/auth/refresh", json={"refresh_token": first})
    assert r.status_code == 200
    second = r.json()["refresh_token"]
    assert second != first
    # Reusing the rotated token is treated as theft: the whole family is revoked.
    assert (await api.client.post("/api/v1/auth/refresh", json={"refresh_token": first})).status_code == 401
    assert (await api.client.post("/api/v1/auth/refresh", json={"refresh_token": second})).status_code == 401


async def test_logout_revokes_refresh_and_access(api: Api) -> None:
    auth = await api.register("out@example.com")
    headers = api.headers(auth)
    r = await api.client.post("/api/v1/auth/logout", json={"refresh_token": auth["_refresh"]}, headers=headers)
    assert r.status_code == 204
    assert (await api.client.get("/api/v1/auth/me", headers=headers)).status_code == 401
    r = await api.client.post("/api/v1/auth/refresh", json={"refresh_token": auth["_refresh"]})
    assert r.status_code == 401


async def test_logout_all_sessions(api: Api) -> None:
    auth = await api.register("all@example.com")
    r = await api.client.post("/api/v1/auth/login", json={"email": "all@example.com", "password": PASSWORD})
    other_refresh = r.json()["refresh_token"]
    await api.client.post("/api/v1/auth/logout", json={"all_sessions": True}, headers=api.headers(auth))
    assert (await api.client.post("/api/v1/auth/refresh", json={"refresh_token": other_refresh})).status_code == 401


async def test_expired_refresh_token_rejected(api: Api, sessionmaker) -> None:
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update

    from app.models import RefreshToken

    auth = await api.register("exp@example.com")
    async with sessionmaker() as s, s.begin():
        await s.execute(update(RefreshToken).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    r = await api.client.post("/api/v1/auth/refresh", json={"refresh_token": auth["_refresh"]})
    assert r.status_code == 401


async def test_missing_and_invalid_tokens(api: Api) -> None:
    assert (await api.client.get("/api/v1/auth/me")).status_code == 401
    r = await api.client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"


async def test_disabled_user_cannot_authenticate(api: Api, sessionmaker) -> None:
    from sqlalchemy import update

    from app.models import User
    from app.models.enums import UserStatus

    auth = await api.register("off@example.com")
    async with sessionmaker() as s, s.begin():
        await s.execute(update(User).values(status=UserStatus.DISABLED))
    assert (await api.client.get("/api/v1/auth/me", headers=api.headers(auth))).status_code == 401


async def test_change_password_revokes_sessions(api: Api) -> None:
    auth = await api.register("pw@example.com")
    r = await api.client.post(
        "/api/v1/users/me/password",
        json={"current_password": PASSWORD, "new_password": "an0ther-Passw0rd"},
        headers=api.headers(auth),
    )
    assert r.status_code == 204
    assert (await api.client.post("/api/v1/auth/refresh", json={"refresh_token": auth["_refresh"]})).status_code == 401
    r = await api.client.post("/api/v1/auth/login", json={"email": "pw@example.com", "password": "an0ther-Passw0rd"})
    assert r.status_code == 200


async def test_login_rate_limited(api: Api, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "auth_rate_limit", 3)
    body = {"email": "rl@example.com", "password": "wrong-pass-1"}
    codes = [(await api.client.post("/api/v1/auth/login", json=body)).status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401]
    assert codes[3:] == [429, 429]
