from __future__ import annotations

import uuid
from datetime import datetime

from app.models.enums import ConnectionAuthMethod, ConnectionStatus
from app.schemas.common import ORMSchema, Schema


class ConnectResponse(Schema):
    authorization_url: str
    mode: str
    expires_in: int


class ConnectionOut(ORMSchema):
    id: uuid.UUID
    workspace_id: uuid.UUID
    instagram_account_id: str
    username: str | None
    auth_method: ConnectionAuthMethod
    status: ConnectionStatus
    granted_permissions: list[str]
    token_expires_at: datetime | None
    last_synced_at: datetime | None
    created_at: datetime


class MediaOut(ORMSchema):
    id: uuid.UUID
    connection_id: uuid.UUID
    external_media_id: str
    media_type: str | None
    permalink: str | None
    caption: str | None
    published_at: datetime | None
    synced_at: datetime
