from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import Query
from pydantic import BaseModel, ConfigDict, Field


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid", str_strip_whitespace=True)


class ORMSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class PageParams(BaseModel):
    limit: int = Field(20, ge=1, le=100)
    offset: int = Field(0, ge=0)
    sort: str | None = Field(None, description="Field to sort by; prefix with '-' for descending.")


class DateRange(BaseModel):
    created_from: datetime | None = None
    created_to: datetime | None = None


def page_params(
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    sort: Annotated[str | None, Query(max_length=40, description="e.g. -created_at")] = None,
) -> PageParams:
    return PageParams(limit=limit, offset=offset, sort=sort)


def date_range(
    created_from: Annotated[datetime | None, Query()] = None,
    created_to: Annotated[datetime | None, Query()] = None,
) -> DateRange:
    return DateRange(created_from=created_from, created_to=created_to)


class Message(BaseModel):
    message: str
