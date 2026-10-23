"""Fixed-window rate limiting backed by Redis, with an in-process fallback if Redis is down."""

from __future__ import annotations

import time

from redis.exceptions import RedisError

from app.core.exceptions import RateLimited
from app.core.logging import get_logger
from app.core.redis import get_redis

logger = get_logger(__name__)
_local_windows: dict[str, tuple[int, float]] = {}


def _local_hit(key: str, window: int) -> int:
    now = time.monotonic()
    count, started = _local_windows.get(key, (0, now))
    if now - started >= window:
        count, started = 0, now
    _local_windows[key] = (count + 1, started)
    if len(_local_windows) > 10_000:  # bound memory
        _local_windows.clear()
    return count + 1


async def consume(key: str, limit: int, window_seconds: int) -> tuple[bool, float]:
    """Count one hit for ``key``. Returns ``(allowed, seconds_until_window_resets)``."""
    now = time.time()
    window_index = int(now // window_seconds)
    bucket = f"rl:{key}:{window_index}"
    try:
        redis = get_redis()
        async with redis.pipeline(transaction=True) as pipe:
            pipe.incr(bucket)
            pipe.expire(bucket, window_seconds + 1)
            count = int((await pipe.execute())[0])
    except (RedisError, OSError):
        logger.warning("rate_limit_redis_unavailable", extra={"key": key.split(":", maxsplit=1)[0]})
        count = _local_hit(bucket, window_seconds)
    return count <= limit, (window_index + 1) * window_seconds - now


async def hit(key: str, limit: int, window_seconds: int) -> None:
    """Like :func:`consume` but raises ``RateLimited`` (used for API endpoints)."""
    allowed, retry_after = await consume(key, limit, window_seconds)
    if not allowed:
        raise RateLimited(details={"retry_after_seconds": int(retry_after) + 1})


def reset_local() -> None:
    _local_windows.clear()
