"""Health checks, migrations, error format and worker task wiring."""

from __future__ import annotations

import asyncio

import pytest
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from tests.conftest import Api


async def test_liveness_and_readiness(api: Api) -> None:
    r = await api.client.get("/health")
    assert r.json()["status"] == "ok"
    r = await api.client.get("/ready")
    assert r.status_code == 200
    assert r.json()["checks"]["database"]["ok"] is True
    assert r.json()["checks"]["redis"]["ok"] is True
    assert (await api.client.get("/api/v1/health")).status_code == 200


async def test_readiness_fails_when_redis_down(api: Api) -> None:
    from redis.asyncio import Redis

    from app.core.redis import set_redis

    set_redis(Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.2))
    r = await api.client.get("/ready")
    assert r.status_code == 503
    assert r.json()["checks"]["redis"]["ok"] is False


async def test_error_format_and_correlation_id(api: Api) -> None:
    r = await api.client.get("/api/v1/campaigns", headers={"X-Request-ID": "req-12345678"})
    assert r.status_code == 401
    assert r.headers["x-request-id"] == "req-12345678"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.json()["error"]["correlation_id"] == "req-12345678"
    r = await api.client.post("/api/v1/auth/login", json={"email": "not-an-email"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


async def test_simulation_disabled_outside_development(api: Api, monkeypatch) -> None:
    from app.core.config import Environment, get_settings

    auth = await api.register("prodsim@example.com")
    template = await api.template(auth)
    campaign = await api.campaign(auth, template["id"])
    monkeypatch.setattr(get_settings(), "app_env", Environment.PRODUCTION)
    r = await api.simulate(auth, campaign["id"])
    assert r.status_code == 404


def test_migrations_roundtrip_and_match_models(alembic_config: Config, database) -> None:
    """Downgrade to base and back on a scratch database, then assert no model drift."""
    import os

    import asyncpg

    url = os.environ["DATABASE_URL"]
    base, _, query = url.partition("?")
    scratch = base.rsplit("/", 1)[0] + "/instaflow_migration_check" + (f"?{query}" if query else "")
    admin = (base.rsplit("/", 1)[0] + "/postgres" + (f"?{query}" if query else "")).replace("+asyncpg", "")

    async def _recreate() -> None:
        conn = await asyncpg.connect(admin)
        await conn.execute('DROP DATABASE IF EXISTS "instaflow_migration_check" WITH (FORCE)')
        await conn.execute('CREATE DATABASE "instaflow_migration_check"')
        await conn.close()

    asyncio.run(_recreate())
    cfg = Config(alembic_config.config_file_name)
    cfg.set_main_option("script_location", alembic_config.get_main_option("script_location"))
    cfg.set_main_option("sqlalchemy.url", scratch)
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    command.check(cfg)  # raises if models and migrations diverge


async def test_unique_constraints_exist(database) -> None:
    async with database.engine.connect() as conn:
        names = set((await conn.execute(text("SELECT conname FROM pg_constraint WHERE contype = 'u'"))).scalars().all())
    assert {
        "uq_webhook_events_dedupe_key",
        "uq_automation_executions_event_id_campaign_id_action_type",
        "uq_leads_workspace_id_external_user_id",
    } <= names


@pytest.mark.usefixtures("database")
def test_celery_tasks_run_the_same_service() -> None:
    """Exercise the real Celery task functions (eagerly, own event loop and engine)."""
    from app.models.enums import EventSource
    from app.services.automation_service import AutomationService
    from app.services.instagram.base import CommentEvent
    from app.workers import tasks

    try:
        ingested = tasks._run(
            lambda db: AutomationService(db.sessionmaker).ingest(
                CommentEvent(comment_id="celery-1", media_id="m", text="hi", account_id="nobody"),
                source=EventSource.INSTAGRAM,
            )
        )
        result = tasks.process_event_task.apply(kwargs={"event_id": str(ingested.event_id)}).get()
        assert result == {"status": "ignored", "queued": 0}
        assert tasks.reap_stale_executions_task.apply().get() == 0
    finally:
        tasks._shutdown()
