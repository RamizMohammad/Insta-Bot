"""Fixtures for exercising the live (webhook) pipeline with a fake Meta adapter."""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.security import encrypt_secret
from app.models import Campaign, InstagramConnection, TriggerRule
from app.models.enums import CampaignStatus, ConnectionAuthMethod, ConnectionStatus, OperatingMode
from app.services.automation_service import AutomationService
from app.services.instagram.base import SendResult
from app.services.instagram.mock_client import MockInstagramClient

ACCOUNT_ID = "17841400000000001"
MEDIA_ID = "18000000000000001"


class FakeMetaClient(MockInstagramClient):
    """Behaves like the live adapter (non-simulated results) without any network access."""

    name = "fake-meta"
    simulated = False

    def _record(self, kind: str, comment_id: str, message: str) -> SendResult:
        result = super()._record(kind, comment_id, message)
        return SendResult(external_id=result.external_id, simulated=False)


def service(sessionmaker: Any, fake: FakeMetaClient, mock: MockInstagramClient | None = None) -> AutomationService:
    from app.models.enums import OperatingMode as Mode

    def resolver(mode: Mode, settings: Any = None) -> MockInstagramClient:
        return fake if mode is Mode.LIVE else (mock or MockInstagramClient())

    return AutomationService(sessionmaker, client_resolver=resolver)


async def create_live_campaign(
    sessionmaker: Any,
    workspace_id: str,
    template_id: str,
    *,
    token_expires_at: datetime | None = None,
    connection_status: ConnectionStatus = ConnectionStatus.ACTIVE,
    config_overrides: dict[str, Any] | None = None,
) -> tuple[uuid.UUID, uuid.UUID]:
    async with sessionmaker() as s, s.begin():
        connection = InstagramConnection(
            workspace_id=uuid.UUID(workspace_id),
            instagram_account_id=ACCOUNT_ID,
            username="brand",
            auth_method=ConnectionAuthMethod.INSTAGRAM_LOGIN,
            encrypted_access_token=encrypt_secret("live-token"),
            token_expires_at=token_expires_at or datetime.now(UTC) + timedelta(days=30),
            status=connection_status,
            granted_permissions=["instagram_business_basic", "instagram_business_manage_comments"],
        )
        s.add(connection)
        await s.flush()
        campaign = Campaign(
            workspace_id=uuid.UUID(workspace_id),
            connection_id=connection.id,
            media_external_id=MEDIA_ID,
            name="Live",
            status=CampaignStatus.ACTIVE,
            mode=OperatingMode.LIVE,
            config={
                "actions": [{"type": "private_reply", "template_id": template_id, "enabled": True}],
                "variables": {"resource_link": "https://example.com/r"},
                **(config_overrides or {}),
            },
            rules=[TriggerRule(keyword="course", position=0)],
        )
        s.add(campaign)
    return connection.id, campaign.id


def webhook_body(comment_id: str = "c-1", text: str = "COURSE please", sender: str = "555") -> dict[str, Any]:
    return {
        "object": "instagram",
        "entry": [
            {
                "id": ACCOUNT_ID,
                "time": int(datetime.now(UTC).timestamp()),
                "changes": [
                    {
                        "field": "comments",
                        "value": {
                            "from": {"id": sender, "username": "fan"},
                            "media": {"id": MEDIA_ID, "media_product_type": "REELS"},
                            "id": comment_id,
                            "text": text,
                        },
                    }
                ],
            }
        ],
    }


def signed(body: dict[str, Any], secret: str = "test-app-secret") -> tuple[bytes, dict[str, str]]:
    raw = json.dumps(body).encode()
    sig = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return raw, {"X-Hub-Signature-256": sig, "Content-Type": "application/json"}
