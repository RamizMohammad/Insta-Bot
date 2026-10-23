// Campaign Simulator: sends a simulated comment through the real backend workflow
// (POST /dev/simulate-comment) and visualises each stage of the pipeline.
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useToast } from "@/components/overlays";
import { ExecutionStatusChip } from "@/components/status";
import { Button, Card, EmptyState, Icon, Segmented } from "@/components/ui";
import { useAllCampaigns, useConnections, useMedia, useSimulate } from "@/hooks/queries";
import { ApiError } from "@/lib/api";
import { shortId } from "@/lib/format";
import type { SimulateRequest, SimulateResponse, TriState } from "@/lib/types";

const newCommentId = () => `cmt_${Math.floor(1e13 + Math.random() * 9e13)}`;

type StepState = "passed" | "failed" | "warning" | "skipped" | "simulated";
interface Step {
  title: string;
  state: StepState;
  detail: React.ReactNode;
}

function buildSteps(req: SimulateRequest, res: SimulateResponse): Step[] {
  const outcome = res.result.campaigns?.[0];
  const matched = Boolean(outcome?.matched);
  const executions = res.executions;
  const eligibility = outcome?.eligibility;
  const steps: Step[] = [
    {
      title: "Event Received & Parsed",
      state: "passed",
      detail: (
        <>
          Received comment from <span className="font-mono font-medium text-on-surface">@{(req.username || "unknown").replace(/^@/, "")}</span> on media{" "}
          <span className="font-mono text-on-surface">#{req.media_id || "campaign target"}</span>
        </>
      ),
    },
    {
      title: "Duplicate Event Check",
      state: res.duplicate ? "warning" : "passed",
      detail: res.duplicate ? (
        <>This comment ID was already processed. No new actions were created (idempotency enforced by the database).</>
      ) : (
        <>
          Event <span className="font-mono text-on-surface">#{shortId(res.event_id)}</span> stored once. Passed idempotency check.
        </>
      ),
    },
    {
      title: "Trigger Rules Evaluated",
      state: res.duplicate ? "skipped" : matched ? "passed" : "failed",
      detail: outcome?.reason ?? res.result.reason ?? "Not evaluated",
    },
  ];
  if (!res.duplicate && matched) {
    steps.push({
      title: "Eligibility & Limits",
      state: eligibility?.decision === "proceed" ? "passed" : "warning",
      detail: eligibility ? (
        <>
          Follower status: <span className="font-medium capitalize text-on-surface">{eligibility.observed}</span> ({eligibility.reason}). Decision:{" "}
          <span className="font-semibold capitalize text-on-surface">{eligibility.decision.replace("_", " ")}</span>
        </>
      ) : (
        "No follower condition"
      ),
    });
    steps.push({
      title: "Execution Record Created",
      state: executions.length ? "passed" : "skipped",
      detail: executions.length ? (
        <>
          {executions.map((e, i) => (
            <span key={e.id}>
              {i > 0 && ", "}
              <Link to={`/executions?open=${e.id}`} className="font-mono font-medium text-primary hover:underline">
                #EXEC-{shortId(e.id)}
              </Link>
            </span>
          ))}{" "}
          persisted
        </>
      ) : (
        "No action configured"
      ),
    });
    const simulated = executions.filter((e) => e.status === "simulated").length;
    steps.push({
      title: "Actions Simulated",
      state: simulated === executions.length && executions.length > 0 ? "simulated" : simulated ? "warning" : executions.length ? "failed" : "skipped",
      detail: executions.length ? (
        <span className="flex flex-wrap items-center gap-1.5">
          {executions.map((e) => (
            <ExecutionStatusChip key={e.id} status={e.status} />
          ))}
        </span>
      ) : (
        "Nothing to send"
      ),
    });
  }
  return steps;
}

const STEP_STYLE: Record<StepState, { cls: string; icon: string; label: string }> = {
  passed: { cls: "bg-emerald-100 text-emerald-700", icon: "check", label: "passed" },
  simulated: { cls: "bg-secondary-container text-primary", icon: "science", label: "simulated" },
  warning: { cls: "bg-amber-100 text-amber-800", icon: "priority_high", label: "attention" },
  failed: { cls: "bg-error-container text-error", icon: "close", label: "stopped" },
  skipped: { cls: "bg-surface-container-high text-outline", icon: "remove", label: "skipped" },
};

