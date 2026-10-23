from __future__ import annotations

import json

import httpx
import pytest

from app.core.config import get_settings
from app.models.enums import ErrorCategory, TriState
from app.services.instagram.base import AdapterError, Capability, parse_comment_webhook
from app.services.instagram.meta_client import MetaInstagramClient
from app.services.instagram.mock_client import MockInstagramClient

WEBHOOK = {
    "object": "instagram",
    "entry": [
        {
            "id": "17841400000000000",
            "time": 1760000000,
            "changes": [
                {
                    "field": "comments",
                    "value": {
                        "from": {"id": "232323", "username": "ana"},
                        "media": {"id": "18000000000000000", "media_product_type": "REELS"},
                        "id": "17865799348089039",
                        "text": "COURSE please",
                    },
                },
                {"field": "mentions", "value": {"media_id": "1"}},
                {"field": "comments", "value": {"id": "no-media"}},
            ],
        }
    ],
}


def test_parse_comment_webhook() -> None:
    [event] = parse_comment_webhook(WEBHOOK)
    assert event.comment_id == "17865799348089039"
    assert event.media_id == "18000000000000000"
    assert event.account_id == "17841400000000000"
    assert event.username == "ana"
    assert event.follower_status is TriState.UNKNOWN
    assert event.created_at.year == 2025
    assert parse_comment_webhook({"object": "page"}) == []
    assert parse_comment_webhook({"object": "instagram", "entry": ["junk", {"changes": [None]}]}) == []


async def test_mock_adapter_records_and_fails_on_demand() -> None:
    mock = MockInstagramClient()
    assert mock.simulated
    assert not mock.supports(Capability.FOLLOWER_STATUS)
    result = await mock.reply_to_comment("t", "c1", "hi")
    assert result.simulated
    assert mock.sent[0].message == "hi"
    mock.fail_next(ErrorCategory.TRANSIENT)
    with pytest.raises(AdapterError) as exc:
        await mock.send_private_reply("t", "a", "c1", "hi")
    assert exc.value.retryable
    assert await mock.get_follower_status("t", "a", "u") is TriState.UNKNOWN
    grant = await mock.exchange_code("mock-code-abc")
    assert grant.access_token.startswith("mock-token-")
    with pytest.raises(AdapterError):
        await mock.exchange_code("real-code")


def _meta(handler) -> tuple[MetaInstagramClient, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def _wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    return MetaInstagramClient(get_settings(), httpx.AsyncClient(transport=httpx.MockTransport(_wrapped))), seen


async def test_meta_private_reply_request_shape() -> None:
    client, seen = _meta(lambda r: httpx.Response(200, json={"recipient_id": "1", "message_id": "m1"}))
    result = await client.send_private_reply("tok", "1784", "c9", "hello")
    assert result.external_id == "m1"
    req = seen[0]
    assert req.url.path == f"/{get_settings().meta_graph_api_version}/1784/messages"
    assert json.loads(req.content) == {"recipient": {"comment_id": "c9"}, "message": {"text": "hello"}}
    assert "appsecret_proof" in req.url.params


async def test_meta_public_reply_and_oauth_url() -> None:
    client, seen = _meta(lambda r: httpx.Response(200, json={"id": "r1"}))
    assert (await client.reply_to_comment("tok", "c9", "thanks")).external_id == "r1"
    assert seen[0].url.path.endswith("/c9/replies")
    url = client.build_authorization_url("state123")
    assert url.startswith("https://www.instagram.com/oauth/authorize?")
    assert "state=state123" in url
    assert "instagram_business_manage_comments" in url


async def test_meta_token_exchange() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.instagram.com":
            return httpx.Response(
                200, json={"data": [{"access_token": "short", "user_id": "99", "permissions": "a,b"}]}
            )
        assert request.url.params["grant_type"] == "ig_exchange_token"
        return httpx.Response(200, json={"access_token": "long", "token_type": "bearer", "expires_in": 5183944})

    client, _ = _meta(handler)
    grant = await client.exchange_code("abc#_")
    assert grant.access_token == "long"
    assert grant.permissions == ["a", "b"]
    assert grant.expires_at is not None


@pytest.mark.parametrize(
    ("status", "body", "side_effect", "category"),
    [
        (429, {}, True, ErrorCategory.RATE_LIMITED),
        (400, {"error": {"code": 4, "message": "limit"}}, True, ErrorCategory.RATE_LIMITED),
        (400, {"error": {"code": 190, "message": "expired"}}, True, ErrorCategory.AUTHORIZATION),
        (403, {"error": {"code": 10, "message": "perm"}}, True, ErrorCategory.AUTHORIZATION),
        (400, {"error": {"code": 100, "message": "bad"}}, True, ErrorCategory.PERMANENT),
        (500, {"error": {"code": 1, "message": "unknown"}}, True, ErrorCategory.AMBIGUOUS),
        (500, {"error": {"code": 1, "message": "unknown"}}, False, ErrorCategory.TRANSIENT),
        (503, {}, True, ErrorCategory.TRANSIENT),
    ],
)
async def test_meta_error_classification(status, body, side_effect, category) -> None:
    client, _ = _meta(lambda r: httpx.Response(status, json=body))
    with pytest.raises(AdapterError) as exc:
        await client._request("POST", "https://graph.instagram.com/x", side_effect=side_effect)
    assert exc.value.category is category


async def test_meta_transport_errors() -> None:
    def connect_fail(request):
        raise httpx.ConnectError("down")

    def read_timeout(request):
        raise httpx.ReadTimeout("slow")

    client, _ = _meta(connect_fail)
    with pytest.raises(AdapterError) as exc:
        await client.reply_to_comment("t", "c", "m")
    assert exc.value.category is ErrorCategory.TRANSIENT  # never reached Meta: safe to retry

    client, _ = _meta(read_timeout)
    with pytest.raises(AdapterError) as exc:
        await client.reply_to_comment("t", "c", "m")
    assert exc.value.category is ErrorCategory.AMBIGUOUS  # may have been delivered: never auto-retry
