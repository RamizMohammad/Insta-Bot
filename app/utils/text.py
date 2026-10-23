from __future__ import annotations


def truncate(value: str | None, limit: int = 500) -> str | None:
    if value is None:
        return None
    return value if len(value) <= limit else value[: limit - 1] + "…"
