"""Lead listing and curation (tags/notes). Leads are created by the automation engine."""

from __future__ import annotations

import uuid

from sqlalchemy import ColumnElement, type_coerce
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead
from app.repositories.resources import LeadRepository
from app.schemas.common import DateRange, PageParams
from app.schemas.lead import LeadUpdate


class LeadService:
    def __init__(self, session: AsyncSession, workspace_id: uuid.UUID):
        self.session = session
        self.repo = LeadRepository(session, workspace_id)

    async def list_leads(
        self, params: PageParams, search: str | None, tag: str | None, dates: DateRange
    ) -> tuple[list[Lead], int]:
        filters: list[ColumnElement[bool]] = []
        if search:
            filters.append(Lead.username.ilike(f"%{search.replace('%', '').replace('_', '')}%"))
        if tag:
            filters.append(type_coerce(Lead.tags, JSONB).contains([tag.strip().lower()]))
        return await self.repo.paginate(params, filters, dates)

    async def get(self, lead_id: uuid.UUID) -> Lead:
        return await self.repo.get(lead_id)

    async def update(self, lead_id: uuid.UUID, body: LeadUpdate) -> Lead:
        lead = await self.repo.get(lead_id, for_update=True)
        if body.tags is not None:
            lead.tags = body.tags
        if "notes" in body.model_fields_set:
            lead.notes = body.notes
        await self.session.commit()
        return lead

    async def delete(self, lead_id: uuid.UUID) -> None:
        await self.repo.delete(await self.repo.get(lead_id))
        await self.session.commit()
