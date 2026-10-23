# InstaFlow Frontend

The web app for [InstaFlow](../instaflow-backend), built from the Google Stitch designs in
`stitch_instaflow_automation_saas_platform` (Material Design 3, Inter, deep-indigo palette) and wired
to the backend API.

* **Stack:** React 18 + TypeScript, Vite 5, Tailwind CSS 3 (design tokens copied from the Stitch
  export), TanStack Query for server state, React Router 6, and [Motion](https://motion.dev) for
  animation.
* **Screens:**
  * The five Stitch designs are reproduced as designed: Dashboard, Campaigns, Campaign Editor
    (Trigger Rules), Simulator and Executions with the detail drawer.
  * Eight more screens follow the same design system: Sign in / Register, Instagram Accounts,
    Message Templates, Leads, Events Log, Workspace Settings, the ⌘K command palette and a 404 page.

## Quick start

```bash
# 1. Backend (see ../instaflow-backend/README.md); simplest local setup without Docker:
cd ../instaflow-backend
uv run python scripts/local_postgres.py --database instaflow   # terminal 1, prints DATABASE_URL
uv run python scripts/local_redis.py                           # terminal 2 (in-memory Redis)
export DATABASE_URL='<printed url>' REDIS_URL=redis://127.0.0.1:6379/0
uv run alembic upgrade head && make dev                        # terminal 3, API on :8000
uv run python scripts/seed_demo.py                             # optional demo data

# 2. Frontend
cd ../instaflow-frontend
npm install
npm run dev                                                    # http://localhost:5173
```

Sign in with the demo account the seed script prints, or create an account on the Register page.
The dev server proxies `/api`, `/health` and `/ready` to `VITE_API_PROXY_TARGET` (default
`http://localhost:8000`), so no CORS setup is needed.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload on :5173 |
| `npm run build` | Regenerates the icon subset, type-checks, and builds to `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run typecheck` | `tsc` in strict mode |
| `npm run lint` | ESLint (TypeScript + React hooks rules) |
| `npm run icons` | Rewrites the Material Symbols link in `index.html` with only the icons in use |

## Project structure

```text
src/
├── main.tsx              # providers: React Query, router, Motion, toasts, session
├── App.tsx               # routes (lazy-loaded pages) + animated page transitions
├── index.css             # Tailwind layers, icon font class, shared component classes
├── lib/
│   ├── api.ts            # fetch client: bearer auth, single shared token refresh, X-Workspace-ID
│   ├── session.tsx       # auth state, workspace switching, Live/Simulation view toggle
│   ├── types.ts          # TypeScript mirror of the backend schemas
│   └── format.ts         # number/date/relative-time helpers
├── hooks/queries.ts      # one React Query hook per backend endpoint (workspace-scoped keys)
├── components/
│   ├── ui.tsx            # Button, Card, Segmented, FilterChip, Field, Avatar, Skeleton…
│   ├── status.tsx        # status chips and mode badges (Stitch semantic colour tokens)
│   ├── overlays.tsx      # Modal, ConfirmDialog, Drawer, Menu, SelectMenu, toasts
│   ├── motion.tsx        # PageTransition, stagger variants, CountUp
│   ├── LineChart.tsx     # SVG area/line chart with draw-in animation and hover tooltip
│   ├── Pagination.tsx, Logo.tsx
├── layout/AppShell.tsx   # sidebar, top app bar, notifications, ⌘K command palette
└── pages/
    ├── Dashboard.tsx, Campaigns.tsx, CampaignEditor.tsx, Simulator.tsx, Executions.tsx
    ├── Accounts.tsx, Templates.tsx, Leads.tsx, Events.tsx, Settings.tsx, Auth.tsx, NotFound.tsx
    └── editor/           # campaign editor: model (API ⇄ UI rules), steps, rule builder, live sandbox
```

## How the UI maps to the backend

| Screen | Endpoints |
|---|---|
| Dashboard | `GET /analytics/overview`, `GET /executions`, `GET /instagram/accounts`, `GET /ready` |
| Campaigns | `GET /campaigns` (search, sort, filters, pagination), lifecycle `POST /campaigns/{id}/{action}`, delete, JSON import/export |
| Campaign Editor | `POST/PATCH /campaigns`, `POST /workflows/evaluate` (live sandbox), `POST /templates/{id}/preview`, `GET /campaigns/{id}/analytics` |
| Simulator | `POST /dev/simulate-comment` (including fault injection: duplicate, 429, timeout) |
| Executions | `GET /executions` (+ `search`), `GET /executions/stats`, `GET /executions/{id}`, `POST /executions/{id}/retry`, `POST /executions/{id}/resolve` |
| Accounts | `GET /instagram/connect` → OAuth → `GET /instagram/callback`, media sync, disconnect |
| Templates | CRUD, `GET /templates/{id}/versions`, preview |
| Leads / Events / Settings | `/leads`, `/events`, `/workspaces/current/*`, `/users/me/password`, `/auth/logout` |

## Behaviour notes

* **Authentication:**
  * The access token is kept only in memory. The refresh token is kept in `localStorage` so a
    reload keeps you signed in.
  * On a 401, one shared refresh call runs and the request is retried. If the refresh fails, you
    are sent back to sign-in.
  * Sign-out revokes the token server-side.
* **Workspaces:** the selected workspace is sent as `X-Workspace-ID`, and the server always checks
  membership. Switching workspaces drops cached data from the previous tenant.
* **Live / Simulation toggle** (top bar): chooses which activity the dashboard's Recent Executions
  shows, and the default mode for new campaigns. It never changes a campaign's mode.
* **Unknown outcomes:** Retry is disabled for executions whose delivery couldn't be confirmed. After
  checking Instagram, use **Mark Succeeded**, or mark the execution as not delivered, which makes a
  retry safe.
* **Live OAuth:** set the backend's `META_REDIRECT_URI` to this app's `/accounts` page, for example
  `https://app.example.com/accounts`. The page completes the code exchange through the API. In mock
  mode the flow loops back automatically.
* **Animation:** page transitions, staggered rows and cards, count-up numbers, the animated chart,
  layout-animated nav, tabs and segmented controls, and spring drawers, menus and dialogs. All of
  it respects the OS "reduce motion" setting.
* **Icons:** Material Symbols is loaded from Google Fonts with `icon_names` set to only the icons
  in use (about 24 KB instead of 3.4 MB). If you add an icon, `npm run build` (or `npm run icons`)
  updates the list.

## Docker

The backend's `docker-compose.yml` includes a `web` service that builds this folder (the
`Dockerfile` here is a multi-stage Node → nginx build) and serves it on `WEB_PORT` (default 8080).
nginx proxies `/api`, `/health` and `/ready` to the `api` service:

```bash
cd ../instaflow-backend && docker compose up -d --build   # then open http://localhost:8080
```
