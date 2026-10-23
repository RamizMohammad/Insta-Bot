"""Registration, login, refresh-token rotation and logout."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from redis.exceptions import RedisError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.exceptions import AuthenticationError, Conflict
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_token,
    password_needs_rehash,
    verify_password,
)
from app.models import RefreshToken, User, Workspace, WorkspaceMember
from app.models.enums import UserStatus, WorkspaceRole
from app.schemas.auth import TokenPair
from app.utils.time import is_past

logger = get_logger(__name__)
_DENYLIST_PREFIX = "auth:denylist:"


class AuthService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None):
        self.session = session
        self.settings = settings or get_settings()

    async def register(self, email: str, password: str, workspace_name: str | None = None) -> User:
        # Deliberately generic: do not confirm which emails are registered.
        failure = Conflict("Registration could not be completed with these details.", code="registration_failed")
        if await self.session.scalar(select(User.id).where(User.email == email)) is not None:
            raise failure
        user = User(email=email, password_hash=hash_password(password))
        self.session.add(user)
        try:
            await self.session.flush()
        except IntegrityError as exc:  # concurrent registration with the same email
            await self.session.rollback()
            raise failure from exc
        workspace = Workspace(name=workspace_name or f"{email.split('@', maxsplit=1)[0]}'s workspace", owner_id=user.id)
        self.session.add(workspace)
        await self.session.flush()
        self.session.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=WorkspaceRole.OWNER))
        await self.session.commit()
        return user

    async def authenticate(self, email: str, password: str) -> User:
        user = await self.session.scalar(select(User).where(User.email == email))
        # verify_password always runs a hash comparison, so timing does not reveal unknown emails.
        valid = verify_password(password, user.password_hash if user else None)
        if not user or not valid or user.status is not UserStatus.ACTIVE:
            raise AuthenticationError("Invalid email or password.")
        if user.password_hash and password_needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
        return user

    async def issue_tokens(self, user: User, family_id: uuid.UUID | None = None) -> TokenPair:
        access, expires_in = create_access_token(user.id, self.settings)
        refresh = generate_refresh_token()
        self.session.add(
            RefreshToken(
                user_id=user.id,
                token_hash=hash_token(refresh),
                family_id=family_id or uuid.uuid4(),
                expires_at=datetime.now(UTC) + timedelta(days=self.settings.refresh_token_ttl_days),
            )
        )
        await self.session.commit()
        return TokenPair(access_token=access, refresh_token=refresh, expires_in=expires_in)

    async def login(self, email: str, password: str) -> TokenPair:
        return await self.issue_tokens(await self.authenticate(email, password))

    async def refresh(self, refresh_token: str) -> TokenPair:
        """Rotate a refresh token. Reusing a revoked token revokes its whole family (theft signal)."""
        token = await self.session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh_token)).with_for_update()
        )
        if token is None:
            raise AuthenticationError()
        now = datetime.now(UTC)
        if token.revoked_at is not None:
            await self._revoke_family(token.family_id, now)
            await self.session.commit()
            logger.warning("refresh_token_reuse_detected", extra={"user_id": str(token.user_id)})
            raise AuthenticationError()
        if is_past(token.expires_at):
            raise AuthenticationError()
        user = await self.session.get(User, token.user_id)
        if user is None or user.status is not UserStatus.ACTIVE:
            raise AuthenticationError()
        token.revoked_at = now
        return await self.issue_tokens(user, family_id=token.family_id)

    async def logout(
        self, user: User, *, refresh_token: str | None, all_sessions: bool, access_claims: dict[str, object]
    ) -> None:
        now = datetime.now(UTC)
        if all_sessions:
            await self.session.execute(
                update(RefreshToken)
                .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
                .values(revoked_at=now)
            )
        elif refresh_token:
            token = await self.session.scalar(
                select(RefreshToken).where(
                    RefreshToken.token_hash == hash_token(refresh_token), RefreshToken.user_id == user.id
                )
            )
            if token is not None:
                await self._revoke_family(token.family_id, now)
        await self.session.commit()
        await self.deny_access_token(access_claims)

    async def _revoke_family(self, family_id: uuid.UUID, now: datetime) -> None:
        await self.session.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )

    @staticmethod
    async def deny_access_token(claims: dict[str, object]) -> None:
        """Block the current access token until it expires (best effort; tokens are short-lived)."""
        jti, exp = claims.get("jti"), claims.get("exp")
        if not isinstance(jti, str) or not isinstance(exp, int | float):
            return
        ttl = max(int(exp - datetime.now(UTC).timestamp()), 1)
        try:
            await get_redis().set(_DENYLIST_PREFIX + jti, "1", ex=ttl)
        except (RedisError, OSError):
            logger.warning("access_token_denylist_unavailable")

    @staticmethod
    async def is_access_token_denied(jti: str | None) -> bool:
        if not jti:
            return False
        try:
            return bool(await get_redis().exists(_DENYLIST_PREFIX + jti))
        except (RedisError, OSError):
            return False

    async def change_password(self, user: User, current: str, new: str) -> None:
        if not verify_password(current, user.password_hash):
            raise AuthenticationError("Current password is incorrect.")
        user.password_hash = hash_password(new)
        await self.session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
        await self.session.commit()
