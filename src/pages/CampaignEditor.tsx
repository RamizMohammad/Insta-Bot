// Campaign editor: 5-step flow (Basics, Trigger Rules, Conditions, Actions, Verification) with a
// sticky live sandbox, matching the Stitch "Trigger Rules Engine" screen.
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ConfirmDialog, useToast } from "@/components/overlays";
import { CampaignStatusChip } from "@/components/status";
import { Button, Card, EmptyState, Icon, Skeleton } from "@/components/ui";
import {
  useCampaign,
  useCampaignTransition,
  useDeleteCampaign,
  useMedia,
  useSaveCampaign,
  useTemplates,
} from "@/hooks/queries";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Campaign } from "@/lib/types";

import { emptyDraft, fromCampaign, toInput, toRules, validate, type Draft } from "./editor/model";
import { RulesStep } from "./editor/RulesStep";
import { Sandbox } from "./editor/Sandbox";
import { ActionsStep, BasicsStep, ConditionsStep, VerifyStep } from "./editor/Steps";

const STEPS = ["Basics", "Trigger Rules", "Conditions", "Actions", "Verification"];
const TITLES = ["Campaign Basics", "Trigger Rules Engine", "Eligibility Conditions", "Reply Actions", "Verification & Launch"];

function TargetAsset({ draft, onChange }: { draft: Draft; onChange: () => void }) {
  const media = useMedia(draft.connection_id ?? undefined);
  const m = media.data?.find((x) => x.id === draft.media_id);
  const reel = (m?.media_type ?? "").toUpperCase().includes("REEL") || m?.media_type === "VIDEO";
  return (
    <Card className="flex items-center justify-between gap-space-md p-space-md">
      <div className="flex min-w-0 items-center gap-space-md">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-secondary shadow-sm">
          <Icon name={m ? (reel ? "movie" : "image") : "photo_library"} className="text-[28px]" />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">Target Asset</span>
          <span className="truncate font-title-sm text-title-sm text-on-surface">
            {m ? `${reel ? "Reel" : "Post"}: "${m.caption || m.external_media_id}"` : draft.media_external_id ? `Media ID ${draft.media_external_id}` : "No post selected"}
          </span>
          <span className="font-body-sm text-body-sm text-secondary">
            {m ? `Posted ${formatDate(m.published_at)} · ${m.external_media_id}` : "Pick the post or Reel this campaign watches in step 1."}
          </span>
        </div>
      </div>
      <button type="button" onClick={onChange} className="shrink-0 rounded-lg bg-surface-container px-space-sm py-1.5 font-label-sm text-label-sm text-secondary transition-colors hover:bg-surface-container-high hover:text-on-surface">
        {m || draft.media_external_id ? "Change" : "Choose"} {reel ? "Reel" : "post"}
      </button>
    </Card>
  );
}

