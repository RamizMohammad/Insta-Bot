"""Message template CRUD with validation and an immutable version history."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import Conflict, ValidationFailed
from app.models import Campaign, MessageTemplate, MessageTemplateVersion, User
from app.models.enums import CampaignStatus
from app.repositories.resources import TemplateRepository
from app.schemas.common import PageParams
from app.schemas.template import TemplateCreate, TemplatePreviewResponse, TemplateUpdate
from app.services import template_renderer


def _validate(body: str, custom_variables: list[str], fallbacks: dict[str, str]) -> list[str]:
    try:
        return template_renderer.validate_template(body, frozenset(custom_variables), fallbacks)
    except template_renderer.TemplateSyntaxError as exc:
        raise ValidationFailed(str(exc), code="template_invalid") from exc


class TemplateService:
    def __init__(self, session: AsyncSession, workspace_id: uuid.UUID, user: User | None = None):
        self.session = session
        self.workspace_id = workspace_id
        self.user = user
        self.repo = TemplateRepository(session, workspace_id)

    async def list_templates(self, params: PageParams, type_: str | None) -> tuple[list[MessageTemplate], int]:
        filters = [MessageTemplate.type == type_] if type_ else []
        return await self.repo.paginate(params, filters)

    async def get(self, template_id: uuid.UUID) -> MessageTemplate:
        return await self.repo.get(template_id)

    async def create(self, body: TemplateCreate) -> MessageTemplate:
        variables = _validate(body.body, body.custom_variables, body.fallbacks)
        template = MessageTemplate(
            workspace_id=self.workspace_id,
            name=body.name,
            type=body.type,
            body=body.body,
            variables=variables,
            fallbacks=body.fallbacks,
            action_config=body.action_config,
            version=1,
        )
        self.repo.add(template)
        await self._commit_with_version(template)
        return template

    async def update(self, template_id: uuid.UUID, body: TemplateUpdate) -> MessageTemplate:
        template = await self.repo.get(template_id, for_update=True)
        new_body = body.body if body.body is not None else template.body
        fallbacks = body.fallbacks if body.fallbacks is not None else template.fallbacks
        custom = (
            body.custom_variables
            if body.custom_variables is not None
            else [v for v in template.variables if v not in template_renderer.SYSTEM_VARIABLES]
        )
        template.variables = _validate(new_body, custom, fallbacks)
        template.body = new_body
        template.fallbacks = fallbacks
        if body.name is not None:
            template.name = body.name
        if body.action_config is not None:
            template.action_config = body.action_config
        template.version += 1
        template.updated_at = datetime.now(UTC)
        await self._commit_with_version(template)
        return template

    async def delete(self, template_id: uuid.UUID) -> None:
        template = await self.repo.get(template_id, for_update=True)
        campaigns = await self.session.scalars(
            select(Campaign).where(
                Campaign.workspace_id == self.workspace_id,
                Campaign.status.in_([CampaignStatus.ACTIVE, CampaignStatus.PAUSED]),
            )
        )
        used_by = [
            c.name
            for c in campaigns
            if any(a.get("template_id") == str(template.id) for a in (c.config or {}).get("actions", []))
        ]
        if used_by:
            raise Conflict("Template is used by active or paused campaigns.", details={"campaigns": used_by})
        await self.repo.delete(template)
        await self.session.commit()

    async def versions(self, template_id: uuid.UUID) -> list[MessageTemplateVersion]:
        template = await self.repo.get(template_id)
        rows = await self.session.scalars(
            select(MessageTemplateVersion)
            .where(MessageTemplateVersion.template_id == template.id)
            .order_by(MessageTemplateVersion.version.desc())
        )
        return list(rows)

    async def preview(self, template_id: uuid.UUID, variables: dict[str, str | None]) -> TemplatePreviewResponse:
        template = await self.repo.get(template_id)
        try:
            result = template_renderer.render(template.body, variables, template.fallbacks, template.type)
        except template_renderer.TemplateRenderError as exc:
            raise ValidationFailed(str(exc), code="template_render_failed") from exc
        return TemplatePreviewResponse(
            rendered=result.text,
            used_variables=list(result.used_variables),
            used_fallbacks=list(result.used_fallbacks),
            length=len(result.text),
            max_length=template_renderer.MAX_LENGTH[template.type],
        )

    async def _commit_with_version(self, template: MessageTemplate) -> None:
        try:
            await self.session.flush()
            self.session.add(
                MessageTemplateVersion(
                    template_id=template.id,
                    version=template.version,
                    name=template.name,
                    body=template.body,
                    variables=template.variables,
                    fallbacks=template.fallbacks,
                    changed_by_id=self.user.id if self.user else None,
                )
            )
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise Conflict("A template with this name already exists.") from exc
