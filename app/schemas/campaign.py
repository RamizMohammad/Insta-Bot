from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import Field, field_validator, model_validator

from app.models.enums import (
    ActionType,
    CampaignStatus,
    FallbackBehavior,
    FollowerRequirement,
    GroupOperator,
    MatchType,
    OperatingMode,
    RuleAction,
    TriState,
)
from app.schemas.common import ORMSchema, Schema


class ActionConfig(Schema):
    type: ActionType
    template_id: uuid.UUID
    enabled: bool = True


class CampaignConfig(Schema):
    """Behaviour of a campaign once a comment matches. Stored as JSON on the campaign."""

    actions: list[ActionConfig] = Field(default_factory=list, max_length=2)
    group_logic: GroupOperator = Field(GroupOperator.OR, description="How rule groups are combined.")
    follower_requirement: FollowerRequirement = FollowerRequirement.ANY
    unknown_follower_fallback: FallbackBehavior = Field(
        FallbackBehavior.SKIP, description="What to do when follower status cannot be determined."
    )
    variables: dict[str, str] = Field(default_factory=dict, description="Custom template variables.")
    ignore_replies: bool = Field(True, description="Ignore comments that reply to another comment.")
    max_actions_per_lead: int | None = Field(None, ge=1, le=100)

    @field_validator("actions")
    @classmethod
    def _unique_action_types(cls, v: list[ActionConfig]) -> list[ActionConfig]:
        types = [a.type for a in v]
        if len(types) != len(set(types)):
            raise ValueError("Each action type may appear only once per campaign.")
        return v

    @field_validator("variables")
    @classmethod
    def _variables(cls, v: dict[str, str]) -> dict[str, str]:
        if len(v) > 20:
            raise ValueError("At most 20 custom variables are allowed.")
        for key, value in v.items():
            if not key.isidentifier() or not key.islower() or len(key) > 64:
                raise ValueError(f"Invalid variable name '{key}'.")
            if len(value) > 500:
                raise ValueError(f"Variable '{key}' is too long.")
        return v


class TriggerRuleIn(Schema):
    keyword: str = Field(min_length=1, max_length=200)
    match_type: MatchType = MatchType.CONTAINS
    case_sensitive: bool = False
    action: RuleAction = RuleAction.INCLUDE
    group_key: str = Field("default", min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")
    group_operator: GroupOperator = GroupOperator.OR

    @model_validator(mode="after")
    def _keyword_shape(self) -> TriggerRuleIn:
        if not self.keyword.strip():
            raise ValueError("Keyword must not be blank.")
        terms = [self.keyword] if self.match_type is MatchType.EXACT else self.keyword.split(",")
        if not any(t.strip() for t in terms):
            raise ValueError("Keyword must not be blank.")
        if self.match_type is MatchType.KEYWORD and any(len(t.split()) > 1 for t in terms):
            raise ValueError("Use match_type 'phrase' for multi-word keywords.")
        return self


class TriggerRuleOut(ORMSchema):
    id: uuid.UUID
    keyword: str
    match_type: MatchType
    case_sensitive: bool
    action: RuleAction
    group_key: str
    group_operator: GroupOperator
    position: int


def _check_rule_groups(rules: list[TriggerRuleIn] | None) -> list[TriggerRuleIn] | None:
    if not rules:
        return rules
    operators: dict[str, GroupOperator] = {}
    for rule in rules:
        if (
            rule.action is RuleAction.INCLUDE
            and operators.setdefault(rule.group_key, rule.group_operator) is not rule.group_operator
        ):
            raise ValueError(f"Rules in group '{rule.group_key}' must share one group_operator.")
    return rules


class CampaignCreate(Schema):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(None, max_length=2000)
    mode: OperatingMode = OperatingMode.SIMULATION
    connection_id: uuid.UUID | None = None
    media_id: uuid.UUID | None = Field(None, description="InstagramMedia.id (synced media).")
    media_external_id: str | None = Field(None, max_length=64, description="Instagram media ID to listen on.")
    config: CampaignConfig = Field(default_factory=CampaignConfig)
    rules: list[TriggerRuleIn] = Field(default_factory=list, max_length=50)

    _groups = field_validator("rules")(_check_rule_groups)


class CampaignUpdate(Schema):
    name: str | None = Field(None, min_length=1, max_length=160)
    description: str | None = Field(None, max_length=2000)
    mode: OperatingMode | None = None
    connection_id: uuid.UUID | None = None
    media_id: uuid.UUID | None = None
    media_external_id: str | None = Field(None, max_length=64)
    config: CampaignConfig | None = None
    rules: list[TriggerRuleIn] | None = Field(None, max_length=50)

    _groups = field_validator("rules")(_check_rule_groups)


class CampaignOut(ORMSchema):
    id: uuid.UUID
    workspace_id: uuid.UUID
    connection_id: uuid.UUID | None
    media_id: uuid.UUID | None
    media_external_id: str | None
    name: str
    description: str | None
    status: CampaignStatus
    mode: OperatingMode
    config: dict[str, Any]
    rules: list[TriggerRuleOut]
    created_at: datetime
    updated_at: datetime


class CampaignTestRequest(Schema):
    comment_text: str | None = Field(None, max_length=10_000)
    username: str | None = Field("test_user", max_length=64)
    follower_status: TriState = TriState.UNKNOWN


class RenderedAction(Schema):
    action_type: ActionType
    template_id: uuid.UUID
    rendered_message: str | None
    error: str | None = None


class CampaignTestResult(Schema):
    matched: bool
    reason: str
    evaluation: dict[str, Any]
    eligibility: dict[str, str]
    would_execute: bool
    actions: list[RenderedAction]
    sent: bool = Field(False, description="Always false: the test endpoint never sends messages.")


class CampaignAnalytics(Schema):
    campaign_id: uuid.UUID
    total_executions: int
    simulated: int
    attempted: int
    succeeded: int
    failed: int
    unknown: int
    skipped: int
    manual_review: int
    pending: int
    by_action: dict[str, dict[str, int]]
