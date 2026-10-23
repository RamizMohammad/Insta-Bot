// Basics, Conditions, Actions and Verification steps of the campaign editor.
import clsx from "clsx";
import { motion } from "motion/react";
import { Link } from "react-router-dom";

import { CountUp } from "@/components/motion";
import { ExecutionStatusChip } from "@/components/status";
import { Card, Field, Icon, inputClass } from "@/components/ui";
import { useCampaignAnalytics, useConnections, useMedia } from "@/hooks/queries";
import { formatDate } from "@/lib/format";
import type { ActionType, FallbackBehavior, FollowerRequirement, OperatingMode, Template } from "@/lib/types";

import { requiredVariables, type Draft, type Issue } from "./model";

type StepProps = { draft: Draft; setDraft: (d: Draft) => void; disabled: boolean };

function OptionCard({
  selected,
  onClick,
  icon,
  title,
  body,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  icon: string;
  title: string;
  body: string;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      className={clsx(
        "relative flex flex-1 items-start gap-space-sm rounded-xl p-space-md text-left transition-colors disabled:opacity-60",
        selected ? "bg-primary-fixed ring-2 ring-primary-container" : "bg-surface-container-low hover:bg-surface-container",
      )}
    >
      <div className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", selected ? "bg-primary-container text-on-primary" : "bg-surface-container-lowest text-primary")}>
        <Icon name={icon} className="text-[20px]" />
      </div>
      <div className="flex flex-col">
        <span className="font-title-sm text-title-sm text-on-surface">{title}</span>
        <span className="font-body-sm text-body-sm text-on-surface-variant">{body}</span>
      </div>
      {selected && <Icon name="check_circle" filled className="absolute right-3 top-3 text-[18px] text-primary" />}
    </motion.button>
  );
}

export function BasicsStep({ draft, setDraft, disabled }: StepProps) {
  const connections = useConnections();
  const media = useMedia(draft.connection_id ?? undefined);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-space-lg">
      <Card className="flex flex-col gap-space-md p-space-lg">
        <h2 className="font-title-md text-title-md text-on-surface">Campaign details</h2>
        <Field label="Campaign name">
          <input className={inputClass} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Summer Launch Reel - PDF Guide" maxLength={160} />
        </Field>
        <Field label="Description" hint="Shown in the campaigns list">
          <input className={inputClass} value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder='e.g. "Comment GUIDE for the free Notion guide"' />
        </Field>
      </Card>

      <Card className="flex flex-col gap-space-md p-space-lg">
        <h2 className="font-title-md text-title-md text-on-surface">Operating mode</h2>
        <div className="flex flex-col gap-space-sm md:flex-row">
          <OptionCard
            disabled={disabled}
            selected={draft.mode === "simulation"}
            onClick={() => set({ mode: "simulation" as OperatingMode })}
            icon="science"
            title="Simulation"
            body="Runs the full workflow with the mock adapter. Nothing is sent to Instagram."
          />
          <OptionCard
            disabled={disabled}
            selected={draft.mode === "live"}
            onClick={() => set({ mode: "live" as OperatingMode })}
            icon="sensors"
            title="Live"
            body="Replies on Instagram through the official Meta API. Needs a connected account."
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-space-md p-space-lg">
        <div className="flex items-center justify-between">
          <h2 className="font-title-md text-title-md text-on-surface">Target post or Reel</h2>
          <Link to="/accounts" className="font-label-md text-label-md text-primary hover:underline">
            Manage accounts
          </Link>
        </div>
        <Field label="Instagram account">
          <select
            disabled={disabled}
            className={inputClass}
            value={draft.connection_id ?? ""}
            onChange={(e) => set({ connection_id: e.target.value || null, media_id: null })}
          >
            <option value="">No account (simulation with a custom media ID)</option>
            {connections.data?.map((c) => (
              <option key={c.id} value={c.id} disabled={c.status !== "active"}>
                @{c.username ?? c.instagram_account_id} {c.auth_method === "mock" ? "(mock)" : ""} {c.status !== "active" ? `· ${c.status}` : ""}
              </option>
            ))}
          </select>
        </Field>
        {draft.connection_id ? (
          <div className="grid grid-cols-2 gap-space-sm md:grid-cols-3">
            {media.isLoading && <span className="font-body-sm text-body-sm text-on-surface-variant">Loading media…</span>}
            {media.data?.length === 0 && (
              <span className="col-span-full font-body-sm text-body-sm text-on-surface-variant">No synced media yet. Sync it from Instagram Accounts.</span>
            )}
            {media.data?.map((m) => {
              const selected = draft.media_id === m.id;
              const reel = (m.media_type ?? "").toUpperCase().includes("REEL") || m.media_type === "VIDEO";
              return (
                <motion.button
                  key={m.id}
                  type="button"
                  disabled={disabled}
                  whileHover={{ y: -2 }}
                  onClick={() => set({ media_id: m.id, media_external_id: m.external_media_id })}
                  className={clsx(
                    "flex flex-col gap-1 rounded-xl p-space-sm text-left transition-colors",
                    selected ? "bg-primary-fixed ring-2 ring-primary-container" : "bg-surface-container-low hover:bg-surface-container",
                  )}
                >
                  <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-surface-container-high text-secondary">
                    <Icon name={reel ? "movie" : "image"} className="text-[28px]" />
                  </div>
                  <span className="truncate font-label-md text-label-md text-on-surface">{m.caption || "Untitled post"}</span>
                  <span className="font-mono text-[11px] text-outline">
                    {reel ? "Reel" : "Post"} · {formatDate(m.published_at)}
                  </span>
                </motion.button>
              );
            })}
          </div>
        ) : (
          <Field label="Media ID" hint="Any ID you'll use in the Simulator">
            <input
              disabled={disabled}
              className={clsx(inputClass, "font-mono")}
              value={draft.media_external_id}
              onChange={(e) => set({ media_external_id: e.target.value, media_id: null })}
              placeholder="test-media-001"
            />
          </Field>
        )}
      </Card>
    </div>
  );
}

