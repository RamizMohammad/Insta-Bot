"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.api.v1.health import liveness, readiness
from app.core.config import Settings, get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.middleware import RequestContextMiddleware
from app.core.redis import close_redis
from app.db.session import get_db
from app.services.instagram import close_clients

logger = get_logger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        configure_logging(settings.log_level)
        db = get_db()
        logger.info(
            "startup",
            extra={"env": str(settings.app_env), "instagram_mode": str(settings.instagram_mode)},
        )
        yield
        await close_clients()
        await close_redis()
        await db.dispose()

    app = FastAPI(
        title=f"{settings.app_name} API",
        version="0.1.0",
        description="Instagram comment automation backend. Simulation mode works without Meta credentials.",
        lifespan=lifespan,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
        openapi_url="/openapi.json" if not settings.is_production else None,
    )
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["Authorization", "Content-Type", "X-Workspace-ID", "X-Request-ID"],
        )
    app.add_middleware(RequestContextMiddleware)
    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_v1_prefix)
    app.add_api_route("/health", liveness, methods=["GET"], tags=["health"], summary="Liveness probe")
    app.add_api_route("/ready", readiness, methods=["GET"], tags=["health"], summary="Readiness probe")
    return app


app = create_app()
