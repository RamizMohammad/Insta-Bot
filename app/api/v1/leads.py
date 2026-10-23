from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.dependencies import MemberDep, SessionDep, WorkspaceDep
from app.schemas.common import DateRange, Page, PageParams, date_range, page_params
from app.schemas.lead import LeadOut, LeadUpdate
from app.services.lead_service import LeadService

router = APIRouter(prefix="/leads", tags=["leads"])


@router.get("", response_model=Page[LeadOut])
async def list_leads(
    ctx: WorkspaceDep,
    session: SessionDep,
    params: Annotated[PageParams, Depends(page_params)],
    dates: Annotated[DateRange, Depends(date_range)],
    search: Annotated[str | None, Query(max_length=64)] = None,
    tag: Annotated[str | None, Query(max_length=40)] = None,
) -> Page[LeadOut]:
    items, total = await LeadService(session, ctx.workspace_id).list_leads(params, search, tag, dates)
    return Page(items=[LeadOut.model_validate(x) for x in items], total=total, limit=params.limit, offset=params.offset)


@router.get("/{lead_id}", response_model=LeadOut)
async def get_lead(lead_id: uuid.UUID, ctx: WorkspaceDep, session: SessionDep) -> LeadOut:
    return LeadOut.model_validate(await LeadService(session, ctx.workspace_id).get(lead_id))


@router.patch("/{lead_id}", response_model=LeadOut)
async def update_lead(lead_id: uuid.UUID, body: LeadUpdate, ctx: MemberDep, session: SessionDep) -> LeadOut:
    return LeadOut.model_validate(await LeadService(session, ctx.workspace_id).update(lead_id, body))


@router.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead(lead_id: uuid.UUID, ctx: MemberDep, session: SessionDep) -> None:
    await LeadService(session, ctx.workspace_id).delete(lead_id)
