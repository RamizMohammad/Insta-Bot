from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field, field_validator

from app.schemas.common import ORMSchema, Schema


class LeadOut(ORMSchema):
    id: uuid.UUID
    workspace_id: uuid.UUID
    external_user_id: str
    username: str | None
    tags: list[str]
    notes: str | None
    comment_count: int
    first_seen_at: datetime
    last_seen_at: datetime


class LeadUpdate(Schema):
    tags: list[str] | None = Field(None, max_length=30)
    notes: str | None = Field(None, max_length=5000)

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        cleaned = list(dict.fromkeys(t.strip().lower() for t in v if t.strip()))
        if any(len(t) > 40 for t in cleaned):
            raise ValueError("Tags must be at most 40 characters.")
        return cleaned
