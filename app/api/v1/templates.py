from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.dependencies import MemberDep, SessionDep, WorkspaceDep
from app.models.enums import TemplateType
from app.schemas.common import Page, PageParams, page_params
from app.schemas.template import (
    TemplateCreate,
    TemplateOut,
    TemplatePreviewRequest,
    TemplatePreviewResponse,
    TemplateUpdate,
    TemplateVersionOut,
)
from app.services.template_service import TemplateService

router = APIRouter(prefix="/templates", tags=["templates"])


@router.post("", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(body: TemplateCreate, ctx: MemberDep, session: SessionDep) -> TemplateOut:
    return TemplateOut.model_validate(await TemplateService(session, ctx.workspace_id, ctx.user).create(body))


@router.get("", response_model=Page[TemplateOut])
async def list_templates(
    ctx: WorkspaceDep,
    session: SessionDep,
    params: Annotated[PageParams, Depends(page_params)],
    type_: Annotated[TemplateType | None, Query(alias="type")] = None,
) -> Page[TemplateOut]:
    items, total = await TemplateService(session, ctx.workspace_id).list_templates(params, type_)
    return Page(
        items=[TemplateOut.model_validate(t) for t in items], total=total, limit=params.limit, offset=params.offset
    )


@router.get("/{template_id}", response_model=TemplateOut)
async def get_template(template_id: uuid.UUID, ctx: WorkspaceDep, session: SessionDep) -> TemplateOut:
    return TemplateOut.model_validate(await TemplateService(session, ctx.workspace_id).get(template_id))


@router.patch("/{template_id}", response_model=TemplateOut)
async def update_template(
    template_id: uuid.UUID, body: TemplateUpdate, ctx: MemberDep, session: SessionDep
) -> TemplateOut:
    service = TemplateService(session, ctx.workspace_id, ctx.user)
    return TemplateOut.model_validate(await service.update(template_id, body))


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: uuid.UUID, ctx: MemberDep, session: SessionDep) -> None:
    await TemplateService(session, ctx.workspace_id).delete(template_id)


@router.get("/{template_id}/versions", response_model=list[TemplateVersionOut])
async def template_versions(template_id: uuid.UUID, ctx: WorkspaceDep, session: SessionDep) -> list[TemplateVersionOut]:
    rows = await TemplateService(session, ctx.workspace_id).versions(template_id)
    return [TemplateVersionOut.model_validate(v) for v in rows]


@router.post("/{template_id}/preview", response_model=TemplatePreviewResponse)
async def preview_template(
    template_id: uuid.UUID, body: TemplatePreviewRequest, ctx: WorkspaceDep, session: SessionDep
) -> TemplatePreviewResponse:
    return await TemplateService(session, ctx.workspace_id).preview(template_id, body.variables)
