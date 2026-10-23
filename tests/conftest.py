"""Test harness: real PostgreSQL (migrated with Alembic), fakeredis, and the mock Instagram adapter.

Set TEST_DATABASE_URL to use an existing PostgreSQL; otherwise a local server is started via pgserver.
The test database is dropped and recreated for every run.
"""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import asyncpg
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

TEST_DB = "instaflow_test"


def _prepare_database() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        from local_postgres import start

        url = start(database="postgres")
    base, _, query = url.partition("?")
    admin_url = base.rsplit("/", 1)[0] + "/postgres" + (f"?{query}" if query else "")

    async def _recreate() -> None:
        conn = await asyncpg.connect(admin_url.replace("postgresql+asyncpg://", "postgresql://"))
        try:
            await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
            await conn.execute(f'CREATE DATABASE "{TEST_DB}"')
        finally:
            await conn.close()

    asyncio.run(_recreate())
    return base.rsplit("/", 1)[0] + f"/{TEST_DB}" + (f"?{query}" if query else "")


DATABASE_URL = _prepare_database()
os.environ.update(
    {
        "APP_ENV": "test",
        "DEBUG": "false",
        "SECRET_KEY": "test-secret-key-0123456789abcdef0123456789",
        "DATABASE_URL": DATABASE_URL,
        "REDIS_URL": "redis://localhost:6399/0",
        "INSTAGRAM_MODE": "mock",
        "META_APP_ID": "test-app-id",
        "META_APP_SECRET": "test-app-secret",
        "META_REDIRECT_URI": "https://example.test/api/v1/instagram/callback",
        "META_WEBHOOK_VERIFY_TOKEN": "verify-me",
        "OUTBOX_KICK_ENABLED": "false",
        "AUTH_RATE_LIMIT": "1000",
        "ACTION_RETRY_BASE_SECONDS": "0",
        "LOG_LEVEL": "WARNING",
    }
)

from alembic.config import Config  # noqa: E402

from alembic import command  # noqa: E402

_alembic_cfg = Config(str(ROOT / "alembic.ini"))
_alembic_cfg.set_main_option("script_location", str(ROOT / "alembic"))
_alembic_cfg.attributes["configure_logger"] = False
command.upgrade(_alembic_cfg, "head")

import fakeredis  # noqa: E402
import httpx  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core import rate_limit  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.redis import set_redis  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import Database, build_engine, get_db, init_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services.instagram import get_mock_client  # noqa: E402
from app.services.instagram.mock_client import MockInstagramClient  # noqa: E402


@pytest.fixture(scope="session")
def alembic_config() -> Config:
    return _alembic_cfg


@pytest.fixture(scope="session")
async def database() -> AsyncIterator[Database]:
    db = init_db(build_engine(get_settings()))
    yield db
    await db.dispose()


@pytest.fixture(autouse=True)
async def _clean_state(database: Database) -> AsyncIterator[None]:
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    set_redis(redis)
    rate_limit.reset_local()
    get_mock_client().reset()
    yield
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    async with database.engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    await redis.aclose()


@pytest.fixture(scope="session")
def app(database: Database) -> Any:
    return create_app(get_settings())


@pytest.fixture
async def client(app: Any) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


@pytest.fixture
def sessionmaker(database: Database) -> Any:
    return get_db().sessionmaker


@pytest.fixture
def mock_ig() -> MockInstagramClient:
    return get_mock_client()


# --- helpers ----------------------------------------------------------------
class Api:
    """Small helper around the HTTP client for authenticated calls."""

    def __init__(self, client: httpx.AsyncClient):
        self.client = client

    async def register(self, email: str, password: str = "s3cure-Passw0rd") -> dict[str, str]:
        r = await self.client.post("/api/v1/auth/register", json={"email": email, "password": password})
        assert r.status_code == 201, r.text
        r = await self.client.post("/api/v1/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        tokens = r.json()
        return {"Authorization": f"Bearer {tokens['access_token']}", "_refresh": tokens["refresh_token"]}

    @staticmethod
    def headers(auth: dict[str, str]) -> dict[str, str]:
        return {k: v for k, v in auth.items() if not k.startswith("_")}

    async def template(self, auth: dict[str, str], **overrides: Any) -> dict[str, Any]:
        body = {
            "name": "Course DM",
            "type": "private_reply",
            "body": "Hey {{username}}! Here is your resource: {{resource_link}}",
            "custom_variables": ["resource_link"],
            "fallbacks": {"username": "there"},
        } | overrides
        r = await self.client.post("/api/v1/templates", json=body, headers=self.headers(auth))
        assert r.status_code == 201, r.text
        return dict(r.json())

    async def campaign(
        self, auth: dict[str, str], template_id: str, *, activate: bool = True, **overrides: Any
    ) -> dict[str, Any]:
        body = {
            "name": "Course launch",
            "mode": "simulation",
            "media_external_id": "test-media-001",
            "config": {
                "actions": [{"type": "private_reply", "template_id": template_id}],
                "variables": {"resource_link": "https://example.com/course"},
            },
            "rules": [
                {"keyword": "course", "match_type": "contains"},
                {"keyword": "spam", "match_type": "keyword", "action": "exclude"},
            ],
        } | overrides
        r = await self.client.post("/api/v1/campaigns", json=body, headers=self.headers(auth))
        assert r.status_code == 201, r.text
        campaign = dict(r.json())
        if activate:
            r = await self.client.post(f"/api/v1/campaigns/{campaign['id']}/activate", headers=self.headers(auth))
            assert r.status_code == 200, r.text
            campaign = dict(r.json())
        return campaign

    async def simulate(self, auth: dict[str, str], campaign_id: str, **overrides: Any) -> httpx.Response:
        body = {
            "campaign_id": campaign_id,
            "comment_id": "test-comment-001",
            "username": "example_user",
            "comment_text": "COURSE please send me the link",
            "follower_status": "unknown",
        } | overrides
        return await self.client.post("/api/v1/dev/simulate-comment", json=body, headers=self.headers(auth))


@pytest.fixture
def api(client: httpx.AsyncClient) -> Api:
    return Api(client)
