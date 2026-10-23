from __future__ import annotations

import uuid

from fastapi import APIRouter, status
from sqlalchemy import func, select

from app.api.dependencies import AdminDep, CurrentUser, SessionDep, WorkspaceDep
from app.core.exceptions import Conflict, NotFound, PermissionDenied
from app.models import User, Workspace, WorkspaceMember
from app.models.enums import WorkspaceRole
from app.schemas.workspace import MemberAdd, MemberOut, MemberUpdate, WorkspaceCreate, WorkspaceOut, WorkspaceUpdate

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _out(workspace: Workspace, role: WorkspaceRole) -> WorkspaceOut:
    return WorkspaceOut.model_validate(workspace).model_copy(update={"role": role})


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
async def create_workspace(body: WorkspaceCreate, user: CurrentUser, session: SessionDep) -> WorkspaceOut:
    workspace = Workspace(name=body.name, owner_id=user.id)
    session.add(workspace)
    await session.flush()
    session.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=WorkspaceRole.OWNER))
    await session.commit()
    return _out(workspace, WorkspaceRole.OWNER)


@router.get("", response_model=list[WorkspaceOut])
async def list_workspaces(user: CurrentUser, session: SessionDep) -> list[WorkspaceOut]:
    rows = await session.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user.id)
        .order_by(Workspace.created_at)
    )
    return [_out(ws, role) for ws, role in rows.all()]


@router.get("/current", response_model=WorkspaceOut)
async def current_workspace(ctx: WorkspaceDep) -> WorkspaceOut:
    return _out(ctx.workspace, ctx.role)


@router.patch("/current", response_model=WorkspaceOut)
async def update_workspace(body: WorkspaceUpdate, ctx: AdminDep, session: SessionDep) -> WorkspaceOut:
    if body.name is not None:
        ctx.workspace.name = body.name
    await session.commit()
    return _out(ctx.workspace, ctx.role)


@router.get("/current/members", response_model=list[MemberOut])
async def list_members(ctx: WorkspaceDep, session: SessionDep) -> list[MemberOut]:
    rows = await session.scalars(
        select(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == ctx.workspace_id)
        .order_by(WorkspaceMember.created_at)
    )
    return [MemberOut.model_validate(m) for m in rows]


@router.post("/current/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
async def add_member(body: MemberAdd, ctx: AdminDep, session: SessionDep) -> MemberOut:
    if body.role is WorkspaceRole.OWNER:
        raise PermissionDenied("Ownership cannot be granted through membership.")
    user = await session.scalar(select(User).where(User.email == body.email.lower()))
    if user is None:
        raise NotFound("No user with that email can be added.")
    exists = await session.scalar(
        select(func.count()).where(WorkspaceMember.workspace_id == ctx.workspace_id, WorkspaceMember.user_id == user.id)
    )
    if exists:
        raise Conflict("User is already a member.")
    member = WorkspaceMember(workspace_id=ctx.workspace_id, user_id=user.id, role=body.role)
    session.add(member)
    await session.commit()
    return MemberOut.model_validate(member)


async def _get_member(session: SessionDep, workspace_id: uuid.UUID, member_id: uuid.UUID) -> WorkspaceMember:
    member = await session.scalar(
        select(WorkspaceMember).where(WorkspaceMember.id == member_id, WorkspaceMember.workspace_id == workspace_id)
    )
    if member is None:
        raise NotFound("Member not found.")
    if member.role is WorkspaceRole.OWNER:
        raise PermissionDenied("The workspace owner cannot be changed or removed.")
    return member


@router.patch("/current/members/{member_id}", response_model=MemberOut)
async def update_member(member_id: uuid.UUID, body: MemberUpdate, ctx: AdminDep, session: SessionDep) -> MemberOut:
    member = await _get_member(session, ctx.workspace_id, member_id)
    if body.role is WorkspaceRole.OWNER:
        raise PermissionDenied("Ownership cannot be granted through membership.")
    member.role = body.role
    await session.commit()
    return MemberOut.model_validate(member)


@router.delete("/current/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(member_id: uuid.UUID, ctx: AdminDep, session: SessionDep) -> None:
    await session.delete(await _get_member(session, ctx.workspace_id, member_id))
    await session.commit()
