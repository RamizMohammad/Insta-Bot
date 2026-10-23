"""Workspace-level overview metrics for the dashboard (aggregated in SQL, no row loading)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AutomationExecution, Campaign, InstagramConnection, WebhookEvent
from app.models.enums import ActionType, CampaignStatus, ConnectionStatus, ExecutionStatus
from app.schemas.analytics import (
    ActionTotals,
    AttentionItem,
    CampaignCounts,
    CampaignExecutionStats,
    DailyPoint,
    Overview,
)
from app.utils.time import as_aware

_PENDING = (ExecutionStatus.QUEUED, ExecutionStatus.IN_PROGRESS, ExecutionStatus.RETRY_SCHEDULED)
_TOKEN_WARNING_WINDOW = timedelta(days=7)


class AnalyticsService:
    def __init__(self, session: AsyncSession, workspace_id: uuid.UUID):
        self.session = session
        self.workspace_id = workspace_id

    async def overview(self, days: int) -> Overview:
        now = datetime.now(UTC)
        since = now - timedelta(days=days)
        previous_since = since - timedelta(days=days)
        ws = self.workspace_id

        received = func.count().filter(WebhookEvent.received_at >= since)
        previous = func.count().filter(WebhookEvent.received_at < since)
        comments, comments_previous, last_event_at = (
            await self.session.execute(
                select(received, previous, func.max(WebhookEvent.received_at)).where(
                    WebhookEvent.workspace_id == ws, WebhookEvent.received_at >= previous_since
                )
            )
        ).one()

        in_window = (AutomationExecution.workspace_id == ws, AutomationExecution.created_at >= since)
        matched_events = await self.session.scalar(
            select(func.count(func.distinct(AutomationExecution.event_id))).where(*in_window)
        )
        totals = ActionTotals()
        rows = await self.session.execute(
            select(
                AutomationExecution.status,
                AutomationExecution.action_type,
                AutomationExecution.is_simulated,
                func.count(),
            )
            .where(*in_window)
            .group_by(AutomationExecution.status, AutomationExecution.action_type, AutomationExecution.is_simulated)
        )
        for status, action_type, _simulated, count in rows:
            totals.total += count
            if status is ExecutionStatus.SIMULATED:
                totals.simulated += count
            elif status is ExecutionStatus.SUCCEEDED:
                totals.succeeded += count
                if action_type is ActionType.PUBLIC_REPLY:
                    totals.public_replies += count
                else:
                    totals.private_replies += count
            elif status is ExecutionStatus.FAILED:
                totals.failed += count
            elif status is ExecutionStatus.UNKNOWN:
                totals.unknown += count
            elif status is ExecutionStatus.MANUAL_REVIEW:
                totals.manual_review += count
            elif status in (ExecutionStatus.SKIPPED, ExecutionStatus.CANCELLED):
                totals.skipped += count
            elif status in _PENDING:
                totals.pending += count
        attempted_live = totals.succeeded + totals.failed + totals.unknown

        day = cast(func.date_trunc("day", AutomationExecution.created_at), Date)
        daily_rows = await self.session.execute(
            select(day, AutomationExecution.status, AutomationExecution.action_type, func.count())
            .where(
                *in_window,
                AutomationExecution.status.in_([ExecutionStatus.SUCCEEDED, ExecutionStatus.SIMULATED]),
            )
            .group_by(day, AutomationExecution.status, AutomationExecution.action_type)
        )
        by_day: dict[date, DailyPoint] = {}
        for d, status, action_type, count in daily_rows:
            point = by_day.setdefault(d, DailyPoint(date=d, live=0, simulated=0))
            kind = "live" if status is ExecutionStatus.SUCCEEDED else "simulated"
            suffix = "public" if action_type is ActionType.PUBLIC_REPLY else "private"
            setattr(point, kind, getattr(point, kind) + count)
            setattr(point, f"{kind}_{suffix}", getattr(point, f"{kind}_{suffix}") + count)
        start = since.date()
        daily = [
            by_day.get(d) or DailyPoint(date=d, live=0, simulated=0)
            for d in (start + timedelta(days=i) for i in range(days + 1))
        ]

        campaign_rows = await self.session.execute(
            select(
                AutomationExecution.campaign_id,
                func.count(),
                func.count().filter(AutomationExecution.is_simulated.is_(True)),
                func.count().filter(AutomationExecution.status.in_([ExecutionStatus.FAILED, ExecutionStatus.UNKNOWN])),
                func.max(AutomationExecution.created_at),
            )
            .where(AutomationExecution.workspace_id == ws, AutomationExecution.campaign_id.is_not(None))
            .group_by(AutomationExecution.campaign_id)
        )
        campaign_stats = [
            CampaignExecutionStats(
                campaign_id=cid, total=total, simulated=sim, live=total - sim, problems=problems, last_execution_at=last
            )
            for cid, total, sim, problems, last in campaign_rows
        ]

        status_rows = await self.session.execute(
            select(Campaign.status, func.count()).where(Campaign.workspace_id == ws).group_by(Campaign.status)
        )
        by_status = {str(s): c for s, c in status_rows}
        campaigns = CampaignCounts(
            total=sum(by_status.values()),
            active=by_status.get(CampaignStatus.ACTIVE, 0),
            paused=by_status.get(CampaignStatus.PAUSED, 0),
            draft=by_status.get(CampaignStatus.DRAFT, 0),
            stopped=by_status.get(CampaignStatus.STOPPED, 0),
        )

        return Overview(
            period_days=days,
            comments_received=comments,
            comments_previous=comments_previous,
            comments_matched=matched_events or 0,
            last_event_at=last_event_at,
            actions=totals,
            success_rate=round(totals.succeeded / attempted_live, 4) if attempted_live else None,
            daily=daily,
            campaigns=campaigns,
            campaign_stats=campaign_stats,
            attention=await self._attention(since, now),
        )

    async def _attention(self, since: datetime, now: datetime) -> list[AttentionItem]:
        items: list[AttentionItem] = []
        connections = await self.session.scalars(
            select(InstagramConnection).where(
                InstagramConnection.workspace_id == self.workspace_id,
                InstagramConnection.status != ConnectionStatus.REVOKED,
            )
        )
        for conn in connections:
            handle = f"@{conn.username}" if conn.username else conn.instagram_account_id
            expires = as_aware(conn.token_expires_at) if conn.token_expires_at else None
            if conn.status in (ConnectionStatus.EXPIRED, ConnectionStatus.ERROR):
                items.append(
                    AttentionItem(
                        kind="connection",
                        severity="critical",
                        title=f"{handle} needs reconnecting",
                        detail="The Instagram connection is no longer authorised. Live campaigns on it cannot send.",
                        connection_id=conn.id,
                    )
                )
            elif expires is not None and expires - now < _TOKEN_WARNING_WINDOW:
                left = max((expires - now).days, 0)
                items.append(
                    AttentionItem(
                        kind="connection",
                        severity="warning",
                        title=f"{handle} token expires in {left} day{'s' if left != 1 else ''}",
                        detail="Reconnect or wait for the automatic refresh to avoid interruptions.",
                        connection_id=conn.id,
                    )
                )

        problem_rows = await self.session.execute(
            select(
                Campaign.id,
                Campaign.name,
                func.count().filter(AutomationExecution.status == ExecutionStatus.FAILED),
                func.count().filter(AutomationExecution.status == ExecutionStatus.UNKNOWN),
                func.count().filter(AutomationExecution.status == ExecutionStatus.MANUAL_REVIEW),
            )
            .join(AutomationExecution, AutomationExecution.campaign_id == Campaign.id)
            .where(Campaign.workspace_id == self.workspace_id, AutomationExecution.created_at >= since)
            .group_by(Campaign.id, Campaign.name)
        )
        for cid, name, failed, unknown, review in problem_rows:
            if failed or unknown:
                parts = [f"{failed} failed"] if failed else []
                parts += [f"{unknown} with unknown outcome"] if unknown else []
                items.append(
                    AttentionItem(
                        kind="failures",
                        severity="critical" if unknown else "warning",
                        title=name,
                        detail=", ".join(parts) + ".",
                        campaign_id=cid,
                        count=failed + unknown,
                    )
                )
            if review:
                items.append(
                    AttentionItem(
                        kind="manual_review",
                        severity="info",
                        title=name,
                        detail=f"{review} action{'s' if review != 1 else ''} waiting for manual review.",
                        campaign_id=cid,
                        count=review,
                    )
                )
        order = {"critical": 0, "warning": 1, "info": 2}
        return sorted(items, key=lambda i: order[i.severity])
