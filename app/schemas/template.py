from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import Field

from app.models.enums import TemplateType
from app.schemas.common import ORMSchema, Schema


class TemplateCreate(Schema):
    name: str = Field(min_length=1, max_length=120)
    type: TemplateType
    body: str = Field(min_length=1, max_length=2200)
    custom_variables: list[str] = Field(default_factory=list, max_length=20)
    fallbacks: dict[str, str] = Field(default_factory=dict)
    action_config: dict[str, Any] = Field(default_factory=dict)


class TemplateUpdate(Schema):
    name: str | None = Field(None, min_length=1, max_length=120)
    body: str | None = Field(None, min_length=1, max_length=2200)
    custom_variables: list[str] | None = Field(None, max_length=20)
    fallbacks: dict[str, str] | None = None
    action_config: dict[str, Any] | None = None


class TemplateOut(ORMSchema):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    type: TemplateType
    body: str
    variables: list[str]
    fallbacks: dict[str, str]
    action_config: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime


class TemplateVersionOut(ORMSchema):
    version: int
    name: str
    body: str
    variables: list[str]
    fallbacks: dict[str, str]
    changed_by_id: uuid.UUID | None
    created_at: datetime


class TemplatePreviewRequest(Schema):
    variables: dict[str, str | None] = Field(default_factory=dict)


class TemplatePreviewResponse(Schema):
    rendered: str
    used_variables: list[str]
    used_fallbacks: list[str]
    length: int
    max_length: int
