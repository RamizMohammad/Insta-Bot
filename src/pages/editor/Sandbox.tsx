// "Live Rule Sandbox": evaluates the unsaved draft against a test comment as you type.
// Uses the backend rule engine (/workflows/evaluate) and template preview; nothing is sent.
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { Icon } from "@/components/ui";
import { api } from "@/lib/api";
import type { RuleEvaluation, Template, TemplatePreview, TriState } from "@/lib/types";

import { MATCH_LABELS, toRules, type Draft } from "./model";

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Sandbox({ draft, templates }: { draft: Draft; templates: Template[] }) {
  const firstKeyword = toRules(draft).find((r) => r.action === "include")?.keyword.split(",")[0]?.trim() || "guide";
  const firstExclusion = toRules(draft).find((r) => r.action === "exclude")?.keyword.split(",")[0]?.trim() || "scam";
  const [comment, setComment] = useState(`Hey! Can you send me the free ${firstKeyword} please? 🙌`);
  const [handle, setHandle] = useState("@sarah_creative");
  const [relationship, setRelationship] = useState<TriState>("unknown");

  const body = useDebounced(
    JSON.stringify({
      comment_text: comment,
      rules: toRules(draft).map(({ group_key, ...rule }) => ({ ...rule, group: group_key })),
      group_logic: draft.config.group_logic,
      follower_status: relationship,
      follower_requirement: draft.config.follower_requirement,
      unknown_follower_fallback: draft.config.unknown_follower_fallback,
    }),
  );

  const evaluation = useQuery({
    queryKey: ["sandbox-eval", body],
    queryFn: async () => {
      const started = performance.now();
      const result = await api<RuleEvaluation>("/workflows/evaluate", { method: "POST", body: JSON.parse(body) });
      return { result, ms: performance.now() - started };
    },
    placeholderData: (prev) => prev,
  });

  const result = evaluation.data?.result;
  const decision = result?.eligibility?.decision;
  const willRun = Boolean(result?.matched && decision === "proceed");
  const enabled = draft.config.actions.filter((a) => a.enabled);
  const username = handle.replace(/^@/, "");

  const previews = useQuery({
    queryKey: ["sandbox-preview", enabled.map((a) => a.template_id).join(), username, comment, JSON.stringify(draft.config.variables), draft.name],
    enabled: willRun && enabled.length > 0,
    queryFn: async () =>
      Promise.all(
        enabled.map(async (a) => {
          try {
            const p = await api<TemplatePreview>(`/templates/${a.template_id}/preview`, {
              method: "POST",
              body: { variables: { ...draft.config.variables, username, comment_text: comment, campaign_name: draft.name } },
            });
            return { type: a.type, text: p.rendered, error: null as string | null };
          } catch (e) {
            return { type: a.type, text: null, error: e instanceof Error ? e.message : "Preview failed" };
          }
        }),
      ),
  });

  const includeResults = result?.results.filter((r) => r.action === "include") ?? [];
  const tName = (type: string) => templates.find((t) => enabled.find((a) => a.type === type)?.template_id === t.id)?.name;

  return (
    <div className="flex flex-col gap-space-md rounded-2xl bg-surface-container-lowest p-space-lg shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex flex-col">
          <div className="mb-1 flex items-center gap-space-xs text-primary">
            <Icon name="science" className="text-[20px]" />
            <h3 className="font-title-md text-title-md text-on-surface">Live Rule Sandbox</h3>
          </div>
          <p className="font-body-sm text-body-sm text-secondary">Simulate comment arrival to test logic in real time</p>
        </div>
        <span className="rounded bg-surface-container-high px-space-xs py-0.5 font-label-sm text-label-sm text-secondary">Dry Run</span>
      </div>
      <div className="flex items-center gap-1.5 rounded bg-secondary-container/50 px-space-sm py-1 font-label-sm text-label-sm text-on-secondary-container">
        <Icon name="verified_user" className="text-[16px] text-primary" />
        <span>Safe environment. No Instagram API calls fired.</span>
      </div>

      <div className="flex flex-col gap-space-sm pt-space-xs">
        <label className="flex flex-col gap-1">
          <span className="font-label-sm text-label-sm font-medium text-on-surface-variant">Test Comment Payload</span>
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full rounded-lg bg-surface-container-low p-space-sm font-body-sm text-body-sm text-on-surface shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        <div className="grid grid-cols-2 gap-space-xs">
          <label className="flex flex-col gap-1">
            <span className="font-label-sm text-label-sm font-medium text-on-surface-variant">Handle</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className="w-full rounded-lg bg-surface-container-low px-space-sm py-1.5 font-body-sm text-body-sm text-on-surface shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label-sm text-label-sm font-medium text-on-surface-variant">Relationship</span>
            <select
              value={relationship}
              onChange={(e) => setRelationship(e.target.value as TriState)}
              className="w-full cursor-pointer rounded-lg bg-surface-container-low px-space-xs py-1.5 font-body-sm text-body-sm text-on-surface shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="true">Follower</option>
              <option value="false">Non-follower</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-space-sm rounded-xl bg-surface-container-low p-space-md shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <motion.span
              key={String(result?.matched)}
              initial={{ scale: 0.4 }}
              animate={{ scale: 1 }}
              className={clsx("h-2.5 w-2.5 rounded-full", !result ? "bg-outline-variant" : result.matched ? "bg-emerald-500" : "bg-error")}
            />
            <span className="font-title-sm text-title-sm font-bold text-on-surface">
              Trigger Match: {!result ? "…" : result.matched ? "SUCCESS" : "NO MATCH"}
            </span>
          </div>
          <span className="rounded bg-surface-container-lowest px-space-xs py-0.5 font-mono font-label-sm text-label-sm font-semibold text-primary">
            {evaluation.data ? `${evaluation.data.ms.toFixed(0)}ms eval` : "—"}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 pt-space-xs font-body-sm text-body-sm">
          <AnimatePresence initial={false}>
            {includeResults.map((r, i) => (
              <motion.div
                key={`${r.keyword}-${i}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-between gap-space-sm text-secondary"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Icon name={r.matched ? "check_circle" : "cancel"} className={clsx("text-[16px]", r.matched ? "text-emerald-600" : "text-outline")} />
                  <span className={clsx("truncate", !r.matched && "text-outline line-through")}>
                    {MATCH_LABELS[r.match_type as keyof typeof MATCH_LABELS]} <strong className={r.matched ? "text-on-surface" : undefined}>"{r.keyword}"</strong>
                  </span>
                </span>
                <span className={clsx("shrink-0 font-mono font-label-sm text-label-sm", r.matched ? "text-secondary" : "text-outline")}>
                  {r.matched ? `group ${r.group.replace("g", "")}` : "not found"}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {result && (
            <>
              <div className="flex items-center justify-between pt-1 text-secondary">
                <span className="flex items-center gap-1.5">
                  <Icon name={result.excluded_by.length ? "gpp_bad" : "verified"} className={clsx("text-[16px]", result.excluded_by.length ? "text-error" : "text-emerald-600")} />
                  <span>Exclusion filter check</span>
                </span>
                <span
                  className={clsx(
                    "rounded px-1.5 py-0.5 font-label-sm text-label-sm",
                    result.excluded_by.length ? "bg-error-container text-on-error-container" : "bg-surface-container-high text-secondary",
                  )}
                >
                  {result.excluded_by.length ? `Blocked by "${result.excluded_by[0].keyword}"` : "Passed (Clean)"}
                </span>
              </div>
              {result.matched && result.eligibility && (
                <div className="flex items-center justify-between text-secondary">
                  <span className="flex items-center gap-1.5">
                    <Icon
                      name={decision === "proceed" ? "how_to_reg" : decision === "manual_review" ? "visibility" : "block"}
                      className={clsx("text-[16px]", decision === "proceed" ? "text-emerald-600" : "text-amber-600")}
                    />
                    <span>Follower condition</span>
                  </span>
                  <span className="rounded bg-surface-container-high px-1.5 py-0.5 font-label-sm text-label-sm capitalize text-secondary">
                    {decision?.replace("_", " ")}
                  </span>
                </div>
              )}
              {!result.matched && <p className="pt-1 font-label-sm text-label-sm text-outline">{result.reason}</p>}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-space-xs">
        <div className="flex items-center justify-between">
          <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-secondary">Resulting Action Pipeline</span>
          <span className="font-label-sm text-label-sm font-medium text-primary">
            {willRun ? `${enabled.length} action${enabled.length === 1 ? "" : "s"} scheduled` : "nothing scheduled"}
          </span>
        </div>
        <div className="flex flex-col gap-space-xs rounded-lg bg-surface-container-low p-space-sm">
          {!willRun && <span className="font-body-sm text-body-sm text-on-surface-variant">No reply would be sent for this comment.</span>}
          {willRun && enabled.length === 0 && <span className="font-body-sm text-body-sm text-on-surface-variant">Add a reply action in step 4.</span>}
          {willRun &&
            previews.data?.map((p) => (
              <motion.div key={p.type} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-space-sm">
                <Icon name={p.type === "private_reply" ? "chat_bubble" : "reply"} className={clsx("mt-0.5 text-[18px]", p.type === "private_reply" ? "text-primary" : "text-secondary")} />
                <div className="flex min-w-0 flex-col">
                  <span className="font-label-sm text-label-sm text-secondary">
                    {p.type === "private_reply" ? "Instant Direct Message" : "Public Comment Reply"} {tName(p.type) && `· ${tName(p.type)}`}
                  </span>
                  <div className={clsx("mt-0.5 rounded p-space-xs font-body-sm text-body-sm shadow-sm", p.error ? "bg-error-container text-on-error-container" : "bg-surface-container-lowest text-on-surface")}>
                    {p.error ?? `"${p.text}"`}
                  </div>
                </div>
              </motion.div>
            ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 pt-space-xs">
        <span className="font-label-sm text-label-sm font-medium text-secondary">Quick Test Scenarios</span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setComment(`${firstKeyword} please!`)} className="rounded-md bg-surface-container px-space-sm py-1 font-label-sm text-label-sm text-on-surface transition-colors hover:bg-surface-container-high">
            "{firstKeyword} please!"
          </button>
          <button type="button" onClick={() => setComment(`This is a ${firstExclusion} ${firstKeyword} link`)} className="rounded-md bg-surface-container px-space-sm py-1 font-label-sm text-label-sm text-error transition-colors hover:bg-surface-container-high">
            Negative: "{firstExclusion}"
          </button>
          <button type="button" onClick={() => setComment("Love the video content!")} className="rounded-md bg-surface-container px-space-sm py-1 font-label-sm text-label-sm text-on-surface-variant transition-colors hover:bg-surface-container-high">
            Neutral: "Love this"
          </button>
        </div>
      </div>
    </div>
  );
}
