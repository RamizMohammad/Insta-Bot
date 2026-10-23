import clsx from "clsx";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { LineChart } from "@/components/LineChart";
import { CountUp, fadeUp, rowIn, staggerContainer } from "@/components/motion";
import { SelectMenu, useToast } from "@/components/overlays";
import { ExecutionStatusChip, ModeTag, actionLabel } from "@/components/status";
import { Avatar, Button, Card, EmptyState, Icon, ProgressBar, Segmented, Skeleton } from "@/components/ui";
import { useConnections, useExecutions, useOverview, useReadiness, useSyncMedia } from "@/hooks/queries";
import { daysUntil, formatNumber, percent, timeAgo } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { DailyPoint, Overview } from "@/lib/types";

const RANGE_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

function exportCsv(overview: Overview) {
  const rows = [
    ["date", "live_sent", "simulated", "live_public", "live_private", "simulated_public", "simulated_private"],
    ...overview.daily.map((d) => [d.date, d.live, d.simulated, d.live_public, d.live_private, d.simulated_public, d.simulated_private]),
  ];
  const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `instaflow-report-${overview.period_days}d.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Kpi({
  title,
  icon,
  iconClass,
  value,
  valueClass,
  badge,
  left,
  right,
  progress,
  barClass,
}: {
  title: string;
  icon: string;
  iconClass: string;
  value: number;
  valueClass?: string;
  badge?: React.ReactNode;
  left: React.ReactNode;
  right: React.ReactNode;
  progress: number;
  barClass: string;
}) {
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ y: -2 }}
      className="flex flex-col rounded-xl bg-surface-container-lowest p-space-md shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="mb-space-sm flex items-center justify-between">
        <span className="font-title-sm text-title-sm text-secondary">{title}</span>
        <div className={clsx("flex h-9 w-9 items-center justify-center rounded-lg", iconClass)}>
          <Icon name={icon} className="text-[20px]" />
        </div>
      </div>
      <div className="mb-space-xs flex flex-wrap items-baseline gap-space-sm">
        <span className={clsx("font-headline-lg text-headline-lg font-bold tracking-tight", valueClass ?? "text-on-surface")}>
          <CountUp value={value} />
        </span>
        {badge}
      </div>
      <div className="flex items-center justify-between gap-space-sm font-body-sm text-body-sm text-on-surface-variant">
        <span>{left}</span>
        <span className="text-right font-medium text-secondary">{right}</span>
      </div>
      <ProgressBar value={progress} className="mt-space-sm" barClass={barClass} />
    </motion.div>
  );
}

function KpiGrid({ data }: { data: Overview }) {
  const a = data.actions;
  const trend = data.comments_previous ? (data.comments_received - data.comments_previous) / data.comments_previous : null;
  const matched = data.comments_received ? data.comments_matched / data.comments_received : 0;
  const review = a.manual_review + a.unknown;
  const reviewCampaigns = new Set(data.attention.filter((x) => x.kind !== "connection").map((x) => x.campaign_id)).size;
  return (
    <motion.section variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        title="Comments Received"
        icon="forum"
        iconClass="bg-surface-container text-primary"
        value={data.comments_received}
        badge={
          trend != null && (
            <span className={clsx("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-label-sm text-label-sm font-semibold", trend >= 0 ? "bg-emerald-50 text-emerald-800" : "bg-error-container text-on-error-container")}>
              <Icon name={trend >= 0 ? "trending_up" : "trending_down"} className="text-[14px]" />
              {trend >= 0 ? "+" : ""}
              {(trend * 100).toFixed(1)}%
            </span>
          )
        }
        left={`vs. ${formatNumber(data.comments_previous)} last period`}
        right={`${percent(matched)} matched`}
        progress={matched * 100}
        barClass="bg-primary"
      />
      <Kpi
        title="Actions Sent"
        icon="forward_to_inbox"
        iconClass="bg-surface-container text-primary"
        value={a.succeeded}
        badge={
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-label-sm text-label-sm font-semibold text-emerald-800">
            {data.success_rate == null ? "No live sends yet" : `${percent(data.success_rate)} success`}
          </span>
        }
        left={`${formatNumber(a.private_replies)} DMs · ${formatNumber(a.public_replies)} Public`}
        right={`${formatNumber(a.pending)} pending`}
        progress={(data.success_rate ?? 0) * 100}
        barClass="bg-primary-container"
      />
      <Kpi
        title="Simulated"
        icon="science"
        iconClass="bg-surface-container text-secondary"
        value={a.simulated}
        badge={
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2 py-0.5 font-label-sm text-label-sm font-semibold text-on-secondary-container">
            <Icon name="tune" className="text-[13px]" />
            Simulated
          </span>
        }
        left="Test bench triggers"
        right="Never sent to Instagram"
        progress={a.total ? (a.simulated / a.total) * 100 : 0}
        barClass="bg-secondary-fixed-dim"
      />
      <Kpi
        title="Needs Review"
        icon="notification_important"
        iconClass="bg-amber-50 text-amber-700"
        value={review}
        valueClass={review ? "text-amber-900" : "text-on-surface"}
        badge={
          review > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-label-sm text-label-sm font-semibold text-amber-900">
              <Icon name="warning" className="text-[13px]" />
              Action required
            </span>
          )
        }
        left={
          <Link to="/executions?status=manual_review" className="inline-flex items-center gap-0.5 font-title-sm text-title-sm text-primary hover:underline">
            Requires manual action <Icon name="arrow_forward" className="text-[16px]" />
          </Link>
        }
        right={`${reviewCampaigns} campaign${reviewCampaigns === 1 ? "" : "s"}`}
        progress={a.total ? (review / a.total) * 100 : 0}
        barClass="bg-amber-500"
      />
    </motion.section>
  );
}

type ChartFilter = "total" | "public" | "private";

function pick(d: DailyPoint, f: ChartFilter) {
  if (f === "public") return [d.live_public, d.simulated_public];
  if (f === "private") return [d.live_private, d.simulated_private];
  return [d.live, d.simulated];
}

function ActionsChart({ data }: { data: Overview }) {
  const [filter, setFilter] = useState<ChartFilter>("total");
  const labels = data.daily.map((d) => new Date(`${d.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "2-digit" }));
  const live = data.daily.map((d) => pick(d, filter)[0]);
  const sim = data.daily.map((d) => pick(d, filter)[1]);
  const totals = [live.reduce((a, b) => a + b, 0), sim.reduce((a, b) => a + b, 0)];
  const peakIndex = live.map((v, i) => v + sim[i]).reduce((best, v, i, arr) => (v > arr[best] ? i : best), 0);
  const peak = live[peakIndex] + sim[peakIndex];
  const series = useMemo(
    () => [
      { label: "Live", values: live, color: "#24389c", gradientId: "liveGradient", gradientOpacity: 0.18 },
      { label: "Simulated", values: sim, color: "#5a5d72", dashed: true, gradientId: "simGradient", gradientOpacity: 0.1 },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, data],
  );
  return (
    <Card initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="flex flex-col p-space-lg">
      <div className="flex flex-col justify-between gap-space-sm pb-space-md sm:flex-row sm:items-center">
        <div className="flex flex-col">
          <span className="font-label-sm text-label-sm font-semibold uppercase text-secondary">Trend Analysis</span>
          <h2 className="font-title-lg text-title-lg font-semibold text-on-surface">Automated Actions Performance</h2>
        </div>
        <Segmented
          id="chart-filter"
          value={filter}
          onChange={setFilter}
          className="self-start rounded-lg p-1 sm:self-center"
          options={[
            { value: "total", label: "Total" },
            { value: "public", label: "Public Reply" },
            { value: "private", label: "DM" },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-space-lg py-space-xs font-body-sm text-body-sm">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-primary" />
          <span className="font-medium text-on-surface">Live Actions Sent</span>
          <span className="ml-1 font-label-sm text-label-sm text-secondary">({formatNumber(totals[0])} total)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-secondary-fixed" />
          <span className="font-medium text-on-surface-variant">Simulated Runs</span>
          <span className="ml-1 font-label-sm text-label-sm text-secondary">({formatNumber(totals[1])} total)</span>
        </div>
        {peak > 0 && (
          <div className="ml-auto hidden items-center gap-1.5 rounded bg-surface-container-low px-2.5 py-1 font-label-sm text-label-sm text-secondary sm:flex">
            <Icon name="speed" className="text-[16px]" /> Peak: {formatNumber(peak)} actions / {labels[peakIndex]}
          </div>
        )}
      </div>
      <div className="relative mt-space-md w-full">
        <LineChart labels={labels} series={series} />
      </div>
    </Card>
  );
}

function RecentExecutions() {
  const { viewMode } = useSession();
  const [offset, setOffset] = useState(0);
  const navigate = useNavigate();
  const simulated = viewMode === "simulation";
  const { data, isLoading } = useExecutions({ limit: 5, offset, simulated });
  const items = data?.items ?? [];
  return (
    <Card initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between p-space-md pb-space-sm">
        <div className="flex items-center gap-space-sm">
          <Icon name="terminal" className="text-[22px] text-primary" />
          <div>
            <h2 className="font-title-lg text-title-lg font-semibold text-on-surface">Recent Executions</h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {simulated ? "Simulated automation runs from the test bench" : "Live automation actions from verified Instagram webhooks"}
            </p>
          </div>
        </div>
        <Link to={`/executions?mode=${viewMode}`} className="inline-flex items-center gap-1 font-title-sm text-title-sm text-primary hover:underline">
          <span>View all ({formatNumber(data?.total ?? 0)})</span>
          <Icon name="arrow_forward" className="text-[16px]" />
        </Link>
      </div>
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse text-left">
          <thead>
            <tr className="bg-surface-container-low font-label-sm text-label-sm uppercase tracking-wider text-secondary">
              <th className="px-space-md py-3 font-semibold">Time</th>
              <th className="px-space-md py-3 font-semibold">Campaign</th>
              <th className="px-space-md py-3 font-semibold">Action Type</th>
              <th className="px-space-md py-3 font-semibold">Recipient</th>
              <th className="px-space-md py-3 font-semibold">Status</th>
              <th className="px-space-md py-3 text-right font-semibold">Mode</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container font-body-md text-body-md text-on-surface">
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-space-md py-3">
                    <Skeleton className="h-8" />
                  </td>
                </tr>
              ))}
            {items.map((e, i) => (
              <motion.tr
                key={e.id}
                custom={i}
                variants={rowIn}
                initial="hidden"
                animate="show"
                onClick={() => navigate(`/executions?open=${e.id}`)}
                className="cursor-pointer transition-colors hover:bg-surface"
              >
                <td className="whitespace-nowrap px-space-md py-3.5 font-label-md text-label-md text-on-surface-variant">{timeAgo(e.created_at)}</td>
                <td className="px-space-md py-3.5">
                  <div className="flex flex-col">
                    <span className="max-w-xs truncate font-title-sm text-title-sm text-on-surface">{e.campaign_name ?? "Deleted campaign"}</span>
                    <span className="font-label-sm text-label-sm text-outline">
                      Trigger: {e.matched_rules[0] ? `${e.matched_rules[0].match_type} "${e.matched_rules[0].keyword.toUpperCase()}"` : "rule match"}
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-space-md py-3.5">
                  <span className="inline-flex items-center gap-1.5 text-on-surface-variant">
                    <Icon name={e.action_type === "private_reply" ? "mark_chat_read" : "forum"} className={clsx("text-[18px]", e.action_type === "private_reply" ? "text-primary" : "text-secondary")} />
                    <span>{actionLabel(e.action_type)}</span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-space-md py-3.5 font-medium text-primary">{e.lead_username ? `@${e.lead_username}` : "—"}</td>
                <td className="whitespace-nowrap px-space-md py-3.5">
                  <ExecutionStatusChip status={e.status} />
                </td>
                <td className="whitespace-nowrap px-space-md py-3.5 text-right">
                  <ModeTag simulated={e.is_simulated} />
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
        {!isLoading && items.length === 0 && (
          <EmptyState
            icon={simulated ? "science" : "sensors"}
            title={simulated ? "No simulated runs yet" : "No live actions yet"}
            body={simulated ? "Run a comment through the Simulator to see it here." : "Live actions appear once an active live campaign receives a matching comment."}
            action={<Button variant="tonal" icon="science" onClick={() => navigate("/simulator")}>Open Simulator</Button>}
          />
        )}
      </div>
      <div className="flex items-center justify-between bg-surface-container-lowest px-space-md py-space-sm">
        <div className="font-label-md text-label-md text-on-surface-variant">
          Showing <strong className="text-on-surface">{data?.total ? `${offset + 1} - ${Math.min(offset + 5, data.total)}` : "0"}</strong> of {formatNumber(data?.total ?? 0)} events
        </div>
        <div className="flex items-center gap-space-xs">
          <button type="button" aria-label="Previous" disabled={offset === 0} onClick={() => setOffset(offset - 5)} className="rounded p-1 text-on-surface-variant hover:bg-surface-container disabled:opacity-40">
            <Icon name="chevron_left" className="text-[20px]" />
          </button>
          <span className="rounded bg-surface-container px-2 py-1 font-label-sm text-label-sm font-semibold text-primary">Page {offset / 5 + 1}</span>
          <button type="button" aria-label="Next" disabled={!data || offset + 5 >= data.total} onClick={() => setOffset(offset + 5)} className="rounded p-1 text-on-surface-variant hover:bg-surface-container disabled:opacity-40">
            <Icon name="chevron_right" className="text-[20px]" />
          </button>
        </div>
      </div>
    </Card>
  );
}

function AttentionCard({ data }: { data: Overview }) {
  const navigate = useNavigate();
  const items = data.attention;
  return (
    <Card initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="flex flex-col p-space-md">
      <div className={clsx("mb-space-md flex items-center gap-space-xs rounded-lg p-space-sm", items.length ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800")}>
        <Icon name={items.length ? "warning" : "task_alt"} className={clsx("text-[20px]", items.length ? "text-amber-700" : "text-emerald-700")} />
        <span className="font-title-sm text-title-sm font-semibold">
          {items.length ? `${items.length} item${items.length === 1 ? "" : "s"} require attention` : "Nothing needs attention"}
        </span>
      </div>
      <div className="flex flex-col gap-space-md">
        {items.slice(0, 4).map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + i * 0.06 }}
            className="flex flex-col gap-space-xs rounded-lg bg-surface-container-low p-space-sm transition-colors hover:bg-surface-container"
          >
            <div className="flex items-start justify-between gap-space-sm">
              <div className="flex flex-col">
                <span className="font-title-sm text-title-sm font-semibold text-on-surface">{item.title}</span>
                <span className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">{item.detail}</span>
              </div>
              <span
                className={clsx(
                  "shrink-0 rounded px-2 py-0.5 font-label-sm text-label-sm font-medium",
                  item.severity === "critical" ? "bg-error-container text-on-error-container" : item.severity === "warning" ? "bg-amber-100 text-amber-800" : "bg-secondary-container text-on-secondary-container",
                )}
              >
                {item.severity === "critical" ? "Critical" : item.severity === "warning" ? "Warning" : "Review"}
              </span>
            </div>
            <div className="mt-space-xs flex items-center justify-end">
              {item.kind === "connection" ? (
                <Button size="sm" onClick={() => navigate("/accounts")}>Reconnect</Button>
              ) : (
                <Button size="sm" variant="tonal" onClick={() => navigate(`/executions?campaign=${item.campaign_id}&status=${item.kind === "manual_review" ? "manual_review" : ""}`)}>
                  {item.kind === "manual_review" ? "Review now" : "Review error"}
                </Button>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </Card>
  );
}

function ChannelCard() {
  const { data, isLoading } = useConnections();
  const sync = useSyncMedia();
  const toast = useToast();
  const navigate = useNavigate();
  const conn = data?.find((c) => c.status === "active") ?? data?.[0];
  if (isLoading) return <Skeleton className="h-56 rounded-xl" />;
  if (!conn) {
    return (
      <Card className="p-space-md">
        <EmptyState icon="link" title="No Instagram account" body="Connect a professional account to run live campaigns." action={<Button icon="add_link" onClick={() => navigate("/accounts")}>Connect account</Button>} />
      </Card>
    );
  }
  const days = daysUntil(conn.token_expires_at);
  return (
    <Card initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="flex flex-col p-space-md">
      <div className="flex items-center justify-between pb-space-sm">
        <span className="font-label-sm text-label-sm font-semibold uppercase text-secondary">Channel Connection</span>
        <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-label-sm text-label-sm font-semibold capitalize", conn.status === "active" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>
          <span className={clsx("h-1.5 w-1.5 rounded-full", conn.status === "active" ? "bg-emerald-600" : "bg-amber-600")} />
          {conn.status}
        </span>
      </div>
      <div className="flex items-center gap-space-sm py-space-xs">
        <div className="relative">
          <Avatar name={conn.username ?? conn.instagram_account_id} size="lg" />
          <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface-container-lowest">
            <Icon name="verified" className="text-[14px] text-pink-600" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-title-sm text-title-sm font-semibold text-on-surface">@{conn.username ?? conn.instagram_account_id}</span>
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            {conn.auth_method === "mock" ? "Mock connection · simulation only" : "Instagram Login · professional account"}
          </span>
        </div>
      </div>
      <div className="mt-space-xs flex flex-col gap-space-xs pt-space-sm">
        <div className="flex items-center justify-between rounded bg-surface-container-low px-space-sm py-1.5 font-body-sm text-body-sm">
          <span className="text-secondary">Token expires in</span>
          <span className="font-title-sm text-title-sm text-on-surface">{days == null ? "Unknown" : days <= 0 ? "Expired" : `${days} days`}</span>
        </div>
        <div className="flex items-center justify-between rounded bg-surface-container-low px-space-sm py-1.5 font-body-sm text-body-sm">
          <span className="text-secondary">Media sync status</span>
          <span className="font-label-md text-label-md text-on-surface">{conn.last_synced_at ? `Synced ${timeAgo(conn.last_synced_at)}` : "Never synced"}</span>
        </div>
      </div>
      <Button
        variant="tonal"
        className="mt-space-md w-full"
        loading={sync.isPending}
        disabled={conn.status !== "active"}
        onClick={() =>
          sync.mutate(conn.id, {
            onSuccess: (media) => toast(`Synced ${media.length} posts`),
            onError: (e) => toast(e.message, "error"),
          })
        }
      >
        <Icon name="sync" className="text-[18px] text-primary" />
        Sync Now
      </Button>
    </Card>
  );
}

function Diagnostics() {
  const { data, dataUpdatedAt, isError } = useReadiness();
  const checks = data
    ? [
        { label: "Database", ok: data.checks.database.ok, detail: data.checks.database.ok ? "Connected" : data.checks.database.error ?? "Down" },
        { label: "Queue & cache (Redis)", ok: data.checks.redis.ok, detail: data.checks.redis.ok ? "Connected" : data.checks.redis.error ?? "Down" },
        {
          label: "Background worker",
          ok: Boolean(data.checks.redis.worker_alive),
          detail: data.checks.redis.worker_heartbeat_age_seconds == null ? "No heartbeat" : `Beat ${Math.round(data.checks.redis.worker_heartbeat_age_seconds)}s ago`,
        },
      ]
    : [];
  const healthy = checks.filter((c) => c.ok).length;
  return (
    <Card initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 }} className="flex flex-col p-space-md">
      <div className="mb-space-sm flex items-center justify-between">
        <div className="flex items-center gap-space-xs">
          <Icon name="dns" className="text-[20px] text-primary" />
          <span className="font-title-sm text-title-sm font-semibold text-on-surface">System Diagnostics</span>
        </div>
        {data && (
          <span className={clsx("rounded-full px-2 py-0.5 font-label-sm text-label-sm font-medium", healthy === checks.length ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>
            {healthy}/{checks.length} healthy
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 pt-1 font-body-sm text-body-sm">
        {isError && <span className="text-on-surface-variant">Status endpoint unreachable.</span>}
        {checks.map((c) => (
          <div key={c.label} className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <span className={clsx("h-2 w-2 rounded-full", c.ok ? "bg-emerald-500" : "bg-amber-500")} />
              <span className="text-on-surface">{c.label}</span>
            </div>
            <span className="font-label-md text-label-md text-secondary">{c.detail}</span>
          </div>
        ))}
      </div>
      <div className="mt-space-sm flex items-center justify-between pt-space-xs font-label-sm text-label-sm text-outline">
        <span>Checks /ready every 30s</span>
        <span>Updated {dataUpdatedAt ? timeAgo(new Date(dataUpdatedAt).toISOString()) : "—"}</span>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [days, setDays] = useState("30");
  const { data, isLoading, isError, refetch } = useOverview(Number(days));
  const name = user?.email.split("@")[0] ?? "there";
  const matchRate = data && data.comments_received ? data.comments_matched / data.comments_received : null;

  return (
    <div className="flex w-full flex-col gap-space-lg">
      <section className="flex flex-col justify-between gap-space-md md:flex-row md:items-end">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-space-xs">
            <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">Executive Overview</span>
            <span className="inline-block h-1 w-1 rounded-full bg-outline-variant" />
            <span className="font-label-md text-label-md font-semibold text-primary">{data ? `${data.campaigns.active} active campaigns` : "Active Cycle"}</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg font-semibold tracking-tight text-on-surface">Dashboard</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Welcome back, {name}.{" "}
            {matchRate != null ? (
              <>
                Your automations matched <strong className="font-title-sm text-title-sm text-on-surface">{percent(matchRate)}</strong> of comments in this period.
              </>
            ) : (
              "No comments received in this period yet."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-space-sm">
          <SelectMenu icon="calendar_today" value={days} onChange={setDays} options={RANGE_OPTIONS} />
          <Button variant="surface" icon="download" disabled={!data} onClick={() => data && exportCsv(data)}>
            Export report
          </Button>
          <Button icon="add" onClick={() => navigate("/campaigns/new")}>
            New Campaign
          </Button>
        </div>
      </section>

      {isLoading && (
        <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      )}
      {isError && (
        <Card className="p-space-md">
          <EmptyState icon="cloud_off" title="Couldn't load your overview" body="The API didn't respond. Check that the backend is running." action={<Button variant="tonal" icon="refresh" onClick={() => refetch()}>Try again</Button>} />
        </Card>
      )}
      {data && <KpiGrid data={data} />}

      <div className="grid grid-cols-1 items-start gap-space-lg xl:grid-cols-12">
        <div className="flex flex-col gap-space-lg xl:col-span-8">
          {data ? <ActionsChart data={data} /> : <Skeleton className="h-80 rounded-xl" />}
          <RecentExecutions />
        </div>
        <div className="flex flex-col gap-space-lg xl:col-span-4">
          {data && <AttentionCard data={data} />}
          <ChannelCard />
          <Diagnostics />
        </div>
      </div>
    </div>
  );
}
