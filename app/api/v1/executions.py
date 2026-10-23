from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy import func, select

from app.api.dependencies import MemberDep, SessionDep, SessionmakerDep, WorkspaceDep
from app.models import AutomationExecution, Lead, WebhookEvent
from app.models.enums import ActionType, EventStatus, ExecutionStatus
from app.repositories.resources import EventRepository, ExecutionRepository
from app.schemas.common import DateRange, Page, PageParams, date_range, page_params
from app.schemas.execution import EventOut, ExecutionOut, ResolveExecutionRequest
from app.services.automation_service import AutomationService
from app.services.execution_view import present
from app.workers.dispatch import kick_outbox_relay

router = APIRouter(tags=["executions"])
PageDep = Annotated[PageParams, Depends(page_params)]
DatesDep = Annotated[DateRange, Depends(date_range)]


@router.get("/executions", response_model=Page[ExecutionOut])
async def list_executions(
    ctx: WorkspaceDep,
    session: SessionDep,
    params: PageDep,
    dates: DatesDep,
    campaign_id: uuid.UUID | None = None,
    status: ExecutionStatus | None = None,
    action_type: ActionType | None = None,
    simulated: bool | None = None,
    search: Annotated[str | None, Query(max_length=64, description="Commenter username contains")] = None,
) -> Page[ExecutionOut]:
    filters = []
    if campaign_id:
        filters.append(AutomationExecution.campaign_id == campaign_id)
    if status:
        filters.append(AutomationExecution.status == status)
    if action_type:
        filters.append(AutomationExecution.action_type == action_type)
    if simulated is not None:
        filters.append(AutomationExecution.is_simulated.is_(simulated))
    if search:
        pattern = f"%{search.lstrip('@').replace('%', '').replace('_', '')}%"
        filters.append(
            AutomationExecution.lead_id.in_(
                select(Lead.id).where(Lead.workspace_id == ctx.workspace_id, Lead.username.ilike(pattern))
            )
        )
    items, total = await ExecutionRepository(session, ctx.workspace_id).paginate(params, filters, dates)
    return Page(items=await present(session, items), total=total, limit=params.limit, offset=params.offset)


@router.get("/executions/stats", response_model=dict[str, int])
async def execution_stats(
    ctx: WorkspaceDep,
    session: SessionDep,
    dates: DatesDep,
    campaign_id: uuid.UUID | None = None,
    simulated: bool | None = None,
) -> dict[str, int]:
    """Execution counts by status (plus ``total``) for the filter chips and summary cards."""
    stmt = select(AutomationExecution.status, func.count()).where(AutomationExecution.workspace_id == ctx.workspace_id)
    if campaign_id:
        stmt = stmt.where(AutomationExecution.campaign_id == campaign_id)
    if simulated is not None:
        stmt = stmt.where(AutomationExecution.is_simulated.is_(simulated))
    if dates.created_from:
        stmt = stmt.where(AutomationExecution.created_at >= dates.created_from)
    if dates.created_to:
        stmt = stmt.where(AutomationExecution.created_at <= dates.created_to)
    counts = {str(status): count for status, count in await session.execute(stmt.group_by(AutomationExecution.status))}
    return {**dict.fromkeys(map(str, ExecutionStatus), 0), **counts, "total": sum(counts.values())}


@router.get("/executions/{execution_id}", response_model=ExecutionOut)
async def get_execution(execution_id: uuid.UUID, ctx: WorkspaceDep, session: SessionDep) -> ExecutionOut:
    [execution] = await present(session, [await ExecutionRepository(session, ctx.workspace_id).get(execution_id)])
    return execution


@router.post("/executions/{execution_id}/retry", response_model=ExecutionOut)
async def retry_execution(
    execution_id: uuid.UUID, ctx: MemberDep, sessionmaker: SessionmakerDep, background: BackgroundTasks
) -> ExecutionOut:
    """Re-queue a failed or manual-review execution. Refused when a previous send may have succeeded."""
    execution = await AutomationService(sessionmaker).manual_retry(ctx.workspace_id, execution_id)
    background.add_task(kick_outbox_relay)
    return ExecutionOut.model_validate(execution)


@router.post("/executions/{execution_id}/resolve", response_model=ExecutionOut)
async def resolve_execution(
    execution_id: uuid.UUID, body: ResolveExecutionRequest, ctx: MemberDep, sessionmaker: SessionmakerDep
) -> ExecutionOut:
    """Record what a person verified on Instagram for an ``unknown`` outcome.

    ``delivered=true`` marks it succeeded. ``delivered=false`` marks it failed, which makes a manual
    retry safe because the message is known not to have been sent.
    """
    execution = await AutomationService(sessionmaker).resolve_unknown(ctx.workspace_id, execution_id, body.delivered)
    return ExecutionOut.model_validate(execution)


@router.get("/events", response_model=Page[EventOut], tags=["events"])
async def list_events(
    ctx: WorkspaceDep,
    session: SessionDep,
    params: PageDep,
    dates: DatesDep,
    status: Annotated[EventStatus | None, Query()] = None,
) -> Page[EventOut]:
    filters = [WebhookEvent.status == status] if status else []
    items, total = await EventRepository(session, ctx.workspace_id).paginate(params, filters, dates)
    return Page(
        items=[EventOut.model_validate(e) for e in items], total=total, limit=params.limit, offset=params.offset
    )


@router.get("/events/{event_id}", response_model=EventOut, tags=["events"])
async def get_event(event_id: uuid.UUID, ctx: WorkspaceDep, session: SessionDep) -> EventOut:
    return EventOut.model_validate(await EventRepository(session, ctx.workspace_id).get(event_id))
