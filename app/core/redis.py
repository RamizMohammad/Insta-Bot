"""Shared async Redis client."""

from __future__ import annotations

from redis.asyncio import Redis

from app.core.config import get_settings

WORKER_HEARTBEAT_KEY = "instaflow:worker:heartbeat"
_client: Redis | None = None


def get_redis() -> Redis:
    global _client
    if _client is None:
        _client = Redis.from_url(get_settings().redis_url, decode_responses=True, socket_timeout=2.0)
    return _client


def set_redis(client: Redis | None) -> None:
    """Override the client (tests use fakeredis)."""
    global _client
    _client = client


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
