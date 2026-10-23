// Executions audit trail with the master table + detail drawer from the Stitch design.
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { CountUp, rowIn } from "@/components/motion";
import { ConfirmDialog, SelectMenu, useToast } from "@/components/overlays";
import { Pagination } from "@/components/Pagination";
import { ExecutionStatusChip, ModeTag, actionIcon, actionLabel } from "@/components/status";
import { Button, Card, EmptyState, Icon, Kbd, Skeleton } from "@/components/ui";
import { useAllCampaigns, useExecution, useExecutions, useResolveExecution, useRetryExecution, useTemplates } from "@/hooks/queries";
import { api } from "@/lib/api";
import { formatDate, formatNumber, formatTime, shortId, timeAgo } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { ActionType, Execution, ExecutionStatus } from "@/lib/types";

const RANGES = [
  { value: "1", label: "Past 24 hours" },
  { value: "7", label: "Past 7 days" },
  { value: "30", label: "Past 30 days" },
  { value: "all", label: "All time" },
];

const STATUS_CHIPS: { value: ExecutionStatus; label: string; cls: string; dot: string }[] = [
  { value: "succeeded", label: "Succeeded", cls: "bg-emerald-50 text-emerald-800 hover:bg-emerald-100", dot: "bg-emerald-600" },
  { value: "simulated", label: "Simulated", cls: "bg-secondary-fixed text-on-secondary-fixed hover:bg-secondary-fixed-dim", dot: "bg-primary-container" },
  { value: "manual_review", label: "Manual Review", cls: "bg-amber-50 text-amber-900 hover:bg-amber-100", dot: "bg-amber-600" },
  { value: "retry_scheduled", label: "Retrying", cls: "bg-amber-50 text-amber-900 hover:bg-amber-100", dot: "bg-amber-500" },
  { value: "failed", label: "Failed", cls: "bg-error-container text-on-error-container hover:bg-error-container/80", dot: "bg-error" },
  { value: "unknown", label: "Unknown", cls: "bg-tertiary-fixed text-on-tertiary-fixed hover:bg-tertiary-fixed-dim ring-1 ring-tertiary/20", dot: "bg-tertiary" },
];