export default function Simulator() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const campaigns = useAllCampaigns();
  const connections = useConnections();
  const simulate = useSimulate();
  const list = useMemo(() => campaigns.data?.items ?? [], [campaigns.data]);

  const [campaignId, setCampaignId] = useState(params.get("campaign") ?? "");
  const [commentId, setCommentId] = useState(newCommentId);
  const [username, setUsername] = useState("@design_enthusiast");
  const [text, setText] = useState("I would love the free PDF template! Can you send link?");
  const [follower, setFollower] = useState<TriState>("unknown");
  const [duplicate, setDuplicate] = useState(false);
  const [rateLimit, setRateLimit] = useState(false);
  const [timeout, setTimeoutFault] = useState(false);
  const [run, setRun] = useState<{ req: SimulateRequest; res: SimulateResponse; ms: number; at: Date } | null>(null);
  const [showDup, setShowDup] = useState(false);
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    if (!campaignId && list.length) setCampaignId((list.find((c) => c.status === "active") ?? list[0]).id);
  }, [campaignId, list]);

  const campaign = list.find((c) => c.id === campaignId);
  const media = useMedia(campaign?.connection_id ?? undefined);
  const mediaItem = media.data?.find((m) => m.id === campaign?.media_id);
  const keywords = campaign?.rules.filter((r) => r.action === "include").map((r) => r.keyword) ?? [];
  const account = connections.data?.find((c) => c.id === campaign?.connection_id);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!campaign) return;
    const req: SimulateRequest = {
      campaign_id: campaign.id,
      comment_id: commentId,
      media_id: campaign.media_external_id,
      username: username.replace(/^@/, "") || null,
      comment_text: text,
      follower_status: follower,
      fault: rateLimit ? "rate_limited" : timeout ? "ambiguous" : "none",
    };
    const started = performance.now();
    try {
      let res = await simulate.mutateAsync(req);
      if (duplicate) res = await simulate.mutateAsync({ ...req, fault: "none" });
      setRun({ req, res, ms: performance.now() - started, at: new Date() });
      if (!duplicate) setCommentId(newCommentId());
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Simulation failed", "error");
    }
  }

  function preset() {
    const kw = keywords[0]?.split(",")[0]?.trim() || "PDF";
    setUsername("@notion_architect");
    setText(`Could you share the ${kw} link? Been looking for this!`);
    setCommentId(newCommentId());
  }

  function reset() {
    setUsername("@design_enthusiast");
    setText("I would love the free PDF template! Can you send link?");
    setFollower("unknown");
    setDuplicate(false);
    setRateLimit(false);
    setTimeoutFault(false);
    setCommentId(newCommentId());
    setRun(null);
  }

  const steps = useMemo(() => (run ? buildSteps(run.req, run.res) : []), [run]);
  const passed = steps.filter((s) => s.state === "passed" || s.state === "simulated").length;
  const fieldCls =
    "w-full rounded-lg bg-surface-container-low px-space-md py-2 font-body-md text-body-md text-on-surface transition-all hover:bg-surface-container focus:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary-container";

  return (
    <div className="flex w-full flex-col gap-space-lg">
      <div className="flex flex-col justify-between gap-space-md rounded-xl bg-surface-container-low p-space-lg shadow-sm md:flex-row md:items-center">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-space-sm">
            <h1 className="font-headline-sm text-headline-sm tracking-tight text-on-surface">Campaign Simulator</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container px-space-sm py-0.5 font-label-sm text-label-sm font-semibold tracking-wide text-on-secondary-container">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Developer Tool - Zero External API Calls
            </span>
          </div>
          <p className="max-w-3xl font-body-md text-body-md text-on-surface-variant">
            End-to-end sandbox to simulate incoming Instagram comment events and preview rule evaluation without touching the live API.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-space-sm">
          <span className="rounded-lg bg-surface-container px-space-sm py-1 font-mono font-label-sm text-label-sm text-outline">POST /dev/simulate-comment</span>
          <Button variant="surface" icon="replay" className="text-primary" onClick={preset}>
            Preset Payload
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-space-lg lg:grid-cols-12">
        <div className="flex flex-col gap-space-md lg:col-span-5">
          <Card className="flex flex-col gap-space-md p-space-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs">
                <Icon name="science" className="text-[20px] text-primary" />
                <h2 className="font-title-md text-title-md text-on-surface">Simulate Incoming Comment</h2>
              </div>
              <span className="rounded bg-surface-container-high px-2 py-0.5 font-mono font-label-sm text-label-sm text-on-surface-variant">comment event</span>
            </div>
            {list.length === 0 && !campaigns.isLoading ? (
              <EmptyState icon="campaign" title="No campaigns yet" body="Create a campaign first, then simulate comments against it." action={<Button icon="add" onClick={() => navigate("/campaigns/new")}>New Campaign</Button>} />
            ) : (
              <form onSubmit={onSubmit} className="flex flex-col gap-space-md">
                <label className="flex flex-col gap-1.5">
                  <span className="flex items-center justify-between font-label-md text-label-md text-on-surface-variant">
                    <span>Target Campaign</span>
                    <span className="font-medium text-primary">{list.filter((c) => c.status === "active").length} active</span>
                  </span>
                  <div className="relative">
                    <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className={clsx(fieldCls, "appearance-none py-2.5")}>
                      {list.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.status}, {c.mode === "live" ? "Live" : "Simulation"})
                        </option>
                      ))}
                    </select>
                    <Icon name="expand_more" className="pointer-events-none absolute right-3 top-3 text-[20px] text-outline" />
                  </div>
                </label>

                <div className="flex flex-col gap-1.5">
                  <span className="font-label-md text-label-md text-on-surface-variant">Media Object &amp; Thumbnail</span>
                  <div className="flex items-center gap-space-sm rounded-lg bg-surface-container-low p-space-sm">
                    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container-high text-secondary">
                      <Icon name={(mediaItem?.media_type ?? "").includes("REEL") ? "movie" : "image"} className="text-[24px]" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">Media ID</span>
                      <span className="truncate font-mono font-body-md text-body-md text-on-surface">{campaign?.media_external_id ?? "—"}</span>
                      <span className="truncate font-label-sm text-label-sm text-outline">
                        {mediaItem?.caption ?? (campaign?.media_external_id ? "Custom media ID" : "Campaign has no target media")}
                        {account && ` · @${account.username ?? account.instagram_account_id}`}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="flex items-center justify-between font-label-md text-label-md text-on-surface-variant">
                      Comment ID
                      <button type="button" aria-label="New comment ID" onClick={() => setCommentId(newCommentId())} className="text-outline hover:text-primary">
                        <Icon name="refresh" className="text-[16px]" />
                      </button>
                    </span>
                    <input value={commentId} onChange={(e) => setCommentId(e.target.value)} className={clsx(fieldCls, "font-mono")} required />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="font-label-md text-label-md text-on-surface-variant">Username</span>
                    <input value={username} onChange={(e) => setUsername(e.target.value)} className={clsx(fieldCls, "font-mono")} />
                  </label>
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="flex items-center justify-between">
                    <span className="font-label-md text-label-md text-on-surface-variant">Comment Text</span>
                    <span className="max-w-[60%] truncate font-label-sm text-label-sm text-outline">
                      Trigger Keywords: {keywords.length ? keywords.map((k) => `"${k}"`).join(", ") : "none"}
                    </span>
                  </span>
                  <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={clsx(fieldCls, "resize-none p-space-md")} />
                </label>

                <div className="flex flex-col gap-1.5">
                  <span className="font-label-md text-label-md text-on-surface-variant">Follower Verification Status</span>
                  <Segmented
                    id="follower"
                    className="grid w-full grid-cols-3 bg-surface-container-low p-1"
                    value={follower}
                    onChange={setFollower}
                    options={[
                      { value: "true", label: "True" },
                      { value: "false", label: "False" },
                      { value: "unknown", label: "Unknown" },
                    ]}
                  />
                </div>

                <div className="flex flex-col gap-2 rounded-lg bg-surface-container-low p-space-sm">
                  <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">Fault Injection &amp; Edge Cases</span>
                  {[
                    { checked: duplicate, set: setDuplicate, label: "Simulate duplicate event webhook" },
                    { checked: rateLimit, set: (v: boolean) => (setRateLimit(v), v && setTimeoutFault(false)), label: "Mock Instagram DM rate limit error (429)" },
                    { checked: timeout, set: (v: boolean) => (setTimeoutFault(v), v && setRateLimit(false)), label: "Mock send timeout (outcome unknown)" },
                  ].map((o) => (
                    <label key={o.label} className="flex cursor-pointer select-none items-center gap-space-sm">
                      <input type="checkbox" className="h-4 w-4 rounded accent-primary" checked={o.checked} onChange={(e) => o.set(e.target.checked)} />
                      <span className="font-body-sm text-body-sm text-on-surface">{o.label}</span>
                    </label>
                  ))}
                </div>

                <div className="flex items-center gap-space-sm pt-space-xs">
                  <Button type="submit" variant="primaryContainer" size="lg" className="flex-1" loading={simulate.isPending} disabled={!campaign}>
                    {!simulate.isPending && <Icon name="play_arrow" filled className="text-[18px]" />}
                    <span>{simulate.isPending ? "Simulating..." : "Run Simulation"}</span>
                  </Button>
                  <Button variant="ghost" size="lg" onClick={reset}>
                    Reset
                  </Button>
                </div>
              </form>
            )}
          </Card>
          <Card className="flex items-center justify-between p-space-md">
            <div className="flex items-center gap-space-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
                <Icon name="bolt" className="text-[18px]" />
              </div>
              <div className="flex flex-col">
                <span className="font-label-md text-label-md font-semibold text-on-surface">Dry-Run Engine</span>
                <span className="font-label-sm text-label-sm text-outline">Same rule engine, dedupe and workflow as live webhooks</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 font-label-sm text-label-sm font-medium text-emerald-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Mock adapter
            </span>
          </Card>
        </div>

        <div className="flex flex-col gap-space-md lg:col-span-7">
          {!run && (
            <Card className="p-space-md">
              <EmptyState
                icon="account_tree"
                title="Run a simulation to see the pipeline"
                body="Each stage (dedupe, rules, eligibility, execution) appears here with the exact outcome from the backend."
              />
            </Card>
          )}
          <AnimatePresence mode="wait">
            {run && (
              <motion.div key={run.at.getTime()} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-space-md">
                <motion.div
                  initial={{ boxShadow: "0 0 0 2px rgba(63,81,181,0.6)" }}
                  animate={{ boxShadow: "0 0 0 0px rgba(63,81,181,0)" }}
                  transition={{ duration: 0.8 }}
                  className="flex items-center justify-between rounded-xl bg-surface-container-low px-space-lg py-3 shadow-sm"
                >
                  <div className="flex items-center gap-space-sm">
                    <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
                    <span className="font-label-md text-label-md font-medium text-on-surface">
                      Simulation executed in <span className="font-semibold text-primary">{Math.round(run.ms)}ms</span> • Mode: Isolated Sandbox
                    </span>
                  </div>
                  <span className="rounded bg-surface-container-high px-2 py-0.5 font-mono font-label-sm text-label-sm text-on-surface-variant">ID: #SIM-{shortId(run.res.event_id)}</span>
                </motion.div>

                <Card className="flex flex-col p-space-md">
                  <div className="flex items-start justify-between gap-space-sm">
                    <div className="flex items-start gap-space-sm">
                      <div className={clsx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", run.res.duplicate ? "bg-amber-100 text-amber-800" : "bg-surface-container text-on-surface-variant")}>
                        <Icon name={run.res.duplicate ? "content_copy" : "verified_user"} className="text-[16px]" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-label-md text-label-md font-semibold text-on-surface">
                          Duplicate event check: {run.res.duplicate ? "Duplicate detected, no new actions" : "No prior execution found"}
                        </span>
                        <span className="font-mono font-body-sm text-body-sm text-outline">Comment ID: {run.req.comment_id}</span>
                      </div>
                    </div>
                    <button type="button" aria-label="Toggle details" onClick={() => setShowDup((v) => !v)} className="rounded-lg p-1 text-primary hover:text-primary-container">
                      <Icon name="expand_more" className={clsx("text-[20px] transition-transform", showDup && "rotate-180")} />
                    </button>
                  </div>
                  <AnimatePresence>
                    {showDup && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="mt-space-sm flex flex-col gap-1 rounded-xl bg-surface-container-low p-space-md font-mono font-body-sm text-body-sm text-on-surface-variant">
                          <div>
                            Dedupe key: <span className="text-on-surface">simulation:&lt;workspace&gt;:{run.req.comment_id}</span>
                          </div>
                          <div>
                            Event ID: <span className="text-on-surface">{run.res.event_id}</span>
                          </div>
                          <div>
                            Guarantee: <span className="font-semibold text-emerald-600">unique constraint + ON CONFLICT DO NOTHING</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>

                <Card className="flex flex-col gap-space-md p-space-lg">
                  <div className="flex items-center justify-between pb-2">
                    <div className="flex items-center gap-space-xs">
                      <Icon name="account_tree" className="text-[20px] text-primary" />
                      <h3 className="font-title-md text-title-md text-on-surface">Execution Pipeline</h3>
                    </div>
                    <span className="font-label-sm text-label-sm text-outline">
                      {passed} of {steps.length} stages passed
                    </span>
                  </div>
                  <div className="relative flex flex-col gap-space-md pl-6">
                    <motion.div
                      className="absolute bottom-3 left-2.5 top-3 w-0.5 origin-top bg-surface-container-high"
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.6 }}
                    />
                    {steps.map((s, i) => {
                      const style = STEP_STYLE[s.state];
                      return (
                        <motion.div
                          key={s.title}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1 + i * 0.12 }}
                          className="relative flex items-start gap-space-md"
                        >
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.15 + i * 0.12, type: "spring", stiffness: 500, damping: 22 }}
                            className={clsx("absolute -left-6 top-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-surface-container-lowest", style.cls)}
                          >
                            <Icon name={style.icon} className="text-[14px]" />
                          </motion.div>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-center justify-between">
                              <span className="font-label-md text-label-md font-semibold text-on-surface">
                                Step {i + 1}: {s.title}
                              </span>
                              <span className="font-mono font-label-sm text-label-sm text-outline">{style.label}</span>
                            </div>
                            <div className="font-body-sm text-body-sm text-on-surface-variant">{s.detail}</div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </Card>

                {run.res.executions.length > 0 && (
                  <div className="flex flex-col gap-space-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-title-sm text-title-sm text-on-surface">Simulated Output Preview</span>
                      <span className="font-label-sm text-label-sm text-outline">Simulated client views</span>
                    </div>
                    <div className="grid grid-cols-1 gap-space-md md:grid-cols-2">
                      {run.res.executions.map((e, i) => (
                        <motion.div
                          key={e.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.6 + i * 0.1 }}
                          className="flex flex-col justify-between gap-space-sm rounded-xl bg-surface-container-lowest p-space-md shadow-sm"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <span className="inline-flex items-center gap-1 font-label-md text-label-md font-semibold text-primary">
                              <Icon name={e.action_type === "public_reply" ? "reply" : "send"} className="text-[16px]" />
                              Action: {e.action_type === "public_reply" ? "Public Reply" : "Private DM"}
                            </span>
                            {e.status === "simulated" ? (
                              <span className="rounded-full bg-secondary-container px-2 py-0.5 font-label-sm text-label-sm text-on-secondary-container">Simulated, not sent</span>
                            ) : (
                              <ExecutionStatusChip status={e.status} />
                            )}
                          </div>
                          {e.action_type === "public_reply" ? (
                            <div className="flex flex-col gap-1.5 rounded-lg bg-surface-container-low p-space-sm">
                              <div className="flex items-center gap-space-xs">
                                <span className="font-label-sm text-label-sm font-semibold text-on-surface">@{account?.username ?? "your_account"}</span>
                                <span className="font-label-sm text-label-sm text-outline">• Public comment reply</span>
                              </div>
                              <p className="font-body-sm text-body-sm text-on-surface">{e.rendered_message ?? e.error_detail ?? "No message rendered"}</p>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5 rounded-lg bg-primary-container p-space-sm text-on-primary">
                              <div className="flex items-center justify-between font-label-sm text-label-sm text-on-primary-container">
                                <span>Direct Message to @{run.req.username ?? "commenter"}</span>
                                <Icon name="lock" className="text-[14px]" />
                              </div>
                              <p className="font-body-sm text-body-sm text-on-primary">{e.rendered_message ?? e.error_detail ?? "No message rendered"}</p>
                            </div>
                          )}
                          <div className="flex items-center justify-between font-label-sm text-label-sm text-outline">
                            <span>Attempts: {e.attempt_count}</span>
                            <span className="truncate">{e.external_response_id ?? e.error_category ?? e.error_detail ?? ""}</span>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}

                <Card className="overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowJson((v) => !v)}
                    className="flex w-full items-center justify-between bg-surface-container-low px-space-lg py-3 text-left transition-colors hover:bg-surface-container"
                  >
                    <div className="flex items-center gap-space-sm">
                      <Icon name="code" className="text-[20px] text-outline" />
                      <span className="font-title-sm text-title-sm text-on-surface">JSON Payload Inspector &amp; Response</span>
                    </div>
                    <div className="flex items-center gap-space-sm">
                      <span className="rounded bg-surface-container px-2 py-0.5 font-mono font-label-sm text-label-sm text-on-surface-variant">200 OK Response</span>
                      <Icon name="expand_more" className={clsx("text-[20px] text-outline transition-transform", showJson && "rotate-180")} />
                    </div>
                  </button>
                  <AnimatePresence>
                    {showJson && (
                      <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                        <pre className="max-h-[420px] overflow-auto bg-inverse-surface p-space-md font-mono text-body-sm leading-relaxed text-secondary-fixed">
                          {JSON.stringify({ request: run.req, response: run.res }, null, 2)}
                        </pre>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
