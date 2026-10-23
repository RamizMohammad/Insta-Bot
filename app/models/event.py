from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, JSONType, UUIDPrimaryKey, str_enum, utcnow
from app.models.enums import EventSource, EventStatus, OutboxStatus


class WebhookEvent(UUIDPrimaryKey, Base):
    """A received comment event. ``dedupe_key`` is unique, which makes ingestion idempotent."""

    __tablename__ = "webhook_events"
    __table_args__ = (Index("ix_webhook_events_workspace_received", "workspace_id", "received_at"),)

    workspace_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    source: Mapped[EventSource] = mapped_column(str_enum(EventSource))
    external_event_id: Mapped[str | None] = mapped_column(String(128))
    dedupe_key: Mapped[str] = mapped_column(String(255), unique=True)
    event_type: Mapped[str] = mapped_column(String(64))
    # Minimised, normalised event data only (never the raw signed payload).
    payload: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    status: Mapped[EventStatus] = mapped_column(str_enum(EventStatus), default=EventStatus.RECEIVED, index=True)
    attempt_count: Mapped[int] = mapped_column(default=0)
    result: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    error: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    correlation_id: Mapped[str | None] = mapped_column(String(64))
    received_at: Mapped[datetime] = mapped_column(default=utcnow)
    processed_at: Mapped[datetime | None]


class OutboxMessage(UUIDPrimaryKey, Base):
    """Transactional outbox: written in the same transaction as the state change it announces."""

    __tablename__ = "outbox_messages"
    __table_args__ = (Index("ix_outbox_messages_status_available", "status", "available_at"),)

    topic: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    status: Mapped[OutboxStatus] = mapped_column(str_enum(OutboxStatus), default=OutboxStatus.PENDING)
    attempts: Mapped[int] = mapped_column(default=0)
    available_at: Mapped[datetime] = mapped_column(default=utcnow)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    dispatched_at: Mapped[datetime | None]
