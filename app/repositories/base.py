"""Tenant-scoped repository base: every query is constrained to one workspace."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any, ClassVar

from sqlalchemy import ColumnElement, Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFound, ValidationFailed
from app.schemas.common import DateRange, PageParams


class WorkspaceScopedRepository[M]:
    model: ClassVar[type[Any]]
    sortable: ClassVar[frozenset[str]] = frozenset({"created_at"})
    default_sort: ClassVar[str] = "-created_at"
    date_column: ClassVar[str] = "created_at"

    def __init__(self, session: AsyncSession, workspace_id: uuid.UUID):
        self.session = session
        self.workspace_id = workspace_id

    def scoped(self) -> Select[M]:
        return select(self.model).where(self.model.workspace_id == self.workspace_id)

    async def get(self, obj_id: uuid.UUID, *, for_update: bool = False) -> M:
        stmt = self.scoped().where(self.model.id == obj_id)
        if for_update:
            stmt = stmt.with_for_update()
        obj = (await self.session.execute(stmt)).scalar_one_or_none()
        if obj is None:
            # Same response for "missing" and "belongs to another workspace" (no existence leak).
            raise NotFound(f"{self.model.__name__} not found.")
        return obj

    def _order_by(self, sort: str | None) -> ColumnElement[Any]:
        sort = sort or self.default_sort
        field = sort.lstrip("-")
        if field not in self.sortable:
            raise ValidationFailed(f"Cannot sort by '{field}'. Allowed: {', '.join(sorted(self.sortable))}.")
        column: ColumnElement[Any] = getattr(self.model, field)
        return column.desc() if sort.startswith("-") else column.asc()

    def apply_date_range(self, stmt: Select[M], dates: DateRange | None) -> Select[M]:
        if dates is None:
            return stmt
        column = getattr(self.model, self.date_column)
        if dates.created_from:
            stmt = stmt.where(column >= dates.created_from)
        if dates.created_to:
            stmt = stmt.where(column <= dates.created_to)
        return stmt

    async def paginate(
        self,
        params: PageParams,
        filters: Sequence[ColumnElement[bool]] = (),
        dates: DateRange | None = None,
    ) -> tuple[list[M], int]:
        stmt = self.apply_date_range(self.scoped().where(*filters), dates)
        total = (await self.session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
        rows = await self.session.execute(
            stmt.order_by(self._order_by(params.sort), self.model.id).limit(params.limit).offset(params.offset)
        )
        return list(rows.scalars().all()), int(total)

    def add(self, obj: M) -> M:
        self.session.add(obj)
        return obj

    async def delete(self, obj: M) -> None:
        await self.session.delete(obj)
