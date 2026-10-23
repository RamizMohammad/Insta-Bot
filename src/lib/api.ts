// Thin fetch client: bearer auth, one shared token refresh, workspace header, typed errors.
import type { TokenPair } from "./types";

const API = "/api/v1";
const REFRESH_KEY = "instaflow.refresh";
const WORKSPACE_KEY = "instaflow.workspace";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionExpired: (() => void) | null = null;

const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage unavailable (private mode): session lasts for this tab only */
    }
  },
};

export const session = {
  setTokens(tokens: TokenPair) {
    accessToken = tokens.access_token;
    storage.set(REFRESH_KEY, tokens.refresh_token);
  },
  clear() {
    accessToken = null;
    storage.set(REFRESH_KEY, null);
  },
  hasRefreshToken: () => Boolean(storage.get(REFRESH_KEY)),
  refreshToken: () => storage.get(REFRESH_KEY),
  workspaceId: () => storage.get(WORKSPACE_KEY),
  setWorkspaceId: (id: string | null) => storage.set(WORKSPACE_KEY, id),
  onExpired(handler: () => void) {
    onSessionExpired = handler;
  },
};

async function parseError(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; details?: unknown } } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error */
  }
  return new ApiError(
    res.status,
    body.error?.code ?? "http_error",
    body.error?.message ?? `Request failed (${res.status})`,
    body.error?.details,
  );
}

export async function refreshSession(): Promise<boolean> {
  const token = storage.get(REFRESH_KEY);
  if (!token) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: token }),
      });
      if (!res.ok) {
        session.clear();
        return false;
      }
      session.setTokens(await res.json());
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Query;
  auth?: boolean;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, auth = true, signal } = opts;
  const qs = query
    ? new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";
  const url = `${API}${path}${qs ? `?${qs}` : ""}`;

  const send = () => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const ws = storage.get(WORKSPACE_KEY);
    if (auth && ws) headers["X-Workspace-ID"] = ws;
    return fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  };

  let res = await send();
  if (res.status === 401 && auth) {
    if (await refreshSession()) {
      res = await send();
    } else {
      onSessionExpired?.();
    }
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function readiness() {
  const res = await fetch("/ready");
  return res.json();
}
