# InstaFlow Backend

Backend for **InstaFlow**, an Instagram comment-automation SaaS. Users connect Instagram professional
accounts, create campaigns for posts or Reels, define keyword trigger rules, and InstaFlow replies
publicly or with a private reply when a comment matches.

* **Simulation mode** works out of the box with no Instagram credentials. Simulated comments run
  through the same rule engine, deduplication and execution pipeline as live webhooks; the actions are
  recorded as `simulated` and never reach Instagram.
* **Live mode** uses the official Instagram API with Instagram Login (`graph.instagram.com`). It is
  built from Meta's documentation but **has not been tested against a real Meta app yet**. See
  [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

No browser automation, password collection, cookie extraction or private APIs are used anywhere.

---

## Contents

1. [Architecture](#architecture)
2. [Project layout](#project-layout)
3. [Prerequisites](#prerequisites)
4. [Environment variables](#environment-variables)
5. [Local setup (without Docker)](#local-setup-without-docker)
6. [Docker startup](#docker-startup)
7. [Database migrations](#database-migrations)
8. [API documentation](#api-documentation)
9. [Authentication](#authentication)
10. [Creating a campaign](#creating-a-campaign)
11. [Simulation mode](#simulation-mode)
12. [Meta developer app configuration](#meta-developer-app-configuration)
13. [OAuth redirect configuration](#oauth-redirect-configuration)
14. [Webhook setup](#webhook-setup)
15. [Required permissions and access approvals](#required-permissions-and-access-approvals)
16. [Production deployment](#production-deployment)
17. [Security considerations](#security-considerations)
18. [Known platform limitations](#known-platform-limitations)
19. [Testing and quality checks](#testing-and-quality-checks)
20. [Troubleshooting](#troubleshooting)

---

## Architecture

```text
             Instagram (Meta)                       Clients (your frontend / scripts)
                   │ webhooks (signed)                         │ REST + JWT
                   ▼                                           ▼
        ┌────────────────────────────── FastAPI (app/api) ─────────────────────────────┐
        │ auth · workspaces · instagram · campaigns · templates · webhooks · executions │
        │ leads · events · dev/simulate-comment · health                                │
        └──────────────┬───────────────────────────────────────────────┬───────────────┘
                       │ services (business logic, framework-free core) │
     rule_engine ─ template_renderer ─ campaign_service ─ automation_service ─ instagram adapters
                       │                                               │
               PostgreSQL (SQLAlchemy async)                   Redis (broker, rate limits,
          events · executions · outbox · leads …              token denylist, heartbeat)
                       │                                               │
                       └──────────── outbox relay ──► Celery worker ◄──┘
                                                     process_event / execute_action
```

**Request → action flow**

1. **Receive.** `POST /api/v1/webhooks/instagram` checks `X-Hub-Signature-256` against the raw
   body. Simulated comments enter through `POST /api/v1/dev/simulate-comment` instead.
2. **Persist and deduplicate.** Each comment is stored once in `webhook_events`, because
   `dedupe_key` is unique and inserts use `ON CONFLICT DO NOTHING`. An `outbox_messages` row is
   written in the same transaction, then the webhook is acknowledged.
3. **Relay.** The outbox relay (Celery beat every 5 s, plus a nudge from the API) publishes due
   messages to the queue. Delivery is at least once, and every consumer is idempotent.
4. **Process the event.** The event row is claimed with `SELECT … FOR UPDATE SKIP LOCKED`, so two
   workers can't process it at once. The worker then:
   * resolves the connection, workspace and active campaigns for the media
   * evaluates the rules and the follower eligibility, applying the configured fallback when
     follower status is `unknown`
   * upserts the lead
   * inserts one `automation_executions` row per (event, campaign, action type), backed by a unique
     constraint
   * writes outbox rows for the queued actions
5. **Execute the action.** A short transaction locks the execution, re-checks the campaign status,
   renders the template, applies the per-account rate limit and marks the execution `in_progress`.
   The Instagram call then runs **with no transaction open** and with a timeout, and a second short
   transaction records the result.
6. **Classify the outcome.** Each send ends in one of these states:
   * `succeeded` or `simulated`
   * `retry_scheduled`: transient errors and rate limits, retried with bounded exponential backoff
     and jitter through the outbox
   * `failed`: permanent, validation, authorization or unsupported errors
   * `unknown`: timeouts and other ambiguous results. These are **never retried automatically**,
     because the message may already have been delivered.
7. **Recover.** If a worker crashes mid-send, the execution is left `in_progress`. A reaper task
   marks it `unknown` and never re-sends it.

Everything is exposed through the executions, events, leads and analytics APIs.

## Project layout

```text
instaflow-backend/
├── app/
│   ├── main.py                 # app factory, middleware, /health, /ready
│   ├── api/
│   │   ├── dependencies.py     # auth, workspace authorization, roles, rate limits
│   │   └── v1/                 # auth, users, workspaces, instagram, campaigns, templates, workflows,
│   │                           # webhooks, executions (+events), leads, dev (simulation), health
│   ├── core/                   # config, security, logging, exceptions, middleware, redis, rate_limit
│   ├── db/                     # declarative base + async session management
│   ├── models/                 # SQLAlchemy models + pure-Python enums
│   ├── schemas/                # Pydantic request/response models
│   ├── repositories/           # tenant-scoped data access (every query filtered by workspace)
│   ├── services/
│   │   ├── rule_engine.py      # standalone comment matching + eligibility (no framework deps)
│   │   ├── template_renderer.py# safe {{variable}} rendering (no expression evaluation)
│   │   ├── auth_service.py, campaign_service.py, template_service.py, lead_service.py
│   │   ├── automation_service.py  # ingest → process → execute workflow
│   │   ├── instagram_service.py   # OAuth connect, media sync, token refresh
│   │   ├── outbox.py              # transactional outbox relay
│   │   └── instagram/          # adapter interface + Meta (live) and mock (simulation) adapters
│   ├── workers/                # Celery app, tasks, API→relay nudge
│   └── utils/                  # backoff, time, text helpers
├── alembic/                    # migrations (async env, reads DATABASE_URL)
├── tests/                      # unit/ (pure logic) and integration/ (API + PostgreSQL)
├── scripts/                    # local_postgres.py (no-Docker DB), simulate_demo.py
├── docs/openapi.json           # exported OpenAPI schema
├── Dockerfile, docker-compose.yml, docker-compose.test.yml, Makefile
├── pyproject.toml, uv.lock, alembic.ini, .env.example
└── IMPLEMENTATION_STATUS.md
```

## Prerequisites

* Python **3.12+** and [uv](https://docs.astral.sh/uv/) (dependencies are pinned in `uv.lock`).
* PostgreSQL 16 and Redis 7. You can run them with Docker Compose, use your own installs, or use
  `scripts/local_postgres.py` for a throwaway PostgreSQL without Docker.
* Docker Engine with Compose v2 for the containerised stack.

## Environment variables

Everything is configured through environment variables, or a `.env` file, via Pydantic Settings
(`app/core/config.py`). Start from `.env.example`. List values use JSON, for example
`CORS_ORIGINS=["https://app.example.com"]`.

| Variable | Default | Purpose |
|---|---|---|
| `APP_ENV` | `development` | `development`, `test`, `staging` or `production`. Staging and production enforce strict validation. |
| `DEBUG` | `false` | Must be `false` in production. |
| `SECRET_KEY` | dev placeholder | Signs JWTs and derives the token-encryption key. Must be at least 32 random characters in production. |
| `TOKEN_ENCRYPTION_KEY` | derived | Optional explicit Fernet key for Instagram tokens. |
| `ACCESS_TOKEN_TTL_MINUTES` / `REFRESH_TOKEN_TTL_DAYS` | 15 / 14 | Token lifetimes. |
| `AUTH_RATE_LIMIT` / `AUTH_RATE_LIMIT_WINDOW_SECONDS` | 10 / 60 | Per-IP, per-route limit for auth endpoints. |
| `DATABASE_URL` | `postgresql+asyncpg://…` | Must use the async driver (`postgresql+asyncpg`). |
| `REDIS_URL` | `redis://localhost:6379/0` | Broker, rate limits, access-token denylist and worker heartbeat. |
| `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` | `REDIS_URL` | Optional overrides. |
| `INSTAGRAM_MODE` | `mock` | `mock` for simulation only, `live` for the Meta API. `mock` is rejected in production. |
| `META_APP_ID`, `META_APP_SECRET` | empty | Instagram app credentials (App Dashboard, Instagram > API setup with Instagram Login). |
| `META_REDIRECT_URI` | empty | Must exactly match a valid OAuth redirect URI in the app. |
| `META_WEBHOOK_VERIFY_TOKEN` | empty | Secret you choose. It is echoed back during webhook verification. |
| `META_GRAPH_API_VERSION` | `v26.0` | The only place the Graph API version is set. |
| `META_APP_SECRET_PROTECTION_ENABLED` | `true` | Adds `appsecret_proof` to Graph calls. |
| `ACTION_MAX_ATTEMPTS` | 5 | Automatic attempts per action (each manual retry adds a fresh budget). |
| `ACTION_RETRY_BASE_SECONDS` / `ACTION_RETRY_MAX_SECONDS` | 2 / 300 | Backoff base and cap. |
| `ACTION_TIMEOUT_SECONDS` | 15 | Timeout for an outgoing Instagram call. When it expires the outcome is `unknown`. |
| `ACCOUNT_RATE_LIMIT_PER_MINUTE` | 30 | Outgoing actions per connected account per minute. |
| `OUTBOX_RELAY_INTERVAL_SECONDS` | 5 | Beat interval for the outbox relay. |
| `SIMULATION_WORKSPACE_ALLOWLIST` | `[]` | Workspace UUIDs allowed to use simulation outside development or test. |

## Local setup (without Docker)

```bash
cd instaflow-backend
uv sync                                   # installs runtime + dev dependencies
cp .env.example .env                      # then edit; keep INSTAGRAM_MODE=mock

# Option A: your own PostgreSQL/Redis -> set DATABASE_URL and REDIS_URL in .env
# Option B: throwaway PostgreSQL with no Docker (prints a DATABASE_URL, keep it running)
uv run python scripts/local_postgres.py

export DATABASE_URL='postgresql+asyncpg://postgres@/instaflow?host=/home/<you>/.cache/instaflow/pgdata'
uv run alembic upgrade head
make dev                                  # API on http://localhost:8000 (docs at /docs)
make worker                               # in another terminal (needs Redis)
make beat                                 # in another terminal (outbox relay + maintenance)
```

Simulation requests through `/api/v1/dev/simulate-comment` run inline, so they work even without the
worker or Redis. Live webhooks need the worker and the beat scheduler. Without Redis, `/ready` returns
503 and the auth rate limits fall back to a per-process counter.

## Docker startup

```bash
cd instaflow-backend
cp .env.example .env            # set SECRET_KEY and POSTGRES_PASSWORD at minimum
docker compose up -d --build    # postgres, redis, migrate (one-shot), api, worker, scheduler
docker compose ps               # every service should become healthy
curl localhost:8000/ready
```

* `migrate` runs `alembic upgrade head` once. The API, worker and scheduler only start after it
  succeeds.
* PostgreSQL and Redis are **not published** to the host. Only the API port (`API_PORT`, default
  8000) is exposed.
* Data persists in the `postgres-data` and `redis-data` volumes. Every service has a health check
  and `restart: unless-stopped`.
* The worker gets 60 s for a warm shutdown. Tasks are acknowledged only after they finish
  (`acks_late`), so work interrupted by a crash is redelivered.

Common commands:

| Task | Command |
|---|---|
| Development (hot reload, local) | `make dev` (plus `make worker`, `make beat`) |
| Full stack | `make up` / `make down` / `make logs` |
| Tests in containers | `docker compose -f docker-compose.test.yml run --rm tests` |
| Tests locally | `make test` |
| Migrations | `make migrate`, or `docker compose run --rm migrate` |
| Production start | `make prod` (with a production `.env`) |

## Database migrations

```bash
uv run alembic upgrade head                           # apply
uv run alembic downgrade -1                           # roll back one
uv run alembic revision --autogenerate -m "add x"     # after changing models
uv run alembic check                                  # fails if models and migrations diverge
```

`alembic/env.py` reads `DATABASE_URL` from the application settings. The test suite upgrades a fresh
database, round-trips `downgrade base` → `upgrade head`, and runs `alembic check`.

## API documentation

Interactive docs are served at `/docs` (Swagger UI) and `/redoc` in non-production environments. The
schema is exported to [`docs/openapi.json`](docs/openapi.json). All endpoints are under `/api/v1`, and
workspace resources use the workspace given in the `X-Workspace-ID` header (membership is always
verified server-side). Without the header, your oldest workspace is used.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` |
| Users | `GET /users/me`, `POST /users/me/password` |
| Workspaces | `GET/POST /workspaces`, `GET/PATCH /workspaces/current`, `GET/POST /workspaces/current/members`, `PATCH/DELETE /workspaces/current/members/{id}` |
| Instagram | `GET /instagram/connect`, `GET /instagram/callback`, `GET /instagram/accounts`, `GET /instagram/accounts/{connection_id}/media?sync=true`, `DELETE /instagram/accounts/{connection_id}` |
| Campaigns | `POST/GET /campaigns`, `GET/PATCH/DELETE /campaigns/{id}`, `POST /campaigns/{id}/{activate,pause,resume,stop,test}`, `GET /campaigns/{id}/analytics` |
| Workflows | `POST /workflows/evaluate` (stateless rule-engine evaluation with explanations) |
| Templates | `POST/GET /templates`, `GET/PATCH/DELETE /templates/{id}`, `GET /templates/{id}/versions`, `POST /templates/{id}/preview` |
| Webhooks | `GET /webhooks/instagram` (verification), `POST /webhooks/instagram` (events) |
| Executions | `GET /executions`, `GET /executions/{id}`, `POST /executions/{id}/retry` |
| Events | `GET /events`, `GET /events/{id}` |
| Leads | `GET /leads`, `GET/PATCH/DELETE /leads/{id}` |
| Simulation | `POST /dev/simulate-comment` |
| Health | `GET /health` (liveness), `GET /ready` (readiness), `GET /api/v1/health` |

**Conventions**

* Lists return `{items, total, limit, offset}` and accept `limit` (1–100), `offset`, `sort`
  (`-created_at`, `name`, …), plus `created_from` and `created_to` date ranges where relevant.
* Errors always have the shape
  `{"error": {"code", "message", "details?", "correlation_id"}}`.
* Every response carries `X-Request-ID`. You can send your own for tracing.

**Roles:** `viewer` can read, `member` can create and change campaigns, templates and leads, and
`admin`/`owner` can also manage members and Instagram connections.

## Authentication

* `POST /auth/register` creates a user and a personal workspace, with you as owner.
* `POST /auth/login` returns `{access_token, refresh_token, expires_in}`. The access token is a
  15-minute HS256 JWT. The refresh token is an opaque random string stored only as a SHA-256 hash.
* `POST /auth/refresh` **rotates** the refresh token. Presenting an already-used token is treated as
  theft and revokes the whole token family.
* `POST /auth/logout` revokes the refresh-token family (or all sessions with `{"all_sessions": true}`)
  and denylists the current access token in Redis until it expires.
* Passwords are hashed with Argon2id. Login failures return the same message and similar timing
  whether or not the email exists. Registration conflicts return a generic message.
* Auth endpoints are rate limited per client IP and route (Redis fixed window).

```bash
curl -s localhost:8000/api/v1/auth/register -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"a-Strong-passw0rd"}'
TOKEN=$(curl -s localhost:8000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"a-Strong-passw0rd"}' | jq -r .access_token)
```

## Creating a campaign

1. **Create the template(s).** Templates use `{{variable}}` placeholders only. The built-in variables
   are `username`, `comment_text` and `campaign_name`. Anything else must be declared in
   `custom_variables` and given a value in the campaign config or a template fallback.

   ```bash
   curl -s localhost:8000/api/v1/templates -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
     "name": "Course DM", "type": "private_reply",
     "body": "Hey {{username}}! Here is your resource: {{resource_link}}",
     "custom_variables": ["resource_link"], "fallbacks": {"username": "there"} }'
   ```

2. **Create the campaign** with rules and actions:

   ```json
   {
     "name": "Course launch",
     "mode": "simulation",
     "media_external_id": "test-media-001",
     "config": {
       "actions": [{"type": "private_reply", "template_id": "<template-uuid>"}],
       "variables": {"resource_link": "https://example.com/course"},
       "group_logic": "or",
       "follower_requirement": "any",
       "unknown_follower_fallback": "skip",
       "ignore_replies": true,
       "max_actions_per_lead": 1
     },
     "rules": [
       {"keyword": "course", "match_type": "contains"},
       {"keyword": "refund", "match_type": "keyword", "action": "exclude"}
     ]
   }
   ```

   For live campaigns, set `connection_id` and either `media_id` (a synced `InstagramMedia` UUID) or
   `media_external_id`.

   * **Match types:**
     * `keyword`: a whole single word
     * `phrase`: a whole-word sequence
     * `exact`: the entire comment
     * `contains`: a substring
   * **Matching:** case-insensitive by default, Unicode-normalised (NFKC), with whitespace
     collapsed. Any matching exclude rule vetoes the comment.
   * **Groups:** within a group, rules combine with the group's `group_operator` (`and`/`or`).
     Groups then combine with `group_logic`.
   * **Follower status** is `true`, `false` or `unknown`. Webhooks never include it, so for live
     comments it is always `unknown`, and the configured fallback decides between `skip`,
     `manual_review` and `proceed`.

3. **Dry-run it:** `POST /campaigns/{id}/test` with `{"comment_text": "..."}`. It shows the rule
   explanations, the eligibility decision and the rendered messages, and **never sends**.
4. **Activate it:** `POST /campaigns/{id}/activate`. Activation checks that there are include rules,
   a target media, enabled actions, matching template types and resolvable variables. For live mode
   it also checks that the server is in live mode and that the connection is active, unexpired and
   has the required permissions.
5. Use **pause, resume and stop** as needed. Active campaigns must be paused before their rules,
   config or target can change. Stopped campaigns are final.

## Simulation mode

`POST /api/v1/dev/simulate-comment` (authenticated, member role):

```json
{
  "campaign_id": "REPLACE_WITH_CAMPAIGN_UUID",
  "comment_id": "test-comment-001",
  "media_id": "test-media-001",
  "username": "example_user",
  "comment_text": "COURSE please send me the link",
  "follower_status": "unknown"
}
```

The endpoint stores a real `webhook_events` row with source `simulation`, scoped per workspace for
deduplication. It then runs the same `process_event` → `execute_action` code inline and returns the
event result and executions. Actions go through the mock adapter and are recorded with
`is_simulated: true` and status `simulated`.

Access rules:

* Available when `APP_ENV` is `development` or `test`.
* Otherwise only for workspaces flagged `is_test_workspace` or listed in
  `SIMULATION_WORKSPACE_ALLOWLIST`. Everyone else gets a 404.
* A user can only simulate against campaigns in their own workspaces.

Run the walkthrough, which covers all eight required scenarios, against a running API:

```bash
uv run python scripts/simulate_demo.py --base-url http://localhost:8000
```

Its output, verified locally:

```text
[PASS] 1. matching comment triggers action - Hey example_user! Here is your resource: https://example.com/course
[PASS] 2. non-matching comment does nothing
[PASS] 3. excluded keyword prevents match - excluded by 'spam'
[PASS] 4. unknown follower status -> fallback
[PASS] 5. duplicate event is not re-executed
[PASS] 6. paused campaign does not execute
[PASS] 7. other workspaces cannot trigger it
[PASS] 8. nothing was sent to Instagram (no live executions)
```

In mock mode, `GET /instagram/connect` returns a URL that loops straight back to
`/instagram/callback` with a mock code. The whole connect flow, including state validation, token
encryption and media sync, therefore works without Meta.

## Meta developer app configuration

1. At <https://developers.facebook.com/apps>, create an app of type **Business** and add the
   **Instagram** product.
2. Under **Instagram > API setup with Instagram Login**, note the **Instagram app ID** and
   **Instagram app secret**. Put them in `META_APP_ID` and `META_APP_SECRET`.
3. The Instagram account you connect must be a **professional account** (Business or Creator).
4. Set `INSTAGRAM_MODE=live`, `META_REDIRECT_URI`, `META_WEBHOOK_VERIFY_TOKEN` and, if needed,
   `META_GRAPH_API_VERSION`.

## OAuth redirect configuration

* In the app's **Business login settings**, add the exact redirect URI, for example
  `https://api.example.com/api/v1/instagram/callback`, and set `META_REDIRECT_URI` to the same value.
  It must match character for character.
* Flow:
  1. `GET /api/v1/instagram/connect` (admin) returns an `authorization_url` for
     `https://www.instagram.com/oauth/authorize`, with a single-use `state` that expires after 10
     minutes and is bound to the user and workspace.
  2. Instagram redirects to the callback with `code` and `state`.
  3. The server validates and consumes the state, exchanges the code at
     `https://api.instagram.com/oauth/access_token`, then swaps it for a 60-day long-lived token with
     `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token`.
  4. It reads `/me`, stores the token encrypted (Fernet), and subscribes the account to the
     `comments` webhook field.
* The scheduler refreshes tokens close to expiry (`grant_type=ig_refresh_token`). If a refresh fails,
  the connection is marked `expired`.

## Webhook setup

1. Your API must be reachable over **HTTPS** with a valid certificate.
2. In the App Dashboard, open **Instagram > Webhooks** and set the callback URL to
   `https://api.example.com/api/v1/webhooks/instagram`. Use the same verify token as
   `META_WEBHOOK_VERIFY_TOKEN`.
3. Meta sends `GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`. The API checks the token
   in constant time and echoes the challenge.
4. Subscribe to the **`comments`** field. The connect flow also calls
   `POST /{ig-user-id}/subscribed_apps?subscribed_fields=comments` for each connected account.
5. Every `POST` must carry `X-Hub-Signature-256: sha256=<HMAC-SHA256(raw body, app secret)>`. Unsigned
   or mismatched requests get a 401. Events are persisted before the 200 response, and duplicate
   deliveries are acknowledged without being processed again.

## Required permissions and access approvals

| Capability | Permission (Instagram Login) |
|---|---|
| Read profile and media | `instagram_business_basic` |
| Read comments, reply publicly, send private replies | `instagram_business_manage_comments` |
| Messaging (requested for completeness of the DM flow) | `instagram_business_manage_messages` |

Development mode only works for accounts with a role on the app. Serving other accounts needs
**Advanced Access** through **App Review** and **Business Verification**. Live campaigns cannot be
activated unless the connection's granted permissions include `instagram_business_basic` and
`instagram_business_manage_comments`.

## Production deployment

1. Use a small VPS (1–2 vCPU, 2 GB RAM is enough to start) with Docker and Compose v2.
2. Create a production `.env` with:
   * `APP_ENV=production`, `DEBUG=false`
   * a random `SECRET_KEY`, generated with
     `python -c "import secrets;print(secrets.token_urlsafe(48))"`
   * a strong `POSTGRES_PASSWORD`
   * `INSTAGRAM_MODE=live` and all `META_*` values

   Startup **fails** if any of these are unsafe or missing.
3. Put a TLS reverse proxy (Caddy, nginx or Traefik) in front of `api:8000`. Uvicorn runs with
   `--proxy-headers`, so restrict `--forwarded-allow-ips` to your proxy if it isn't on the same
   host.
4. Run `make prod`. Migrations run automatically through the `migrate` service.
5. Back up PostgreSQL (`pg_dump` from the `postgres` container) and watch `/ready`, which reports
   database and Redis status and the worker heartbeat age.
6. Scale the workers with `docker compose up -d --scale worker=2`. Keep **one** `scheduler`.

## Security considerations

* **Tenant isolation:** every repository query is filtered by `workspace_id`. Membership is checked
  on every request, and a missing resource and a resource in another workspace both return the same
  404.
* **Secrets:** settings come from the environment. Instagram tokens are encrypted at rest. Refresh
  tokens and OAuth states are stored only as hashes.
* **Webhooks:** HMAC signatures are verified over the raw body, the verify token is compared in
  constant time, and the body size is capped.
* **Templates:** single-pass `{{name}}` substitution only. Expressions are never evaluated. Logic
  blocks and unknown variables are rejected, and variable values are stripped of control characters
  and template delimiters.
* **Logging:** structured JSON with correlation IDs. Keys and values that look like passwords,
  tokens, secrets, authorization headers or OAuth codes are redacted. Request logs contain paths
  only, never query strings.
* **Production hardening:** API docs are disabled in production, and security headers are set on
  every response (`nosniff`, `DENY`, `no-referrer`, `no-store`).
* **Data minimisation:** events store normalised comment fields, not raw signed payloads. Leads keep
  only platform-provided identifiers and the username.

## Known platform limitations

* **Follower status is not available.** Meta exposes no endpoint for checking whether an arbitrary
  commenter follows the account, and webhooks don't include it. It is always `unknown` for live
  events, and the campaign fallback decides what happens.
* **Private replies:**
  * one private reply per comment
  * only within **7 days** of the comment (InstaFlow skips older comments up front)
  * for Instagram Live comments, only during the broadcast
  * follow-up messages only after the user responds, within 24 hours
* Commenter fields such as the username may be missing. They are treated as unavailable, never
  guessed.
* **Rate limits and quotas** apply per app and per account. Rate-limit errors are deferred and
  retried, and a per-account limiter caps the outgoing rate.
* **Ambiguous sends** (a timeout or 5xx after the request was sent) are recorded as `unknown` and
  never retried automatically. Check Instagram before retrying by hand. The API refuses manual
  retries of `unknown` executions.
* **Instagram API with Facebook Login** (`graph.facebook.com`, Page tokens) is not implemented. Only
  Instagram Login is.

## Testing and quality checks

```bash
make test        # 142 tests: unit + integration against real PostgreSQL (migrated via Alembic)
make lint        # ruff check + ruff format --check
make typecheck   # mypy --strict on app/ and scripts/
make check       # all of the above
```

* **Database:** tests use an isolated, freshly recreated database (`instaflow_test`). Without
  `TEST_DATABASE_URL`, a local PostgreSQL is started automatically through `pgserver`.
* **Redis** is replaced by `fakeredis`.
* **Meta API calls** are mocked with `httpx.MockTransport` and a fake adapter. The tests never send
  real messages.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/ready` returns 503 with `redis.ok=false` | Redis is unreachable. Check `REDIS_URL` and that the `redis` service is healthy. |
| `worker_alive: false` in `/ready` | The worker or scheduler isn't running. Check `docker compose logs worker scheduler`. |
| Live webhooks are stored but nothing happens | Make sure the scheduler (beat) and worker are running. `GET /api/v1/events` shows each event's status and error. |
| `Invalid production configuration: …` at startup | Fix the listed settings. Production refuses mock mode and placeholder secrets. |
| `live_mode_unavailable` when activating | Set `INSTAGRAM_MODE=live` and all `META_*` variables. |
| Webhook verification fails (403) | `META_WEBHOOK_VERIFY_TOKEN` must equal the token in the App Dashboard. |
| Webhook POST returns 401 `invalid_signature` | `META_APP_SECRET` must be the **Instagram** app secret, and no proxy may modify the body. |
| OAuth callback returns `oauth_state_invalid` | The state is single-use and expires after 10 minutes. Start again from `/instagram/connect`. |
| Execution stuck in `retry_scheduled` | It runs at `next_attempt_at` through the outbox. Check that the scheduler is running. |
| Execution `unknown` | The outcome was ambiguous. Verify on Instagram, because it is never retried automatically. |
| `scripts/local_postgres.py` fails to start | Its data directory path must not contain spaces. Pass `--data-dir`. |
