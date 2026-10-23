"""Concrete workspace-scoped repositories."""

from __future__ import annotations

from app.models import (
    AutomationExecution,
    Campaign,
    InstagramConnection,
    InstagramMedia,
    Lead,
    MessageTemplate,
    WebhookEvent,
)
from app.repositories.base import WorkspaceScopedRepository


class CampaignRepository(WorkspaceScopedRepository[Campaign]):
    model = Campaign
    sortable = frozenset({"created_at", "updated_at", "name", "status"})


class TemplateRepository(WorkspaceScopedRepository[MessageTemplate]):
    model = MessageTemplate
    sortable = frozenset({"created_at", "updated_at", "name"})


class ConnectionRepository(WorkspaceScopedRepository[InstagramConnection]):
    model = InstagramConnection


class MediaRepository(WorkspaceScopedRepository[InstagramMedia]):
    model = InstagramMedia
    sortable = frozenset({"synced_at", "published_at"})
    default_sort = "-published_at"
    date_column = "published_at"


class LeadRepository(WorkspaceScopedRepository[Lead]):
    model = Lead
    sortable = frozenset({"created_at", "first_seen_at", "last_seen_at", "comment_count", "username"})
    default_sort = "-last_seen_at"
    date_column = "last_seen_at"


class ExecutionRepository(WorkspaceScopedRepository[AutomationExecution]):
    model = AutomationExecution
    sortable = frozenset({"created_at", "completed_at", "status"})


class EventRepository(WorkspaceScopedRepository[WebhookEvent]):
    model = WebhookEvent
    sortable = frozenset({"received_at"})
    default_sort = "-received_at"
    date_column = "received_at"
