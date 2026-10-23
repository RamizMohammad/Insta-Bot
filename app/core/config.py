"""Application settings loaded from environment variables (Pydantic Settings)."""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_SECRET_MARKERS = ("replace-with", "change-me", "changeme", "dev-secret", "insecure")


class Environment(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    STAGING = "staging"
    PRODUCTION = "production"


class InstagramMode(StrEnum):
    MOCK = "mock"
    LIVE = "live"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Application -------------------------------------------------------
    app_name: str = "InstaFlow"
    app_env: Environment = Environment.DEVELOPMENT
    debug: bool = False
    log_level: str = "INFO"
    api_v1_prefix: str = "/api/v1"
    cors_origins: list[str] = Field(default_factory=list)

    # --- Security ----------------------------------------------------------
    secret_key: SecretStr = SecretStr("dev-secret-change-me-dev-secret-change-me")
    # Optional dedicated Fernet key (urlsafe base64, 32 bytes). Derived from SECRET_KEY if unset.
    token_encryption_key: SecretStr | None = None
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 14
    jwt_algorithm: str = "HS256"
    auth_rate_limit: int = 10  # attempts per window per client+route
    auth_rate_limit_window_seconds: int = 60

    # --- Infrastructure ----------------------------------------------------
    database_url: str = "postgresql+asyncpg://instaflow:instaflow@localhost:5432/instaflow"
    database_pool_size: int = 5
    database_max_overflow: int = 5
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str | None = None
    celery_result_backend: str | None = None

    # --- Automation --------------------------------------------------------
    action_max_attempts: int = 5
    action_retry_base_seconds: float = 2.0
    action_retry_max_seconds: float = 300.0
    action_timeout_seconds: float = 15.0
    account_rate_limit_per_minute: int = 30
    outbox_batch_size: int = 100
    outbox_relay_interval_seconds: float = 5.0
    # After committing new outbox rows the API nudges the relay so work starts immediately.
    outbox_kick_enabled: bool = True
    # Workspaces allowed to use the simulation endpoint outside development/test.
    simulation_workspace_allowlist: list[str] = Field(default_factory=list)

    # --- Instagram / Meta --------------------------------------------------
    instagram_mode: InstagramMode = InstagramMode.MOCK
    meta_app_id: str = ""
    meta_app_secret: SecretStr = SecretStr("")
    meta_redirect_uri: str = ""
    meta_webhook_verify_token: SecretStr = SecretStr("")
    meta_graph_api_version: str = "v26.0"
    meta_graph_base_url: str = "https://graph.instagram.com"
    meta_oauth_authorize_url: str = "https://www.instagram.com/oauth/authorize"
    meta_oauth_token_url: str = "https://api.instagram.com/oauth/access_token"
    meta_app_secret_protection_enabled: bool = True
    meta_scopes: list[str] = Field(
        default_factory=lambda: [
            "instagram_business_basic",
            "instagram_business_manage_comments",
            "instagram_business_manage_messages",
        ]
    )
    oauth_state_ttl_seconds: int = 600

    @property
    def is_production(self) -> bool:
        return self.app_env in (Environment.PRODUCTION, Environment.STAGING)

    @property
    def is_dev_or_test(self) -> bool:
        return self.app_env in (Environment.DEVELOPMENT, Environment.TEST)

    @property
    def broker_url(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def result_backend(self) -> str:
        return self.celery_result_backend or self.redis_url

    @property
    def meta_configured(self) -> bool:
        return bool(
            self.meta_app_id
            and self.meta_app_secret.get_secret_value()
            and self.meta_redirect_uri
            and self.meta_webhook_verify_token.get_secret_value()
        )

    @model_validator(mode="after")
    def _validate_production(self) -> Settings:
        """Refuse to start production with development secrets or silent mock mode."""
        if not self.is_production:
            return self
        problems: list[str] = []
        secret = self.secret_key.get_secret_value()
        if len(secret) < 32 or any(m in secret.lower() for m in _DEV_SECRET_MARKERS):
            problems.append("SECRET_KEY must be a random value of at least 32 characters")
        if self.debug:
            problems.append("DEBUG must be false")
        if self.instagram_mode is InstagramMode.MOCK:
            problems.append("INSTAGRAM_MODE=mock is not allowed in production; set INSTAGRAM_MODE=live")
        if self.instagram_mode is InstagramMode.LIVE and not self.meta_configured:
            problems.append(
                "META_APP_ID, META_APP_SECRET, META_REDIRECT_URI and META_WEBHOOK_VERIFY_TOKEN are required"
            )
        if problems:
            raise ValueError("Invalid production configuration: " + "; ".join(problems))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