const FOLLOWER: { value: FollowerRequirement; icon: string; title: string; body: string }[] = [
  { value: "any", icon: "groups", title: "Anyone", body: "Reply to every matching comment." },
  { value: "followers_only", icon: "how_to_reg", title: "Followers only", body: "Only when the commenter follows you." },
  { value: "non_followers_only", icon: "person_add", title: "Non-followers only", body: "Only when they don't follow you yet." },
];

const FALLBACK: { value: FallbackBehavior; icon: string; title: string; body: string }[] = [
  { value: "skip", icon: "block", title: "Skip", body: "Don't reply. Safest default." },
  { value: "manual_review", icon: "visibility", title: "Send to manual review", body: "Queue it for a person to approve." },
  { value: "proceed", icon: "arrow_forward", title: "Proceed", body: "Reply as if the condition was met." },
];

export function ConditionsStep({ draft, setDraft, disabled }: StepProps) {
  const config = draft.config;
  const set = (patch: Partial<Draft["config"]>) => setDraft({ ...draft, config: { ...config, ...patch } });
  return (
    <div className="flex flex-col gap-space-lg">
      <Card className="flex flex-col gap-space-md p-space-lg">
        <div>
          <h2 className="font-title-md text-title-md text-on-surface">Who should get a reply?</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">Follower requirement checked after a comment matches your rules.</p>
        </div>
        <div className="flex flex-col gap-space-sm md:flex-row">
          {FOLLOWER.map((o) => (
            <OptionCard key={o.value} disabled={disabled} selected={config.follower_requirement === o.value} onClick={() => set({ follower_requirement: o.value })} icon={o.icon} title={o.title} body={o.body} />
          ))}
        </div>
      </Card>
      <Card className={clsx("flex flex-col gap-space-md p-space-lg transition-opacity", config.follower_requirement === "any" && "opacity-60")}>
        <div>
          <h2 className="font-title-md text-title-md text-on-surface">When follower status is unknown</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Instagram doesn't share whether a commenter follows you, so for live comments this is usually <strong>unknown</strong>. InstaFlow never guesses.
          </p>
        </div>
        <div className="flex flex-col gap-space-sm md:flex-row">
          {FALLBACK.map((o) => (
            <OptionCard
              key={o.value}
              disabled={disabled || config.follower_requirement === "any"}
              selected={config.unknown_follower_fallback === o.value}
              onClick={() => set({ unknown_follower_fallback: o.value })}
              icon={o.icon}
              title={o.title}
              body={o.body}
            />
          ))}
        </div>
      </Card>
      <Card className="flex flex-col gap-space-md p-space-lg">
        <h2 className="font-title-md text-title-md text-on-surface">Restrictions</h2>
        <label className="flex cursor-pointer items-center justify-between gap-space-md rounded-lg bg-surface-container-low p-space-md">
          <span className="flex flex-col">
            <span className="font-title-sm text-title-sm text-on-surface">Ignore replies to other comments</span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">Only top-level comments can trigger the automation.</span>
          </span>
          <input type="checkbox" disabled={disabled} className="h-5 w-5 accent-primary" checked={config.ignore_replies} onChange={(e) => set({ ignore_replies: e.target.checked })} />
        </label>
        <div className="flex flex-col justify-between gap-space-sm rounded-lg bg-surface-container-low p-space-md md:flex-row md:items-center">
          <span className="flex flex-col">
            <span className="font-title-sm text-title-sm text-on-surface">Max replies per person</span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">Stop replying to someone after this many rounds of actions. Empty means no limit.</span>
          </span>
          <input
            type="number"
            min={1}
            max={100}
            disabled={disabled}
            className={clsx(inputClass, "w-28")}
            value={config.max_actions_per_lead ?? ""}
            onChange={(e) => set({ max_actions_per_lead: e.target.value ? Math.max(1, Math.min(100, Number(e.target.value))) : null })}
            placeholder="No limit"
          />
        </div>
      </Card>
    </div>
  );
}

