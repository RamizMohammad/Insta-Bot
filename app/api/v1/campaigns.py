from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.dependencies import MemberDep, SessionDep, WorkspaceDep
from app.models.enums import CampaignStatus, OperatingMode
from app.schemas.campaign import (
    CampaignAnalytics,
    CampaignCreate,
    CampaignOut,
    CampaignTestRequest,
    CampaignTestResult,
    CampaignUpdate,
)
from app.schemas.common import DateRange, Page, PageParams, date_range, page_params
from app.services.campaign_service import CampaignService

router = APIRouter(prefix="/campaigns", tags=["campaigns"])
PageDep = Annotated[PageParams, Depends(page_params)]
DatesDep = Annotated[DateRange, Depends(date_range)]


@router.post("", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
async def create_campaign(body: CampaignCreate, ctx: MemberDep, session: SessionDep) -> CampaignOut:
    return CampaignOut.model_validate(await CampaignService(session, ctx.workspace).create(body))


@router.get("", response_model=Page[CampaignOut])
async def list_campaigns(
    ctx: WorkspaceDep,
    session: SessionDep,
    params: PageDep,
    dates: DatesDep,
    status_: Annotated[CampaignStatus | None, Query(alias="status")] = None,
    mode: OperatingMode | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
) -> Page[CampaignOut]:
    items, total = await CampaignService(session, ctx.workspace).list_campaigns(params, status_, mode, search, dates)
    return Page(
        items=[CampaignOut.model_validate(c) for c in items], total=total, limit=params.limit, offset=params.offset
    )


@router.get("/{campaign_id}", response_model=CampaignOut)
async def get_campaign(campaign_id: uuid.UUID, ctx: WorkspaceDep, session: SessionDep) -> CampaignOut:
    return CampaignOut.model_validate(await CampaignService(session, ctx.workspace).get(campaign_id))


@router.patch("/{campaign_id}", response_model=CampaignOut)
async def update_campaign(
    campaign_id: uuid.UUID, body: CampaignUpdate, ctx: MemberDep, session: SessionDep
) -> CampaignOut:
    return CampaignOut.model_validate(await CampaignService(session, ctx.workspace).update(campaign_id, body))


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_campaign(campaign_id: uuid.UUID, ctx: MemberDep, session: SessionDep) -> None:
    await CampaignService(session, ctx.workspace).delete(campaign_id)


def _transition_route(action: str) -> None:
    async def _handler(campaign_id: uuid.UUID, ctx: MemberDep, session: SessionDep) -> CampaignOut:
        return CampaignOut.model_validate(await CampaignService(session, ctx.workspace).transition(campaign_id, action))

    _handler.__name__ = f"{action}_campaign"
    router.add_api_route(
        f"/{{campaign_id}}/{action}",
        _handler,
        methods=["POST"],
        response_model=CampaignOut,
        summary=f"{action.capitalize()} campaign",
    )


for _action in ("activate", "pause", "resume", "stop"):
    _transition_route(_action)


@router.post("/{campaign_id}/test", response_model=CampaignTestResult)
async def test_campaign(
    campaign_id: uuid.UUID, body: CampaignTestRequest, ctx: WorkspaceDep, session: SessionDep
) -> CampaignTestResult:
    """Dry-run a comment through the rules and templates. Never sends anything to Instagram."""
    return await CampaignService(session, ctx.workspace).test(campaign_id, body)


@router.get("/{campaign_id}/analytics", response_model=CampaignAnalytics)
async def campaign_analytics(
    campaign_id: uuid.UUID, ctx: WorkspaceDep, session: SessionDep, dates: DatesDep
) -> CampaignAnalytics:
    return await CampaignService(session, ctx.workspace).analytics(campaign_id, dates)
