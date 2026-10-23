"""Walk through the simulation scenarios against a running API (no Instagram credentials needed).

    uv run python scripts/simulate_demo.py --base-url http://localhost:8000

Creates a throwaway user, a template and a simulation campaign, then demonstrates:
matching, non-matching, exclusion, unknown-follower fallback, duplicate suppression,
paused campaigns, workspace isolation, and that simulated replies never reach Instagram.
"""

from __future__ import annotations

import argparse
import secrets
import sys
from typing import Any

import httpx

PASSWORD = "Demo-" + secrets.token_urlsafe(12) + "1"


def _check(label: str, ok: bool, detail: Any = "") -> bool:
    print(f"[{'PASS' if ok else 'FAIL'}] {label}{f' - {detail}' if detail else ''}")
    return ok


def _user(client: httpx.Client, tag: str) -> dict[str, str]:
    email = f"demo-{tag}-{secrets.token_hex(4)}@example.com"
    client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD}).raise_for_status()
    tokens = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).raise_for_status().json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()

    with httpx.Client(base_url=args.base_url, timeout=30) as client:
        h = _user(client, "owner")
        template = (
            client.post(
                "/api/v1/templates",
                headers=h,
                json={
                    "name": "Course DM",
                    "type": "private_reply",
                    "body": "Hey {{username}}! Here is your resource: {{resource_link}}",
                    "custom_variables": ["resource_link"],
                    "fallbacks": {"username": "there"},
                },
            )
            .raise_for_status()
            .json()
        )
        campaign = (
            client.post(
                "/api/v1/campaigns",
                headers=h,
                json={
                    "name": "Demo campaign",
                    "mode": "simulation",
                    "media_external_id": "test-media-001",
                    "config": {
                        "actions": [{"type": "private_reply", "template_id": template["id"]}],
                        "variables": {"resource_link": "https://example.com/course"},
                        "follower_requirement": "followers_only",
                        "unknown_follower_fallback": "manual_review",
                    },
                    "rules": [
                        {"keyword": "course", "match_type": "contains"},
                        {"keyword": "spam", "match_type": "keyword", "action": "exclude"},
                    ],
                },
            )
            .raise_for_status()
            .json()
        )
        cid = campaign["id"]
        client.post(f"/api/v1/campaigns/{cid}/activate", headers=h).raise_for_status()

        def simulate(headers: dict[str, str], comment_id: str, text: str, follower: str = "true") -> httpx.Response:
            return client.post(
                "/api/v1/dev/simulate-comment",
                headers=headers,
                json={
                    "campaign_id": cid,
                    "comment_id": comment_id,
                    "media_id": "test-media-001",
                    "username": "example_user",
                    "comment_text": text,
                    "follower_status": follower,
                },
            )

        results = []
        r = simulate(h, "demo-1", "COURSE please send me the link").json()
        ex = r["executions"]
        results.append(
            _check(
                "1. matching comment triggers action",
                ex and ex[0]["status"] == "simulated",
                ex[0]["rendered_message"] if ex else r,
            )
        )
        r = simulate(h, "demo-2", "Nice reel!").json()
        results.append(_check("2. non-matching comment does nothing", r["executions"] == []))
        r = simulate(h, "demo-3", "course spam").json()
        results.append(
            _check("3. excluded keyword prevents match", r["executions"] == [], r["result"]["campaigns"][0]["reason"])
        )
        r = simulate(h, "demo-4", "course", follower="unknown").json()
        results.append(
            _check("4. unknown follower status -> fallback", r["executions"][0]["status"] == "manual_review")
        )
        r = simulate(h, "demo-1", "COURSE please send me the link").json()
        results.append(_check("5. duplicate event is not re-executed", r["duplicate"] and len(r["executions"]) == 1))
        client.post(f"/api/v1/campaigns/{cid}/pause", headers=h).raise_for_status()
        r = simulate(h, "demo-6", "course").json()
        results.append(_check("6. paused campaign does not execute", r["executions"] == []))
        client.post(f"/api/v1/campaigns/{cid}/resume", headers=h).raise_for_status()
        intruder = _user(client, "intruder")
        results.append(
            _check("7. other workspaces cannot trigger it", simulate(intruder, "demo-7", "course").status_code == 404)
        )
        execs = client.get("/api/v1/executions", headers=h, params={"simulated": "false"}).json()
        results.append(_check("8. nothing was sent to Instagram (no live executions)", execs["total"] == 0))
        stats = client.get(f"/api/v1/campaigns/{cid}/analytics", headers=h).json()
        print("analytics:", {k: v for k, v in stats.items() if k != "by_action"})
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
