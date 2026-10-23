import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { rowIn } from "@/components/motion";
import { Pagination } from "@/components/Pagination";
import { EventStatusChip } from "@/components/status";
import { Card, EmptyState, FilterChip, Icon, Skeleton } from "@/components/ui";
import { useAllCampaigns, useEvents } from "@/hooks/queries";
import { formatDate, formatTime, shortId, timeAgo } from "@/lib/format";
import type { EventStatus } from "@/lib/types";

const STATUSES: EventStatus[] = ["processed", "ignored", "failed", "received", "processing"];

export default function Events() {
  const [status, setStatus] = useState<EventStatus | "all">("all");
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => setOffset(0), [status, limit]);
  const events = useEvents({ limit, offset, status: status === "all" ? undefined : status });
  const campaigns = useAllCampaigns();
  const names = new Map((campaigns.data?.items ?? []).map((c) => [c.id, c.name]));
  const rows = events.data?.items ?? [];

  return (
    <div className="flex w-full flex-col gap-space-lg">
      <div>
        <div className="mb-space-xs flex items-center gap-space-sm">
          <h1 className="font-headline-md text-headline-md tracking-tight text-on-surface">Events Log</h1>
          <span className="rounded-full bg-surface-container-high px-2.5 py-0.5 font-label-md text-label-md font-semibold text-on-surface-variant">{events.data?.total ?? "…"} events</span>
        </div>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Every incoming comment event (Instagram webhooks and simulations), stored once before processing. Errors are shown with sensitive values redacted.
        </p>
      </div>

      <Card className="flex flex-wrap items-center gap-1.5 p-space-md">
        <span className="mr-1 font-label-sm text-label-sm font-semibold uppercase text-outline">Status</span>
        <FilterChip active={status === "all"} onClick={() => setStatus("all")}>
          All
        </FilterChip>
        {STATUSES.map((s) => (
          <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
            <span className="capitalize">{s}</span>
          </FilterChip>
        ))}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="bg-surface-container-low font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                <th className="px-space-md py-3">Received</th>
                <th className="px-space-md py-3">Source</th>
                <th className="px-space-md py-3">Comment</th>
                <th className="px-space-md py-3">Status</th>
                <th className="px-space-md py-3 text-center">Attempts</th>
                <th className="px-space-sm py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container font-body-md text-body-md">
              {events.isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-space-md py-3">
                      <Skeleton className="h-10" />
                    </td>
                  </tr>
                ))}
              {rows.map((ev, i) => {
                const open = expanded === ev.id;
                return (
                  <Fragment key={ev.id}>
                    <motion.tr custom={i} variants={rowIn} initial="hidden" animate="show" onClick={() => setExpanded(open ? null : ev.id)} className={clsx("cursor-pointer transition-colors hover:bg-surface-container-low", open && "bg-surface-container-low")}>
                      <td className="whitespace-nowrap px-space-md py-3">
                        <div className="flex flex-col">
                          <span className="font-label-md text-label-md text-on-surface">{formatTime(ev.received_at)}</span>
                          <span className="font-label-sm text-label-sm text-outline">{timeAgo(ev.received_at)}</span>
                        </div>
                      </td>
                      <td className="px-space-md py-3">
                        <span className={clsx("inline-flex items-center gap-1 rounded px-2 py-0.5 font-label-sm text-label-sm font-semibold", ev.source === "instagram" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface-variant")}>
                          <Icon name={ev.source === "instagram" ? "webhook" : "science"} className="text-[14px]" />
                          {ev.source === "instagram" ? "Instagram" : "Simulation"}
                        </span>
                      </td>
                      <td className="max-w-[340px] px-space-md py-3">
                        <div className="flex flex-col">
                          <span className="truncate text-on-surface">{ev.payload.text ?? <span className="italic text-outline">No text</span>}</span>
                          <span className="font-label-sm text-label-sm text-outline">
                            {ev.payload.username ? `@${ev.payload.username}` : "unknown user"} · media {ev.payload.media_id ?? "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-space-md py-3">
                        <EventStatusChip status={ev.status} />
                      </td>
                      <td className="px-space-md py-3 text-center font-mono">{ev.attempt_count}</td>
                      <td className="px-space-sm py-3 text-right">
                        <Icon name="expand_more" className={clsx("text-[20px] text-outline transition-transform", open && "rotate-180")} />
                      </td>
                    </motion.tr>
                    <AnimatePresence>
                      {open && (
                        <tr>
                          <td colSpan={6} className="bg-surface-container-low px-space-md pb-space-md">
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex flex-col gap-space-sm overflow-hidden">
                              <div className="grid grid-cols-1 gap-space-sm md:grid-cols-3">
                                <div className="rounded-lg bg-surface-container-lowest p-space-sm font-body-sm text-body-sm">
                                  <div className="text-outline">Event</div>
                                  <div className="font-mono text-on-surface">#{shortId(ev.id)}</div>
                                  <div className="font-mono text-[11px] text-outline">comment {ev.external_event_id}</div>
                                </div>
                                <div className="rounded-lg bg-surface-container-lowest p-space-sm font-body-sm text-body-sm">
                                  <div className="text-outline">Processed</div>
                                  <div className="text-on-surface">{ev.processed_at ? `${formatDate(ev.processed_at)} ${formatTime(ev.processed_at)}` : "Not yet"}</div>
                                </div>
                                <div className="rounded-lg bg-surface-container-lowest p-space-sm font-body-sm text-body-sm">
                                  <div className="text-outline">Follower status</div>
                                  <div className="capitalize text-on-surface">{ev.payload.follower_status ?? "unknown"}</div>
                                </div>
                              </div>
                              {ev.error && (
                                <div className="flex items-start gap-space-xs rounded-lg bg-error-container px-space-sm py-2 font-body-sm text-body-sm text-on-error-container">
                                  <Icon name="error" className="text-[18px]" />
                                  <span>
                                    <strong>{ev.error.type}:</strong> {ev.error.message}
                                  </span>
                                </div>
                              )}
                              {ev.result.reason && <div className="font-body-sm text-body-sm text-on-surface-variant">Result: {ev.result.reason}</div>}
                              {ev.result.campaigns?.map((c) => (
                                <div key={c.campaign_id} className="flex flex-wrap items-center gap-space-sm rounded-lg bg-surface-container-lowest p-space-sm font-body-sm text-body-sm">
                                  <Icon name={c.matched ? "check_circle" : "cancel"} className={clsx("text-[18px]", c.matched ? "text-emerald-600" : "text-outline")} />
                                  <Link to={`/campaigns/${c.campaign_id}`} className="font-semibold text-primary hover:underline">
                                    {names.get(c.campaign_id) ?? "Campaign"}
                                  </Link>
                                  <span className="text-on-surface-variant">{c.reason}</span>
                                  {c.executions.length > 0 && (
                                    <Link to={`/executions?campaign=${c.campaign_id}`} className="ml-auto font-label-md text-label-md text-primary hover:underline">
                                      {c.executions.length} action{c.executions.length === 1 ? "" : "s"} →
                                    </Link>
                                  )}
                                </div>
                              ))}
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!events.isLoading && rows.length === 0 && <EmptyState icon="history" title="No events yet" body="Events appear when Instagram delivers a comment webhook or you run the Simulator." />}
        </div>
        <Pagination total={events.data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} onLimitChange={setLimit} noun="events" />
      </Card>
    </div>
  );
}
