"""Celery tasks. Each worker process owns one event loop and one DB engine (reused across tasks)."""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from celery.signals import worker_process_shutdown

from app.core.config import get_settings
from app.core.logging import configure_logging, correlation_id_var, get_logger
from app.core.redis import WORKER_HEARTBEAT_KEY, get_redis
from app.db.session import Database, build_engine
from app.services.automation_service import AutomationService
from app.services.instagram_service import InstagramService
from app.services.outbox import purge_dispatched, relay_outbox
from app.workers.celery_app import TASK_FOR_TOPIC, celery_app

logger = get_logger(__name__)

_runner: asyncio.Runner | None = None
_db: Database | None = None


def _run[T](factory: Callable[[Database], Awaitable[T]], correlation_id: str | None = None) -> T:
    global _runner, _db
    if _runner is None:
        configure_logging(get_settings().log_level)
        _runner = asyncio.Runner()
    if _db is None:
        _db = Database(build_engine())
    database = _db

    async def _with_context() -> T:
        token = correlation_id_var.set(correlation_id or uuid.uuid4().hex)
        try:
            return await factory(database)
        finally:
            correlation_id_var.reset(token)

    return _runner.run(_with_context())


@worker_process_shutdown.connect
def _shutdown(**_: Any) -> None:
    """Graceful shutdown: dispose pooled connections and close the loop."""
    global _runner, _db
    if _runner is not None:
        if _db is not None:
            _runner.run(_db.dispose())
        _runner.close()
    _runner, _db = None, None


def publish(topic: str, payload: dict[str, Any]) -> None:
    celery_app.send_task(TASK_FOR_TOPIC[topic], kwargs=payload, correlation_id=correlation_id_var.get())


def _service(db: Database) -> AutomationService:
    return AutomationService(db.sessionmaker)


@celery_app.task(name="instaflow.relay_outbox", ignore_result=True)
def relay_outbox_task() -> int:
    settings = get_settings()
    return _run(lambda db: relay_outbox(db.sessionmaker, publish, settings.outbox_batch_size))


@celery_app.task(
    name="instaflow.process_event",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=2,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=5,
)
def process_event_task(self: Any, event_id: str) -> dict[str, Any]:
    result = _run(
        lambda db: _service(db).process_event(uuid.UUID(event_id)), correlation_id=self.request.correlation_id
    )
    if result.queued_execution_ids:
        relay_outbox_task.delay()
    return {"status": str(result.status), "queued": len(result.queued_execution_ids)}


@celery_app.task(
    name="instaflow.execute_action",
    bind=True,
    autoretry_for=(ConnectionError, OSError),
    retry_backoff=2,
    retry_backoff_max=120,
    retry_jitter=True,
    max_retries=5,
)
def execute_action_task(self: Any, execution_id: str) -> dict[str, Any]:
    # Adapter failures are classified and rescheduled through the outbox by the service itself;
    # only infrastructure errors (DB/Redis unreachable before any send) are retried by Celery.
    outcome = _run(
        lambda db: _service(db).execute_action(uuid.UUID(execution_id)), correlation_id=self.request.correlation_id
    )
    return {"status": str(outcome.status), "retry_in": outcome.retry_in}


@celery_app.task(name="instaflow.reap_stale_executions", ignore_result=True)
def reap_stale_executions_task() -> int:
    return _run(lambda db: _service(db).reap_stale_executions())


@celery_app.task(name="instaflow.refresh_tokens", ignore_result=True)
def refresh_tokens_task() -> int:
    return _run(lambda db: InstagramService(db.sessionmaker).refresh_expiring_tokens())


@celery_app.task(name="instaflow.purge_outbox", ignore_result=True)
def purge_outbox_task() -> int:
    return _run(lambda db: purge_dispatched(db.sessionmaker))


@celery_app.task(name="instaflow.heartbeat", ignore_result=True)
def heartbeat_task() -> None:
    async def _beat(_: Database) -> None:
        await get_redis().set(WORKER_HEARTBEAT_KEY, str(time.time()), ex=300)

    _run(_beat)
