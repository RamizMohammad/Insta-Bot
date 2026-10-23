"""Fill a development workspace with realistic demo data through the public API (simulation only).

    uv run python scripts/seed_demo.py --base-url http://localhost:8000

Creates (or reuses) the demo login below, connects a mock Instagram account, syncs media,
creates templates and campaigns, and runs a batch of simulated comments so every screen has data.
Requires APP_ENV=development (or test). Nothing is ever sent to Instagram.
"""

from __future__ import annotations

import argparse
import random
import sys
import zlib
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "Demo-passw0rd-123"  # development-only seed credential

COMMENTS = [
    ("ana.designs", "GUIDE please! 🙌", "true"),
    ("marcus_tech", "Can you send me the PDF guide?", "unknown"),
    ("clara.studio", "guide", "false"),
    ("jordan.k", "This is a scam bot", "unknown"),
    ("art_by_sam", "love this reel", "true"),
    ("nina_creates", "Send me the link to the guide pls", "true"),
    ("leo.films", "PDF!!", "unknown"),
    ("maya_ux", "Where's the course link?", "true"),
    ("sam.writes", "course please", "unknown"),
    ("kai_builds", "stop sending me stuff", "unknown"),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()
    c = httpx.Client(base_url=f"{args.base_url}/api/v1", timeout=30)

    c.post(
        "/auth/register",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD, "workspace_name": "Studio Creatives Co."},
    )
    login = c.post("/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    login.raise_for_status()
    c.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

    def call(method: str, path: str, **kw: Any) -> Any:
        r = c.request(method, path, **kw)
        if r.status_code >= 400:
            print(f"{method} {path} -> {r.status_code} {r.text}", file=sys.stderr)
            r.raise_for_status()
        return r.json() if r.content else None

    # Mock Instagram connection + media (loops back through our own OAuth callback).
    url = call("GET", "/instagram/connect")["authorization_url"]
    q = parse_qs(urlparse(url).query)
    connection = call("GET", "/instagram/callback", params={"code": q["code"][0], "state": q["state"][0]})
    media = call("GET", f"/instagram/accounts/{connection['id']}/media", params={"sync": "true"})

    existing = {t["name"]: t for t in call("GET", "/templates", params={"limit": 100})["items"]}

    def template(name: str, type_: str, body: str, custom: list[str]) -> dict[str, Any]:
        if name in existing:
            return existing[name]
        return call(
            "POST",
            "/templates",
            json={
                "name": name,
                "type": type_,
                "body": body,
                "custom_variables": custom,
                "fallbacks": {"username": "there"},
            },
        )

    dm = template(
        "Summer PDF DM",
        "private_reply",
        "Hey {{username}}! Here is your private link to the Summer PDF Guide: {{resource_link}} 🚀",
        ["resource_link"],
    )
    public = template("Check your DMs", "public_reply", "Check your DMs @{{username}}, just sent it over! 🙌", [])
    course = template(
        "Course link DM", "private_reply", "Hi {{username}}, here's the course: {{resource_link}}", ["resource_link"]
    )

    campaigns = {c_["name"]: c_ for c_ in call("GET", "/campaigns", params={"limit": 100})["items"]}

    def campaign(name: str, body: dict[str, Any], activate: bool = True) -> dict[str, Any]:
        if name in campaigns:
            return campaigns[name]
        created = call("POST", "/campaigns", json={"name": name, **body})
        if activate:
            created = call("POST", f"/campaigns/{created['id']}/activate")
        return created

    summer = campaign(
        "Summer Launch Reel - PDF Guide",
        {
            "description": "Get the free Notion guide",
            "mode": "simulation",
            "connection_id": connection["id"],
            "media_id": media[0]["id"],
            "config": {
                "actions": [
                    {"type": "private_reply", "template_id": dm["id"]},
                    {"type": "public_reply", "template_id": public["id"]},
                ],
                "variables": {"resource_link": "https://instaflow.io/r/guide-902"},
                "follower_requirement": "followers_only",
                "unknown_follower_fallback": "manual_review",
            },
            "rules": [
                {"keyword": "guide, pdf", "match_type": "contains"},
                {"keyword": "scam, fake, bot", "match_type": "keyword", "action": "exclude"},
                {"keyword": "stop, unsubscribe", "match_type": "keyword", "action": "exclude"},
            ],
        },
    )
    course_campaign = campaign(
        "Course Launch Comments",
        {
            "description": "Comment COURSE for the link",
            "mode": "simulation",
            "connection_id": connection["id"],
            "media_id": media[1]["id"],
            "config": {
                "actions": [{"type": "private_reply", "template_id": course["id"]}],
                "variables": {"resource_link": "https://example.com/course"},
            },
            "rules": [{"keyword": "course", "match_type": "keyword"}],
        },
    )
    campaign(
        "Preset Pack v2 Launch",
        {
            "description": "Free preset bundle",
            "mode": "simulation",
            "media_external_id": media[2]["external_media_id"],
            "rules": [{"keyword": "preset", "match_type": "contains"}],
        },
        activate=False,
    )

    rng = random.Random(7)  # noqa: S311 - deterministic demo IDs
    for i, (user, text, follower) in enumerate(COMMENTS * 2):
        target = course_campaign if "course" in text.lower() else summer
        fault = "none"
        if i == 3:
            fault = "rate_limited"
        elif i == 11:
            fault = "ambiguous"
        call(
            "POST",
            "/dev/simulate-comment",
            json={
                "campaign_id": target["id"],
                "comment_id": f"seed-{i:03d}-{rng.randint(1000, 9999)}",
                "username": user,
                "commenter_id": f"ig_{zlib.crc32(user.encode()) % 10**8}",
                "comment_text": text,
                "follower_status": follower,
                "fault": fault,
            },
        )
    print(f"Seeded. Sign in at the frontend with {DEMO_EMAIL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
