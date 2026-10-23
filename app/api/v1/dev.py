"""Simulation mode: run a fake comment through the real workflow using the mock adapter."""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select

from app.api.dependencies import MemberDep, SessionmakerDep, SettingsDep
from app.core.exceptions import NotFound
from app.models import AutomationExecution, Campaign, WebhookEvent
from app.models.enums import ErrorCategory, EventSource
from app.schemas.execution import SimulateCommentRequest, SimulateCommentResponse
from app.services.automation_service import AutomationService
from app.services.execution_view import present
from app.services.instagram import get_mock_client
from app.services.instagram.base import CommentEvent

router = APIRouter(prefix="/dev", tags=["simulation"])


@router.post("/simulate-comment", response_model=SimulateCommentResponse)
async def simulate_comment(
    body: SimulateCommentRequest, ctx: MemberDep, sessionmaker: SessionmakerDep, settings: SettingsDep
) -> SimulateCommentResponse:
    """Available in development/test, or for workspaces explicitly authorised for testing.

    The event goes through the same rule engine, eligibility checks, deduplication and execution
    pipeline as live webhooks, but every action is executed by the mock adapter and recorded as simulated.
    """
    permitted = (
        settings.is_dev_or_test
        or ctx.workspace.is_test_workspace
        or str(ctx.workspace_id) in settings.simulation_workspace_allowlist
    )
    if not permitted:
        raise NotFound()

    async with sessionmaker() as session:
        campaign = await session.scalar(
            select(Campaign).where(Campaign.id == body.campaign_id, Campaign.workspace_id == ctx.workspace_id)
        )
    if campaign is None:
        raise NotFound("Campaign not found.")

    event = CommentEvent(
        comment_id=body.comment_id,
        media_id=body.media_id or campaign.media_external_id or "",
        text=body.comment_text,
        account_id="simulated-account",
        commenter_id=body.commenter_id,
        username=body.username,
        parent_id=body.parent_id,
        follower_status=body.follower_status,
    )
    service = AutomationService(sessionmaker, settings)
    ingested = await service.ingest(
        event,
        source=EventSource.SIMULATION,
        scope=str(ctx.workspace_id),
        workspace_id=ctx.workspace_id,
        extra={"campaign_id": str(campaign.id)},
        enqueue=False,
    )
    if ingested.created:
        processed = await service.process_event(ingested.event_id, enqueue_actions=False)
        if body.fault != "none" and processed.queued_execution_ids:
            get_mock_client().fail_next(ErrorCategory(body.fault), message=f"injected {body.fault} failure")
        for execution_id in processed.queued_execution_ids:
            await service.execute_action(execution_id)

    async with sessionmaker() as session:
        stored = await session.get(WebhookEvent, ingested.event_id)
        assert stored is not None
        executions = (
            await session.scalars(
                select(AutomationExecution)
                .where(AutomationExecution.event_id == stored.id)
                .order_by(AutomationExecution.created_at)
            )
        ).all()
        return SimulateCommentResponse(
            event_id=stored.id,
            duplicate=not ingested.created,
            event_status=stored.status,
            result=stored.result,
            executions=await present(session, executions),
        )
