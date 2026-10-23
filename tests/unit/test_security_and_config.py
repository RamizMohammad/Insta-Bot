from __future__ import annotations

import hashlib
import hmac
import json
import logging
import random
import uuid
from datetime import timedelta

import jwt
import pytest
from pydantic import SecretStr

from app.core.config import Environment, InstagramMode, Settings, get_settings
from app.core.exceptions import AuthenticationError
from app.core.logging import JsonFormatter, redact, redact_text
from app.core.security import (
    create_access_token,
    decode_access_token,
    decrypt_secret,
    encrypt_secret,
    hash_password,
    verify_meta_signature,
    verify_password,
)
from app.utils.backoff import backoff_delay


def test_password_hashing() -> None:
    h = hash_password("s3cure-Passw0rd")
    assert h.startswith("$argon2")
    assert verify_password("s3cure-Passw0rd", h)
    assert not verify_password("wrong", h)
    assert not verify_password("anything", None)


def test_access_token_roundtrip_and_expiry() -> None:
    settings = get_settings()
    user_id = uuid.uuid4()
    token, ttl = create_access_token(user_id, settings)
    assert ttl == settings.access_token_ttl_minutes * 60
    assert decode_access_token(token)["sub"] == str(user_id)

    expired = jwt.encode(
        {"sub": str(user_id), "type": "access", "iat": 0, "exp": 1, "iss": settings.app_name},
        settings.secret_key.get_secret_value(),
        algorithm="HS256",
    )
    with pytest.raises(AuthenticationError):
        decode_access_token(expired)
    forged = jwt.encode(
        {"sub": str(user_id), "type": "access", "iat": 0, "exp": 9e9},
        "another-secret-of-sufficient-length-1234",
        algorithm="HS256",
    )
    with pytest.raises(AuthenticationError):
        decode_access_token(forged)


def test_token_encryption_roundtrip() -> None:
    ciphertext = encrypt_secret("IGQVJ-secret-token")
    assert "IGQVJ" not in ciphertext
    assert decrypt_secret(ciphertext) == "IGQVJ-secret-token"
    other = get_settings().model_copy(update={"secret_key": SecretStr("x" * 40)})
    with pytest.raises(AuthenticationError):
        decrypt_secret(ciphertext, other)


def test_meta_signature() -> None:
    body = b'{"object":"instagram"}'
    sig = "sha256=" + hmac.new(b"secret", body, hashlib.sha256).hexdigest()
    assert verify_meta_signature(body, sig, "secret")
    assert not verify_meta_signature(body + b" ", sig, "secret")
    assert not verify_meta_signature(body, sig.replace("sha256=", "sha1="), "secret")
    assert not verify_meta_signature(body, None, "secret")
    assert not verify_meta_signature(body, sig, "")


def test_redaction() -> None:
    data = {"password": "p", "nested": {"access_token": "t", "ok": "Bearer abc.def"}, "list": ["refresh_token=xyz"]}
    out = redact(data)
    assert out["password"] == "[REDACTED]"
    assert out["nested"]["access_token"] == "[REDACTED]"
    assert out["nested"]["ok"] == "Bearer [REDACTED]"
    assert out["list"] == ["refresh_token=[REDACTED]"]
    assert "secret123" not in redact_text("https://x?client_secret=secret123&a=1")


def test_json_log_formatter_redacts() -> None:
    record = logging.LogRecord("t", logging.INFO, "", 0, "token access_token=abc", (), None)
    record.authorization = "Bearer x"
    line = json.loads(JsonFormatter().format(record))
    assert line["message"] == "token access_token=[REDACTED]"
    assert line["authorization"] == "[REDACTED]"


def _prod(**overrides) -> Settings:
    base = {
        "app_env": Environment.PRODUCTION,
        "secret_key": SecretStr("k" * 20 + "R4nd0m-" + "z" * 20),
        "instagram_mode": InstagramMode.LIVE,
        "meta_app_id": "1",
        "meta_app_secret": SecretStr("s"),
        "meta_redirect_uri": "https://x/cb",
        "meta_webhook_verify_token": SecretStr("v"),
    }
    return Settings(_env_file=None, **(base | overrides))  # type: ignore[call-arg]


def test_production_config_validation() -> None:
    assert _prod().is_production
    with pytest.raises(ValueError, match="SECRET_KEY"):
        _prod(secret_key=SecretStr("replace-with-a-secure-random-secret"))
    with pytest.raises(ValueError, match="mock"):
        _prod(instagram_mode=InstagramMode.MOCK)
    with pytest.raises(ValueError, match="META_APP_ID"):
        _prod(meta_app_id="")
    with pytest.raises(ValueError, match="DEBUG"):
        _prod(debug=True)


def test_backoff_is_bounded_with_jitter() -> None:
    rng = random.Random(1)
    delays = [backoff_delay(n, base=2, cap=60, rng=rng) for n in range(1, 12)]
    assert all(0 <= d <= 90 for d in delays)
    assert delays[0] < 3.1
    assert max(delays) >= 30
    assert timedelta(seconds=backoff_delay(50, cap=10)) <= timedelta(seconds=15)
