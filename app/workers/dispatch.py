"""Best-effort nudge from the API to the outbox relay (the periodic relay is the safety net)."""

from __future__ import annotations

import asyncio

from app.core.config import get_settings
from app.core.logging import get_logger
from app.workers.celery_app import celery_app

logger = get_logger(__name__)


async def kick_outbox_relay() -> None:
    if not get_settings().outbox_kick_enabled:
        return
    try:
        await asyncio.wait_for(
            asyncio.to_thread(celery_app.send_task, "instaflow.relay_outbox", retry=False), timeout=3.0
        )
    except Exception:  # noqa: BLE001 - the periodic relay will pick the work up
        logger.warning("outbox_kick_failed")
