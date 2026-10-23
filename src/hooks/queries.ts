// React Query hooks for every backend resource. Keys start with the resource name and include the
// workspace so switching workspaces never shows stale data from another tenant.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type {
  Campaign,
  CampaignAnalytics,
  CampaignInput,
  CampaignTestResult,
  Connection,
  Execution,
  Lead,
  Media,
  Member,
  Overview,
  Page,
  RuleEvaluation,
  SimulateRequest,
  SimulateResponse,
  Template,
  TemplatePreview,
  TemplateVersion,
  TriState,
  WebhookEvent,
  Workspace,
} from "@/lib/types";

type Params = Record<string, string | number | boolean | null | undefined>;

function useWs() {
  return useSession().workspace?.id ?? "none";
}

// --- Overview ------------------------------------------------------------------
export function useOverview(days = 30) {
  const ws = useWs();
  return useQuery({
    queryKey: ["overview", ws, days],
    queryFn: () => api<Overview>("/analytics/overview", { query: { days } }),
    refetchInterval: 30_000,
  });
}

// --- Campaigns -----------------------------------------------------------------
export function useCampaigns(params: Params = {}) {
  const ws = useWs();
  return useQuery({
    queryKey: ["campaigns", ws, params],
    queryFn: () => api<Page<Campaign>>("/campaigns", { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useAllCampaigns() {
  return useCampaigns({ limit: 100, sort: "name" });
}

export function useCampaign(id: string | undefined) {
  const ws = useWs();
  return useQuery({
    queryKey: ["campaign", ws, id],
    queryFn: () => api<Campaign>(`/campaigns/${id}`),
    enabled: Boolean(id),
  });
}

export function useCampaignAnalytics(id: string | undefined) {
  const ws = useWs();
  return useQuery({
    queryKey: ["campaign-analytics", ws, id],
    queryFn: () => api<CampaignAnalytics>(`/campaigns/${id}/analytics`),
    enabled: Boolean(id),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useSaveCampaign() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<CampaignInput> }) =>
      id
        ? api<Campaign>(`/campaigns/${id}`, { method: "PATCH", body })
        : api<Campaign>("/campaigns", { method: "POST", body }),
    onSuccess: () => invalidate("campaigns", "campaign", "overview"),
  });
}

export function useCampaignTransition() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "activate" | "pause" | "resume" | "stop" }) =>
      api<Campaign>(`/campaigns/${id}/${action}`, { method: "POST" }),
    onSuccess: () => invalidate("campaigns", "campaign", "overview"),
  });
}

export function useDeleteCampaign() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate("campaigns", "overview"),
  });
}

export function useTestCampaign() {
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; comment_text: string; username: string; follower_status: TriState }) =>
      api<CampaignTestResult>(`/campaigns/${id}/test`, { method: "POST", body }),
  });
}

export function useEvaluateRules() {
  return useMutation({
    mutationFn: (body: unknown) => api<RuleEvaluation>("/workflows/evaluate", { method: "POST", body }),
  });
}

// --- Templates -----------------------------------------------------------------
export function useTemplates(params: Params = {}) {
  const ws = useWs();
  return useQuery({
    queryKey: ["templates", ws, params],
    queryFn: () => api<Page<Template>>("/templates", { query: { limit: 100, sort: "name", ...params } }),
  });
}

export function useTemplateVersions(id: string | undefined) {
  const ws = useWs();
  return useQuery({
    queryKey: ["template-versions", ws, id],
    queryFn: () => api<TemplateVersion[]>(`/templates/${id}/versions`),
    enabled: Boolean(id),
  });
}

export function useSaveTemplate() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) =>
      id
        ? api<Template>(`/templates/${id}`, { method: "PATCH", body })
        : api<Template>("/templates", { method: "POST", body }),
    onSuccess: () => invalidate("templates", "template-versions"),
  });
}

export function useDeleteTemplate() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate("templates"),
  });
}

export function usePreviewTemplate() {
  return useMutation({
    mutationFn: ({ id, variables }: { id: string; variables: Record<string, string> }) =>
      api<TemplatePreview>(`/templates/${id}/preview`, { method: "POST", body: { variables } }),
  });
}