const ACTIONS: { type: ActionType; icon: string; title: string; body: string }[] = [
  { type: "private_reply", icon: "send", title: "Private DM", body: "One private reply per comment, within 7 days of the comment." },
  { type: "public_reply", icon: "reply", title: "Public Reply", body: "A reply posted under the comment, visible to everyone." },
];

export function ActionsStep({ draft, setDraft, disabled, templates }: StepProps & { templates: Template[] }) {
  const config = draft.config;
  const setAction = (type: ActionType, patch: { enabled?: boolean; template_id?: string }) => {
    const existing = config.actions.find((a) => a.type === type);
    const next = existing
      ? config.actions.map((a) => (a.type === type ? { ...a, ...patch } : a))
      : [...config.actions, { type, enabled: true, template_id: "", ...patch }];
    setDraft({ ...draft, config: { ...config, actions: next.filter((a) => a.template_id || a.enabled) } });
  };
  const vars = requiredVariables(draft, templates);
  return (
    <div className="flex flex-col gap-space-lg">
      {ACTIONS.map((a) => {
        const current = config.actions.find((x) => x.type === a.type);
        const enabled = Boolean(current?.enabled);
        const options = templates.filter((t) => t.type === a.type);
        const tpl = templates.find((t) => t.id === current?.template_id);
        return (
          <Card key={a.type} layout className={clsx("flex flex-col gap-space-md p-space-lg transition-all", !enabled && "opacity-80")}>
            <div className="flex items-start justify-between gap-space-md">
              <div className="flex items-start gap-space-sm">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-container text-primary">
                  <Icon name={a.icon} className="text-[20px]" />
                </div>
                <div>
                  <h2 className="font-title-md text-title-md text-on-surface">{a.title}</h2>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">{a.body}</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={`Enable ${a.title}`}
                disabled={disabled}
                onClick={() => setAction(a.type, { enabled: !enabled, template_id: current?.template_id ?? options[0]?.id ?? "" })}
                className={clsx("relative h-6 w-11 shrink-0 rounded-full transition-colors", enabled ? "bg-primary-container" : "bg-surface-container-highest")}
              >
                <motion.span layout className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow", enabled ? "right-0.5" : "left-0.5")} />
              </button>
            </div>
            {enabled && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="flex flex-col gap-space-sm">
                <Field label="Message template" hint={<Link to="/templates" className="text-primary hover:underline">Manage templates</Link>}>
                  <select disabled={disabled} className={inputClass} value={current?.template_id ?? ""} onChange={(e) => setAction(a.type, { template_id: e.target.value })}>
                    <option value="">Choose a template…</option>
                    {options.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (v{t.version})
                      </option>
                    ))}
                  </select>
                </Field>
                {options.length === 0 && (
                  <p className="font-body-sm text-body-sm text-amber-900">
                    No {a.title.toLowerCase()} templates yet. <Link to="/templates" className="font-semibold text-primary hover:underline">Create one</Link>.
                  </p>
                )}
                {tpl && <div className="whitespace-pre-wrap rounded-lg bg-surface-container-low p-space-sm font-body-sm text-body-sm text-on-surface-variant">{tpl.body}</div>}
              </motion.div>
            )}
          </Card>
        );
      })}
      <Card className="flex flex-col gap-space-md p-space-lg">
        <div>
          <h2 className="font-title-md text-title-md text-on-surface">Template variables</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Values for the custom variables your templates use. <code className="rounded bg-surface-container px-1">username</code>,{" "}
            <code className="rounded bg-surface-container px-1">comment_text</code> and <code className="rounded bg-surface-container px-1">campaign_name</code> are filled in automatically.
          </p>
        </div>
        {vars.length === 0 && <p className="font-body-sm text-body-sm text-outline">The selected templates don't need extra variables.</p>}
        {vars.map((v) => (
          <Field key={v} label={`{{${v}}}`}>
            <input
              disabled={disabled}
              className={inputClass}
              value={config.variables[v] ?? ""}
              placeholder="https://..."
              onChange={(e) => setDraft({ ...draft, config: { ...config, variables: { ...config.variables, [v]: e.target.value } } })}
            />
          </Field>
        ))}
      </Card>
    </div>
  );
}

