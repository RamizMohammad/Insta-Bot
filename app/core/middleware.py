"""Pure ASGI middleware: correlation IDs, security headers and access logging."""

from __future__ import annotations

import re
import time
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logging import correlation_id_var, get_logger

logger = get_logger("instaflow.access")
_VALID_ID = re.compile(r"^[A-Za-z0-9._\-]{8,64}$")
_SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"cache-control", b"no-store"),
]


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = dict(scope.get("headers") or []).get(b"x-request-id", b"").decode("latin-1")
        cid = incoming if _VALID_ID.fullmatch(incoming) else uuid.uuid4().hex
        token = correlation_id_var.set(cid)
        started = time.perf_counter()
        status_code = 500

        async def _send(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", cid.encode()))
                headers.extend(_SECURITY_HEADERS)
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            logger.info(
                "request",
                extra={
                    "method": scope.get("method"),
                    "path": scope.get("path"),  # path only: query strings may carry OAuth codes
                    "status": status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                },
            )
            correlation_id_var.reset(token)
