"""Adapter selection. Simulation always uses the mock adapter; live requires INSTAGRAM_MODE=live."""

from __future__ import annotations

from app.core.config import InstagramMode, Settings, get_settings
from app.core.exceptions import UnsupportedCapability
from app.models.enums import OperatingMode
from app.services.instagram.base import InstagramClient
from app.services.instagram.meta_client import MetaInstagramClient
from app.services.instagram.mock_client import MockInstagramClient

_mock: MockInstagramClient | None = None
_live: MetaInstagramClient | None = None


def get_mock_client() -> MockInstagramClient:
    global _mock
    if _mock is None:
        _mock = MockInstagramClient(callback_url=f"{get_settings().api_v1_prefix}/instagram/callback")
    return _mock


def live_mode_available(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return settings.instagram_mode is InstagramMode.LIVE and settings.meta_configured


def get_live_client(settings: Settings | None = None) -> MetaInstagramClient:
    global _live
    settings = settings or get_settings()
    if not live_mode_available(settings):
        raise UnsupportedCapability(
            "Live Instagram integration is disabled. Set INSTAGRAM_MODE=live and the META_* settings.",
            code="live_mode_unavailable",
        )
    if _live is None:
        _live = MetaInstagramClient(settings)
    return _live


def get_connection_client(settings: Settings | None = None) -> InstagramClient:
    """Adapter used for OAuth/account sync: follows the global INSTAGRAM_MODE."""
    settings = settings or get_settings()
    return get_live_client(settings) if settings.instagram_mode is InstagramMode.LIVE else get_mock_client()


def client_for_mode(mode: OperatingMode, settings: Settings | None = None) -> InstagramClient:
    return get_mock_client() if mode is OperatingMode.SIMULATION else get_live_client(settings)


async def close_clients() -> None:
    global _live
    if _live is not None:
        await _live.aclose()
        _live = None


__all__ = [
    "InstagramClient",
    "client_for_mode",
    "close_clients",
    "get_connection_client",
    "get_live_client",
    "get_mock_client",
    "live_mode_available",
]
