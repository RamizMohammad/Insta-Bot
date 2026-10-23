"""Deterministic in-memory adapter for simulation mode and tests. Never performs network I/O."""

from __future__ import annotations

import hashlib
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

from app.models.enums import ErrorCategory
from app.services.instagram.base import (
    AccountInfo,
    AdapterError,
    Capability,
    InstagramClient,
    MediaItem,
    SendResult,
    TokenGrant,
)

MOCK_PERMISSIONS = ["instagram_business_basic", "instagram_business_manage_comments"]


@dataclass(slots=True)
class SentMessage:
    kind: str
    comment_id: str
    message: str
    external_id: str
    at: datetime


class MockInstagramClient(InstagramClient):
    name = "mock"
    simulated = True
    capabilities = frozenset(
        {
            Capability.OAUTH,
            Capability.LIST_MEDIA,
            Capability.WEBHOOK_SUBSCRIPTION,
            Capability.PUBLIC_REPLY,
            Capability.PRIVATE_REPLY,
            Capability.TOKEN_REFRESH,
        }
    )

    def __init__(self, callback_url: str = "/api/v1/instagram/callback"):
        self.callback_url = callback_url
        self.sent: list[SentMessage] = []
        self._failures: deque[AdapterError] = deque()

    # --- Test helpers -----------------------------------------------------------
    def fail_next(self, category: ErrorCategory, times: int = 1, message: str = "simulated failure") -> None:
        """Queue failures for the next ``times`` send operations (used to exercise retry logic)."""
        self._failures.extend(AdapterError(message, category, retry_after=0.0) for _ in range(times))

    def reset(self) -> None:
        self.sent.clear()
        self._failures.clear()

    def _maybe_fail(self) -> None:
        if self._failures:
            raise self._failures.popleft()

    # --- OAuth (loops back to our own callback, no Meta involved) ---------------
    def build_authorization_url(self, state: str) -> str:
        return f"{self.callback_url}?{urlencode({'code': 'mock-code-' + state[:8], 'state': state})}"

    async def exchange_code(self, code: str) -> TokenGrant:
        if not code.startswith("mock-code-"):
            raise AdapterError("Invalid mock authorization code", ErrorCategory.PERMANENT)
        digest = hashlib.sha256(code.encode()).hexdigest()[:12]
        return TokenGrant(
            access_token=f"mock-token-{digest}",
            user_id=f"mock-ig-{digest}",
            permissions=list(MOCK_PERMISSIONS),
            expires_at=datetime.now(UTC) + timedelta(days=60),
        )

    async def refresh_token(self, access_token: str) -> TokenGrant:
        return TokenGrant(access_token=access_token, expires_at=datetime.now(UTC) + timedelta(days=60))

    async def get_account(self, access_token: str) -> AccountInfo:
        suffix = access_token.removeprefix("mock-token-")
        return AccountInfo(account_id=f"mock-ig-{suffix}", username=f"mock_{suffix[:6]}", account_type="BUSINESS")

    async def list_media(self, access_token: str, limit: int = 25) -> list[MediaItem]:
        return [
            MediaItem(
                id=f"test-media-{i:03d}",
                media_type="VIDEO" if i % 2 else "IMAGE",
                media_product_type="REELS" if i % 2 else "FEED",
                permalink=f"https://www.instagram.com/p/mock{i:03d}/",
                caption=f"Mock post {i}",
                timestamp=datetime(2026, 1, i, tzinfo=UTC),
            )
            for i in range(1, min(limit, 5) + 1)
        ]

    async def subscribe_webhooks(self, access_token: str, account_id: str, fields: list[str]) -> bool:
        return True

    # --- Actions (recorded, never sent) -------------------------------------------
    def _record(self, kind: str, comment_id: str, message: str) -> SendResult:
        self._maybe_fail()
        external_id = f"sim_{kind}_{uuid.uuid4().hex[:16]}"
        self.sent.append(SentMessage(kind, comment_id, message, external_id, datetime.now(UTC)))
        return SendResult(external_id=external_id, simulated=True)

    async def reply_to_comment(self, access_token: str, comment_id: str, message: str) -> SendResult:
        return self._record("public_reply", comment_id, message)

    async def send_private_reply(self, access_token: str, account_id: str, comment_id: str, message: str) -> SendResult:
        return self._record("private_reply", comment_id, message)
