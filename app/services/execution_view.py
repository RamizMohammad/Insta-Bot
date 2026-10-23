"""Attach display context (campaign name, commenter, comment) to execution rows for the API."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AutomationExecution, Campaign, Lead, WebhookEvent
from app.schemas.execution import ExecutionOut


def _ids(values: Sequence[uuid.UUID | None]) -> set[uuid.UUID]:
    return {v for v in values if v is not None}


async def present(session: AsyncSession, executions: Sequence[AutomationExecution]) -> list[ExecutionOut]:
    """Three batched lookups regardless of page size (no N+1 queries)."""
    if not executions:
        return []
    campaign_ids = _ids([e.campaign_id for e in executions])
    lead_ids = _ids([e.lead_id for e in executions])
    names: dict[uuid.UUID, str] = {}
    usernames: dict[uuid.UUID, str | None] = {}
    if campaign_ids:
        rows = await session.execute(select(Campaign.id, Campaign.name).where(Campaign.id.in_(campaign_ids)))
        names = dict(rows.all())
    if lead_ids:
        rows_l = await session.execute(select(Lead.id, Lead.username).where(Lead.id.in_(lead_ids)))
        usernames = dict(rows_l.all())
    rows_e = await session.execute(
        select(WebhookEvent.id, WebhookEvent.payload).where(WebhookEvent.id.in_({e.event_id for e in executions}))
    )
    payloads: dict[uuid.UUID, dict[str, Any]] = {eid: payload or {} for eid, payload in rows_e}

    presented = []
    for execution in executions:
        payload = payloads.get(execution.event_id, {})
        presented.append(
            ExecutionOut.model_validate(execution).model_copy(
                update={
                    "campaign_name": names.get(execution.campaign_id) if execution.campaign_id else None,
                    "lead_username": (usernames.get(execution.lead_id) if execution.lead_id else None)
                    or payload.get("username"),
                    "comment_id": payload.get("comment_id"),
                    "comment_text": payload.get("text"),
                    "media_id": payload.get("media_id"),
                }
            )
        )
    return presented
