"""Comment-event workflow: ingest -> process (rules, eligibility, executions) -> execute actions.

Reliability guarantees
----------------------
* Ingestion is idempotent: ``webhook_events.dedupe_key`` is unique and inserted with ON CONFLICT DO NOTHING.
* Each (event, campaign, action_type) can have at most one execution row (unique constraint), so duplicate
  deliveries or concurrent workers can never create duplicate outgoing actions.
* Work is announced through the transactional outbox in the same transaction as the state change.
* Rows are claimed with ``FOR UPDATE SKIP LOCKED``; no transaction is held open during external HTTP calls.
* Ambiguous send outcomes are recorded as ``unknown`` and never retried automatically.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core import rate_limit
from app.core.config import Settings, get_settings
from app.core.exceptions import Conflict, NotFound, UnsupportedCapability
from app.core.logging import correlation_id_var, get_logger, redact_text
from app.core.security import decrypt_secret
from app.models import (
    AutomationExecution,
    Campaign,
    InstagramConnection,
    Lead,
    MessageTemplate,
    OutboxMessage,
    WebhookEvent,
)
from app.models.enums import (
    ActionType,
    CampaignStatus,
    ConnectionStatus,
    EligibilityDecision,
    ErrorCategory,
    EventSource,
    EventStatus,
    ExecutionStatus,
    OperatingMode,
)
from app.schemas.campaign import CampaignConfig
from app.services import rule_engine, template_renderer
from app.services.campaign_service import build_template_context, to_engine_rules
from app.services.instagram import client_for_mode
from app.services.instagram.base import AdapterError, CommentEvent, InstagramClient, SendResult
from app.utils.backoff import backoff_delay
from app.utils.text import truncate
from app.utils.time import as_aware, is_past

logger = get_logger(__name__)

TOPIC_PROCESS_EVENT = "process_event"
TOPIC_EXECUTE_ACTION = "execute_action"
PRIVATE_REPLY_WINDOW = timedelta(days=7)
_RUNNABLE = (ExecutionStatus.QUEUED, ExecutionStatus.RETRY_SCHEDULED)
_DECISION_STATUS = {
    EligibilityDecision.PROCEED: ExecutionStatus.QUEUED,
    EligibilityDecision.SKIP: ExecutionStatus.SKIPPED,
    EligibilityDecision.MANUAL_REVIEW: ExecutionStatus.MANUAL_REVIEW,
}


@dataclass(slots=True)
class IngestResult:
    event_id: uuid.UUID
    created: bool


@dataclass(slots=True)
class ProcessResult:
    event_id: uuid.UUID
    status: EventStatus | None
    queued_execution_ids: list[uuid.UUID] = field(default_factory=list)
    summary: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class PreparedSend:
    client: InstagramClient
    token: str
    account_id: str
    comment_id: str
    message: str
    action_type: ActionType


@dataclass(slots=True)
class ActionOutcome:
    execution_id: uuid.UUID
    status: ExecutionStatus | None
    retry_in: float | None = None
    detail: str | None = None


class AutomationService:
    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        settings: Settings | None = None,
        client_resolver: Any = client_for_mode,
    ):
        self.sessionmaker = sessionmaker
        self.settings = settings or get_settings()
        self.client_resolver = client_resolver

    # ------------------------------------------------------------------ ingest
    async def ingest(
        self,
        event: CommentEvent,
        *,
        source: EventSource,
        scope: str = "",
        workspace_id: uuid.UUID | None = None,
        extra: dict[str, Any] | None = None,
        enqueue: bool = True,
    ) -> IngestResult:
        """Persist the event (idempotently) and, if new, enqueue processing via the outbox."""
        key = rule_engine.dedupe_key(str(source), event.comment_id, scope)
        payload = {**event.to_payload(), **(extra or {})}
        async with self.sessionmaker() as session, session.begin():
            inserted = await session.scalar(
                pg_insert(WebhookEvent)
                .values(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    source=source,
                    external_event_id=event.comment_id,
                    dedupe_key=key,
                    event_type="comment",
                    payload=payload,
                    status=EventStatus.RECEIVED,
                    attempt_count=0,
                    result={},
                    correlation_id=correlation_id_var.get(),
                    received_at=datetime.now(UTC),
                )
                .on_conflict_do_nothing(index_elements=[WebhookEvent.dedupe_key])
                .returning(WebhookEvent.id)
            )
            if inserted is None:
                existing = await session.scalar(select(WebhookEvent.id).where(WebhookEvent.dedupe_key == key))
                assert existing is not None
                return IngestResult(existing, created=False)
            if enqueue:
                session.add(OutboxMessage(topic=TOPIC_PROCESS_EVENT, payload={"event_id": str(inserted)}))
        return IngestResult(inserted, created=True)

    # ----------------------------------------------------------------- process
    async def process_event(self, event_id: uuid.UUID, *, enqueue_actions: bool = True) -> ProcessResult:
        try:
            async with self.sessionmaker() as session, session.begin():
                event = await session.scalar(
                    select(WebhookEvent).where(WebhookEvent.id == event_id).with_for_update(skip_locked=True)
                )
                if event is None:
                    return ProcessResult(event_id, None, summary={"skipped": "locked or missing"})
                if event.status in (EventStatus.PROCESSED, EventStatus.IGNORED):
                    return ProcessResult(event_id, event.status, summary=event.result)
                event.status = EventStatus.PROCESSING
                event.attempt_count += 1
                result = await self._evaluate_event(session, event, enqueue_actions)
                event.status = EventStatus.PROCESSED if result.summary.get("campaigns") else EventStatus.IGNORED
                event.result = result.summary
                event.error = None
                event.processed_at = datetime.now(UTC)
                result.status = event.status
                return result
        except Exception as exc:
            await self._mark_event_failed(event_id, exc)
            raise

    async def _mark_event_failed(self, event_id: uuid.UUID, exc: Exception) -> None:
        async with self.sessionmaker() as session, session.begin():
            await session.execute(
                update(WebhookEvent)
                .where(WebhookEvent.id == event_id)
                .values(
                    status=EventStatus.FAILED,
                    error={"type": type(exc).__name__, "message": truncate(redact_text(str(exc)), 500)},
                    attempt_count=WebhookEvent.attempt_count + 1,
                )
            )

    async def _campaigns_for(
        self, session: AsyncSession, event: WebhookEvent, comment: CommentEvent
    ) -> tuple[list[Campaign], str | None]:
        if event.source is EventSource.SIMULATION:
            campaign = await session.scalar(
                select(Campaign).where(
                    Campaign.id == uuid.UUID(event.payload["campaign_id"]),
                    Campaign.workspace_id == event.workspace_id,
                )
            )
            return ([campaign] if campaign else []), None if campaign else "campaign not found"

        connections = (
            await session.scalars(
                select(InstagramConnection).where(
                    InstagramConnection.instagram_account_id == comment.account_id,
                    InstagramConnection.status == ConnectionStatus.ACTIVE,
                )
            )
        ).all()
        if not connections:
            return [], "no active connection for this Instagram account"
        if comment.commenter_id and comment.commenter_id == comment.account_id:
            return [], "comment authored by the connected account"
        if len({c.workspace_id for c in connections}) == 1:
            event.workspace_id = connections[0].workspace_id
        campaigns = (
            await session.scalars(
                select(Campaign).where(
                    Campaign.connection_id.in_([c.id for c in connections]),
                    Campaign.media_external_id == comment.media_id,
                    Campaign.status == CampaignStatus.ACTIVE,
                    Campaign.mode == OperatingMode.LIVE,
                )
            )
        ).all()
        return list(campaigns), None if campaigns else "no active campaign for this media"

    async def _evaluate_event(self, session: AsyncSession, event: WebhookEvent, enqueue: bool) -> ProcessResult:
        comment = CommentEvent.from_payload(event.payload)
        result = ProcessResult(event.id, None)
        campaigns, reason = await self._campaigns_for(session, event, comment)
        outcomes: list[dict[str, Any]] = []
        lead_id: uuid.UUID | None = None

        for campaign in campaigns:
            outcome: dict[str, Any] = {"campaign_id": str(campaign.id), "executions": []}
            outcomes.append(outcome)
            if campaign.status is not CampaignStatus.ACTIVE:
                outcome.update(matched=False, reason=f"campaign is {campaign.status}")
                continue
            if comment.media_id != campaign.media_external_id:
                outcome.update(matched=False, reason="comment is not on the campaign's media")
                continue
            config = CampaignConfig.model_validate(campaign.config)
            if config.ignore_replies and comment.parent_id:
                outcome.update(matched=False, reason="comment is a reply; campaign ignores replies")
                continue

            evaluation = rule_engine.evaluate(comment.text, to_engine_rules(campaign.rules), config.group_logic)
            outcome.update(matched=evaluation.matched, reason=evaluation.reason)
            if not evaluation.matched:
                continue
            eligibility = rule_engine.evaluate_eligibility(
                comment.follower_status, config.follower_requirement, config.unknown_follower_fallback
            )
            outcome["eligibility"] = eligibility.to_dict()

            if lead_id is None:
                lead_id = await self._upsert_lead(session, campaign.workspace_id, comment)
            lead_limited = await self._lead_limit_reached(session, campaign, config, lead_id)

            for action in config.actions:
                if not action.enabled:
                    continue
                status, category, detail = _DECISION_STATUS[eligibility.decision], None, eligibility.reason
                if lead_limited:
                    status, detail = ExecutionStatus.SKIPPED, "per-lead action limit reached"
                elif (
                    status is ExecutionStatus.QUEUED
                    and action.type is ActionType.PRIVATE_REPLY
                    and datetime.now(UTC) - as_aware(comment.created_at) > PRIVATE_REPLY_WINDOW
                ):
                    status, category = ExecutionStatus.SKIPPED, ErrorCategory.UNSUPPORTED
                    detail = "private replies must be sent within 7 days of the comment"
                simulated = event.source is EventSource.SIMULATION or campaign.mode is OperatingMode.SIMULATION
                execution_id = await session.scalar(
                    pg_insert(AutomationExecution)
                    .values(
                        id=uuid.uuid4(),
                        workspace_id=campaign.workspace_id,
                        campaign_id=campaign.id,
                        event_id=event.id,
                        lead_id=lead_id,
                        connection_id=campaign.connection_id,
                        template_id=action.template_id,
                        action_type=action.type,
                        status=status,
                        is_simulated=simulated,
                        matched_rules=[_rule_summary(r) for r in evaluation.matched_rules],
                        evaluation={
                            "reason": evaluation.reason,
                            "eligibility": eligibility.to_dict(),
                            "groups": evaluation.groups,
                        },
                        attempt_count=0,
                        error_category=category,
                        error_detail=None if status is ExecutionStatus.QUEUED else detail,
                        created_at=datetime.now(UTC),
                        updated_at=datetime.now(UTC),
                        completed_at=None if status is ExecutionStatus.QUEUED else datetime.now(UTC),
                    )
                    .on_conflict_do_nothing(constraint="uq_automation_executions_event_id_campaign_id_action_type")
                    .returning(AutomationExecution.id)
                )
                outcome["executions"].append(
                    {"action_type": str(action.type), "status": str(status), "created": execution_id is not None}
                )
                if execution_id is not None and status is ExecutionStatus.QUEUED:
                    result.queued_execution_ids.append(execution_id)
                    if enqueue:
                        session.add(
                            OutboxMessage(topic=TOPIC_EXECUTE_ACTION, payload={"execution_id": str(execution_id)})
                        )

        result.summary = {"campaigns": outcomes, "reason": reason} if reason else {"campaigns": outcomes}
        return result

    async def _upsert_lead(
        self, session: AsyncSession, workspace_id: uuid.UUID, comment: CommentEvent
    ) -> uuid.UUID | None:
        external_id = comment.commenter_id or (f"username:{comment.username}" if comment.username else None)
        if external_id is None:
            return None
        now = datetime.now(UTC)
        stmt = pg_insert(Lead).values(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            external_user_id=external_id,
            username=comment.username,
            tags=[],
            comment_count=1,
            first_seen_at=now,
            last_seen_at=now,
            created_at=now,
            updated_at=now,
        )
        upsert = stmt.on_conflict_do_update(
            constraint="uq_leads_workspace_id_external_user_id",
            set_={
                "username": func.coalesce(stmt.excluded.username, Lead.username),
                "comment_count": Lead.comment_count + 1,
                "last_seen_at": now,
                "updated_at": now,
            },
        ).returning(Lead.id)
        lead_id: uuid.UUID | None = await session.scalar(upsert)
        return lead_id

    async def _lead_limit_reached(
        self, session: AsyncSession, campaign: Campaign, config: CampaignConfig, lead_id: uuid.UUID | None
    ) -> bool:
        if config.max_actions_per_lead is None or lead_id is None:
            return False
        count = await session.scalar(
            select(func.count()).where(
                AutomationExecution.campaign_id == campaign.id,
                AutomationExecution.lead_id == lead_id,
                AutomationExecution.status.in_(
                    [ExecutionStatus.SUCCEEDED, ExecutionStatus.SIMULATED, *_RUNNABLE, ExecutionStatus.IN_PROGRESS]
                ),
            )
        )
        return (count or 0) >= config.max_actions_per_lead * max(len(config.actions), 1)

    # ----------------------------------------------------------------- execute
    async def execute_action(self, execution_id: uuid.UUID) -> ActionOutcome:
        prepared = await self._claim(execution_id)
        if isinstance(prepared, ActionOutcome):
            return prepared
        try:
            send = await asyncio.wait_for(self._send(prepared), timeout=self.settings.action_timeout_seconds)
        except TimeoutError:
            return await self._record_failure(
                execution_id, AdapterError("Timed out waiting for Instagram", ErrorCategory.AMBIGUOUS)
            )
        except AdapterError as exc:
            return await self._record_failure(execution_id, exc)
        except UnsupportedCapability as exc:
            return await self._record_failure(execution_id, AdapterError(exc.message, ErrorCategory.UNSUPPORTED))
        return await self._record_success(execution_id, send)

    @staticmethod
    async def _send(p: PreparedSend) -> SendResult:
        if p.action_type is ActionType.PUBLIC_REPLY:
            return await p.client.reply_to_comment(p.token, p.comment_id, p.message)
        return await p.client.send_private_reply(p.token, p.account_id, p.comment_id, p.message)

    async def _claim(self, execution_id: uuid.UUID) -> ActionOutcome | PreparedSend:
        """Short transaction: lock, validate, render, mark in-progress. Returns what the send needs."""
        async with self.sessionmaker() as session, session.begin():
            execution = await session.scalar(
                select(AutomationExecution)
                .where(AutomationExecution.id == execution_id)
                .with_for_update(skip_locked=True)
            )
            if execution is None:
                return ActionOutcome(execution_id, None, detail="locked or missing")
            if execution.status not in _RUNNABLE:
                return ActionOutcome(execution_id, execution.status, detail="not runnable")
            now = datetime.now(UTC)
            if execution.next_attempt_at and as_aware(execution.next_attempt_at) > now + timedelta(seconds=1):
                return ActionOutcome(
                    execution_id, execution.status, retry_in=(as_aware(execution.next_attempt_at) - now).total_seconds()
                )

            campaign = await session.get(Campaign, execution.campaign_id) if execution.campaign_id else None
            event = await session.get(WebhookEvent, execution.event_id)
            template = await session.get(MessageTemplate, execution.template_id) if execution.template_id else None
            if campaign is None or campaign.status is not CampaignStatus.ACTIVE:
                return self._finish(execution, ExecutionStatus.CANCELLED, None, "campaign is no longer active")
            if template is None or event is None:
                return self._finish(
                    execution, ExecutionStatus.FAILED, ErrorCategory.VALIDATION, "template or event missing"
                )

            comment = CommentEvent.from_payload(event.payload)
            config = CampaignConfig.model_validate(campaign.config)
            try:
                rendered = template_renderer.render(
                    template.body,
                    build_template_context(campaign, config, comment.username, comment.text),
                    template.fallbacks,
                    template.type,
                ).text
            except template_renderer.TemplateRenderError as exc:
                return self._finish(execution, ExecutionStatus.FAILED, ErrorCategory.VALIDATION, str(exc))

            mode = OperatingMode.SIMULATION if execution.is_simulated else OperatingMode.LIVE
            try:
                client = self.client_resolver(mode, self.settings)
            except UnsupportedCapability as exc:
                return self._finish(execution, ExecutionStatus.FAILED, ErrorCategory.UNSUPPORTED, exc.message)

            token, account_id = "simulated", comment.account_id or "simulated-account"
            if not execution.is_simulated:
                connection = (
                    await session.get(InstagramConnection, execution.connection_id) if execution.connection_id else None
                )
                if (
                    connection is None
                    or connection.status is not ConnectionStatus.ACTIVE
                    or not connection.encrypted_access_token
                ):
                    return self._finish(
                        execution,
                        ExecutionStatus.FAILED,
                        ErrorCategory.AUTHORIZATION,
                        "Instagram connection unavailable",
                    )
                if is_past(connection.token_expires_at):
                    connection.status = ConnectionStatus.EXPIRED
                    return self._finish(
                        execution, ExecutionStatus.FAILED, ErrorCategory.AUTHORIZATION, "Instagram token expired"
                    )
                allowed, retry_after = await rate_limit.consume(
                    f"acct:{connection.id}", self.settings.account_rate_limit_per_minute, 60
                )
                if not allowed:
                    self._schedule(
                        session, execution, retry_after, ErrorCategory.RATE_LIMITED, "per-account rate limit"
                    )
                    return ActionOutcome(execution_id, ExecutionStatus.RETRY_SCHEDULED, retry_in=retry_after)
                token = decrypt_secret(connection.encrypted_access_token, self.settings)
                account_id = connection.instagram_account_id

            execution.status = ExecutionStatus.IN_PROGRESS
            execution.attempt_count += 1
            execution.started_at = now
            execution.next_attempt_at = None
            execution.rendered_message = rendered
            return PreparedSend(client, token, account_id, comment.comment_id, rendered, execution.action_type)

    @staticmethod
    def _finish(
        execution: AutomationExecution, status: ExecutionStatus, category: ErrorCategory | None, detail: str | None
    ) -> ActionOutcome:
        execution.status = status
        execution.error_category = category
        execution.error_detail = truncate(detail)
        execution.completed_at = datetime.now(UTC)
        execution.next_attempt_at = None
        return ActionOutcome(execution.id, status, detail=detail)

    @staticmethod
    def _schedule(
        session: AsyncSession, execution: AutomationExecution, delay: float, category: ErrorCategory, detail: str
    ) -> None:
        when = datetime.now(UTC) + timedelta(seconds=delay)
        execution.status = ExecutionStatus.RETRY_SCHEDULED
        execution.next_attempt_at = when
        execution.error_category = category
        execution.error_detail = truncate(detail)
        session.add(
            OutboxMessage(topic=TOPIC_EXECUTE_ACTION, payload={"execution_id": str(execution.id)}, available_at=when)
        )

    async def _record_success(self, execution_id: uuid.UUID, send: SendResult) -> ActionOutcome:
        async with self.sessionmaker() as session, session.begin():
            execution = await session.get(AutomationExecution, execution_id, with_for_update=True)
            assert execution is not None
            status = ExecutionStatus.SIMULATED if send.simulated else ExecutionStatus.SUCCEEDED
            execution.external_response_id = send.external_id
            outcome = self._finish(execution, status, None, None)
        logger.info("action_completed", extra={"execution_id": str(execution_id), "status": str(status)})
        return outcome

    async def _record_failure(self, execution_id: uuid.UUID, error: AdapterError) -> ActionOutcome:
        async with self.sessionmaker() as session, session.begin():
            execution = await session.get(AutomationExecution, execution_id, with_for_update=True)
            assert execution is not None
            detail = redact_text(str(error))
            manual_retries = int((execution.evaluation or {}).get("manual_retries", 0))
            budget = self.settings.action_max_attempts * (1 + manual_retries)
            if error.retryable and execution.attempt_count < budget:
                delay = error.retry_after or backoff_delay(
                    execution.attempt_count,
                    self.settings.action_retry_base_seconds,
                    self.settings.action_retry_max_seconds,
                )
                self._schedule(session, execution, delay, error.category, detail)
                outcome = ActionOutcome(execution_id, ExecutionStatus.RETRY_SCHEDULED, retry_in=delay, detail=detail)
            elif error.category is ErrorCategory.AMBIGUOUS:
                outcome = self._finish(execution, ExecutionStatus.UNKNOWN, error.category, detail)
            else:
                if error.category is ErrorCategory.AUTHORIZATION and error.code == 190 and execution.connection_id:
                    await session.execute(
                        update(InstagramConnection)
                        .where(InstagramConnection.id == execution.connection_id)
                        .values(status=ConnectionStatus.EXPIRED)
                    )
                outcome = self._finish(execution, ExecutionStatus.FAILED, error.category, detail)
        logger.warning(
            "action_failed",
            extra={"execution_id": str(execution_id), "category": str(error.category), "status": str(outcome.status)},
        )
        return outcome

    # ------------------------------------------------------------ maintenance
    async def manual_retry(self, workspace_id: uuid.UUID, execution_id: uuid.UUID) -> AutomationExecution:
        """Re-queue an execution only when repeating it cannot duplicate a delivered message."""
        async with self.sessionmaker() as session, session.begin():
            execution = await session.scalar(
                select(AutomationExecution)
                .where(AutomationExecution.id == execution_id, AutomationExecution.workspace_id == workspace_id)
                .with_for_update()
            )
            if execution is None:
                raise NotFound("Execution not found.")
            if execution.status is ExecutionStatus.UNKNOWN or execution.error_category is ErrorCategory.AMBIGUOUS:
                raise Conflict(
                    "The previous attempt may have been delivered; it will not be retried automatically. "
                    "Verify on Instagram before taking further action.",
                    code="retry_unsafe",
                )
            if execution.status not in (ExecutionStatus.FAILED, ExecutionStatus.MANUAL_REVIEW):
                raise Conflict(f"Executions that are {execution.status} cannot be retried.", code="retry_not_allowed")
            evaluation = dict(execution.evaluation or {})
            evaluation["manual_retries"] = int(evaluation.get("manual_retries", 0)) + 1
            execution.evaluation = evaluation
            execution.status = ExecutionStatus.QUEUED
            execution.error_category = None
            execution.error_detail = None
            execution.completed_at = None
            execution.next_attempt_at = None
            session.add(OutboxMessage(topic=TOPIC_EXECUTE_ACTION, payload={"execution_id": str(execution.id)}))
        return execution

    async def resolve_unknown(
        self, workspace_id: uuid.UUID, execution_id: uuid.UUID, delivered: bool
    ) -> AutomationExecution:
        async with self.sessionmaker() as session, session.begin():
            execution = await session.scalar(
                select(AutomationExecution)
                .where(AutomationExecution.id == execution_id, AutomationExecution.workspace_id == workspace_id)
                .with_for_update()
            )
            if execution is None:
                raise NotFound("Execution not found.")
            if execution.status is not ExecutionStatus.UNKNOWN:
                raise Conflict("Only executions with an unknown outcome can be resolved.", code="not_unknown")
            evaluation = dict(execution.evaluation or {})
            evaluation["resolution"] = {"delivered": delivered, "at": datetime.now(UTC).isoformat()}
            execution.evaluation = evaluation
            if delivered:
                self._finish(execution, ExecutionStatus.SUCCEEDED, None, "confirmed delivered by a team member")
            else:
                self._finish(
                    execution,
                    ExecutionStatus.FAILED,
                    ErrorCategory.PERMANENT,
                    "confirmed not delivered by a team member",
                )
        return execution

    async def reap_stale_executions(self, older_than: timedelta | None = None) -> int:
        """Executions stuck ``in_progress`` (worker crashed mid-send) become ``unknown``, never re-sent."""
        cutoff = datetime.now(UTC) - (older_than or timedelta(seconds=self.settings.action_timeout_seconds * 4))
        async with self.sessionmaker() as session, session.begin():
            result = await session.execute(
                update(AutomationExecution)
                .where(
                    AutomationExecution.status == ExecutionStatus.IN_PROGRESS,
                    AutomationExecution.started_at < cutoff,
                )
                .values(
                    status=ExecutionStatus.UNKNOWN,
                    error_category=ErrorCategory.AMBIGUOUS,
                    error_detail="worker stopped before the outcome was recorded",
                    completed_at=datetime.now(UTC),
                )
            )
        return int(getattr(result, "rowcount", 0) or 0)


def _rule_summary(result: rule_engine.RuleResult) -> dict[str, Any]:
    return {
        "rule_id": result.rule_id,
        "keyword": result.keyword,
        "match_type": result.match_type,
        "group": result.group,
        "reason": result.reason,
    }
