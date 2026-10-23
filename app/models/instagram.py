from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, JSONType, Timestamps, UUIDPrimaryKey, str_enum, utcnow
from app.models.enums import ConnectionAuthMethod, ConnectionStatus


class InstagramConnection(UUIDPrimaryKey, Timestamps, Base):
    """A workspace's link to an Instagram professional account. Tokens are Fernet-encrypted."""

    __tablename__ = "instagram_connections"
    __table_args__ = (UniqueConstraint("workspace_id", "instagram_account_id"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    instagram_account_id: Mapped[str] = mapped_column(String(64), index=True)
    username: Mapped[str | None] = mapped_column(String(64))
    auth_method: Mapped[ConnectionAuthMethod] = mapped_column(str_enum(ConnectionAuthMethod))
    encrypted_access_token: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None]
    status: Mapped[ConnectionStatus] = mapped_column(str_enum(ConnectionStatus), default=ConnectionStatus.ACTIVE)
    granted_permissions: Mapped[list[str]] = mapped_column(JSONType, default=list)
    last_synced_at: Mapped[datetime | None]


class InstagramMedia(UUIDPrimaryKey, Base):
    __tablename__ = "instagram_media"
    __table_args__ = (
        UniqueConstraint("connection_id", "external_media_id"),
        Index("ix_instagram_media_workspace_external", "workspace_id", "external_media_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("instagram_connections.id", ondelete="CASCADE"))
    external_media_id: Mapped[str] = mapped_column(String(64))
    media_type: Mapped[str | None] = mapped_column(String(32))
    permalink: Mapped[str | None] = mapped_column(String(512))
    caption: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime | None]
    synced_at: Mapped[datetime] = mapped_column(default=utcnow)


class OAuthState(UUIDPrimaryKey, Base):
    """Single-use OAuth ``state`` value bound to the initiating user and workspace."""

    __tablename__ = "oauth_states"

    state_hash: Mapped[str] = mapped_column(String(64), unique=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    extra: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
