import { useQueries } from "@tanstack/react-query";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { CountUp, fadeUp, rowIn, staggerContainer } from "@/components/motion";
import { ConfirmDialog, Menu, MenuItem, SelectMenu, useToast } from "@/components/overlays";
import { Pagination } from "@/components/Pagination";
import { CampaignStatusChip, ModePill } from "@/components/status";
import { Button, Card, EmptyState, FilterChip, Icon, IconButton, ProgressBar, Skeleton } from "@/components/ui";
import {
  useAllCampaigns,
  useCampaignTransition,
  useCampaigns,
  useConnections,
  useDeleteCampaign,
  useOverview,
  useSaveCampaign,
} from "@/hooks/queries";
import { api } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import type { Campaign, CampaignInput, CampaignStatus, Media, OperatingMode } from "@/lib/types";

const SORTS = [
  { value: "-updated_at", label: "Recently updated" },
  { value: "-created_at", label: "Newest first" },
  { value: "name", label: "Name A–Z" },
  { value: "status", label: "Status" },
];

type Target = "all" | "reels" | "posts" | "carousel";

function mediaKind(type: string | null | undefined): Exclude<Target, "all"> | null {
  const t = (type ?? "").toUpperCase();
  if (t.includes("REEL") || t === "VIDEO") return "reels";
  if (t.includes("CAROUSEL")) return "carousel";
  return t ? "posts" : null;
}

const KIND_ICON = { reels: "movie", posts: "image", carousel: "view_carousel" } as const;
const KIND_LABEL = { reels: "Reel", posts: "Post", carousel: "Carousel" } as const;

