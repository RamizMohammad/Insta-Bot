"""Password hashing, JWT access tokens, opaque refresh tokens, and secret encryption."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import Settings, get_settings
from app.core.exceptions import AuthenticationError

_hasher = PasswordHasher()
# Used to equalise timing when the user does not exist (avoids account enumeration).
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


# --- Passwords -------------------------------------------------------------
def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


# --- Access tokens (short-lived JWT) ----------------------------------------
def create_access_token(user_id: uuid.UUID, settings: Settings | None = None) -> tuple[str, int]:
    settings = settings or get_settings()
    now = datetime.now(UTC)
    ttl = timedelta(minutes=settings.access_token_ttl_minutes)
    claims = {
        "sub": str(user_id),
        "type": "access",
        "iat": now,
        "nbf": now,
        "exp": now + ttl,
        "jti": uuid.uuid4().hex,
        "iss": settings.app_name,
    }
    token = jwt.encode(claims, settings.secret_key.get_secret_value(), algorithm=settings.jwt_algorithm)
    return token, int(ttl.total_seconds())


def decode_access_token(token: str, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            settings.secret_key.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            issuer=settings.app_name,
            options={"require": ["exp", "sub", "type", "iat"]},
        )
    except jwt.PyJWTError as exc:
        raise AuthenticationError() from exc
    if claims.get("type") != "access":
        raise AuthenticationError()
    return claims


# --- Refresh tokens (opaque, stored hashed) ---------------------------------
def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """Deterministic SHA-256 digest for looking up high-entropy tokens."""
    return hashlib.sha256(token.encode()).hexdigest()


# --- Symmetric encryption for third-party credentials -----------------------
@lru_cache(maxsize=4)
def _fernet(secret_key: str, explicit_key: str | None) -> Fernet:
    if explicit_key:
        return Fernet(explicit_key.encode())
    derived = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"instaflow-token-encryption", info=b"v1").derive(
        secret_key.encode()
    )
    return Fernet(base64.urlsafe_b64encode(derived))


def _cipher(settings: Settings | None = None) -> Fernet:
    settings = settings or get_settings()
    explicit = settings.token_encryption_key.get_secret_value() if settings.token_encryption_key else None
    return _fernet(settings.secret_key.get_secret_value(), explicit)


def encrypt_secret(plaintext: str, settings: Settings | None = None) -> str:
    return _cipher(settings).encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str, settings: Settings | None = None) -> str:
    try:
        return _cipher(settings).decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise AuthenticationError("Stored credential could not be decrypted.", code="credential_invalid") from exc


# --- HMAC helpers -----------------------------------------------------------
def hmac_sha256_hex(key: str, message: bytes) -> str:
    return hmac.new(key.encode(), message, hashlib.sha256).hexdigest()


def verify_meta_signature(raw_body: bytes, header_value: str | None, app_secret: str) -> bool:
    """Validate Meta's ``X-Hub-Signature-256: sha256=<hex>`` header against the raw body."""
    if not header_value or not app_secret or not header_value.startswith("sha256="):
        return False
    expected = hmac_sha256_hex(app_secret, raw_body)
    return hmac.compare_digest(expected, header_value.removeprefix("sha256="))


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
