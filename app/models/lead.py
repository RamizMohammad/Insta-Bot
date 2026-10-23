from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, JSONType, Timestamps, UUIDPrimaryKey, utcnow


class Lead(UUIDPrimaryKey, Timestamps, Base):
    """A commenter seen by the workspace. Only platform-provided identifiers are stored."""

    __tablename__ = "leads"
    __table_args__ = (
        UniqueConstraint("workspace_id", "external_user_id"),
        Index("ix_leads_workspace_last_seen", "workspace_id", "last_seen_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    external_user_id: Mapped[str] = mapped_column(String(64))
    username: Mapped[str | None] = mapped_column(String(64))
    tags: Mapped[list[str]] = mapped_column(JSONType, default=list)
    notes: Mapped[str | None] = mapped_column(Text)
    comment_count: Mapped[int] = mapped_column(default=0)
    first_seen_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(default=utcnow)