// --- Executions & events -------------------------------------------------------------
export function useExecutions(params: Params) {
  const ws = useWs();
  return useQuery({
    queryKey: ["executions", ws, params],
    queryFn: () => api<Page<Execution>>("/executions", { query: params }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
}

export function useExecution(id: string | null) {
  const ws = useWs();
  return useQuery({
    queryKey: ["execution", ws, id],
    queryFn: () => api<Execution>(`/executions/${id}`),
    enabled: Boolean(id),
    // Poll while the worker is still working on it, so the drawer updates by itself.
    refetchInterval: (q) =>
      ["queued", "in_progress", "retry_scheduled"].includes(q.state.data?.status ?? "") ? 2000 : false,
  });
}

export function useRetryExecution() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<Execution>(`/executions/${id}/retry`, { method: "POST" }),
    onSuccess: () => invalidate("executions", "execution", "execution-stats", "overview"),
  });
}

export function useResolveExecution() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, delivered }: { id: string; delivered: boolean }) =>
      api<Execution>(`/executions/${id}/resolve`, { method: "POST", body: { delivered } }),
    onSuccess: () => invalidate("executions", "execution", "execution-stats", "overview"),
  });
}

export function useEvents(params: Params) {
  const ws = useWs();
  return useQuery({
    queryKey: ["events", ws, params],
    queryFn: () => api<Page<WebhookEvent>>("/events", { query: params }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
}

export function useSimulate() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: SimulateRequest) =>
      api<SimulateResponse>("/dev/simulate-comment", { method: "POST", body }),
    onSuccess: () => invalidate("executions", "execution-stats", "events", "overview", "leads", "campaign-analytics"),
  });
}

// --- Leads ---------------------------------------------------------------------------
export function useLeads(params: Params) {
  const ws = useWs();
  return useQuery({
    queryKey: ["leads", ws, params],
    queryFn: () => api<Page<Lead>>("/leads", { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateLead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { tags?: string[]; notes?: string | null } }) =>
      api<Lead>(`/leads/${id}`, { method: "PATCH", body }),
    onSuccess: () => invalidate("leads"),
  });
}

export function useDeleteLead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/leads/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate("leads"),
  });
}

// --- Instagram -----------------------------------------------------------------------
export function useConnections() {
  const ws = useWs();
  return useQuery({ queryKey: ["connections", ws], queryFn: () => api<Connection[]>("/instagram/accounts") });
}

export function useMedia(connectionId: string | undefined) {
  const ws = useWs();
  return useQuery({
    queryKey: ["media", ws, connectionId],
    queryFn: () => api<Media[]>(`/instagram/accounts/${connectionId}/media`),
    enabled: Boolean(connectionId),
  });
}

export function useSyncMedia() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (connectionId: string) =>
      api<Media[]>(`/instagram/accounts/${connectionId}/media`, { query: { sync: true } }),
    onSuccess: () => invalidate("media", "connections"),
  });
}

export function useDisconnect() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (connectionId: string) => api<void>(`/instagram/accounts/${connectionId}`, { method: "DELETE" }),
    onSuccess: () => invalidate("connections", "overview"),
  });
}

export function useStartConnect() {
  return useMutation({
    mutationFn: () => api<{ authorization_url: string; mode: string; expires_in: number }>("/instagram/connect"),
  });
}

// --- Workspace -----------------------------------------------------------------------
export function useMembers() {
  const ws = useWs();
  return useQuery({ queryKey: ["members", ws], queryFn: () => api<Member[]>("/workspaces/current/members") });
}

export function useWorkspaceMutations() {
  const invalidate = useInvalidate();
  const done = { onSuccess: () => invalidate("members", "workspaces") };
  return {
    rename: useMutation({
      mutationFn: (name: string) => api<Workspace>("/workspaces/current", { method: "PATCH", body: { name } }),
      ...done,
    }),
    create: useMutation({
      mutationFn: (name: string) => api<Workspace>("/workspaces", { method: "POST", body: { name } }),
      ...done,
    }),
    addMember: useMutation({
      mutationFn: (body: { email: string; role: string }) =>
        api<Member>("/workspaces/current/members", { method: "POST", body }),
      ...done,
    }),
    updateMember: useMutation({
      mutationFn: ({ id, role }: { id: string; role: string }) =>
        api<Member>(`/workspaces/current/members/${id}`, { method: "PATCH", body: { role } }),
      ...done,
    }),
    removeMember: useMutation({
      mutationFn: (id: string) => api<void>(`/workspaces/current/members/${id}`, { method: "DELETE" }),
      ...done,
    }),
  };
}

export function useReadiness() {
  return useQuery({
    queryKey: ["readiness"],
    queryFn: async () => {
      const res = await fetch("/ready");
      return (await res.json()) as import("@/lib/types").Readiness;
    },
    refetchInterval: 30_000,
    retry: false,
  });
}