function errorMessage(e: unknown) {
  if (e instanceof ApiError) {
    const details = e.details as { missing_variables?: string[]; missing_permissions?: string[] } | { msg: string }[] | undefined;
    if (Array.isArray(details) && details[0]) return `${e.message} ${details[0].msg}`;
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}

export default function CampaignEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { viewMode } = useSession();
  const isNew = !id;
  const campaign = useCampaign(id);
  const templates = useTemplates();
  const save = useSaveCampaign();
  const transition = useCampaignTransition();
  const remove = useDeleteCampaign();

  const [search] = useSearchParams();
  const [draft, setDraft] = useState<Draft>(() => ({
    ...emptyDraft(viewMode),
    connection_id: search.get("connection"),
    media_id: search.get("media"),
  }));
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [step, setStep] = useState(isNew ? 0 : 1);
  const [bannerOpen, setBannerOpen] = useState(true);
  const [confirm, setConfirm] = useState<"stop" | "delete" | null>(null);

  useEffect(() => {
    if (campaign.data && loadedFor !== campaign.data.updated_at) {
      setDraft(fromCampaign(campaign.data));
      setLoadedFor(campaign.data.updated_at);
    }
  }, [campaign.data, loadedFor]);

  const current: Campaign | undefined = campaign.data;
  const locked = current?.status === "active" || current?.status === "stopped";
  const issues = useMemo(() => validate(draft, templates.data?.items ?? []), [draft, templates.data]);
  const ruleCount = toRules(draft).length;

  async function persist(): Promise<Campaign | null> {
    try {
      const body = toInput(draft);
      if (!body.name) {
        toast("Give the campaign a name first.", "error");
        setStep(0);
        return null;
      }
      const saved = await save.mutateAsync({
        id,
        body: locked ? { name: body.name, description: body.description } : body,
      });
      setLoadedFor(saved.updated_at);
      if (isNew) navigate(`/campaigns/${saved.id}`, { replace: true });
      return saved;
    } catch (e) {
      toast(errorMessage(e), "error");
      return null;
    }
  }

  async function saveDraft() {
    const saved = await persist();
    if (saved) toast(isNew ? "Campaign created as a draft" : "Changes saved");
  }

  async function validateAndActivate() {
    if (issues.length) {
      setBannerOpen(true);
      setStep(issues[0].step);
      toast("Fix the highlighted items before activating.", "error");
      return;
    }
    const saved = await persist();
    if (!saved) return;
    const action = saved.status === "paused" ? "resume" : "activate";
    transition.mutate(
      { id: saved.id, action },
      {
        onSuccess: () => toast(saved.mode === "live" ? "Campaign is live on Instagram" : "Campaign active in simulation mode"),
        onError: (e) => toast(errorMessage(e), "error"),
      },
    );
  }

  if (!isNew && campaign.isLoading) {
    return (
      <div className="flex flex-col gap-space-lg">
        <Skeleton className="h-24" />
        <Skeleton className="h-14" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!isNew && campaign.isError) {
    return (
      <Card className="mt-space-xl">
        <EmptyState icon="search_off" title="Campaign not found" body="It may have been deleted, or it belongs to another workspace." action={<Button onClick={() => navigate("/campaigns")}>Back to campaigns</Button>} />
      </Card>
    );
  }

  const kind = draft.media_id ? "Reel Auto-Responder" : "Comment Auto-Responder";

  return (
    <div className="flex w-full flex-col">
      <div className="mb-space-lg flex flex-col gap-space-md">
        <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-center">
          <div className="flex flex-col gap-space-xs">
            <div className="flex items-center gap-space-xs font-label-md text-label-md text-secondary">
              <Link to="/campaigns" className="transition-colors hover:text-primary">
                Campaigns
              </Link>
              <Icon name="chevron_right" className="text-[14px] text-outline" />
              <span className="max-w-[260px] truncate font-title-sm text-title-sm text-on-surface">{draft.name || "New campaign"}</span>
              <Icon name="chevron_right" className="text-[14px] text-outline" />
              <span className="rounded bg-surface-container-high px-space-xs py-0.5 font-label-sm text-label-sm text-on-surface-variant">{isNew ? "Create" : "Edit Mode"}</span>
              {current && <CampaignStatusChip status={current.status} />}
            </div>
            <div className="flex flex-wrap items-center gap-space-sm">
              <AnimatePresence mode="wait">
                <motion.h1
                  key={step}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="font-headline-md text-headline-md tracking-tight text-on-surface"
                >
                  {TITLES[step]}
                </motion.h1>
              </AnimatePresence>
              <span className="flex items-center gap-1 rounded-full bg-secondary-container px-space-sm py-0.5 font-label-sm text-label-sm font-semibold text-on-secondary-container">
                <span className={clsx("h-1.5 w-1.5 rounded-full bg-primary", current?.status === "active" && "animate-pulse")} />
                {kind}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-space-sm">
            <div className="flex items-center rounded-full bg-surface-container-high p-1 shadow-sm" role="radiogroup" aria-label="Operating mode">
              {(["simulation", "live"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={locked}
                  onClick={() => setDraft({ ...draft, mode: m })}
                  className={clsx(
                    "relative flex items-center gap-1 rounded-full px-space-sm py-1 font-label-sm text-label-sm transition-colors disabled:cursor-not-allowed",
                    draft.mode === m ? "text-on-primary" : "text-secondary hover:text-on-surface",
                  )}
                >
                  {draft.mode === m && <motion.span layoutId="mode-pill" className="absolute inset-0 rounded-full bg-primary shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                  <span className="relative flex items-center gap-1">
                    {m === "live" && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    {m === "live" ? "Live" : "Simulation"}
                  </span>
                </button>
              ))}
            </div>
            <Button variant="tonal" className="bg-surface-container-low text-secondary shadow-sm" loading={save.isPending && !transition.isPending} onClick={saveDraft}>
              {isNew ? "Save Draft" : "Save"}
            </Button>
            {current?.status === "active" ? (
              <Button variant="surface" icon="pause" loading={transition.isPending} onClick={() => transition.mutate({ id: current.id, action: "pause" }, { onSuccess: () => toast("Campaign paused. You can edit it now.") })}>
                Pause to edit
              </Button>
            ) : current?.status === "stopped" ? null : (
              <Button icon="bolt" className="px-space-lg shadow-md" loading={transition.isPending} onClick={validateAndActivate}>
                {current?.status === "paused" ? "Validate & Resume" : "Validate & Activate"}
              </Button>
            )}
          </div>
        </div>

        <AnimatePresence>
          {locked && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="flex items-center gap-space-sm rounded-xl bg-surface-container-low p-space-sm pl-space-md font-body-md text-body-md text-on-surface-variant shadow-sm">
                <Icon name="lock" className="text-[20px] text-primary" />
                {current?.status === "active"
                  ? "This campaign is running. Rules, conditions and actions are read-only until you pause it."
                  : "This campaign is stopped. Stopped campaigns are final; duplicate it via Export / Import to reuse the setup."}
              </div>
            </motion.div>
          )}
          {!locked && bannerOpen && issues.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="flex items-center justify-between rounded-xl bg-secondary-container/60 p-space-sm pl-space-md text-on-secondary-container shadow-sm">
                <div className="flex items-center gap-space-sm">
                  <Icon name="info" className="text-[20px] text-primary" />
                  <span className="font-body-md text-body-md text-on-secondary-container">
                    <strong className="font-title-sm text-title-sm text-primary">Pre-flight notice:</strong> {issues[0].message}
                    {issues.length > 1 && ` (+${issues.length - 1} more)`}
                  </span>
                </div>
                <div className="flex items-center gap-space-sm">
                  <button type="button" onClick={() => setStep(issues[0].step)} className="whitespace-nowrap rounded-lg bg-surface-container-lowest px-space-sm py-1 font-label-sm text-label-sm text-primary shadow-sm transition-colors hover:bg-surface">
                    Resolve in Step {issues[0].step + 1}
                  </button>
                  <button type="button" aria-label="Dismiss" onClick={() => setBannerOpen(false)} className="rounded p-1 hover:text-on-surface">
                    <Icon name="close" className="text-[18px]" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="w-full overflow-x-auto rounded-xl bg-surface-container-lowest p-space-xs shadow-sm">
          <div className="grid min-w-[820px] grid-cols-5 gap-space-xs" role="tablist">
            {STEPS.map((label, i) => {
              const active = i === step;
              const done = i < step || (i === 0 && !issues.some((x) => x.step === 0) && !active);
              return (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStep(i)}
                  className={clsx(
                    "relative flex items-center justify-center gap-space-xs whitespace-nowrap rounded-lg px-space-sm py-space-sm transition-colors",
                    active ? "text-on-primary" : done ? "bg-surface-container-low text-on-surface hover:bg-surface-container" : "text-secondary hover:bg-surface-container-low",
                  )}
                >
                  {active && <motion.span layoutId="step-active" className="absolute inset-0 rounded-lg bg-primary shadow-md" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                  <span className="relative flex items-center gap-space-xs">
                    {done && !active ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-container text-on-primary">
                        <Icon name="check" className="text-[14px]" />
                      </span>
                    ) : (
                      <span className={clsx("flex h-5 w-5 items-center justify-center rounded-full font-label-sm text-label-sm", active ? "bg-white/20 text-on-primary" : "bg-surface-container text-on-surface-variant")}>
                        {i + 1}
                      </span>
                    )}
                    <span className={active ? "font-title-sm text-title-sm" : "font-label-lg text-label-lg"}>
                      {done && !active ? `${i + 1}. ${label}` : label}
                    </span>
                    {i === 1 && (
                      <span className={clsx("ml-1 rounded-full px-1.5 py-0.5 font-label-sm text-label-sm", active ? "bg-white/20 text-on-primary" : "bg-surface-container text-on-surface-variant")}>
                        {ruleCount} rule{ruleCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-gutter lg:grid-cols-12">
        <div className="flex flex-col gap-space-lg lg:col-span-8">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.22 }} className="flex flex-col gap-space-lg">
              {step === 0 && <BasicsStep draft={draft} setDraft={setDraft} disabled={locked} />}
              {step === 1 && <RulesStep draft={draft} setDraft={setDraft} disabled={locked} />}
              {step === 2 && <ConditionsStep draft={draft} setDraft={setDraft} disabled={locked} />}
              {step === 3 && <ActionsStep draft={draft} setDraft={setDraft} disabled={locked} templates={templates.data?.items ?? []} />}
              {step === 4 && <VerifyStep campaignId={id} issues={issues} onGoTo={setStep} />}
            </motion.div>
          </AnimatePresence>
          {step === 1 && <TargetAsset draft={draft} onChange={() => setStep(0)} />}
          <div className="flex items-center justify-between">
            <Button variant="ghost" icon="arrow_back" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Back
            </Button>
            <div className="flex gap-space-sm">
              {current && current.status !== "stopped" && (
                <Button variant="ghost" icon="stop_circle" onClick={() => setConfirm("stop")}>
                  Stop
                </Button>
              )}
              {current && current.status !== "active" && (
                <Button variant="ghost" icon="delete" className="text-error hover:text-error" onClick={() => setConfirm("delete")}>
                  Delete
                </Button>
              )}
              {step < STEPS.length - 1 && (
                <Button variant="tonal" iconRight="arrow_forward" onClick={() => setStep(step + 1)}>
                  Next: {STEPS[step + 1]}
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className="sticky top-20 flex flex-col gap-space-md lg:col-span-4">
          <Sandbox draft={draft} templates={templates.data?.items ?? []} />
          <div className="flex items-start gap-space-sm rounded-xl bg-surface-container-low p-space-md">
            <Icon name="lightbulb" className="text-[20px] text-primary" />
            <div className="flex flex-col">
              <span className="font-title-sm text-title-sm text-on-surface">Pro-tip for High Conversion</span>
              <p className="font-body-sm text-body-sm text-secondary">
                Keep primary triggers to single-word commands like <strong className="text-on-surface">"GUIDE"</strong> in your Reel audio. Commenters on mobile prefer typing fewer letters.
              </p>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "stop" ? "Stop this campaign?" : "Delete this campaign?"}
        danger
        confirmLabel={confirm === "stop" ? "Stop campaign" : "Delete"}
        loading={transition.isPending || remove.isPending}
        body={
          confirm === "stop"
            ? "Stopped campaigns stop replying immediately and can't be restarted. Queued actions are cancelled."
            : "The campaign and its rules are deleted. Execution history is kept for your records."
        }
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!current) return;
          if (confirm === "stop") {
            transition.mutate({ id: current.id, action: "stop" }, { onSuccess: () => (toast("Campaign stopped"), setConfirm(null)), onError: (e) => toast(errorMessage(e), "error") });
          } else {
            remove.mutate(current.id, {
              onSuccess: () => {
                toast("Campaign deleted");
                navigate("/campaigns");
              },
              onError: (e) => (toast(errorMessage(e), "error"), setConfirm(null)),
            });
          }
        }}
      />
    </div>
  );
}
