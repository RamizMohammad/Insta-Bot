from __future__ import annotations

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC)


def as_aware(value: datetime) -> datetime:
    """Treat naive datetimes as UTC (some drivers drop tzinfo)."""
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def is_past(value: datetime | None) -> bool:
    return value is not None and as_aware(value) <= utcnow()
