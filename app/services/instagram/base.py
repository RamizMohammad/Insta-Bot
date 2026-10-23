"""Integration adapter contract. The automation engine depends only on this module."""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from app.models.enums import ErrorCategory, TriState


class Capability(StrEnum):
    OAUTH = "oauth"
    LIST_MEDIA = "list_media"
    WEBHOOK_SUBSCRIPTION = "webhook_subscription"
    PUBLIC_REPLY = "public_reply"
    PRIVATE_REPLY = "private_reply"
    TOKEN_REFRESH = "token_refresh"
    # Meta exposes no endpoint to check whether an arbitrary commenter follows the account.
    FOLLOWER_STATUS = "follower_status"


@dataclass(slots=True)
class CommentEvent:
    """Normalised comment notification (live webhook or simulation)."""

    comment_id: str
    media_id: str
    text: str | None
    account_id: str | None = None  # the connected professional account that received the comment
    commenter_id: str | None = None
    username: str | None = None
    parent_id: str | None = None
    media_product_type: str | None = None
    follower_status: TriState = TriState.UNKNOWN
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_payload(self) -> dict[str, Any]:
        return {
            "comment_id": self.comment_id,
            "media_id": self.media_id,
            "text": self.text,
            "account_id": self.account_id,
            "commenter_id": self.commenter_id,
            "username": self.username,
            "parent_id": self.parent_id,
            "media_product_type": self.media_product_type,
            "follower_status": str(self.follower_status),
            "created_at": self.created_at.isoformat(),
        }

    @classmethod
    def from_payload(cls, data: dict[str, Any]) -> CommentEvent:
        created = data.get("created_at")
        return cls(
            comment_id=str(data["comment_id"]),
            media_id=str(data["media_id"]),
            text=data.get("text"),
            account_id=data.get("account_id"),
            commenter_id=data.get("commenter_id"),
            username=data.get("username"),
            parent_id=data.get("parent_id"),
            media_product_type=data.get("media_product_type"),
            follower_status=TriState(data.get("follower_status", TriState.UNKNOWN)),
            created_at=datetime.fromisoformat(created) if created else datetime.now(UTC),
        )


@dataclass(slots=True)
class TokenGrant:
    access_token: str
    user_id: str | None = None
    permissions: list[str] = field(default_factory=list)
    expires_at: datetime | None = None


@dataclass(slots=True)
class AccountInfo:
    account_id: str
    username: str | None = None
    account_type: str | None = None


@dataclass(slots=True)
class MediaItem:
    id: str
    media_type: str | None = None
    media_product_type: str | None = None
    permalink: str | None = None
    caption: str | None = None
    timestamp: datetime | None = None


@dataclass(slots=True)
class SendResult:
    external_id: str | None
    simulated: bool
    recipient_id: str | None = None


class AdapterError(Exception):
    """An integration failure, classified so the worker knows whether retrying is safe."""

    def __init__(self, message: str, category: ErrorCategory, *, retry_after: float | None = None, code: Any = None):
        super().__init__(message)
        self.category = category
        self.retry_after = retry_after
        self.code = code

    @property
    def retryable(self) -> bool:
        return self.category in (ErrorCategory.TRANSIENT, ErrorCategory.RATE_LIMITED)


class InstagramClient(abc.ABC):
    """Operations InstaFlow needs from Instagram. Implemented by the Meta and mock adapters."""

    name: str
    simulated: bool
    capabilities: frozenset[Capability]

    def supports(self, capability: Capability) -> bool:
        return capability in self.capabilities

    @abc.abstractmethod
    def build_authorization_url(self, state: str) -> str: ...

    @abc.abstractmethod
    async def exchange_code(self, code: str) -> TokenGrant: ...

    @abc.abstractmethod
    async def refresh_token(self, access_token: str) -> TokenGrant: ...

    @abc.abstractmethod
    async def get_account(self, access_token: str) -> AccountInfo: ...

    @abc.abstractmethod
    async def list_media(self, access_token: str, limit: int = 25) -> list[MediaItem]: ...

    @abc.abstractmethod
    async def subscribe_webhooks(self, access_token: str, account_id: str, fields: list[str]) -> bool: ...

    @abc.abstractmethod
    async def reply_to_comment(self, access_token: str, comment_id: str, message: str) -> SendResult: ...

    @abc.abstractmethod
    async def send_private_reply(
        self, access_token: str, account_id: str, comment_id: str, message: str
    ) -> SendResult: ...

    async def get_follower_status(self, access_token: str, account_id: str, user_id: str) -> TriState:
        """Not offered by the Instagram Platform; callers must treat follower status as ``unknown``."""
        return TriState.UNKNOWN

    async def aclose(self) -> None:
        return None


def _parse_entry_time(value: Any) -> datetime:
    """Webhook ``entry.time`` is a Unix timestamp (seconds, occasionally milliseconds)."""
    if isinstance(value, int | float) and value > 0:
        return datetime.fromtimestamp(value / 1000 if value > 10**11 else value, UTC)
    return datetime.now(UTC)


def parse_comment_webhook(payload: dict[str, Any]) -> list[CommentEvent]:
    """Extract ``comments`` changes from an Instagram webhook body (``object == "instagram"``).

    Unsupported objects/fields are ignored. Missing commenter attributes stay ``None``; follower status
    is always ``unknown`` because webhooks do not include it.
    """
    if not isinstance(payload, dict) or payload.get("object") != "instagram":
        return []
    events: list[CommentEvent] = []
    for entry in payload.get("entry") or []:
        if not isinstance(entry, dict):
            continue
        account_id = str(entry["id"]) if entry.get("id") is not None else None
        entry_time = entry.get("time")
        for change in entry.get("changes") or []:
            if not isinstance(change, dict) or change.get("field") not in ("comments", "live_comments"):
                continue
            value = change.get("value") or {}
            media = value.get("media") or {}
            sender = value.get("from") or {}
            if not value.get("id") or not media.get("id"):
                continue
            created = _parse_entry_time(entry_time)
            events.append(
                CommentEvent(
                    comment_id=str(value["id"]),
                    media_id=str(media["id"]),
                    text=value.get("text") if isinstance(value.get("text"), str) else None,
                    account_id=account_id,
                    commenter_id=str(sender["id"]) if sender.get("id") else None,
                    username=sender.get("username"),
                    parent_id=str(value["parent_id"]) if value.get("parent_id") else None,
                    media_product_type=media.get("media_product_type"),
                    created_at=created,
                )
            )
    return events
