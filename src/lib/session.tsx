// App-wide session: authenticated user, workspace selection and the Live/Simulation view toggle.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, refreshSession, session } from "./api";
import type { OperatingMode, TokenPair, User, Workspace } from "./types";

interface SessionValue {
  status: "loading" | "anonymous" | "authenticated";
  user: User | null;
  workspaces: Workspace[];
  workspace: Workspace | null;
  viewMode: OperatingMode;
  setViewMode: (mode: OperatingMode) => void;
  switchWorkspace: (id: string) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, workspaceName?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SessionValue["status"]>(
    session.hasRefreshToken() ? "loading" : "anonymous",
  );
  const [workspaceId, setWorkspaceId] = useState<string | null>(session.workspaceId());
  const [viewMode, setViewMode] = useState<OperatingMode>("simulation");

  useEffect(() => {
    session.onExpired(() => {
      session.clear();
      qc.clear();
      setStatus("anonymous");
    });
    if (status === "loading") {
      refreshSession().then((ok) => setStatus(ok ? "authenticated" : "anonymous"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const authed = status === "authenticated";
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<User>("/auth/me"), enabled: authed });
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api<Workspace[]>("/workspaces", { auth: true }),
    enabled: authed,
  });

  const workspace = useMemo(() => {
    const list = workspaces.data ?? [];
    return list.find((w) => w.id === workspaceId) ?? list[0] ?? null;
  }, [workspaces.data, workspaceId]);

  useEffect(() => {
    if (workspace && workspace.id !== session.workspaceId()) session.setWorkspaceId(workspace.id);
  }, [workspace]);

  const switchWorkspace = useCallback(
    (id: string) => {
      session.setWorkspaceId(id);
      setWorkspaceId(id);
      qc.removeQueries({ predicate: (q) => !["me", "workspaces"].includes(String(q.queryKey[0])) });
    },
    [qc],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await api<TokenPair>("/auth/login", { method: "POST", body: { email, password }, auth: false });
      session.setTokens(tokens);
      qc.clear();
      setStatus("authenticated");
    },
    [qc],
  );

  const register = useCallback(
    async (email: string, password: string, workspaceName?: string) => {
      await api("/auth/register", {
        method: "POST",
        body: { email, password, workspace_name: workspaceName || null },
        auth: false,
      });
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST", body: { refresh_token: session.refreshToken() } });
    } catch {
      /* already signed out server-side */
    }
    session.clear();
    session.setWorkspaceId(null);
    qc.clear();
    setStatus("anonymous");
  }, [qc]);

  const value: SessionValue = {
    status: authed && (me.isLoading || workspaces.isLoading) ? "loading" : status,
    user: me.data ?? null,
    workspaces: workspaces.data ?? [],
    workspace,
    viewMode,
    setViewMode,
    switchWorkspace,
    login,
    register,
    logout,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