const compact = (n: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function diagnostic(e: Execution): { icon: string; label: string; cls: string } | null {
  if (e.status === "unknown") return { icon: "sync_problem", label: "Outcome unknown", cls: "text-tertiary" };
  if (e.status === "failed") {
    const map: Record<string, string> = {
      authorization: "Authorization",
      rate_limited: "Rate limited",
      permanent: "Rejected by Instagram",
      transient: "Network error",
      validation: "Message invalid",
      unsupported: "Not supported",
    };
    return { icon: e.error_category === "authorization" ? "lock" : "error", label: map[e.error_category ?? ""] ?? "Failed", cls: "text-error" };
  }
  if (e.status === "manual_review" || e.status === "skipped") return { icon: "help", label: e.error_detail ?? e.evaluation.eligibility?.reason ?? "Needs review", cls: "text-on-surface-variant" };
  if (e.status === "retry_scheduled") return { icon: "schedule", label: e.error_detail ?? "Retry scheduled", cls: "text-amber-700" };
  return null;
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-space-xs rounded-xl bg-surface-container-low p-space-md">
      <div className="flex items-center justify-between">
        <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-outline">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function ExecutionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: e, isLoading } = useExecution(id);
  const retry = useRetryExecution();
  const resolve = useResolveExecution();
  const toast = useToast();
  const [confirm, setConfirm] = useState<"delivered" | "not_delivered" | null>(null);
  const templates = useTemplates();
  const template = templates.data?.items.find((t) => t.id === e?.template_id);

  if (isLoading || !e) {
    return (
      <div className="flex flex-col gap-space-md p-space-md">
        <Skeleton className="h-16" />
        <Skeleton className="h-32" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const rule = e.matched_rules[0];
  const eligibility = e.evaluation.eligibility;
  const canRetry = e.status === "failed" || e.status === "manual_review";
  const banner =
    e.status === "unknown"
      ? { title: "Delivery could not be confirmed", body: e.error_detail ?? "Instagram did not confirm the send. The message may or may not have been delivered.", cls: "bg-tertiary-fixed/30 text-on-tertiary-fixed-variant", icon: "report_problem", iconCls: "text-tertiary" }
      : e.status === "failed"
        ? { title: "Action failed", body: e.error_detail ?? "Instagram rejected the request.", cls: "bg-error-container/60 text-on-error-container", icon: "error", iconCls: "text-error" }
        : e.status === "manual_review"
          ? { title: "Waiting for manual review", body: eligibility?.reason ?? "A condition couldn't be evaluated automatically.", cls: "bg-amber-50 text-amber-900", icon: "visibility", iconCls: "text-amber-700" }
          : e.status === "retry_scheduled"
            ? { title: "Retry scheduled", body: `${e.error_detail ?? "Temporary error."} Next attempt ${e.next_attempt_at ? `at ${formatTime(e.next_attempt_at)}` : "soon"}.`, cls: "bg-amber-50 text-amber-900", icon: "schedule", iconCls: "text-amber-700" }
            : null;

  const timeline = [
    { at: e.created_at, label: "Execution created", detail: "Queued after the comment matched", tone: "bg-primary" },
    ...(e.started_at ? [{ at: e.started_at, label: `Attempt ${e.attempt_count} started`, detail: e.is_simulated ? "Mock adapter (simulation)" : "Instagram Graph API", tone: "bg-primary-container" }] : []),
    ...(e.completed_at
      ? [
          {
            at: e.completed_at,
            label: `${actionLabel(e.action_type)} ${e.status.replace("_", " ")}`,
            detail: e.external_response_id ? `External ID: ${e.external_response_id}` : (e.error_detail ?? ""),
            tone: e.status === "succeeded" || e.status === "simulated" ? "bg-emerald-500" : e.status === "unknown" ? "bg-tertiary" : "bg-error",
          },
        ]
      : []),
    ...(e.evaluation.resolution
      ? [{ at: e.evaluation.resolution.at, label: e.evaluation.resolution.delivered ? "Confirmed delivered" : "Confirmed not delivered", detail: "Resolved by a team member", tone: "bg-secondary" }]
      : []),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-space-xs bg-surface-container-low p-space-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <Icon name="developer_board" className="text-[22px] text-primary" />
            <h2 className="font-title-md text-title-md font-bold tracking-tight text-on-surface">Execution #EXEC-{shortId(e.id)}</h2>
          </div>
          <button type="button" aria-label="Close drawer" onClick={onClose} className="rounded-lg p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface">
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>
        <div className="flex items-center justify-between pt-0.5 font-label-sm text-label-sm text-on-surface-variant">
          <span className="flex items-center gap-1 font-mono">
            <Icon name="access_time" className="text-[14px]" />
            {formatDate(e.created_at)} • {formatTime(e.created_at)}
          </span>
          <span className="font-medium">{e.is_simulated ? "Triggered by Simulator" : "Triggered by Webhook"}</span>
        </div>
        <div className="mt-1 flex items-center gap-space-xs">
          <ExecutionStatusChip status={e.status} />
          <span className="rounded-full bg-secondary-container px-2.5 py-1 font-label-sm text-label-sm font-semibold text-on-secondary-container">
            {e.is_simulated ? "Simulated Execution" : "Live Execution"}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-space-md overflow-y-auto p-space-md">
        {banner && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={clsx("flex items-start gap-space-sm rounded-xl p-space-md", banner.cls)}>
            <Icon name={banner.icon} className={clsx("mt-0.5 shrink-0 text-[22px]", banner.iconCls)} />
            <div className="flex flex-col gap-0.5">
              <span className="font-title-sm text-title-sm font-bold">{banner.title}</span>
              <p className="font-body-sm text-body-sm leading-relaxed">{banner.body}</p>
            </div>
          </motion.div>
        )}

        <Section title="Matched Rules" aside={rule && <span className="rounded bg-surface-container-highest px-1.5 py-px font-mono font-label-sm text-label-sm text-on-surface">{e.matched_rules.length} rule{e.matched_rules.length === 1 ? "" : "s"}</span>}>
          {rule ? (
            <div className="mt-1 space-y-1.5">
              <div className="flex items-start gap-2 text-on-surface">
                <Icon name="filter_center_focus" className="shrink-0 text-[18px] text-primary" />
                <span className="font-body-sm text-body-sm">
                  {rule.reason.replace(/^comment /, "Comment ")} for keyword <span className="rounded bg-surface-container px-1.5 py-0.5 font-mono font-semibold text-primary">{rule.keyword}</span>
                </span>
              </div>
              {e.comment_text && <div className="rounded-lg bg-surface-container-lowest p-2.5 font-body-sm text-body-sm italic text-on-surface-variant">"{e.comment_text}"</div>}
              <div className="flex items-center justify-between pt-1 font-label-sm text-label-sm text-on-surface-variant">
                <span>
                  Match Type: <strong className="font-semibold capitalize text-on-surface">{rule.match_type} (Group {rule.group.replace("g", "")})</strong>
                </span>
                <span className="font-mono text-outline">Post ID: {e.media_id ?? "—"}</span>
              </div>
            </div>
          ) : (
            <span className="font-body-sm text-body-sm text-on-surface-variant">No rule details recorded.</span>
          )}
        </Section>

        <Section title="Eligibility Decision">
          <div className="mt-1 grid grid-cols-2 gap-2">
            <div className="flex flex-col rounded-lg bg-surface-container-lowest p-2">
              <span className="font-label-sm text-label-sm text-on-surface-variant">Follower Status</span>
              <span className="flex items-center gap-1 font-title-sm text-title-sm font-semibold capitalize text-on-surface">
                <span className={clsx("h-2 w-2 rounded-full", eligibility?.observed === "true" ? "bg-emerald-500" : eligibility?.observed === "false" ? "bg-error" : "bg-amber-500")} />
                {eligibility?.observed === "true" ? "Follower" : eligibility?.observed === "false" ? "Not following" : "Unknown"}
              </span>
            </div>
            <div className="flex flex-col rounded-lg bg-surface-container-lowest p-2">
              <span className="font-label-sm text-label-sm text-on-surface-variant">Attempts</span>
              <span className="font-title-sm text-title-sm font-semibold text-on-surface">
                {e.attempt_count}
                {e.evaluation.manual_retries ? ` · ${e.evaluation.manual_retries} manual retr${e.evaluation.manual_retries === 1 ? "y" : "ies"}` : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-1 font-label-sm text-label-sm text-on-surface-variant">
            <span>
              Policy: <strong className="font-semibold capitalize text-on-surface">{eligibility ? `${eligibility.condition.replace(/_/g, " ")} → ${eligibility.decision.replace("_", " ")}` : "—"}</strong>
            </span>
            <span className="flex items-center gap-0.5 font-semibold text-emerald-700">
              <Icon name="shield" className="text-[14px]" /> Safe Mode
            </span>
          </div>
        </Section>

        <Section title="Rendered Message Payload" aside={<span className="font-label-sm text-label-sm font-medium text-primary">{template ? `${template.name} v${template.version}` : actionLabel(e.action_type)}</span>}>
          <div className="mt-1 flex flex-col gap-2 rounded-lg bg-surface-container-lowest p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary-container text-xs font-bold text-on-secondary-container">IG</span>
              <span className="font-label-sm text-label-sm font-semibold text-on-surface">
                {e.action_type === "private_reply" ? "Direct Message to" : "Public reply to"} {e.lead_username ? `@${e.lead_username}` : "commenter"}
              </span>
            </div>
            <p className="rounded-lg bg-surface-container-low p-2.5 font-body-sm text-body-sm leading-relaxed text-on-surface">
              {e.rendered_message ?? <span className="italic text-outline">Not rendered yet (the action hasn't run).</span>}
            </p>
          </div>
        </Section>

        <Section title="Attempt Timeline">
          <div className="relative mt-2 space-y-4 pl-6">
            {timeline.map((t, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="relative flex flex-col">
                <div className={clsx("absolute -left-6 top-1 h-3 w-3 rounded-full ring-4 ring-surface-container", t.tone)} />
                <div className="flex items-center justify-between">
                  <span className="font-label-md text-label-md font-bold capitalize text-on-surface">{t.label}</span>
                  <span className="font-mono font-label-sm text-label-sm text-outline">{formatTime(t.at)}</span>
                </div>
                {t.detail && <p className="mt-0.5 break-all font-body-sm text-body-sm text-on-surface-variant">{t.detail}</p>}
              </motion.div>
            ))}
          </div>
        </Section>
      </div>

      <div className="mt-auto flex flex-col gap-space-sm bg-surface-container-low p-space-md">
        {e.status === "unknown" && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-100 p-space-sm font-body-sm text-body-sm leading-snug text-amber-950">
            <Icon name="warning" className="mt-0.5 shrink-0 text-[18px] text-amber-700" />
            <span>This message may already have been delivered. Check Instagram first, then record what you found. Retrying blindly could send a duplicate DM.</span>
          </div>
        )}
        <div className="flex items-center gap-space-sm">
          <Button
            variant={canRetry ? "primary" : "tonal"}
            icon="replay"
            className={clsx("h-10 flex-1", !canRetry && "bg-surface-container-highest text-outline")}
            disabled={!canRetry}
            loading={retry.isPending}
            title={canRetry ? undefined : e.status === "unknown" ? "Retry is blocked until the outcome is confirmed" : "Only failed or review items can be retried"}
            onClick={() => retry.mutate(e.id, { onSuccess: () => toast(e.status === "manual_review" ? "Approved and queued" : "Retry queued"), onError: (err) => toast(err.message, "error") })}
          >
            {e.status === "manual_review" ? "Approve & Send" : "Retry Action"}
          </Button>
          {e.status === "unknown" && (
            <Button variant="tonal" icon="done_all" className="h-10 bg-surface-container-highest" onClick={() => setConfirm("delivered")}>
              Mark Succeeded
            </Button>
          )}
        </div>
        {e.status === "unknown" ? (
          <button type="button" onClick={() => setConfirm("not_delivered")} className="w-full py-1 text-center font-label-sm text-label-sm text-on-surface-variant transition-colors hover:text-error">
            It wasn't delivered: mark as failed so it can be retried safely
          </button>
        ) : (
          <button type="button" onClick={onClose} className="w-full py-1 text-center font-label-sm text-label-sm text-on-surface-variant transition-colors hover:text-on-surface">
            Close details
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "delivered" ? "Mark as delivered?" : "Mark as not delivered?"}
        confirmLabel={confirm === "delivered" ? "Yes, it was delivered" : "Yes, not delivered"}
        loading={resolve.isPending}
        body={
          confirm === "delivered"
            ? "Only confirm this after you've seen the reply on Instagram. The execution will be recorded as succeeded."
            : "Only confirm this after checking Instagram. The execution becomes failed, and you can then retry it without risking a duplicate."
        }
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          resolve.mutate(
            { id: e.id, delivered: confirm === "delivered" },
            { onSuccess: () => (toast("Outcome recorded"), setConfirm(null)), onError: (err) => (toast(err.message, "error"), setConfirm(null)) },
          )
        }
      />
    </div>
  );
}

export default function Executions() {
  const [params, setParams] = useSearchParams();
  const { viewMode } = useSession();
  const campaigns = useAllCampaigns();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [range, setRange] = useState("7");
  const [type, setType] = useState<ActionType | "all">("all");
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [spin, setSpin] = useState(false);

  const campaign = params.get("campaign") || "all";
  const status = (params.get("status") || "all") as ExecutionStatus | "all";
  const mode = params.get("mode") || "all";
  const openId = params.get("open");
  const setParam = (key: string, value: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (!value || value === "all") next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setOffset(0), [debounced, range, type, campaign, status, mode, limit]);

  const createdFrom = useMemo(() => (range === "all" ? undefined : new Date(Date.now() - Number(range) * 86400000).toISOString()), [range]);
  const simulated = mode === "all" ? undefined : mode === "simulation";
  const base = { campaign_id: campaign === "all" ? undefined : campaign, simulated, created_from: createdFrom };
  const list = useExecutions({ ...base, limit, offset, status: status === "all" ? undefined : status, action_type: type === "all" ? undefined : type, search: debounced || undefined });
  const stats = useQuery({
    queryKey: ["execution-stats", base],
    queryFn: () => api<Record<string, number>>("/executions/stats", { query: base }),
    refetchInterval: 15_000,
  });
  const s = stats.data ?? {};
  const liveAttempted = (s.succeeded ?? 0) + (s.failed ?? 0) + (s.unknown ?? 0);

  const cards = [
    { label: "Total", icon: "terminal", iconCls: "", value: s.total ?? 0, aside: <span className="font-label-sm text-label-sm text-secondary">{range === "all" ? "all-time" : RANGES.find((r) => r.value === range)?.label.toLowerCase()}</span> },
    {
      label: "Succeeded",
      icon: "check_circle",
      iconCls: "text-emerald-600",
      value: s.succeeded ?? 0,
      aside: liveAttempted ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-label-sm text-label-sm font-semibold text-emerald-800">{(((s.succeeded ?? 0) / liveAttempted) * 100).toFixed(1)}%</span> : null,
    },
    { label: "Simulated", icon: "science", iconCls: "text-secondary", value: s.simulated ?? 0, aside: <span className="font-label-sm text-label-sm text-on-surface-variant">sandboxed</span> },
    {
      label: "Review Required",
      icon: "warning",
      iconCls: "text-amber-600",
      value: (s.manual_review ?? 0) + (s.unknown ?? 0),
      aside: (s.manual_review ?? 0) + (s.unknown ?? 0) > 0 ? <span className="rounded bg-amber-100 px-1.5 py-0.5 font-label-sm text-label-sm font-semibold text-amber-900">Action</span> : null,
    },
    { label: "Failed", icon: "error", iconCls: "text-error", value: s.failed ?? 0, valueCls: "text-error", aside: s.total ? <span className="font-label-sm text-label-sm font-medium text-error">{(((s.failed ?? 0) / s.total) * 100).toFixed(2)}%</span> : null },
  ];

  const filtersActive = campaign !== "all" || status !== "all" || mode !== "all" || type !== "all" || debounced || range !== "7";
  const rows = list.data?.items ?? [];

  return (
    <div className="flex w-full flex-col">
      <section className="mb-space-lg flex flex-col gap-space-lg">
        <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-end">
          <div className="space-y-1">
            <div className="flex items-center gap-space-xs font-label-md text-label-md text-on-surface-variant">
              <span>Automation Hub</span>
              <Icon name="chevron_right" className="text-[14px]" />
              <span className="font-medium text-primary">Audit Trail</span>
            </div>
            <h1 className="font-headline-lg text-headline-lg font-bold tracking-tight text-on-surface">Executions</h1>
            <p className="max-w-2xl font-body-md text-body-md text-on-surface-variant">Real-time delivery log and audit trail of all automated replies and direct messages</p>
          </div>
          <div className="flex items-center gap-space-sm self-start rounded-xl bg-surface-container-low px-space-md py-space-xs shadow-sm md:self-auto">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
            </span>
            <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wide text-on-surface">Streaming Live</span>
            <span className="font-label-sm text-label-sm text-outline-variant">•</span>
            <button
              type="button"
              onClick={() => {
                setSpin(true);
                Promise.all([list.refetch(), stats.refetch()]).finally(() => setTimeout(() => setSpin(false), 400));
              }}
              className="flex items-center gap-1 font-label-sm text-label-sm font-medium text-primary transition-colors hover:text-primary-container"
            >
              <Icon name="sync" className={clsx("text-[16px]", spin && "animate-spin")} />
              <span>Sync</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-space-sm md:grid-cols-5">
          {cards.map((c, i) => (
            <motion.div key={c.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="flex flex-col justify-between rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
              <div className="flex items-center justify-between text-on-surface-variant">
                <span className="font-label-md text-label-md font-medium">{c.label}</span>
                <Icon name={c.icon} className={clsx("text-[18px]", c.iconCls)} />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className={clsx("font-headline-md text-headline-md font-bold tracking-tight", c.valueCls ?? "text-on-surface")}>
                  <CountUp value={c.value} />
                </span>
                {c.aside}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <Card className="mb-space-md flex flex-col gap-space-md p-space-md">
        <div className="flex flex-col items-stretch justify-between gap-space-md lg:flex-row lg:items-center">
          <div className="relative max-w-xl flex-1">
            <Icon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[20px] text-outline" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSearch("")}
              aria-label="Filter by username"
              className="w-full rounded-lg bg-surface-container-low py-2.5 pl-11 pr-16 font-body-md text-body-md text-on-surface transition-all placeholder:text-outline focus:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Filter by commenter username..."
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <Kbd>Esc</Kbd>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-space-xs">
            <SelectMenu
              label="Campaign"
              value={campaign}
              onChange={(v) => setParam("campaign", v)}
              options={[{ value: "all", label: "All Campaigns" }, ...(campaigns.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))]}
            />
            <SelectMenu
              label="Mode"
              value={mode}
              onChange={(v) => setParam("mode", v)}
              options={[
                { value: "all", label: "Live & Simulation" },
                { value: "live", label: "Live only" },
                { value: "simulation", label: "Simulation only" },
              ]}
            />
            <SelectMenu icon="calendar_today" value={range} onChange={setRange} options={RANGES} />
            <button
              type="button"
              title="Clear filters"
              aria-label="Clear filters"
              disabled={!filtersActive}
              onClick={() => {
                setParams({}, { replace: true });
                setSearch("");
                setRange("7");
                setType("all");
              }}
              className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
            >
              <Icon name="filter_alt_off" className="text-[20px]" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-space-xs pt-space-xs">
          <span className="mr-1 font-label-sm text-label-sm font-semibold uppercase tracking-wider text-outline">Status:</span>
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={() => setParam("status", null)}
            className={clsx(
              "flex items-center gap-1.5 rounded-full px-space-md py-1 font-label-sm text-label-sm font-semibold",
              status === "all" ? "bg-secondary-container text-on-secondary-container shadow-sm" : "bg-surface-container-low text-on-surface-variant",
            )}
          >
            <span>All</span>
            <span className="rounded-full bg-surface-container-lowest px-1.5 text-[10px] font-bold">{compact(s.total ?? 0)}</span>
          </motion.button>
          {STATUS_CHIPS.map((c) => (
            <motion.button
              key={c.value}
              whileTap={{ scale: 0.96 }}
              type="button"
              onClick={() => setParam("status", status === c.value ? null : c.value)}
              className={clsx("flex items-center gap-1.5 rounded-full px-space-md py-1 font-label-sm text-label-sm font-semibold transition-all", c.cls, status === c.value ? "shadow-md ring-2 ring-primary-container" : status !== "all" && "opacity-60")}
            >
              <span className={clsx("h-2 w-2 rounded-full", c.dot)} />
              <span>{c.label}</span>
              <span className="text-[10px] opacity-75">{compact(s[c.value] ?? 0)}</span>
            </motion.button>
          ))}
          <div className="mx-2 hidden h-4 w-px bg-surface-container-highest sm:block" />
          <span className="mr-1 font-label-sm text-label-sm font-semibold uppercase tracking-wider text-outline">Type:</span>
          {(["all", "public_reply", "private_reply"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={clsx("rounded-lg px-2.5 py-1 font-label-sm text-label-sm", type === t ? "bg-surface-container font-medium text-on-surface" : "text-on-surface-variant hover:bg-surface-container-high")}
            >
              {t === "all" ? "All Types" : actionLabel(t)}
            </button>
          ))}
        </div>
      </Card>

      <div className="relative flex w-full flex-col items-start gap-space-md xl:flex-row">
        <motion.div layout transition={{ type: "spring", stiffness: 300, damping: 34 }} className="flex w-full flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm xl:flex-1">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="select-none bg-surface-container-low font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <th className="px-space-md py-3 font-semibold">Timestamp / Lead</th>
                  <th className="px-space-md py-3 font-semibold">Campaign</th>
                  <th className="px-space-md py-3 font-semibold">Action &amp; Mode</th>
                  <th className="px-space-md py-3 font-semibold">Status</th>
                  <th className="px-space-md py-3 text-center font-semibold">Tries</th>
                  {!openId && <th className="px-space-md py-3 font-semibold">Failure Diagnostic</th>}
                  <th className="px-space-sm py-3 text-right font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container font-body-md text-body-md">
                {list.isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={7} className="px-space-md py-3">
                        <Skeleton className="h-10" />
                      </td>
                    </tr>
                  ))}
                {rows.map((e, i) => {
                  const selected = e.id === openId;
                  const diag = diagnostic(e);
                  return (
                    <motion.tr
                      key={e.id}
                      custom={i}
                      variants={rowIn}
                      initial="hidden"
                      animate="show"
                      onClick={() => setParam("open", selected ? null : e.id)}
                      className={clsx("relative cursor-pointer transition-colors", selected ? "bg-primary-fixed/20 hover:bg-primary-fixed/30" : "hover:bg-surface-container-low")}
                    >
                      <td className="px-space-md py-3.5">
                        <div className="flex items-center gap-space-sm">
                          {selected && <motion.div layoutId="exec-selected" className="-ml-2 mr-1 h-10 w-2 shrink-0 rounded-full bg-primary" />}
                          <div className="flex flex-col">
                            <span className="font-title-sm text-title-sm font-semibold text-on-surface">{e.lead_username ? `@${e.lead_username}` : "Unknown user"}</span>
                            <span className="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant">
                              <Icon name="schedule" className="text-[13px]" />
                              {formatTime(e.created_at)} ({timeAgo(e.created_at)})
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-space-md py-3.5">
                        <div className="flex flex-col">
                          <span className="max-w-[190px] truncate font-medium text-on-surface">{e.campaign_name ?? "Deleted campaign"}</span>
                          <span className="max-w-[190px] truncate font-label-sm text-label-sm text-on-surface-variant">{e.matched_rules[0] ? `Keyword "${e.matched_rules[0].keyword}"` : "Rule match"}</span>
                        </div>
                      </td>
                      <td className="px-space-md py-3.5">
                        <div className="flex flex-col items-start gap-1">
                          <span className="inline-flex items-center gap-1 font-label-sm text-label-sm text-on-surface">
                            <Icon name={actionIcon(e.action_type)} className={clsx("text-[15px]", e.action_type === "private_reply" ? "text-primary" : "text-secondary")} />
                            {actionLabel(e.action_type)}
                          </span>
                          <ModeTag simulated={e.is_simulated} />
                        </div>
                      </td>
                      <td className="px-space-md py-3.5">
                        <ExecutionStatusChip status={e.status} />
                      </td>
                      <td className="px-space-md py-3.5 text-center">
                        <span
                          className={clsx(
                            "rounded px-2 py-0.5 font-label-sm text-label-sm font-semibold",
                            e.status === "failed" ? "bg-error-container text-error" : e.status === "manual_review" ? "bg-amber-100 text-amber-900" : "bg-surface-container text-on-surface-variant",
                          )}
                        >
                          {e.attempt_count}
                        </span>
                      </td>
                      {!openId && (
                        <td className="px-space-md py-3.5">
                          {diag ? (
                            <div className={clsx("flex items-center gap-1.5", diag.cls)}>
                              <Icon name={diag.icon} className="shrink-0 text-[16px]" />
                              <span className="max-w-[170px] truncate font-label-md text-label-md font-semibold" title={diag.label}>
                                {diag.label}
                              </span>
                            </div>
                          ) : (
                            <span className="font-label-md text-label-md text-outline">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-space-sm py-3.5 text-right">
                        <Icon name="chevron_right" className={clsx("text-[20px]", selected ? "text-primary" : "text-outline-variant")} />
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
            {!list.isLoading && rows.length === 0 && (
              <EmptyState
                icon="manage_search"
                title={filtersActive ? "No executions match these filters" : "No executions yet"}
                body={filtersActive ? "Try widening the date range or clearing filters." : `Run a comment through the Simulator to see the audit trail.${viewMode === "live" ? " Live actions appear when active live campaigns match comments." : ""}`}
              />
            )}
          </div>
          <Pagination total={list.data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} onLimitChange={setLimit} sizes={[25, 50, 100]} />
        </motion.div>

        <AnimatePresence>
          {openId && (
            <motion.aside
              key="drawer"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
              className="sticky top-20 flex max-h-[calc(100vh-6rem)] w-full shrink-0 flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-md xl:w-[420px]"
            >
              <ExecutionDetail id={openId} onClose={() => setParam("open", null)} />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
      <p className="mt-space-sm font-label-sm text-label-sm text-outline">Showing {formatNumber(rows.length)} rows · auto-refreshes every 15s</p>
    </div>
  );
}
