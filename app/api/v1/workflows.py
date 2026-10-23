"""Stateless access to the rule engine (useful for building and debugging trigger rules)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import Field

from app.api.dependencies import CurrentUser
from app.models.enums import (
    FallbackBehavior,
    FollowerRequirement,
    GroupOperator,
    MatchType,
    RuleAction,
    TriState,
)
from app.schemas.common import Schema
from app.services import rule_engine

router = APIRouter(prefix="/workflows", tags=["workflows"])


class RuleSpec(Schema):
    keyword: str = Field(min_length=1, max_length=200)
    match_type: MatchType = MatchType.CONTAINS
    case_sensitive: bool = False
    action: RuleAction = RuleAction.INCLUDE
    group: str = Field("default", max_length=64)
    group_operator: GroupOperator = GroupOperator.OR


class EvaluateRequest(Schema):
    comment_text: Any = Field(None, description="Comment text; non-strings are reported as malformed.")
    rules: list[RuleSpec] = Field(max_length=50)
    group_logic: GroupOperator = GroupOperator.OR
    follower_status: TriState = TriState.UNKNOWN
    follower_requirement: FollowerRequirement = FollowerRequirement.ANY
    unknown_follower_fallback: FallbackBehavior = FallbackBehavior.SKIP


@router.post("/evaluate")
async def evaluate_rules(body: EvaluateRequest, _: CurrentUser) -> dict[str, Any]:
    """Evaluate rules against a comment and explain the result. Touches no data and sends nothing."""
    rules = [rule_engine.Rule(**r.model_dump(), id=str(i)) for i, r in enumerate(body.rules)]
    evaluation = rule_engine.evaluate(body.comment_text, rules, body.group_logic)
    eligibility = rule_engine.evaluate_eligibility(
        body.follower_status, body.follower_requirement, body.unknown_follower_fallback
    )
    return {**evaluation.to_dict(), "eligibility": eligibility.to_dict()}