/** Media records for every connection, keyed by id (used for thumbnails and the Target filter). */
function useMediaIndex() {
  const connections = useConnections();
  const results = useQueries({
    queries: (connections.data ?? []).map((c) => ({
      queryKey: ["media", "index", c.id],
      queryFn: () => api<Media[]>(`/instagram/accounts/${c.id}/media`, { query: { limit: 100 } }),
      staleTime: 60_000,
    })),
  });
  const stamp = results.map((r) => r.dataUpdatedAt).join();
  return useMemo(() => {
    const map = new Map<string, Media>();
    results.forEach((r) => r.data?.forEach((m) => map.set(m.id, m)));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
}

function actionsSummary(c: Campaign) {
  const enabled = (c.config.actions ?? []).filter((a) => a.enabled);
  const pub = enabled.some((a) => a.type === "public_reply");
  const dm = enabled.some((a) => a.type === "private_reply");
  if (pub && dm) return { icon: "forum", label: "Public Reply + DM" };
  if (dm) return { icon: "mark_chat_unread", label: "Private DM only" };
  if (pub) return { icon: "mode_comment", label: "Public Reply" };
  return { icon: "block", label: "No actions" };
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCampaign(c: Campaign) {
  const body: CampaignInput = {
    name: c.name,
    description: c.description,
    mode: c.mode,
    media_external_id: c.media_external_id,
    config: c.config as CampaignInput["config"],
    rules: c.rules.map(({ keyword, match_type, case_sensitive, action, group_key, group_operator }) => ({
      keyword,
      match_type,
      case_sensitive,
      action,
      group_key,
      group_operator,
    })),
  };
  download(`${c.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.instaflow.json`, JSON.stringify(body, null, 2), "application/json");
}

function Metric({
  label,
  icon,
  iconClass,
  value,
  aside,
  progress,
  barClass,
  format,
}: {
  label: string;
  icon: string;
  iconClass: string;
  value: number;
  aside: React.ReactNode;
  progress: number;
  barClass: string;
  format?: (n: number) => string;
}) {
  return (
    <motion.div variants={fadeUp} className="flex flex-col justify-between rounded-xl bg-surface-container-lowest p-space-lg shadow-sm">
      <div className="mb-space-xs flex items-center justify-between text-on-surface-variant">
        <span className="font-label-md text-label-md uppercase tracking-wider">{label}</span>
        <Icon name={icon} className={clsx("text-[20px]", iconClass)} />
      </div>
      <div className="flex items-baseline justify-between gap-space-sm">
        <span className="font-headline-lg text-headline-lg font-bold text-on-surface">
          <CountUp value={value} format={format} />
        </span>
        {aside}
      </div>
      <ProgressBar value={progress} className="mt-space-md" barClass={barClass} />
    </motion.div>
  );
}

export default function Campaigns() {
  const navigate = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<CampaignStatus | "all">("all");
  const [mode, setMode] = useState<OperatingMode | "all">("all");
  const [target, setTarget] = useState<Target>("all");
  const [sort, setSort] = useState("-updated_at");
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<Campaign | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setOffset(0), [debounced, status, mode, target, sort, limit]);

  const overview = useOverview(1);
  const totals = useOverview(30);
  const all = useAllCampaigns();
  const mediaIndex = useMediaIndex();
  const list = useCampaigns({
    limit: target === "all" ? limit : 100,
    offset: target === "all" ? offset : 0,
    sort,
    search: debounced || undefined,
    status: status === "all" ? undefined : status,
    mode: mode === "all" ? undefined : mode,
  });
  const transition = useCampaignTransition();
  const remove = useDeleteCampaign();
  const save = useSaveCampaign();

  // The media-type filter is applied client-side (media type lives on the synced media record).
  const kindOf = (c: Campaign) => mediaKind(c.media_id ? mediaIndex.get(c.media_id)?.media_type : null);
  const filtered = (list.data?.items ?? []).filter((c) => target === "all" || kindOf(c) === target);
  const rows = target === "all" ? filtered : filtered.slice(offset, offset + limit);
  const total = target === "all" ? (list.data?.total ?? 0) : filtered.length;

  const stats = new Map((totals.data?.campaign_stats ?? []).map((s) => [s.campaign_id, s]));
  const counts = totals.data?.campaigns;
  const allItems = all.data?.items ?? [];
  const modeCount = (m: OperatingMode) => allItems.filter((c) => c.mode === m).length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function bulk(action: "pause" | "resume" | "stop") {
    const targets = rows.filter((c) => selected.has(c.id));
    const results = await Promise.allSettled(targets.map((c) => transition.mutateAsync({ id: c.id, action })));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    toast(`${ok} of ${targets.length} campaigns updated`, ok === targets.length ? "success" : "info");
    setSelected(new Set());
  }

  async function onImport(file: File) {
    try {
      const body = JSON.parse(await file.text()) as CampaignInput;
      const created = await save.mutateAsync({ body: { ...body, name: `${body.name} (imported)` } });
      toast("Campaign imported as a draft");
      navigate(`/campaigns/${created.id}`);
    } catch (e) {
      toast(e instanceof Error ? `Import failed: ${e.message}` : "Import failed", "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function exportList() {
    const header = ["name", "status", "mode", "media", "executions", "created_at"];
    const lines = rows.map((c) => [JSON.stringify(c.name), c.status, c.mode, c.media_external_id ?? "", stats.get(c.id)?.total ?? 0, c.created_at]);
    download("campaigns.csv", [header, ...lines].map((l) => l.join(",")).join("\n"), "text/csv");
  }

  function run(c: Campaign, action: "activate" | "pause" | "resume" | "stop", message: string) {
    transition.mutate({ id: c.id, action }, { onSuccess: () => toast(message), onError: (e) => toast(e.message, "error") });
  }

  const active = counts?.active ?? 0;
  const day = overview.data?.actions;
  const matchRate = totals.data && totals.data.comments_received ? (totals.data.comments_matched / totals.data.comments_received) * 100 : 0;
  const filtersActive = debounced || status !== "all" || mode !== "all" || target !== "all";

  return (
    <div className="flex w-full flex-col">
      <div className="mb-space-xl flex flex-col justify-between gap-space-lg md:flex-row md:items-end">
        <div>
          <div className="mb-space-xs flex items-center gap-space-sm">
            <h1 className="font-headline-md text-headline-md tracking-tight text-on-surface">Campaigns</h1>
            <span className="rounded-full bg-surface-container-high px-2.5 py-0.5 font-label-md text-label-md font-semibold text-on-surface-variant">
              {counts?.total ?? "…"} total
            </span>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Manage automation rules, keyword triggers, and engagement flows for Instagram posts and Reels
          </p>
        </div>
        <div className="flex items-center gap-space-sm">
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
          />
          <Button variant="surface" icon="file_download" className="py-2.5" onClick={() => fileRef.current?.click()}>
            Import campaign
          </Button>
          <Button variant="primaryContainer" icon="add" className="px-space-lg py-2.5" onClick={() => navigate("/campaigns/new")}>
            New Campaign
          </Button>
        </div>
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="mb-space-xl grid grid-cols-1 gap-space-md md:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Active Campaigns"
          icon="sensors"
          iconClass="text-primary"
          value={active}
          aside={
            <span className="flex items-center rounded-full bg-secondary-container px-2 py-0.5 text-xs font-semibold text-on-secondary-container">
              {counts?.total ? `${Math.round((active / counts.total) * 100)}% of total` : "none yet"}
            </span>
          }
          progress={counts?.total ? (active / counts.total) * 100 : 0}
          barClass="bg-primary"
        />
        <Metric
          label="Live Executions (24h)"
          icon="trending_up"
          iconClass="text-secondary"
          value={day?.succeeded ?? 0}
          aside={<span className="text-xs font-medium text-on-surface-variant">{formatNumber(day?.failed ?? 0)} failed</span>}
          progress={day?.total ? (day.succeeded / day.total) * 100 : 0}
          barClass="bg-primary"
        />
        <Metric
          label="Sandbox Executions"
          icon="science"
          iconClass="text-secondary"
          value={totals.data?.actions.simulated ?? 0}
          aside={<span className="text-xs font-medium text-on-surface-variant">{formatNumber(totals.data?.actions.pending ?? 0)} in flight</span>}
          progress={totals.data?.actions.total ? (totals.data.actions.simulated / totals.data.actions.total) * 100 : 0}
          barClass="bg-secondary"
        />
        <Metric
          label="Trigger Match Rate"
          icon="verified"
          iconClass="text-primary"
          value={matchRate}
          format={(n) => `${n.toFixed(1)}%`}
          aside={<span className="text-xs font-medium text-on-surface-variant">{formatNumber(totals.data?.comments_received ?? 0)} comments</span>}
          progress={matchRate}
          barClass="bg-primary-container"
        />
      </motion.div>

      <Card className="mb-space-lg flex flex-col gap-space-md p-space-md">
        <div className="flex flex-col items-stretch justify-between gap-space-md md:flex-row md:items-center">
          <div className="relative flex-1">
            <Icon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[20px] text-outline" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search campaigns"
              className="w-full rounded-lg bg-surface-container-low py-2 pl-11 pr-4 font-body-md text-body-md text-on-surface shadow-inner transition-all placeholder:text-outline focus:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary-container"
              placeholder="Search campaigns by name..."
            />
          </div>
          <div className="flex shrink-0 items-center gap-space-sm">
            <SelectMenu label="Sort" value={sort} onChange={setSort} options={SORTS} />
            <IconButton icon="download" label="Export list" className="bg-surface-container-low p-2" onClick={exportList} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-space-md pt-space-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-label-sm text-label-sm font-semibold uppercase text-outline">Status</span>
            <FilterChip active={status === "all"} onClick={() => setStatus("all")}>
              All ({counts?.total ?? 0})
            </FilterChip>
            {(["active", "paused", "draft", "stopped"] as const).map((s) => (
              <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
                <span className="capitalize">{s}</span> ({counts?.[s] ?? 0})
              </FilterChip>
            ))}
          </div>
          <div className="hidden h-4 w-px bg-surface-container-high md:block" />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-label-sm text-label-sm font-semibold uppercase text-outline">Mode</span>
            <FilterChip active={mode === "all"} onClick={() => setMode("all")}>
              All modes
            </FilterChip>
            <FilterChip active={mode === "live"} onClick={() => setMode("live")}>
              Live ({modeCount("live")})
            </FilterChip>
            <FilterChip active={mode === "simulation"} onClick={() => setMode("simulation")}>
              Simulation ({modeCount("simulation")})
            </FilterChip>
          </div>
          <div className="hidden h-4 w-px bg-surface-container-high md:block" />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-label-sm text-label-sm font-semibold uppercase text-outline">Target</span>
            <FilterChip active={target === "all"} onClick={() => setTarget("all")}>
              All posts
            </FilterChip>
            <FilterChip active={target === "reels"} onClick={() => setTarget("reels")}>
              Reels only
            </FilterChip>
            <FilterChip active={target === "posts"} onClick={() => setTarget("posts")}>
              Feed posts
            </FilterChip>
            <FilterChip active={target === "carousel"} onClick={() => setTarget("carousel")}>
              Carousel only
            </FilterChip>
          </div>
        </div>
      </Card>

      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-space-sm overflow-hidden"
          >
            <div className="flex items-center justify-between rounded-xl bg-primary-fixed px-space-md py-2 text-on-primary-fixed">
              <span className="font-label-lg text-label-lg">{selected.size} selected</span>
              <div className="flex gap-space-xs">
                <Button size="sm" variant="surface" icon="pause" onClick={() => bulk("pause")}>
                  Pause
                </Button>
                <Button size="sm" variant="surface" icon="play_arrow" onClick={() => bulk("resume")}>
                  Resume
                </Button>
                <Button size="sm" variant="surface" icon="stop" onClick={() => bulk("stop")}>
                  Stop
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="mb-space-lg w-full overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead>
              <tr className="select-none bg-surface-container-low font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                <th className="w-12 px-space-lg py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="h-4 w-4 cursor-pointer rounded accent-primary"
                    checked={rows.length > 0 && rows.every((c) => selected.has(c.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((c) => c.id)) : new Set())}
                  />
                </th>
                <th className="px-space-md py-3">Campaign &amp; Target Post</th>
                <th className="px-space-md py-3">Mode</th>
                <th className="px-space-md py-3">Status</th>
                <th className="px-space-md py-3">Triggers &amp; Actions</th>
                <th className="px-space-md py-3">Executions</th>
                <th className="px-space-md py-3">Created</th>
                <th className="px-space-md py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low font-body-md text-body-md text-on-surface">
              {list.isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={8} className="px-space-md py-3">
                      <Skeleton className="h-10" />
                    </td>
                  </tr>
                ))}
              {rows.map((c, i) => {
                const kind = kindOf(c);
                const media = c.media_id ? mediaIndex.get(c.media_id) : undefined;
                const s = stats.get(c.id);
                const actions = actionsSummary(c);
                const keywords = c.rules.filter((r) => r.action === "include").map((r) => r.keyword);
                const subtitle = c.description || media?.caption || (keywords.length ? `Keywords: ${keywords.join(", ")}` : "No rules yet");
                return (
                  <motion.tr key={c.id} custom={i} variants={rowIn} initial="hidden" animate="show" className="group transition-colors hover:bg-surface-container-low/60">
                    <td className="px-space-lg py-3.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.name}`}
                        className="h-4 w-4 cursor-pointer rounded accent-primary"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                      />
                    </td>
                    <td className="px-space-md py-3.5">
                      <div className="flex items-start gap-space-sm">
                        <div className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container text-secondary">
                          <Icon name={kind ? KIND_ICON[kind] : "photo_library"} className="text-[20px]" />
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <Link to={`/campaigns/${c.id}`} className="font-title-sm text-title-sm font-semibold text-on-surface transition-colors hover:text-primary">
                            {c.name}
                          </Link>
                          <div className="mt-0.5 flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant">
                            <span className="font-mono text-outline">
                              {kind ? KIND_LABEL[kind] : "Media"} #{(c.media_external_id ?? "unset").slice(-5)}
                            </span>
                            <span>•</span>
                            <span className="max-w-[210px] truncate">{subtitle.startsWith("Keywords") ? subtitle : `"${subtitle}"`}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-space-md py-3.5">
                      <ModePill mode={c.mode} pulse={c.status === "active"} />
                    </td>
                    <td className="px-space-md py-3.5">
                      <CampaignStatusChip status={c.status} />
                    </td>
                    <td className="px-space-md py-3.5">
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-surface-container px-2 py-0.5 font-label-sm text-label-sm text-on-surface">
                        <Icon name={actions.icon} className="text-[13px] text-secondary" />
                        <span>{actions.label}</span>
                      </span>
                    </td>
                    <td className="px-space-md py-3.5 font-mono text-body-sm">
                      {s ? (
                        <>
                          <span className="font-semibold text-on-surface">{formatNumber(s.total)}</span>{" "}
                          {s.live === 0 && <span className="text-xs text-outline">(Simulated)</span>}
                        </>
                      ) : (
                        <span className="text-on-surface-variant">0</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-space-md py-3.5 font-body-sm text-body-sm text-on-surface-variant">{formatDate(c.created_at)}</td>
                    <td className="px-space-md py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton icon="visibility" label="View details" onClick={() => navigate(`/campaigns/${c.id}`)} />
                        <Menu align="right" trigger={({ toggle: open }) => <IconButton icon="more_vert" label="More actions" onClick={open} />}>
                          {(close) => (
                            <>
                              {c.status === "draft" && (
                                <MenuItem icon="bolt" onClick={() => (close(), run(c, "activate", "Campaign activated"))}>
                                  Activate
                                </MenuItem>
                              )}
                              {c.status === "active" && (
                                <MenuItem icon="pause" onClick={() => (close(), run(c, "pause", "Campaign paused"))}>
                                  Pause
                                </MenuItem>
                              )}
                              {c.status === "paused" && (
                                <MenuItem icon="play_arrow" onClick={() => (close(), run(c, "resume", "Campaign resumed"))}>
                                  Resume
                                </MenuItem>
                              )}
                              <MenuItem icon="science" onClick={() => (close(), navigate(`/simulator?campaign=${c.id}`))}>
                                Simulate a comment
                              </MenuItem>
                              <MenuItem icon="ios_share" onClick={() => (close(), exportCampaign(c))}>
                                Export JSON
                              </MenuItem>
                              {c.status !== "stopped" && (
                                <MenuItem icon="stop_circle" onClick={() => (close(), run(c, "stop", "Campaign stopped"))}>
                                  Stop
                                </MenuItem>
                              )}
                              <MenuItem icon="delete" danger onClick={() => (close(), setConfirmDelete(c))}>
                                Delete
                              </MenuItem>
                            </>
                          )}
                        </Menu>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          {!list.isLoading && rows.length === 0 && (
            <EmptyState
              icon="campaign"
              title={filtersActive ? "No campaigns match these filters" : "Create your first campaign"}
              body="Campaigns watch one post or Reel and reply when a comment matches your keywords."
              action={
                <Button icon="add" onClick={() => navigate("/campaigns/new")}>
                  New Campaign
                </Button>
              }
            />
          )}
        </div>
        <Pagination total={total} limit={limit} offset={offset} onChange={setOffset} onLimitChange={setLimit} noun="campaigns" sizes={[10, 20, 50]} />
      </Card>

      <div className="flex items-start gap-space-md rounded-xl bg-surface-container-low p-space-lg shadow-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
          <Icon name="science" className="text-[20px]" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-title-sm text-title-sm font-semibold text-on-surface">Pro-Tip: Safety Sandbox Mode</h4>
            <span className="rounded bg-surface-container-highest px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Recommended
            </span>
          </div>
          <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
            Need to test a campaign safely without sending real DMs? Keep it in <strong className="text-on-surface">Simulation mode</strong> and run test
            comments through the Simulator. Simulated actions go through the same rules and safety checks and are recorded in your Executions log, but never
            reach Instagram.
          </p>
        </div>
        <Link to="/simulator" className="hidden shrink-0 items-center gap-1 font-label-md text-label-md font-semibold text-primary transition-colors hover:text-primary-container sm:inline-flex">
          <span>Open Simulator</span>
          <Icon name="arrow_forward" className="text-[16px]" />
        </Link>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete campaign?"
        danger
        confirmLabel="Delete"
        loading={remove.isPending}
        body={
          <>
            <strong className="text-on-surface">{confirmDelete?.name}</strong> and its rules will be deleted. Its execution history is kept. Active
            campaigns must be paused first.
          </>
        }
        onClose={() => setConfirmDelete(null)}
        onConfirm={() =>
          confirmDelete &&
          remove.mutate(confirmDelete.id, {
            onSuccess: () => {
              toast("Campaign deleted");
              setConfirmDelete(null);
            },
            onError: (e) => {
              toast(e.message, "error");
              setConfirmDelete(null);
            },
          })
        }
      />
    </div>
  );
}
