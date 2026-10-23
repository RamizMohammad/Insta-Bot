from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.core.redis import WORKER_HEARTBEAT_KEY, get_redis
from app.db.session import get_db

router = APIRouter(tags=["health"])


async def _check_database() -> dict[str, Any]:
    try:
        async with get_db().engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": type(exc).__name__}


async def _check_redis() -> dict[str, Any]:
    try:
        redis = get_redis()
        await redis.ping()
        beat = await redis.get(WORKER_HEARTBEAT_KEY)
        age = round(time.time() - float(beat), 1) if beat else None
        return {"ok": True, "worker_heartbeat_age_seconds": age, "worker_alive": age is not None and age < 120}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": type(exc).__name__}


async def readiness() -> JSONResponse:
    database, redis = await _check_database(), await _check_redis()
    ready = database["ok"] and redis["ok"]
    body = {"status": "ready" if ready else "unavailable", "checks": {"database": database, "redis": redis}}
    return JSONResponse(body, status_code=200 if ready else 503)


def liveness() -> dict[str, str]:
    settings = get_settings()
    return {"status": "ok", "app": settings.app_name, "env": str(settings.app_env)}


@router.get("/health", summary="API health and dependency status")
async def api_health() -> JSONResponse:
    return await readiness()
