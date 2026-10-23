"""Structured JSON logging with correlation IDs and sensitive-data redaction."""

from __future__ import annotations

import json
import logging
import re
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

correlation_id_var: ContextVar[str | None] = ContextVar("correlation_id", default=None)

REDACTED = "[REDACTED]"
_SENSITIVE_KEYS = re.compile(
    r"(pass(word)?|secret|token|authorization|cookie|api[_-]?key|signature|code_verifier|appsecret)",
    re.IGNORECASE,
)
# Values that look like credentials even when the key name is innocuous.
_SENSITIVE_VALUE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]+"), "Bearer " + REDACTED),
    (
        re.compile(r"(?i)\b(access_token|client_secret|refresh_token|appsecret_proof|code)=[^&\s]+"),
        r"\1=" + REDACTED,
    ),
    (re.compile(r"eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+"), REDACTED),  # JWTs
)
_RESERVED_ATTRS = frozenset(
    vars(logging.LogRecord("", 0, "", 0, "", (), None)).keys() | {"message", "asctime", "taskName"}
)


def redact_text(value: str) -> str:
    for pattern, replacement in _SENSITIVE_VALUE_PATTERNS:
        value = pattern.sub(replacement, value)
    return value


def redact(value: Any, _depth: int = 0) -> Any:
    """Recursively redact sensitive keys/values from dicts, lists and strings."""
    if _depth > 8:
        return value
    if isinstance(value, dict):
        return {
            k: REDACTED if isinstance(k, str) and _SENSITIVE_KEYS.search(k) else redact(v, _depth + 1)
            for k, v in value.items()
        }
    if isinstance(value, list | tuple):
        return [redact(v, _depth + 1) for v in value]
    if isinstance(value, str):
        return redact_text(value)
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_text(record.getMessage()),
        }
        if cid := correlation_id_var.get():
            payload["correlation_id"] = cid
        extra = {k: v for k, v in vars(record).items() if k not in _RESERVED_ATTRS}
        if extra:
            payload.update(redact(extra))
        if record.exc_info:
            payload["exc_info"] = redact_text(self.formatException(record.exc_info))
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    for noisy in ("uvicorn.access", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
