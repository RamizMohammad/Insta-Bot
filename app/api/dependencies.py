"""Shared FastAPI dependencies: DB session, current user, workspace authorization, rate limits."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core import rate_limit
from app.core.config import Settings, get_settings
from app.core.exceptions import AuthenticationError, NotFound, PermissionDenied
from app.core.security import decode_access_token
from app.db.session import get_db, get_session
from app.models import User, Workspace, WorkspaceMember
from app.models.enums import UserStatus, WorkspaceRole
from app.services.auth_service import AuthService

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
_bearer = HTTPBearer(auto_error=False)

_ROLE_RANK = {WorkspaceRole.VIEWER: 0, WorkspaceRole.MEMBER: 1, WorkspaceRole.ADMIN: 2, WorkspaceRole.OWNER: 3}


@dataclass(slots=True)
class AuthContext:
    user: User
    claims: dict[str, Any]


@dataclass(slots=True)
class WorkspaceContext:
    user: User
    workspace: Workspace
    role: WorkspaceRole

    @property
    def workspace_id(self) -> uuid.UUID:
        return self.workspace.id

    def require(self, minimum: WorkspaceRole) -> None:
        if _ROLE_RANK[self.role] < _ROLE_RANK[minimum]:
            raise PermissionDenied()


async def get_auth_context(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuthContext:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AuthenticationError("Authentication required.")
    claims = decode_access_token(credentials.credentials)
    if await AuthService.is_access_token_denied(claims.get("jti")):
        raise AuthenticationError()
    try:
        user_id = uuid.UUID(str(claims["sub"]))
    except ValueError as exc:
        raise AuthenticationError() from exc
    user = await session.get(User, user_id)
    if user is None or user.status is not UserStatus.ACTIVE:
        raise AuthenticationError()
    return AuthContext(user=user, claims=claims)


AuthDep = Annotated[AuthContext, Depends(get_auth_context)]


async def get_current_user(auth: AuthDep) -> User:
    return auth.user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_workspace_context(
    session: SessionDep,
    user: CurrentUser,
    x_workspace_id: Annotated[
        uuid.UUID | None, Header(description="Workspace to act in. Defaults to your oldest workspace.")
    ] = None,
) -> WorkspaceContext:
    """Resolve the workspace from the header, *always* verifying membership server-side."""
    stmt = (
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user.id)
    )
    if x_workspace_id is not None:
        stmt = stmt.where(Workspace.id == x_workspace_id)
    row = (await session.execute(stmt.order_by(Workspace.created_at).limit(1))).first()
    if row is None:
        # Identical response whether the workspace is missing or the user is not a member.
        raise NotFound("Workspace not found.")
    return WorkspaceContext(user=user, workspace=row[0], role=row[1])


WorkspaceDep = Annotated[WorkspaceContext, Depends(get_workspace_context)]


def require_role(minimum: WorkspaceRole) -> Callable[[WorkspaceContext], Awaitable[WorkspaceContext]]:
    async def _dependency(ctx: WorkspaceDep) -> WorkspaceContext:
        ctx.require(minimum)
        return ctx

    return _dependency


MemberDep = Annotated[WorkspaceContext, Depends(require_role(WorkspaceRole.MEMBER))]
AdminDep = Annotated[WorkspaceContext, Depends(require_role(WorkspaceRole.ADMIN))]


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def auth_rate_limit(scope: str) -> Callable[[Request, Settings], Awaitable[None]]:
    async def _dependency(request: Request, settings: SettingsDep) -> None:
        await rate_limit.hit(
            f"{scope}:{client_ip(request)}", settings.auth_rate_limit, settings.auth_rate_limit_window_seconds
        )

    return _dependency


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return get_db().sessionmaker


SessionmakerDep = Annotated[async_sessionmaker[AsyncSession], Depends(get_sessionmaker)]
