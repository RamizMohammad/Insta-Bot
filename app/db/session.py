"""Async engine and session management."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import Settings, get_settings


def build_engine(settings: Settings | None = None, *, null_pool: bool = False) -> AsyncEngine:
    settings = settings or get_settings()
    if null_pool:
        return create_async_engine(settings.database_url, poolclass=NullPool)
    return create_async_engine(
        settings.database_url,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_pre_ping=True,
        pool_recycle=1800,
    )


class Database:
    """Holds the engine/sessionmaker for one event loop (API process or worker process)."""

    def __init__(self, engine: AsyncEngine):
        self.engine = engine
        self.sessionmaker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)

    async def dispose(self) -> None:
        await self.engine.dispose()


_db: Database | None = None


def init_db(engine: AsyncEngine | None = None) -> Database:
    global _db
    _db = Database(engine or build_engine())
    return _db


def get_db() -> Database:
    if _db is None:
        return init_db()
    return _db


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, rolled back on error."""
    async with get_db().sessionmaker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
