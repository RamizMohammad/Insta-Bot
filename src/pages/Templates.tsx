import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";

import { fadeUp, staggerContainer } from "@/components/motion";
import { ConfirmDialog, Drawer, useToast } from "@/components/overlays";
import { Button, Card, EmptyState, Field, FilterChip, Icon, IconButton, Skeleton, inputClass } from "@/components/ui";
import { useDeleteTemplate, usePreviewTemplate, useSaveTemplate, useTemplateVersions, useTemplates } from "@/hooks/queries";
import { ApiError } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/format";
import type { Template, TemplateType } from "@/lib/types";

const SYSTEM = ["username", "comment_text", "campaign_name"];
const LIMIT: Record<TemplateType, number> = { public_reply: 2200, private_reply: 1000 };
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

function placeholders(body: string) {
  return [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/** Body text with {{variables}} rendered as chips. */
function Highlighted({ body }: { body: string }) {
  const parts = body.split(/(\{\{\s*[^{}]*?\s*\}\})/g);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((p, i) =>
        p.startsWith("{{") ? (
          <span key={i} className={clsx("rounded px-1 font-mono text-[12px]", SYSTEM.includes(p.slice(2, -2).trim()) ? "bg-secondary-container text-primary" : "bg-tertiary-fixed text-on-tertiary-fixed")}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

interface FormState {
  name: string;
  type: TemplateType;
  body: string;
  fallbacks: Record<string, string>;
}

function TemplateEditor({ template, onClose }: { template: Template | "new"; onClose: () => void }) {
  const isNew = template === "new";
  const save = useSaveTemplate();
  const preview = usePreviewTemplate();
  const versions = useTemplateVersions(isNew ? undefined : template.id);
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() =>
    isNew
      ? { name: "", type: "private_reply", body: "Hey {{username}}! Thanks for your interest.\nHere is your resource: {{resource_link}}", fallbacks: { username: "there" } }
      : { name: template.name, type: template.type, body: template.body, fallbacks: { ...template.fallbacks } },
  );
  const [samples, setSamples] = useState<Record<string, string>>({ username: "sarah_creative", comment_text: "Send me the guide!", campaign_name: "Summer Launch" });
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vars = placeholders(form.body);
  const custom = vars.filter((v) => !SYSTEM.includes(v));
  const rendered = form.body.replace(PLACEHOLDER, (_, name: string) => samples[name] || form.fallbacks[name] || `{{${name}}}`).trim();
  const limit = LIMIT[form.type];

  async function submit() {
    setError(null);
    const fallbacks = Object.fromEntries(Object.entries(form.fallbacks).filter(([k, v]) => v.trim() && vars.includes(k)));
    const body = { name: form.name.trim(), body: form.body, custom_variables: custom, fallbacks, ...(isNew ? { type: form.type } : {}) };
    try {
      await save.mutateAsync({ id: isNew ? undefined : template.id, body });
      toast(isNew ? "Template created" : "New version saved");
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the template");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between bg-surface-container-low p-space-md">
        <div className="flex items-center gap-space-xs">
          <Icon name="chat_bubble_outline" className="text-[22px] text-primary" />
          <h2 className="font-title-md text-title-md font-bold text-on-surface">{isNew ? "New template" : `Edit ${template.name}`}</h2>
          {!isNew && <span className="rounded bg-surface-container-highest px-1.5 font-mono font-label-sm text-label-sm">v{template.version}</span>}
        </div>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </div>
      <div className="flex flex-1 flex-col gap-space-md overflow-y-auto p-space-md">
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Summer PDF DM" maxLength={120} />
        </Field>
        <Field label="Type" hint={isNew ? undefined : "Type can't change after creation"}>
          <div className="grid grid-cols-2 gap-space-xs">
            {(["private_reply", "public_reply"] as TemplateType[]).map((t) => (
              <button
                key={t}
                type="button"
                disabled={!isNew}
                onClick={() => setForm({ ...form, type: t })}
                className={clsx(
                  "flex items-center justify-center gap-1 rounded-lg py-2 font-label-lg text-label-lg transition-colors disabled:cursor-not-allowed",
                  form.type === t ? "bg-primary-fixed text-on-primary-fixed ring-2 ring-primary-container" : "bg-surface-container-low text-on-surface-variant",
                )}
              >
                <Icon name={t === "private_reply" ? "send" : "reply"} className="text-[16px]" />
                {t === "private_reply" ? "Private reply (DM)" : "Public reply"}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Message body" hint={<span className={rendered.length > limit ? "text-error" : undefined}>{rendered.length} / {limit}</span>}>
          <textarea className={clsx(inputClass, "min-h-[120px] resize-y")} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </Field>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 font-label-sm text-label-sm text-outline">Insert:</span>
          {SYSTEM.concat(custom.length ? [] : ["resource_link"]).map((v) => (
            <button key={v} type="button" onClick={() => setForm({ ...form, body: `${form.body}{{${v}}}` })} className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-[12px] text-primary hover:bg-secondary-container">
              {`{{${v}}}`}
            </button>
          ))}
        </div>
        {vars.length > 0 && (
          <div className="flex flex-col gap-space-xs rounded-xl bg-surface-container-low p-space-md">
            <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-outline">Variables</span>
            {vars.map((v) => (
              <div key={v} className="grid grid-cols-[110px_1fr_1fr] items-center gap-space-xs">
                <span className={clsx("truncate rounded px-1.5 py-0.5 font-mono text-[12px]", SYSTEM.includes(v) ? "bg-secondary-container text-primary" : "bg-tertiary-fixed text-on-tertiary-fixed")}>{v}</span>
                <input className={clsx(inputClass, "py-1.5 text-body-sm")} placeholder="Preview value" value={samples[v] ?? ""} onChange={(e) => setSamples({ ...samples, [v]: e.target.value })} />
                <input className={clsx(inputClass, "py-1.5 text-body-sm")} placeholder="Fallback (optional)" value={form.fallbacks[v] ?? ""} onChange={(e) => setForm({ ...form, fallbacks: { ...form.fallbacks, [v]: e.target.value } })} />
              </div>
            ))}
            {custom.length > 0 && <p className="font-body-sm text-body-sm text-on-surface-variant">Custom variables get their values from each campaign's settings, or the fallback if empty.</p>}
          </div>
        )}
        <div className="flex flex-col gap-space-xs">
          <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-outline">Preview</span>
          <div className={clsx("rounded-xl p-space-md font-body-md text-body-md", form.type === "private_reply" ? "bg-primary-container text-on-primary" : "bg-surface-container-low text-on-surface")}>
            {rendered || <span className="opacity-60">Nothing to preview</span>}
          </div>
          {!isNew && (
            <Button
              size="sm"
              variant="tonal"
              icon="verified"
              className="self-start"
              loading={preview.isPending}
              onClick={() =>
                preview.mutate(
                  { id: template.id, variables: samples },
                  { onSuccess: (p) => toast(`Server render OK (${p.length}/${p.max_length} chars)`), onError: (e) => toast(e.message, "error") },
                )
              }
            >
              Validate saved version on server
            </Button>
          )}
        </div>
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex items-start gap-space-xs rounded-lg bg-error-container px-space-sm py-2 font-body-sm text-body-sm text-on-error-container">
              <Icon name="error" className="text-[18px]" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>
        {!isNew && (
          <div className="flex flex-col gap-space-xs">
            <button type="button" onClick={() => setShowHistory((v) => !v)} className="flex items-center justify-between rounded-lg bg-surface-container-low px-space-md py-2 font-label-lg text-label-lg text-on-surface">
              <span className="flex items-center gap-space-xs">
                <Icon name="history" className="text-[18px]" /> Version history ({versions.data?.length ?? "…"})
              </span>
              <Icon name="expand_more" className={clsx("text-[20px] transition-transform", showHistory && "rotate-180")} />
            </button>
            <AnimatePresence>
              {showHistory && (
                <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="flex flex-col gap-space-xs overflow-hidden">
                  {versions.data?.map((v) => (
                    <li key={v.version} className="rounded-lg bg-surface-container-low p-space-sm">
                      <div className="mb-1 flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant">
                        <span className="font-semibold text-on-surface">v{v.version} · {v.name}</span>
                        <span>{timeAgo(v.created_at)}</span>
                      </div>
                      <div className="font-body-sm text-body-sm text-on-surface-variant">
                        <Highlighted body={v.body} />
                      </div>
                      {v.version !== template.version && (
                        <button type="button" onClick={() => setForm({ ...form, body: v.body, fallbacks: { ...v.fallbacks } })} className="mt-1 font-label-sm text-label-sm font-semibold text-primary hover:underline">
                          Restore this version
                        </button>
                      )}
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-space-sm bg-surface-container-low p-space-md">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button icon="save" loading={save.isPending} disabled={!form.name.trim() || !form.body.trim() || rendered.length > limit} onClick={submit}>
          {isNew ? "Create template" : "Save new version"}
        </Button>
      </div>
    </div>
  );
}

export default function Templates() {
  const [type, setType] = useState<TemplateType | "all">("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [confirm, setConfirm] = useState<Template | null>(null);
  const templates = useTemplates(type === "all" ? {} : { type });
  const remove = useDeleteTemplate();
  const toast = useToast();
  const items = useMemo(
    () => (templates.data?.items ?? []).filter((t) => !search || `${t.name} ${t.body}`.toLowerCase().includes(search.toLowerCase())),
    [templates.data, search],
  );

  return (
    <div className="flex w-full flex-col gap-space-lg">
      <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-end">
        <div>
          <div className="mb-space-xs flex items-center gap-space-sm">
            <h1 className="font-headline-md text-headline-md tracking-tight text-on-surface">Message Templates</h1>
            <span className="rounded-full bg-surface-container-high px-2.5 py-0.5 font-label-md text-label-md font-semibold text-on-surface-variant">{templates.data?.total ?? "…"} total</span>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant">Reusable replies with safe {"{{variable}}"} substitution. Every edit is kept as a new version.</p>
        </div>
        <Button variant="primaryContainer" icon="add" className="px-space-lg py-2.5" onClick={() => setEditing("new")}>
          New Template
        </Button>
      </div>

      <Card className="flex flex-col gap-space-md p-space-md md:flex-row md:items-center">
        <div className="relative flex-1">
          <Icon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[20px] text-outline" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search templates" placeholder="Search templates..." className="w-full rounded-lg bg-surface-container-low py-2 pl-11 pr-4 font-body-md text-body-md focus:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary-container" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 font-label-sm text-label-sm font-semibold uppercase text-outline">Type</span>
          <FilterChip active={type === "all"} onClick={() => setType("all")}>All</FilterChip>
          <FilterChip active={type === "private_reply"} onClick={() => setType("private_reply")}>Private DM</FilterChip>
          <FilterChip active={type === "public_reply"} onClick={() => setType("public_reply")}>Public Reply</FilterChip>
        </div>
      </Card>

      {templates.isLoading && (
        <div className="grid grid-cols-1 gap-space-md md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      )}
      {!templates.isLoading && items.length === 0 && (
        <Card>
          <EmptyState icon="chat_bubble_outline" title={search ? "No templates match" : "No templates yet"} body="Templates are the messages your campaigns send. Create one for DMs and one for public replies." action={<Button icon="add" onClick={() => setEditing("new")}>New Template</Button>} />
        </Card>
      )}
      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-space-md md:grid-cols-2 xl:grid-cols-3">
        {items.map((t) => (
          <motion.div key={t.id} variants={fadeUp} whileHover={{ y: -3 }} className="flex flex-col gap-space-sm rounded-xl bg-surface-container-lowest p-space-md shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between gap-space-sm">
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-title-sm text-title-sm text-on-surface">{t.name}</span>
                <span className="font-label-sm text-label-sm text-outline">
                  v{t.version} · updated {formatDate(t.updated_at)}
                </span>
              </div>
              <span className={clsx("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-label-sm text-label-sm font-semibold", t.type === "private_reply" ? "bg-primary-fixed text-on-primary-fixed" : "bg-surface-container-high text-on-surface-variant")}>
                <Icon name={t.type === "private_reply" ? "send" : "reply"} className="text-[13px]" />
                {t.type === "private_reply" ? "Private DM" : "Public Reply"}
              </span>
            </div>
            <div className="line-clamp-4 min-h-[80px] rounded-lg bg-surface-container-low p-space-sm font-body-sm text-body-sm text-on-surface">
              <Highlighted body={t.body} />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-on-surface-variant">{t.variables.length} variable{t.variables.length === 1 ? "" : "s"}</span>
              <div className="flex gap-1">
                <IconButton icon="edit" label="Edit" onClick={() => setEditing(t)} />
                <IconButton icon="delete" label="Delete" className="hover:text-error" onClick={() => setConfirm(t)} />
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      <Drawer open={editing !== null} onClose={() => setEditing(null)} width="w-full sm:w-[520px]">
        {editing && <TemplateEditor key={editing === "new" ? "new" : `${editing.id}-${editing.version}`} template={editing} onClose={() => setEditing(null)} />}
      </Drawer>
      <ConfirmDialog
        open={Boolean(confirm)}
        title="Delete template?"
        danger
        confirmLabel="Delete"
        loading={remove.isPending}
        body={<>Templates used by active or paused campaigns can't be deleted. Version history for <strong>{confirm?.name}</strong> is removed too.</>}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          confirm &&
          remove.mutate(confirm.id, {
            onSuccess: () => (toast("Template deleted"), setConfirm(null)),
            onError: (e) => (toast(e.message, "error"), setConfirm(null)),
          })
        }
      />
    </div>
  );
}
