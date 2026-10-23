from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import EmailStr, Field

from app.models.enums import WorkspaceRole
from app.schemas.common import ORMSchema, Schema


class WorkspaceCreate(Schema):
    name: str = Field(min_length=1, max_length=120)


class WorkspaceUpdate(Schema):
    name: str | None = Field(None, min_length=1, max_length=120)


class WorkspaceOut(ORMSchema):
    id: uuid.UUID
    name: str
    owner_id: uuid.UUID
    is_test_workspace: bool
    created_at: datetime
    updated_at: datetime
    role: WorkspaceRole | None = None


class MemberAdd(Schema):
    email: EmailStr
    role: WorkspaceRole = WorkspaceRole.MEMBER


class MemberUpdate(Schema):
    role: WorkspaceRole


class MemberOut(ORMSchema):
    id: uuid.UUID
    user_id: uuid.UUID
    role: WorkspaceRole
    created_at: datetime
