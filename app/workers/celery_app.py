"""Celery application (Redis broker). Start with: ``celery -A app.workers.celery_app worker -B``."""

from __future__ import annotations

from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "instaflow", broker=settings.broker_url, backend=settings.result_backend, include=["app.workers.tasks"]
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    result_expires=3600,
    task_ignore_result=True,
    timezone="UTC",
    enable_utc=True,
    # Reliability: ack after completion, requeue if the worker dies, one task at a time per process.
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=int(settings.action_timeout_seconds * 3),
    task_time_limit=int(settings.action_timeout_seconds * 4),
    broker_connection_retry_on_startup=True,
    broker_transport_options={"visibility_timeout": 3600},
    task_default_queue="instaflow",
    worker_send_task_events=False,
    beat_schedule={
        "relay-outbox": {"task": "instaflow.relay_outbox", "schedule": settings.outbox_relay_interval_seconds},
        "reap-stale-executions": {"task": "instaflow.reap_stale_executions", "schedule": 60.0},
        "worker-heartbeat": {"task": "instaflow.heartbeat", "schedule": 30.0},
        "refresh-instagram-tokens": {"task": "instaflow.refresh_tokens", "schedule": 6 * 3600.0},
        "purge-outbox": {"task": "instaflow.purge_outbox", "schedule": 24 * 3600.0},
    },
)

TASK_FOR_TOPIC = {"process_event": "instaflow.process_event", "execute_action": "instaflow.execute_action"}
