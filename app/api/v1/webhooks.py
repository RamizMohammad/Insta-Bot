from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Header, Query, Request
from fastapi.responses import PlainTextResponse

from app.api.dependencies import SessionmakerDep, SettingsDep
from app.core.exceptions import AuthenticationError, PermissionDenied, ServiceUnavailable, ValidationFailed
from app.core.logging import get_logger
from app.core.security import constant_time_equals, verify_meta_signature
from app.models.enums import EventSource
from app.services.automation_service import AutomationService
from app.services.instagram.base import parse_comment_webhook
from app.workers.dispatch import kick_outbox_relay

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = get_logger(__name__)
MAX_WEBHOOK_BYTES = 1_000_000


@router.get("/instagram", response_class=PlainTextResponse)
async def verify_subscription(
    settings: SettingsDep,
    hub_mode: Annotated[str | None, Query(alias="hub.mode")] = None,
    hub_verify_token: Annotated[str | None, Query(alias="hub.verify_token")] = None,
    hub_challenge: Annotated[str | None, Query(alias="hub.challenge", max_length=256)] = None,
) -> str:
    expected = settings.meta_webhook_verify_token.get_secret_value()
    if not expected:
        raise ServiceUnavailable("Webhook verification is not configured.")
    if hub_mode != "subscribe" or not hub_verify_token or not constant_time_equals(hub_verify_token, expected):
        raise PermissionDenied("Webhook verification failed.")
    return hub_challenge or ""


@router.post("/instagram")
async def receive(
    request: Request,
    settings: SettingsDep,
    sessionmaker: SessionmakerDep,
    background: BackgroundTasks,
    x_hub_signature_256: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Verify the signature over the raw body, persist events, then acknowledge quickly."""
    secret = settings.meta_app_secret.get_secret_value()
    if not secret:
        raise ServiceUnavailable("Webhook signature verification is not configured.")
    raw = await request.body()
    if len(raw) > MAX_WEBHOOK_BYTES:
        raise ValidationFailed("Payload too large.")
    if not verify_meta_signature(raw, x_hub_signature_256, secret):
        raise AuthenticationError("Invalid webhook signature.", code="invalid_signature")
    try:
        payload = await request.json()
    except ValueError as exc:
        raise ValidationFailed("Body is not valid JSON.") from exc

    service = AutomationService(sessionmaker, settings)
    created = duplicates = 0
    for event in parse_comment_webhook(payload):
        result = await service.ingest(event, source=EventSource.INSTAGRAM)
        created += result.created
        duplicates += not result.created
    if created:
        background.add_task(kick_outbox_relay)
    logger.info("webhook_received", extra={"events": created, "duplicates": duplicates})
    return {"received": created, "duplicates": duplicates}
