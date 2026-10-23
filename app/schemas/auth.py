from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import EmailStr, Field, field_validator

from app.models.enums import UserStatus
from app.schemas.common import ORMSchema, Schema


def _check_strength(value: str) -> str:
    if value.isdigit() or value.isalpha() or len(set(value)) < 4:
        raise ValueError("Password must mix letters with numbers or symbols.")
    return value


class RegisterRequest(Schema):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    workspace_name: str | None = Field(None, max_length=120)

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()

    _strength = field_validator("password")(_check_strength)


class LoginRequest(Schema):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()


class RefreshRequest(Schema):
    refresh_token: str = Field(min_length=20, max_length=200)


class LogoutRequest(Schema):
    refresh_token: str | None = Field(None, min_length=20, max_length=200)
    all_sessions: bool = False


class TokenPair(Schema):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(ORMSchema):
    id: uuid.UUID
    email: str
    status: UserStatus
    created_at: datetime
    updated_at: datetime


class ChangePasswordRequest(Schema):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)

    _strength = field_validator("new_password")(_check_strength)
