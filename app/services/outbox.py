"""Transactional outbox relay: moves committed outbox rows onto the task queue."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.logging import get_logger
from app.models import OutboxMessage
from app.models.enums import OutboxStatus

logger = get_logger(__name__)
Publisher = Callable[[str, dict[str, Any]], None]


async def relay_outbox(
    sessionmaker: async_sessionmaker[AsyncSession], publish: Publisher, batch_size: int = 100
) -> int:
    """Publish due messages. Safe to run concurrently (SKIP LOCKED) and at-least-once by design:
    consumers are idempotent, so a crash between publish and commit only causes a harmless re-delivery.
    """
    published = 0
    async with sessionmaker() as session, session.begin():
        rows = (
            await session.scalars(
                select(OutboxMessage)
                .where(OutboxMessage.status == OutboxStatus.PENDING, OutboxMessage.available_at <= datetime.now(UTC))
                .order_by(OutboxMessage.available_at)
                .limit(batch_size)
                .with_for_update(skip_locked=True)
            )
        ).all()
        for message in rows:
            message.attempts += 1
            try:
                publish(message.topic, message.payload)
            except Exception:
                logger.exception("outbox_publish_failed", extra={"topic": message.topic})
                break
            message.status = OutboxStatus.DISPATCHED
            message.dispatched_at = datetime.now(UTC)
            published += 1
    return published


async def purge_dispatched(sessionmaker: async_sessionmaker[AsyncSession], older_than_days: int = 7) -> int:
    cutoff = datetime.now(UTC) - timedelta(days=older_than_days)
    async with sessionmaker() as session, session.begin():
        result = await session.execute(
            delete(OutboxMessage).where(
                OutboxMessage.status == OutboxStatus.DISPATCHED, OutboxMessage.dispatched_at < cutoff
            )
        )
    return int(getattr(result, "rowcount", 0) or 0)
