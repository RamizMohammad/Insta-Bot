from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from app.models.enums import ActionType, ErrorCategory, EventSource, EventStatus, ExecutionStatus, TriState
from app.schemas.common import ORMSchema, Schema


class ExecutionOut(ORMSchema):
    id: uuid.UUID
    workspace_id: uuid.UUID
    campaign_id: uuid.UUID | None
    event_id: uuid.UUID
    lead_id: uuid.UUID | None
    template_id: uuid.UUID | None = None
    action_type: ActionType
    status: ExecutionStatus
    is_simulated: bool
    matched_rules: list[dict[str, Any]]
    evaluation: dict[str, Any]
    rendered_message: str | None
    attempt_count: int
    external_response_id: str | None
    error_category: ErrorCategory | None
    error_detail: str | None
    next_attempt_at: datetime | None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None
    # Display context resolved from related rows (not stored on the execution).
    campaign_name: str | None = None
    lead_username: str | None = None
    comment_id: str | None = None
    comment_text: str | None = None
    media_id: str | None = None


class EventOut(ORMSchema):
    id: uuid.UUID
    workspace_id: uuid.UUID | None
    source: EventSource
    external_event_id: str | None
    event_type: str
    status: EventStatus
    attempt_count: int
    payload: dict[str, Any]
    result: dict[str, Any]
    error: dict[str, Any] | None
    received_at: datetime
    processed_at: datetime | None


class SimulateCommentRequest(Schema):
    campaign_id: uuid.UUID
    comment_id: str = Field(min_length=1, max_length=128)
    media_id: str | None = Field(None, max_length=64, description="Defaults to the campaign's media.")
    username: str | None = Field(None, max_length=64)
    commenter_id: str | None = Field(None, max_length=64)
    comment_text: str | None = Field(None, max_length=10_000)
    follower_status: TriState = TriState.UNKNOWN
    parent_id: str | None = Field(None, max_length=128)
    fault: Literal["none", "transient", "rate_limited", "ambiguous", "permanent"] = Field(
        "none", description="Make the mock adapter fail the next send (exercise retries and safety rules)."
    )


class SimulateCommentResponse(Schema):
    event_id: uuid.UUID
    duplicate: bool
    event_status: EventStatus
    result: dict[str, Any]
    executions: list[ExecutionOut]


class ResolveExecutionRequest(Schema):
    """Human verification of an ``unknown`` outcome after checking Instagram."""

    delivered: bool
