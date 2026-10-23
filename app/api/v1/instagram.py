from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.dependencies import AdminDep, SessionmakerDep, WorkspaceDep
from app.schemas.instagram import ConnectionOut, ConnectResponse, MediaOut
from app.services.instagram_service import InstagramService

router = APIRouter(prefix="/instagram", tags=["instagram"])


@router.get("/connect", response_model=ConnectResponse)
async def connect(ctx: AdminDep, sessionmaker: SessionmakerDep) -> ConnectResponse:
    """Start OAuth. In mock mode the URL loops straight back to the callback (no Meta involved)."""
    start = await InstagramService(sessionmaker).start_connect(ctx.workspace_id, ctx.user.id)
    return ConnectResponse(authorization_url=start.authorization_url, mode=start.mode, expires_in=start.expires_in)


@router.get("/callback", response_model=ConnectionOut)
async def callback(
    sessionmaker: SessionmakerDep,
    code: Annotated[str | None, Query(max_length=2048)] = None,
    state: Annotated[str | None, Query(max_length=256)] = None,
    error: Annotated[str | None, Query(max_length=128)] = None,
) -> ConnectionOut:
    """OAuth redirect target. Authorised by the single-use ``state`` bound to the initiating user."""
    connection = await InstagramService(sessionmaker).complete_connect(code, state, error)
    return ConnectionOut.model_validate(connection)


@router.get("/accounts", response_model=list[ConnectionOut])
async def accounts(ctx: WorkspaceDep, sessionmaker: SessionmakerDep) -> list[ConnectionOut]:
    rows = await InstagramService(sessionmaker).list_connections(ctx.workspace_id)
    return [ConnectionOut.model_validate(c) for c in rows]


@router.get("/accounts/{account_id}/media", response_model=list[MediaOut])
async def account_media(
    account_id: uuid.UUID,
    ctx: WorkspaceDep,
    sessionmaker: SessionmakerDep,
    sync: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
) -> list[MediaOut]:
    """List media for a connection (``account_id`` is the connection ID). ``sync=true`` refreshes from Instagram."""
    rows = await InstagramService(sessionmaker).media(ctx.workspace_id, account_id, sync=sync, limit=limit)
    return [MediaOut.model_validate(m) for m in rows]


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(account_id: uuid.UUID, ctx: AdminDep, sessionmaker: SessionmakerDep) -> None:
    await InstagramService(sessionmaker).disconnect(ctx.workspace_id, account_id)
