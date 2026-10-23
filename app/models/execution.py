from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, JSONType, UUIDPrimaryKey, str_enum, utcnow
from app.models.enums import ActionType, ErrorCategory, ExecutionStatus


class AutomationExecution(UUIDPrimaryKey, Base):
    """One planned action for (event, campaign). The unique constraint prevents duplicate actions."""

    __tablename__ = "automation_executions"
    __table_args__ = (
        UniqueConstraint("event_id", "campaign_id", "action_type"),
        Index("ix_automation_executions_workspace_created", "workspace_id", "created_at"),
        Index("ix_automation_executions_campaign_status", "campaign_id", "status"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("campaigns.id", ondelete="SET NULL"))
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("webhook_events.id", ondelete="CASCADE"), index=True)
    lead_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"))
    connection_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("instagram_connections.id", ondelete="SET NULL"))
    template_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("message_templates.id", ondelete="SET NULL"))
    action_type: Mapped[ActionType] = mapped_column(str_enum(ActionType))
    status: Mapped[ExecutionStatus] = mapped_column(str_enum(ExecutionStatus), default=ExecutionStatus.QUEUED)
    is_simulated: Mapped[bool] = mapped_column(default=False)
    matched_rules: Mapped[list[dict[str, Any]]] = mapped_column(JSONType, default=list)
    evaluation: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    rendered_message: Mapped[str | None] = mapped_column(Text)
    attempt_count: Mapped[int] = mapped_column(default=0)
    external_response_id: Mapped[str | None] = mapped_column(String(128))
    error_category: Mapped[ErrorCategory | None] = mapped_column(str_enum(ErrorCategory))
    error_detail: Mapped[str | None] = mapped_column(Text)
    next_attempt_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    started_at: Mapped[datetime | None]
    completed_at: Mapped[datetime | None]
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
