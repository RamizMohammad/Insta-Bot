"""Campaign CRUD, lifecycle transitions, activation checks, dry-run tests and analytics."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.exceptions import Conflict, UnsupportedCapability, ValidationFailed
from app.models import AutomationExecution, Campaign, InstagramConnection, MessageTemplate, TriggerRule, Workspace
from app.models.enums import (
    CampaignStatus,
    ConnectionStatus,
    EligibilityDecision,
    ExecutionStatus,
    OperatingMode,
    RuleAction,
)
from app.repositories.resources import CampaignRepository, ConnectionRepository, MediaRepository, TemplateRepository
from app.schemas.campaign import (
    CampaignAnalytics,
    CampaignConfig,
    CampaignCreate,
    CampaignTestRequest,
    CampaignTestResult,
    CampaignUpdate,
    RenderedAction,
    TriggerRuleIn,
)
from app.schemas.common import DateRange, PageParams
from app.services import rule_engine, template_renderer
from app.services.instagram import live_mode_available
from app.utils.time import is_past

# Permissions needed for comment replies and private replies (Instagram API with Instagram Login).
REQUIRED_LIVE_PERMISSIONS = frozenset({"instagram_business_basic", "instagram_business_manage_comments"})

_TRANSITIONS: dict[str, tuple[frozenset[CampaignStatus], CampaignStatus]] = {
    "activate": (frozenset({CampaignStatus.DRAFT}), CampaignStatus.ACTIVE),
    "pause": (frozenset({CampaignStatus.ACTIVE}), CampaignStatus.PAUSED),
    "resume": (frozenset({CampaignStatus.PAUSED}), CampaignStatus.ACTIVE),
    "stop": (frozenset({CampaignStatus.DRAFT, CampaignStatus.ACTIVE, CampaignStatus.PAUSED}), CampaignStatus.STOPPED),
}
_STRUCTURAL_FIELDS = {"mode", "connection_id", "media_id", "media_external_id", "config", "rules"}


def to_engine_rules(rules: list[TriggerRule]) -> list[rule_engine.Rule]:
    return [
        rule_engine.Rule(
            keyword=r.keyword,
            match_type=r.match_type,
            case_sensitive=r.case_sensitive,
            action=r.action,
            group=r.group_key,
            group_operator=r.group_operator,
            id=str(r.id),
        )
        for r in rules
    ]


def _build_rules(rules: list[TriggerRuleIn]) -> list[TriggerRule]:
    return [TriggerRule(position=i, **r.model_dump()) for i, r in enumerate(rules)]


class CampaignService:
    def __init__(self, session: AsyncSession, workspace: Workspace, settings: Settings | None = None):
        self.session = session
        self.workspace = workspace
        self.settings = settings or get_settings()
        self.repo = CampaignRepository(session, workspace.id)

    # --- CRUD ---------------------------------------------------------------
    async def list_campaigns(
        self,
        params: PageParams,
        status: CampaignStatus | None,
        mode: OperatingMode | None,
        search: str | None,
        dates: DateRange,
    ) -> tuple[list[Campaign], int]:
        filters = []
        if status:
            filters.append(Campaign.status == status)
        if mode:
            filters.append(Campaign.mode == mode)
        if search:
            filters.append(Campaign.name.ilike(f"%{search.replace('%', '').replace('_', '')}%"))
        return await self.repo.paginate(params, filters, dates)

    async def get(self, campaign_id: uuid.UUID) -> Campaign:
        return await self.repo.get(campaign_id)

    async def create(self, body: CampaignCreate) -> Campaign:
        campaign = Campaign(
            workspace_id=self.workspace.id,
            name=body.name,
            description=body.description,
            mode=body.mode,
            config=body.config.model_dump(mode="json"),
            rules=_build_rules(body.rules),
        )
        await self._apply_targets(campaign, body.connection_id, body.media_id, body.media_external_id)
        await self._check_templates(body.config, strict=False)
        self.repo.add(campaign)
        await self.session.commit()
        return await self.repo.get(campaign.id)

    async def update(self, campaign_id: uuid.UUID, body: CampaignUpdate) -> Campaign:
        campaign = await self.repo.get(campaign_id, for_update=True)
        changes = body.model_dump(exclude_unset=True)
        if campaign.status is CampaignStatus.STOPPED:
            raise Conflict("Stopped campaigns cannot be edited.")
        if campaign.status is CampaignStatus.ACTIVE and _STRUCTURAL_FIELDS & changes.keys():
            raise Conflict("Pause the campaign before changing its mode, target, rules or configuration.")
        if "name" in changes and body.name is not None:
            campaign.name = body.name
        if "description" in changes:
            campaign.description = body.description
        if body.mode is not None:
            campaign.mode = body.mode
        if body.config is not None:
            await self._check_templates(body.config, strict=False)
            campaign.config = body.config.model_dump(mode="json")
        if body.rules is not None:
            campaign.rules = _build_rules(body.rules)
        if {"connection_id", "media_id", "media_external_id"} & changes.keys():
            await self._apply_targets(
                campaign,
                changes.get("connection_id", campaign.connection_id),
                changes.get("media_id", campaign.media_id),
                changes.get("media_external_id", campaign.media_external_id),
            )
        campaign.updated_at = datetime.now(UTC)
        await self.session.commit()
        return await self.repo.get(campaign.id)

    async def delete(self, campaign_id: uuid.UUID) -> None:
        campaign = await self.repo.get(campaign_id, for_update=True)
        if campaign.status is CampaignStatus.ACTIVE:
            raise Conflict("Pause or stop the campaign before deleting it.")
        await self.repo.delete(campaign)
        await self.session.commit()

    async def _apply_targets(
        self,
        campaign: Campaign,
        connection_id: uuid.UUID | None,
        media_id: uuid.UUID | None,
        media_external_id: str | None,
    ) -> None:
        # Every referenced resource must belong to this workspace.
        if connection_id is not None:
            await ConnectionRepository(self.session, self.workspace.id).get(connection_id)
        if media_id is not None:
            media = await MediaRepository(self.session, self.workspace.id).get(media_id)
            if connection_id is not None and media.connection_id != connection_id:
                raise ValidationFailed("The media does not belong to the selected Instagram connection.")
            connection_id = connection_id or media.connection_id
            media_external_id = media.external_media_id
        campaign.connection_id = connection_id
        campaign.media_id = media_id
        campaign.media_external_id = media_external_id

    async def _check_templates(self, config: CampaignConfig, *, strict: bool) -> dict[uuid.UUID, MessageTemplate]:
        templates: dict[uuid.UUID, MessageTemplate] = {}
        repo = TemplateRepository(self.session, self.workspace.id)
        for action in config.actions:
            template = await repo.get(action.template_id)
            if str(template.type) != str(action.type):
                raise ValidationFailed(f"Template '{template.name}' is a {template.type}, not a {action.type}.")
            if strict:
                missing = [
                    v
                    for v in template.variables
                    if v not in template_renderer.SYSTEM_VARIABLES
                    and v not in config.variables
                    and v not in template.fallbacks
                ]
                if missing:
                    raise ValidationFailed(
                        f"Template '{template.name}' needs values for: {', '.join(missing)}.",
                        details={"template_id": str(template.id), "missing_variables": missing},
                    )
            templates[template.id] = template
        return templates

    # --- Lifecycle ----------------------------------------------------------------
    async def transition(self, campaign_id: uuid.UUID, action: str) -> Campaign:
        allowed_from, target = _TRANSITIONS[action]
        campaign = await self.repo.get(campaign_id, for_update=True)
        if campaign.status not in allowed_from:
            raise Conflict(f"Cannot {action} a campaign that is {campaign.status}.", code="invalid_transition")
        if target is CampaignStatus.ACTIVE:
            await self.validate_activation(campaign)
        campaign.status = target
        campaign.updated_at = datetime.now(UTC)
        await self.session.commit()
        return await self.repo.get(campaign.id)

    async def validate_activation(self, campaign: Campaign) -> None:
        problems: list[str] = []
        config = CampaignConfig.model_validate(campaign.config)
        if not any(r.action is RuleAction.INCLUDE for r in campaign.rules):
            problems.append("at least one include rule is required")
        if not campaign.media_external_id:
            problems.append("a target media is required")
        if not any(a.enabled for a in config.actions):
            problems.append("at least one enabled action is required")
        if problems:
            raise ValidationFailed("Campaign configuration is incomplete: " + "; ".join(problems) + ".")
        await self._check_templates(config, strict=True)

        if campaign.mode is OperatingMode.SIMULATION:
            if not self.simulation_permitted():
                raise UnsupportedCapability(
                    "Simulation campaigns are only allowed in development or in authorised test workspaces.",
                    code="simulation_not_permitted",
                )
            return
        await self._validate_live(campaign, config)

    async def _validate_live(self, campaign: Campaign, config: CampaignConfig) -> None:
        if not live_mode_available(self.settings):
            raise UnsupportedCapability(
                "Live mode is not available: the server is not configured for the Meta API.",
                code="live_mode_unavailable",
            )
        if campaign.connection_id is None:
            raise ValidationFailed("Live campaigns require an Instagram connection.")
        connection = await self.session.get(InstagramConnection, campaign.connection_id)
        if connection is None or connection.workspace_id != self.workspace.id:
            raise ValidationFailed("Live campaigns require an Instagram connection.")
        if connection.status is not ConnectionStatus.ACTIVE or not connection.encrypted_access_token:
            raise ValidationFailed("The Instagram connection is not active. Reconnect the account.")
        if is_past(connection.token_expires_at):
            raise ValidationFailed("The Instagram access token has expired. Reconnect the account.")
        missing = REQUIRED_LIVE_PERMISSIONS - set(connection.granted_permissions or [])
        if missing:
            raise ValidationFailed(
                "The Instagram connection is missing required permissions.",
                details={"missing_permissions": sorted(missing)},
            )

    def simulation_permitted(self) -> bool:
        return (
            self.settings.is_dev_or_test
            or self.workspace.is_test_workspace
            or str(self.workspace.id) in self.settings.simulation_workspace_allowlist
        )

    # --- Dry run --------------------------------------------------------------------
    async def test(self, campaign_id: uuid.UUID, body: CampaignTestRequest) -> CampaignTestResult:
        """Evaluate a hypothetical comment. Renders messages but never sends anything."""
        campaign = await self.repo.get(campaign_id)
        config = CampaignConfig.model_validate(campaign.config)
        evaluation = rule_engine.evaluate(body.comment_text, to_engine_rules(campaign.rules), config.group_logic)
        eligibility = rule_engine.evaluate_eligibility(
            body.follower_status, config.follower_requirement, config.unknown_follower_fallback
        )
        templates = await self._check_templates(config, strict=False)
        context = build_template_context(campaign, config, body.username, evaluation.normalized_text)
        actions: list[RenderedAction] = []
        for action in config.actions:
            if not action.enabled:
                continue
            template = templates[action.template_id]
            try:
                rendered = template_renderer.render(template.body, context, template.fallbacks, template.type)
                actions.append(
                    RenderedAction(action_type=action.type, template_id=template.id, rendered_message=rendered.text)
                )
            except template_renderer.TemplateRenderError as exc:
                actions.append(
                    RenderedAction(
                        action_type=action.type, template_id=template.id, rendered_message=None, error=str(exc)
                    )
                )
        return CampaignTestResult(
            matched=evaluation.matched,
            reason=evaluation.reason,
            evaluation=evaluation.to_dict(),
            eligibility=eligibility.to_dict(),
            would_execute=evaluation.matched and eligibility.decision is EligibilityDecision.PROCEED,
            actions=actions,
        )

    # --- Analytics ---------------------------------------------------------------------
    async def analytics(self, campaign_id: uuid.UUID, dates: DateRange) -> CampaignAnalytics:
        campaign = await self.repo.get(campaign_id)
        stmt = select(
            AutomationExecution.action_type,
            AutomationExecution.status,
            AutomationExecution.is_simulated,
            func.count(),
            func.count().filter(AutomationExecution.attempt_count > 0),
        ).where(AutomationExecution.campaign_id == campaign.id, AutomationExecution.workspace_id == self.workspace.id)
        if dates.created_from:
            stmt = stmt.where(AutomationExecution.created_at >= dates.created_from)
        if dates.created_to:
            stmt = stmt.where(AutomationExecution.created_at <= dates.created_to)
        rows = (
            await self.session.execute(
                stmt.group_by(
                    AutomationExecution.action_type, AutomationExecution.status, AutomationExecution.is_simulated
                )
            )
        ).all()
        return summarize_executions(campaign.id, rows)


def build_template_context(
    campaign: Campaign, config: CampaignConfig, username: str | None, comment_text: str | None
) -> dict[str, Any]:
    return {**config.variables, "username": username, "comment_text": comment_text, "campaign_name": campaign.name}


_PENDING = {ExecutionStatus.QUEUED, ExecutionStatus.IN_PROGRESS, ExecutionStatus.RETRY_SCHEDULED}


def summarize_executions(campaign_id: uuid.UUID, rows: Any) -> CampaignAnalytics:
    totals = dict.fromkeys(
        (
            "total_executions",
            "simulated",
            "attempted",
            "succeeded",
            "failed",
            "unknown",
            "skipped",
            "manual_review",
            "pending",
        ),
        0,
    )
    by_action: dict[str, dict[str, int]] = {}
    for action_type, status, is_simulated, count, attempted in rows:
        totals["total_executions"] += count
        if not is_simulated:
            totals["attempted"] += attempted
        key = {
            ExecutionStatus.SIMULATED: "simulated",
            ExecutionStatus.SUCCEEDED: "succeeded",
            ExecutionStatus.FAILED: "failed",
            ExecutionStatus.UNKNOWN: "unknown",
            ExecutionStatus.SKIPPED: "skipped",
            ExecutionStatus.CANCELLED: "skipped",
            ExecutionStatus.MANUAL_REVIEW: "manual_review",
        }.get(status, "pending" if status in _PENDING else None)
        if key:
            totals[key] += count
        bucket = by_action.setdefault(str(action_type), {})
        bucket[str(status)] = bucket.get(str(status), 0) + count
    return CampaignAnalytics(campaign_id=campaign_id, by_action=by_action, **totals)
