from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, JSONType, Timestamps, UUIDPrimaryKey, str_enum, utcnow
from app.models.enums import TemplateType


class MessageTemplate(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "message_templates"
    __table_args__ = (UniqueConstraint("workspace_id", "name"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[TemplateType] = mapped_column(str_enum(TemplateType))
    body: Mapped[str] = mapped_column(Text)
    variables: Mapped[list[str]] = mapped_column(JSONType, default=list)
    fallbacks: Mapped[dict[str, str]] = mapped_column(JSONType, default=dict)
    action_config: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    version: Mapped[int] = mapped_column(default=1)


class MessageTemplateVersion(UUIDPrimaryKey, Base):
    """Immutable audit record of every template revision."""

    __tablename__ = "message_template_versions"
    __table_args__ = (UniqueConstraint("template_id", "version"),)

    template_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("message_templates.id", ondelete="CASCADE"))
    version: Mapped[int]
    name: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(Text)
    variables: Mapped[list[str]] = mapped_column(JSONType, default=list)
    fallbacks: Mapped[dict[str, str]] = mapped_column(JSONType, default=dict)
    changed_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
