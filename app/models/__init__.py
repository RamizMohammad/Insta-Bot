"""Import every model so Alembic and the mapper registry can see them."""

from app.models.campaign import Campaign, TriggerRule
from app.models.event import OutboxMessage, WebhookEvent
from app.models.execution import AutomationExecution
from app.models.instagram import InstagramConnection, InstagramMedia, OAuthState
from app.models.lead import Lead
from app.models.template import MessageTemplate, MessageTemplateVersion
from app.models.user import RefreshToken, User
from app.models.workspace import Workspace, WorkspaceMember

__all__ = [
    "AutomationExecution",
    "Campaign",
    "InstagramConnection",
    "InstagramMedia",
    "Lead",
    "MessageTemplate",
    "MessageTemplateVersion",
    "OAuthState",
    "OutboxMessage",
    "RefreshToken",
    "TriggerRule",
    "User",
    "WebhookEvent",
    "Workspace",
    "WorkspaceMember",
]
