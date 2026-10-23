"""Instagram account connection (OAuth), media sync and token lifecycle."""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import InstagramMode, Settings, get_settings
from app.core.exceptions import AuthenticationError, IntegrationError, ValidationFailed
from app.core.logging import get_logger
from app.core.security import decrypt_secret, encrypt_secret, hash_token
from app.models import InstagramConnection, InstagramMedia, OAuthState
from app.models.enums import ConnectionAuthMethod, ConnectionStatus
from app.repositories.resources import ConnectionRepository, MediaRepository
from app.services.instagram import get_connection_client, get_live_client, get_mock_client
from app.services.instagram.base import AdapterError, InstagramClient
from app.utils.time import is_past

logger = get_logger(__name__)
WEBHOOK_FIELDS = ["comments"]


@dataclass(slots=True)
class ConnectStart:
    authorization_url: str
    mode: str
    expires_in: int


def client_for_connection(connection: InstagramConnection, settings: Settings | None = None) -> InstagramClient:
    if connection.auth_method is ConnectionAuthMethod.MOCK:
        return get_mock_client()
    return get_live_client(settings)


class InstagramService:
    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession], settings: Settings | None = None):
        self.sessionmaker = sessionmaker
        self.settings = settings or get_settings()

    async def start_connect(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> ConnectStart:
        client = get_connection_client(self.settings)
        state = secrets.token_urlsafe(32)
        async with self.sessionmaker() as session, session.begin():
            session.add(
                OAuthState(
                    state_hash=hash_token(state),
                    workspace_id=workspace_id,
                    user_id=user_id,
                    expires_at=datetime.now(UTC) + timedelta(seconds=self.settings.oauth_state_ttl_seconds),
                )
            )
        return ConnectStart(client.build_authorization_url(state), client.name, self.settings.oauth_state_ttl_seconds)

    async def complete_connect(self, code: str | None, state: str | None, error: str | None) -> InstagramConnection:
        if not state:
            raise AuthenticationError("Missing OAuth state.", code="oauth_state_invalid")
        # 1) Consume the single-use state (short transaction).
        async with self.sessionmaker() as session, session.begin():
            oauth_state = await session.scalar(
                select(OAuthState).where(OAuthState.state_hash == hash_token(state)).with_for_update()
            )
            now = datetime.now(UTC)
            if oauth_state is None or oauth_state.used_at is not None or is_past(oauth_state.expires_at):
                raise AuthenticationError("OAuth state is invalid or expired.", code="oauth_state_invalid")
            oauth_state.used_at = now
            workspace_id = oauth_state.workspace_id
        if error:
            raise AuthenticationError("Instagram authorization was denied.", code="oauth_denied")
        if not code:
            raise ValidationFailed("Missing authorization code.")

        # 2) Talk to Instagram with no transaction open.
        client = get_connection_client(self.settings)
        try:
            grant = await client.exchange_code(code)
            account = await client.get_account(grant.access_token)
        except AdapterError as exc:
            raise IntegrationError("Instagram token exchange failed.", details={"category": str(exc.category)}) from exc
        subscribed = False
        try:
            subscribed = await client.subscribe_webhooks(grant.access_token, account.account_id, WEBHOOK_FIELDS)
        except AdapterError as exc:
            logger.warning("webhook_subscription_failed", extra={"category": str(exc.category)})

        # 3) Persist the connection with the token encrypted at rest.
        auth_method = (
            ConnectionAuthMethod.INSTAGRAM_LOGIN
            if self.settings.instagram_mode is InstagramMode.LIVE
            else ConnectionAuthMethod.MOCK
        )
        values = {
            "username": account.username,
            "auth_method": auth_method,
            "encrypted_access_token": encrypt_secret(grant.access_token, self.settings),
            "token_expires_at": grant.expires_at,
            "status": ConnectionStatus.ACTIVE,
            "granted_permissions": grant.permissions,
            "last_synced_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
        }
        async with self.sessionmaker() as session, session.begin():
            stmt = pg_insert(InstagramConnection).values(
                id=uuid.uuid4(),
                workspace_id=workspace_id,
                instagram_account_id=account.account_id,
                created_at=datetime.now(UTC),
                **values,
            )
            connection_id = await session.scalar(
                stmt.on_conflict_do_update(
                    constraint="uq_instagram_connections_workspace_id_instagram_account_id", set_=values
                ).returning(InstagramConnection.id)
            )
            connection = await session.get(InstagramConnection, connection_id)
            assert connection is not None
        logger.info("instagram_connected", extra={"connection_id": str(connection.id), "webhooks": subscribed})
        return connection

    async def list_connections(self, workspace_id: uuid.UUID) -> list[InstagramConnection]:
        async with self.sessionmaker() as session:
            rows = await session.scalars(
                select(InstagramConnection)
                .where(InstagramConnection.workspace_id == workspace_id)
                .order_by(InstagramConnection.created_at)
            )
            return list(rows)

    async def disconnect(self, workspace_id: uuid.UUID, connection_id: uuid.UUID) -> None:
        async with self.sessionmaker() as session, session.begin():
            connection = await ConnectionRepository(session, workspace_id).get(connection_id, for_update=True)
            connection.status = ConnectionStatus.REVOKED
            connection.encrypted_access_token = None

    async def media(
        self, workspace_id: uuid.UUID, connection_id: uuid.UUID, *, sync: bool, limit: int = 25
    ) -> list[InstagramMedia]:
        async with self.sessionmaker() as session:
            connection = await ConnectionRepository(session, workspace_id).get(connection_id)
        if sync:
            await self._sync_media(connection, limit)
        async with self.sessionmaker() as session:
            rows = await session.scalars(
                MediaRepository(session, workspace_id)
                .scoped()
                .where(InstagramMedia.connection_id == connection.id)
                .order_by(InstagramMedia.published_at.desc().nulls_last())
                .limit(limit)
            )
            return list(rows)

    async def _sync_media(self, connection: InstagramConnection, limit: int) -> None:
        if connection.status is not ConnectionStatus.ACTIVE or not connection.encrypted_access_token:
            raise ValidationFailed("The Instagram connection is not active. Reconnect the account.")
        client = client_for_connection(connection, self.settings)
        try:
            items = await client.list_media(decrypt_secret(connection.encrypted_access_token, self.settings), limit)
        except AdapterError as exc:
            raise IntegrationError(
                "Could not fetch media from Instagram.", details={"category": str(exc.category)}
            ) from exc
        now = datetime.now(UTC)
        async with self.sessionmaker() as session, session.begin():
            for item in items:
                values = {
                    "media_type": item.media_product_type or item.media_type,
                    "permalink": item.permalink,
                    "caption": item.caption,
                    "published_at": item.timestamp,
                    "synced_at": now,
                }
                await session.execute(
                    pg_insert(InstagramMedia)
                    .values(
                        id=uuid.uuid4(),
                        workspace_id=connection.workspace_id,
                        connection_id=connection.id,
                        external_media_id=item.id,
                        **values,
                    )
                    .on_conflict_do_update(constraint="uq_instagram_media_connection_id_external_media_id", set_=values)
                )
            conn = await session.get(InstagramConnection, connection.id)
            if conn is not None:
                conn.last_synced_at = now

    async def refresh_expiring_tokens(self, within: timedelta = timedelta(days=7)) -> int:
        """Refresh long-lived tokens nearing expiry; mark connections expired when refresh fails."""
        async with self.sessionmaker() as session:
            connections = (
                await session.scalars(
                    select(InstagramConnection).where(
                        InstagramConnection.status == ConnectionStatus.ACTIVE,
                        InstagramConnection.auth_method == ConnectionAuthMethod.INSTAGRAM_LOGIN,
                        InstagramConnection.token_expires_at.is_not(None),
                        InstagramConnection.token_expires_at < datetime.now(UTC) + within,
                    )
                )
            ).all()
        refreshed = 0
        for connection in connections:
            assert connection.encrypted_access_token is not None
            try:
                grant = await get_live_client(self.settings).refresh_token(
                    decrypt_secret(connection.encrypted_access_token, self.settings)
                )
                values = {
                    "encrypted_access_token": encrypt_secret(grant.access_token, self.settings),
                    "token_expires_at": grant.expires_at,
                }
                refreshed += 1
            except AdapterError as exc:
                logger.warning("token_refresh_failed", extra={"connection_id": str(connection.id)})
                values = {"status": ConnectionStatus.EXPIRED} if not exc.retryable else {}
            if values:
                async with self.sessionmaker() as session, session.begin():
                    conn = await session.get(InstagramConnection, connection.id, with_for_update=True)
                    if conn is not None:
                        for key, value in values.items():
                            setattr(conn, key, value)
        return refreshed
