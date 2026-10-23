import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { rowIn } from "@/components/motion";
import { ConfirmDialog, Drawer, SelectMenu, useToast } from "@/components/overlays";
import { Pagination } from "@/components/Pagination";
import { ExecutionStatusChip, actionLabel } from "@/components/status";
import { Avatar, Button, Card, EmptyState, Icon, IconButton, Skeleton, inputClass } from "@/components/ui";
import { useDeleteLead, useExecutions, useLeads, useUpdateLead } from "@/hooks/queries";
import { formatDate, timeAgo } from "@/lib/format";
import type { Lead } from "@/lib/types";

const SORTS = [
  { value: "-last_seen_at", label: "Last seen" },
  { value: "-comment_count", label: "Most comments" },
  { value: "-first_seen_at", label: "Newest" },
  { value: "username", label: "Username A–Z" },
];

function LeadDetail({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const update = useUpdateLead();
  const remove = useDeleteLead();
  const toast = useToast();
  const [tags, setTags] = useState(lead.tags);
  const [tagInput, setTagInput] = useState("");
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [confirm, setConfirm] = useState(false);
  const history = useExecutions({ search: lead.username ?? undefined, limit: 20 });
  const dirty = notes !== (lead.notes ?? "") || tags.join() !== lead.tags.join();

  function addTag(e: KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
      e.preventDefault();
      const t = tagInput.trim().toLowerCase().slice(0, 40);
      if (!tags.includes(t)) setTags([...tags, t]);
      setTagInput("");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between bg-surface-container-low p-space-md">
        <div className="flex items-center gap-space-sm">
          <Avatar name={lead.username ?? lead.external_user_id} size="lg" />
          <div className="flex flex-col">
            <span className="font-title-md text-title-md text-on-surface">{lead.username ? `@${lead.username}` : lead.external_user_id}</span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">
              {lead.comment_count} comment{lead.comment_count === 1 ? "" : "s"} · first seen {formatDate(lead.first_seen_at)}
            </span>
          </div>
        </div>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </div>
      <div className="flex flex-1 flex-col gap-space-md overflow-y-auto p-space-md">
        <div className="flex flex-col gap-space-xs">
          <span className="font-label-md text-label-md text-on-surface-variant">Tags</span>
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-surface-container-low p-2">
            <AnimatePresence>
              {tags.map((t) => (
                <motion.span key={t} layout initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} className="inline-flex items-center gap-1 rounded-full bg-primary-fixed px-2 py-0.5 font-label-sm text-label-sm text-on-primary-fixed">
                  {t}
                  <button type="button" aria-label={`Remove ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>
                    <Icon name="close" className="text-[14px]" />
                  </button>
                </motion.span>
              ))}
            </AnimatePresence>
            <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={addTag} placeholder="Add tag, press Enter" className="min-w-[120px] flex-1 bg-transparent px-1 font-body-sm text-body-sm focus:outline-none" />
          </div>
        </div>
        <label className="flex flex-col gap-space-xs">
          <span className="font-label-md text-label-md text-on-surface-variant">Notes</span>
          <textarea className={clsx(inputClass, "min-h-[100px]")} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context for your team…" maxLength={5000} />
        </label>
        <div className="flex flex-col gap-space-xs">
          <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-outline">Automation history</span>
          {history.isLoading && <Skeleton className="h-20" />}
          {history.data?.items.length === 0 && <span className="font-body-sm text-body-sm text-on-surface-variant">No actions for this person yet.</span>}
          {history.data?.items
            .filter((e) => e.lead_id === lead.id)
            .map((e) => (
              <div key={e.id} className="flex flex-col gap-1 rounded-lg bg-surface-container-low p-space-sm">
                <div className="flex items-center justify-between">
                  <span className="font-label-md text-label-md text-on-surface">
                    {actionLabel(e.action_type)} · {e.campaign_name ?? "Deleted campaign"}
                  </span>
                  <ExecutionStatusChip status={e.status} />
                </div>
                {e.comment_text && <span className="font-body-sm text-body-sm italic text-on-surface-variant">"{e.comment_text}"</span>}
                <span className="font-label-sm text-label-sm text-outline">{timeAgo(e.created_at)}</span>
              </div>
            ))}
        </div>
      </div>
      <div className="flex items-center justify-between bg-surface-container-low p-space-md">
        <Button variant="ghost" icon="delete" className="text-error hover:text-error" onClick={() => setConfirm(true)}>
          Delete lead
        </Button>
        <Button
          icon="save"
          disabled={!dirty}
          loading={update.isPending}
          onClick={() => update.mutate({ id: lead.id, body: { tags, notes: notes || null } }, { onSuccess: () => toast("Lead updated"), onError: (e) => toast(e.message, "error") })}
        >
          Save changes
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        title="Delete this lead?"
        danger
        confirmLabel="Delete"
        loading={remove.isPending}
        body="The lead's tags and notes are removed. Execution history stays in your audit trail. The lead is recreated if they comment again."
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate(lead.id, { onSuccess: () => (toast("Lead deleted"), onClose()), onError: (e) => toast(e.message, "error") })}
      />
    </div>
  );
}

export default function Leads() {
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [debounced, setDebounced] = useState(search);
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("-last_seen_at");
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Lead | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim().replace(/^@/, "")), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setOffset(0), [debounced, tag, sort, limit]);
  const leads = useLeads({ limit, offset, sort, search: debounced || undefined, tag: tag || undefined });
  const rows = leads.data?.items ?? [];

  function exportCsv() {
    const lines = [["username", "external_user_id", "comments", "tags", "first_seen", "last_seen"], ...rows.map((l) => [l.username ?? "", l.external_user_id, l.comment_count, `"${l.tags.join(" ")}"`, l.first_seen_at, l.last_seen_at])];
    const url = URL.createObjectURL(new Blob([lines.map((l) => l.join(",")).join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex w-full flex-col gap-space-lg">
      <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-end">
        <div>
          <div className="mb-space-xs flex items-center gap-space-sm">
            <h1 className="font-headline-md text-headline-md tracking-tight text-on-surface">Leads</h1>
            <span className="rounded-full bg-surface-container-high px-2.5 py-0.5 font-label-md text-label-md font-semibold text-on-surface-variant">{leads.data?.total ?? "…"} total</span>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant">People who commented on your campaigns. Only identifiers Instagram provides are stored.</p>
        </div>
        <Button variant="surface" icon="download" disabled={!rows.length} onClick={exportCsv}>
          Export CSV
        </Button>
      </div>

      <Card className="flex flex-col gap-space-md p-space-md md:flex-row md:items-center">
        <div className="relative flex-1">
          <Icon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[20px] text-outline" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search leads" placeholder="Search by username..." className="w-full rounded-lg bg-surface-container-low py-2 pl-11 pr-4 font-body-md text-body-md focus:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary-container" />
        </div>
        <div className="relative">
          <Icon name="sell" className="absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline" />
          <input value={tag} onChange={(e) => setTag(e.target.value.trim().toLowerCase())} aria-label="Filter by tag" placeholder="Filter by tag" className="w-44 rounded-lg bg-surface-container-low py-2 pl-9 pr-3 font-body-md text-body-md focus:outline-none focus:ring-2 focus:ring-primary-container" />
        </div>
        <SelectMenu label="Sort" value={sort} onChange={setSort} options={SORTS} />
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="bg-surface-container-low font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                <th className="px-space-md py-3">Lead</th>
                <th className="px-space-md py-3">Comments</th>
                <th className="px-space-md py-3">Tags</th>
                <th className="px-space-md py-3">First seen</th>
                <th className="px-space-md py-3">Last seen</th>
                <th className="px-space-sm py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container font-body-md text-body-md">
              {leads.isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-space-md py-3">
                      <Skeleton className="h-10" />
                    </td>
                  </tr>
                ))}
              {rows.map((l, i) => (
                <motion.tr key={l.id} custom={i} variants={rowIn} initial="hidden" animate="show" onClick={() => setOpen(l)} className="cursor-pointer transition-colors hover:bg-surface-container-low">
                  <td className="px-space-md py-3">
                    <div className="flex items-center gap-space-sm">
                      <Avatar name={l.username ?? l.external_user_id} />
                      <div className="flex flex-col">
                        <span className="font-title-sm text-title-sm text-on-surface">{l.username ? `@${l.username}` : "Unknown username"}</span>
                        <span className="font-mono text-[11px] text-outline">{l.external_user_id}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-space-md py-3 font-mono">{l.comment_count}</td>
                  <td className="px-space-md py-3">
                    <div className="flex flex-wrap gap-1">
                      {l.tags.length ? l.tags.map((t) => <span key={t} className="rounded-full bg-primary-fixed px-2 py-0.5 font-label-sm text-label-sm text-on-primary-fixed">{t}</span>) : <span className="text-outline">—</span>}
                    </div>
                  </td>
                  <td className="px-space-md py-3 font-body-sm text-body-sm text-on-surface-variant">{formatDate(l.first_seen_at)}</td>
                  <td className="px-space-md py-3 font-body-sm text-body-sm text-on-surface-variant">{timeAgo(l.last_seen_at)}</td>
                  <td className="px-space-sm py-3 text-right">
                    <Icon name="chevron_right" className="text-[20px] text-outline-variant" />
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          {!leads.isLoading && rows.length === 0 && <EmptyState icon="group" title={debounced || tag ? "No leads match" : "No leads yet"} body="Leads appear automatically when someone's comment matches a campaign." />}
        </div>
        <Pagination total={leads.data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} onLimitChange={setLimit} noun="leads" />
      </Card>

      <Drawer open={open !== null} onClose={() => setOpen(null)}>
        {open && <LeadDetail key={open.id} lead={open} onClose={() => setOpen(null)} />}
      </Drawer>
    </div>
  );
}
