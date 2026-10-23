# Implementation Status

Last updated: 2026-10-22

## Completed

| Area | What's done |
|---|---|
| Configuration | Pydantic Settings; production refuses placeholder secrets, `DEBUG=true`, and mock mode. |
| Data model | All 10 specified entities, plus `RefreshToken`, `WorkspaceMember`, `OAuthState`, `MessageTemplateVersion` and `OutboxMessage`. UUID keys, foreign keys with explicit delete policies, unique constraints for idempotency, and query indexes. One Alembic migration (`0001`). |
| Auth | Register, login, refresh with rotation and reuse detection, logout (family or all sessions, plus access-token denylist), `me`, password change. Argon2id hashing and per-IP rate limits. |
| Authorization | Workspace membership and roles (owner, admin, member, viewer). Every repository query is tenant-scoped. `X-Workspace-ID` is always verified. |
| Campaigns | CRUD with pagination, filters, sort and date ranges. Lifecycle (activate, pause, resume, stop) with activation validation that covers live-mode connection and permission checks. Dry-run `test` endpoint that never sends. Analytics. |
| Rule engine | Standalone (`app/services/rule_engine.py`). Supports keyword, phrase, exact and contains matching; case sensitivity; NFKC and zero-width normalisation; exclusions; AND/OR groups; explanations; and a tri-state follower check with fallbacks. |
| Templates | Safe `{{var}}` rendering with syntax and variable validation, fallbacks, sanitised values, per-operation length limits, preview, and version history. |
| Automation | Ingest, process and execute pipeline with DB-enforced deduplication, `SKIP LOCKED` claiming, a transactional outbox, no transactions held during HTTP calls, error classification, bounded backoff with jitter, a per-account rate limit, timeouts, a stale-execution reaper, and safe manual retries. |
| Workers | Celery tasks for processing, execution, outbox relay, the reaper, token refresh, outbox purge and heartbeat. Uses `acks_late`, prefetch=1 and graceful engine disposal. |
| Instagram | Adapter interface. Mock adapter for simulation. Meta adapter (Instagram Login) for OAuth URL, code exchange, long-lived token, refresh, `/me`, media, `subscribed_apps`, comment replies and private replies, with `appsecret_proof`. Follower status is reported as unsupported. |
| Webhooks | Verification (`hub.*`) and `X-Hub-Signature-256` validation over the raw body. Events are persisted before acknowledgement, and duplicates are acknowledged without reprocessing. |
| Simulation | `POST /api/v1/dev/simulate-comment`, limited to dev/test or authorised test workspaces. Uses the same pipeline as live events, inline. `scripts/simulate_demo.py` walks through all eight scenarios. |
| Leads, executions, events | List with filters and date ranges, get, patch tags and notes, delete. Execution history and retry. Event history with status and redacted errors. |
| Observability | JSON logs with correlation IDs (`X-Request-ID`) and redaction, `/health`, `/ready` (DB, Redis, worker heartbeat), `/api/v1/health`, and a uniform error envelope. |
| Deployment | Multi-stage non-root Dockerfile. Compose stack with `migrate`, `api`, `worker`, `scheduler`, `postgres` and `redis`, each with health checks, volumes and restart policies, and with no public DB or Redis ports. Test compose file, Makefile and `.env.example`. |

## Verification results (local, 2026-10-22)

* **Tests:** `uv run pytest`: **142 passed**. These run against real PostgreSQL 16, migrated by
  Alembic, with fakeredis and mocked Meta HTTP. They cover:
  * rule engine, templates and security
  * the auth lifecycle and tenant isolation
  * the campaign lifecycle
  * webhook verification and signatures
  * deduplication, including concurrent deliveries and concurrent workers
  * worker retries and classification, token expiry and revocation
  * OAuth state, all simulation scenarios, the migration round-trip with `alembic check`, and the
    Celery task wiring
* **Lint:** `ruff check` and `ruff format --check`: clean.
* **Types:** `mypy --strict app scripts`: no issues.
* **Running server:** started uvicorn against PostgreSQL and ran `scripts/simulate_demo.py`. All 8
  scenarios passed.
* **Not verified here:** `docker compose up` itself. The Docker daemon wasn't accessible in the build
  environment. `docker compose config` validates both compose files.
* **Not verified at all:** the **live Meta integration**. The adapter follows Meta's published
  documentation (Business Login, comment moderation, private replies and webhooks, Graph API `v26.0`)
  but has not been run against a real Meta app. Do not treat live mode as working until the checklist
  below passes.

## Remaining work

* Run `docker compose up --build` on a machine with Docker and confirm all services are healthy.
* Verify live mode end to end (checklist below), then adjust the error-code mapping from real
  responses if needed.
* Optional: an Instagram API with Facebook Login adapter (Page tokens, `graph.facebook.com`).
* Optional: email verification and password reset (these need an email provider).
* Optional: an admin endpoint to flag `is_test_workspace` (today it's set in the database or through
  `SIMULATION_WORKSPACE_ALLOWLIST`).
* Optional: metrics export (Prometheus) and a dead-letter view for permanently failed events.

## Enabling live Instagram integration

1. Create a Meta **Business** app with the **Instagram** product, using API setup with Instagram
   Login.
2. Set these environment variables:
   * `INSTAGRAM_MODE=live`
   * `META_APP_ID` and `META_APP_SECRET` (the Instagram app values)
   * `META_REDIRECT_URI`, which must be registered exactly in Business login settings
   * `META_WEBHOOK_VERIFY_TOKEN`
3. Serve the API over public **HTTPS**. Configure the webhook callback
   `https://<host>/api/v1/webhooks/instagram` with the verify token, then subscribe to `comments`.
4. Connect an Instagram **professional** account that has a role on the app (development mode) by
   calling `GET /api/v1/instagram/connect` and completing the redirect.
5. Request these permissions:
   * `instagram_business_basic`
   * `instagram_business_manage_comments`
   * `instagram_business_manage_messages`

   To serve accounts outside the app's roles you also need **Advanced Access** through **App Review**
   and **Business Verification**.
6. **Verification checklist:**
   * The connect flow stores an active connection with the expected permissions.
   * `GET /instagram/accounts/{id}/media?sync=true` lists real media.
   * A real comment on the target media creates a `webhook_events` row with a valid signature.
   * A live campaign activates.
   * A public reply appears on the comment.
   * A private reply arrives within the 7-day window.
   * The token refresh task succeeds.
