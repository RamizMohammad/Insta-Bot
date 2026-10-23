"""Bounded exponential backoff with jitter."""

from __future__ import annotations

import random


def backoff_delay(
    attempt: int, base: float = 2.0, cap: float = 300.0, jitter: float = 0.5, rng: random.Random | None = None
) -> float:
    """Delay before retry number ``attempt`` (1-based): ``base * 2**(attempt-1)`` capped, +/- ``jitter``."""
    raw = min(cap, base * (2.0 ** max(attempt - 1, 0)))
    spread = raw * jitter
    sample = rng.random() if rng else random.random()  # noqa: S311 - jitter, not security
    return max(0.0, raw - spread + sample * 2 * spread)