export function VerifyStep({ campaignId, issues, onGoTo }: { campaignId?: string; issues: Issue[]; onGoTo: (step: number) => void }) {
  const analytics = useCampaignAnalytics(campaignId);
  const stats = analytics.data;
  const cells: { label: string; value: number; status?: Parameters<typeof ExecutionStatusChip>[0]["status"] }[] = stats
    ? [
        { label: "Total", value: stats.total_executions },
        { label: "Simulated", value: stats.simulated, status: "simulated" },
        { label: "Succeeded", value: stats.succeeded, status: "succeeded" },
        { label: "Failed", value: stats.failed, status: "failed" },
        { label: "Unknown", value: stats.unknown, status: "unknown" },
        { label: "Manual review", value: stats.manual_review, status: "manual_review" },
        { label: "Skipped", value: stats.skipped, status: "skipped" },
        { label: "Pending", value: stats.pending, status: "queued" },
      ]
    : [];
  return (
    <div className="flex flex-col gap-space-lg">
      <Card className="flex flex-col gap-space-md p-space-lg">
        <h2 className="font-title-md text-title-md text-on-surface">Pre-flight checklist</h2>
        {issues.length === 0 ? (
          <div className="flex items-center gap-space-sm rounded-lg bg-emerald-50 p-space-md text-emerald-800">
            <Icon name="task_alt" className="text-[22px]" />
            <span className="font-title-sm text-title-sm">Everything needed for activation is in place.</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-space-xs">
            {issues.map((issue, i) => (
              <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex items-center justify-between gap-space-sm rounded-lg bg-amber-50 px-space-md py-2 text-amber-900">
                <span className="flex items-center gap-space-xs font-body-md text-body-md">
                  <Icon name="error" className="text-[18px] text-amber-700" />
                  {issue.message}
                </span>
                <button type="button" onClick={() => onGoTo(issue.step)} className="shrink-0 font-label-md text-label-md font-semibold text-primary hover:underline">
                  Fix in step {issue.step + 1}
                </button>
              </motion.li>
            ))}
          </ul>
        )}
      </Card>
      {campaignId && (
        <Card className="flex flex-col gap-space-md p-space-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-title-md text-title-md text-on-surface">Campaign analytics</h2>
            <Link to={`/executions?campaign=${campaignId}`} className="inline-flex items-center gap-1 font-label-md text-label-md text-primary hover:underline">
              View executions <Icon name="arrow_forward" className="text-[16px]" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-space-sm md:grid-cols-4">
            {cells.map((c) => (
              <div key={c.label} className="flex flex-col gap-1 rounded-lg bg-surface-container-low p-space-sm">
                <span className="font-label-md text-label-md text-on-surface-variant">{c.label}</span>
                <span className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  <CountUp value={c.value} />
                </span>
              </div>
            ))}
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Simulated runs never reach Instagram. Unknown outcomes are never retried automatically; check Instagram and resolve them from Executions.
          </p>
          <Link to={`/simulator?campaign=${campaignId}`} className="inline-flex w-fit items-center gap-1 rounded-lg bg-surface-container px-space-md py-2 font-label-lg text-label-lg text-primary hover:bg-surface-container-high">
            <Icon name="science" className="text-[18px]" /> Run a simulated comment
          </Link>
        </Card>
      )}
    </div>
  );
}
