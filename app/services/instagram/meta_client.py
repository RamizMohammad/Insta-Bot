"""Live adapter for the Instagram API with Instagram Login (graph.instagram.com).

Endpoints follow Meta's Instagram Platform documentation (Business Login, comment moderation,
private replies, webhooks). The API version is configured once via ``META_GRAPH_API_VERSION``.
This adapter has NOT been verified against a real Meta app from this codebase; see
IMPLEMENTATION_STATUS.md before relying on it.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import Settings
from app.core.security import hmac_sha256_hex
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

# Graph API error codes: https://developers.facebook.com/docs/graph-api/guides/error-handling
_RATE_LIMIT_CODES = {4, 17, 32, 613}
_AUTH_CODES = {102, 190}
_PERMISSION_CODES = {3, 10} | set(range(200, 300))
_TRANSIENT_CODES = {1, 2}


class MetaInstagramClient(InstagramClient):
    name = "meta"
    simulated = False
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

    def __init__(self, settings: Settings, http: httpx.AsyncClient | None = None):
        self.settings = settings
        self._http = http or httpx.AsyncClient(
            timeout=httpx.Timeout(settings.action_timeout_seconds, connect=5.0),
            headers={"User-Agent": f"{settings.app_name}/1.0"},
        )

    @property
    def _graph(self) -> str:
        return f"{self.settings.meta_graph_base_url.rstrip('/')}/{self.settings.meta_graph_api_version}"

    def _auth_params(self, access_token: str) -> dict[str, str]:
        params = {"access_token": access_token}
        secret = self.settings.meta_app_secret.get_secret_value()
        if self.settings.meta_app_secret_protection_enabled and secret:
            params["appsecret_proof"] = hmac_sha256_hex(secret, access_token.encode())
        return params

    # --- HTTP plumbing ------------------------------------------------------
    async def _request(self, method: str, url: str, *, side_effect: bool = False, **kwargs: Any) -> dict[str, Any]:
        """Send a request and classify failures.

        For side-effecting calls, a failure after the request may have reached Meta (read timeout,
        dropped connection, 5xx) is ``AMBIGUOUS`` and must not be retried automatically.
        """
        try:
            response = await self._http.request(method, url, **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
            raise AdapterError("Could not reach Instagram", ErrorCategory.TRANSIENT) from exc
        except httpx.TransportError as exc:
            category = ErrorCategory.AMBIGUOUS if side_effect else ErrorCategory.TRANSIENT
            raise AdapterError("Instagram request outcome unknown", category) from exc

        try:
            data: dict[str, Any] = response.json()
        except ValueError:
            data = {}
        if response.is_success:
            return data
        raise self._classify(response, data, side_effect)

    @staticmethod
    def _classify(response: httpx.Response, data: dict[str, Any], side_effect: bool) -> AdapterError:
        error = data.get("error") if isinstance(data.get("error"), dict) else data
        code = error.get("code") if isinstance(error, dict) else None
        message = str((error or {}).get("message") or (error or {}).get("error_message") or "Instagram API error")
        retry_after = float(response.headers.get("Retry-After", 0) or 0) or None
        if response.status_code == 429 or code in _RATE_LIMIT_CODES:
            return AdapterError(message, ErrorCategory.RATE_LIMITED, retry_after=retry_after or 60.0, code=code)
        if code in _AUTH_CODES or response.status_code == 401:
            return AdapterError(message, ErrorCategory.AUTHORIZATION, code=code)
        if code in _PERMISSION_CODES or response.status_code == 403:
            return AdapterError(message, ErrorCategory.AUTHORIZATION, code=code)
        if response.status_code >= 500 or code in _TRANSIENT_CODES:
            if side_effect and response.status_code != 503:
                return AdapterError(message, ErrorCategory.AMBIGUOUS, code=code)
            return AdapterError(message, ErrorCategory.TRANSIENT, retry_after=retry_after, code=code)
        return AdapterError(message, ErrorCategory.PERMANENT, code=code)

    # --- OAuth ---------------------------------------------------------------
    def build_authorization_url(self, state: str) -> str:
        query = urlencode(
            {
                "client_id": self.settings.meta_app_id,
                "redirect_uri": self.settings.meta_redirect_uri,
                "response_type": "code",
                "scope": ",".join(self.settings.meta_scopes),
                "state": state,
            }
        )
        return f"{self.settings.meta_oauth_authorize_url}?{query}"

    async def exchange_code(self, code: str) -> TokenGrant:
        short = await self._request(
            "POST",
            self.settings.meta_oauth_token_url,
            data={
                "client_id": self.settings.meta_app_id,
                "client_secret": self.settings.meta_app_secret.get_secret_value(),
                "grant_type": "authorization_code",
                "redirect_uri": self.settings.meta_redirect_uri,
                "code": code.removesuffix("#_"),
            },
        )
        # Documented response wraps the grant in ``data: [...]``; older responses are flat.
        grant = short["data"][0] if isinstance(short.get("data"), list) and short["data"] else short
        if not grant.get("access_token"):
            raise AdapterError("Token exchange returned no access token", ErrorCategory.PERMANENT)
        permissions = grant.get("permissions") or []
        if isinstance(permissions, str):
            permissions = [p for p in permissions.split(",") if p]
        long_lived = await self._request(
            "GET",
            f"{self.settings.meta_graph_base_url.rstrip('/')}/access_token",
            params={
                "grant_type": "ig_exchange_token",
                "client_secret": self.settings.meta_app_secret.get_secret_value(),
                "access_token": grant["access_token"],
            },
        )
        return TokenGrant(
            access_token=long_lived["access_token"],
            user_id=str(grant.get("user_id")) if grant.get("user_id") else None,
            permissions=list(permissions),
            expires_at=_expiry(long_lived.get("expires_in")),
        )

    async def refresh_token(self, access_token: str) -> TokenGrant:
        data = await self._request(
            "GET",
            f"{self.settings.meta_graph_base_url.rstrip('/')}/refresh_access_token",
            params={"grant_type": "ig_refresh_token", "access_token": access_token},
        )
        return TokenGrant(access_token=data["access_token"], expires_at=_expiry(data.get("expires_in")))

    # --- Account and media ----------------------------------------------------
    async def get_account(self, access_token: str) -> AccountInfo:
        data = await self._request(
            "GET",
            f"{self._graph}/me",
            params={"fields": "user_id,username,account_type", **self._auth_params(access_token)},
        )
        return AccountInfo(
            account_id=str(data.get("user_id") or data["id"]),
            username=data.get("username"),
            account_type=data.get("account_type"),
        )

    async def list_media(self, access_token: str, limit: int = 25) -> list[MediaItem]:
        data = await self._request(
            "GET",
            f"{self._graph}/me/media",
            params={
                "fields": "id,media_type,media_product_type,permalink,caption,timestamp",
                "limit": str(min(max(limit, 1), 100)),
                **self._auth_params(access_token),
            },
        )
        return [
            MediaItem(
                id=str(item["id"]),
                media_type=item.get("media_type"),
                media_product_type=item.get("media_product_type"),
                permalink=item.get("permalink"),
                caption=item.get("caption"),
                timestamp=_parse_ts(item.get("timestamp")),
            )
            for item in data.get("data", [])
            if item.get("id")
        ]

    async def subscribe_webhooks(self, access_token: str, account_id: str, fields: list[str]) -> bool:
        data = await self._request(
            "POST",
            f"{self._graph}/{account_id}/subscribed_apps",
            params={"subscribed_fields": ",".join(fields), **self._auth_params(access_token)},
        )
        return bool(data.get("success"))

    # --- Actions ------------------------------------------------------------------
    async def reply_to_comment(self, access_token: str, comment_id: str, message: str) -> SendResult:
        data = await self._request(
            "POST",
            f"{self._graph}/{comment_id}/replies",
            params=self._auth_params(access_token),
            json={"message": message},
            side_effect=True,
        )
        return SendResult(external_id=data.get("id"), simulated=False)

    async def send_private_reply(self, access_token: str, account_id: str, comment_id: str, message: str) -> SendResult:
        # Private replies: one message per comment, within 7 days of the comment.
        data = await self._request(
            "POST",
            f"{self._graph}/{account_id}/messages",
            params=self._auth_params(access_token),
            json={"recipient": {"comment_id": comment_id}, "message": {"text": message}},
            side_effect=True,
        )
        return SendResult(external_id=data.get("message_id"), simulated=False, recipient_id=data.get("recipient_id"))

    async def aclose(self) -> None:
        await self._http.aclose()


def _expiry(expires_in: Any) -> datetime | None:
    try:
        return datetime.now(UTC) + timedelta(seconds=int(expires_in))
    except (TypeError, ValueError):
        return None


def _parse_ts(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("+0000", "+00:00"))
    except ValueError:
        return None
