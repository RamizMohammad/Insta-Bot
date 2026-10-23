// Status chips and mode badges using the Stitch semantic status tokens.
import clsx from "clsx";

import type { CampaignStatus, ConnectionStatus, EventStatus, ExecutionStatus, OperatingMode } from "@/lib/types";
import { Icon } from "./ui";

const EXECUTION: Record<ExecutionStatus, { label: string; cls: string; icon?: string; dot?: string }> = {
  succeeded: { label: "Succeeded", cls: "bg-emerald-50 text-emerald-800", icon: "done" },
  simulated: { label: "Simulated", cls: "bg-secondary-fixed text-on-secondary-fixed", icon: "science" },
  manual_review: { label: "Manual Review", cls: "bg-amber-50 text-amber-900", icon: "visibility" },
  retry_scheduled: { label: "Retry Scheduled", cls: "bg-amber-50 text-amber-900", icon: "schedule" },
  failed: { label: "Failed", cls: "bg-error-container text-on-error-container", icon: "cancel" },
  unknown: { label: "Unknown", cls: "bg-tertiary-fixed text-on-tertiary-fixed", dot: "bg-tertiary animate-pulse" },
  queued: { label: "Queued", cls: "bg-primary-fixed text-on-primary-fixed", dot: "bg-primary" },
  in_progress: { label: "Sending", cls: "bg-primary-fixed text-on-primary-fixed", dot: "bg-primary animate-pulse" },
  skipped: { label: "Skipped", cls: "bg-surface-container-high text-on-surface-variant", icon: "block" },
  cancelled: { label: "Cancelled", cls: "bg-surface-container-high text-on-surface-variant", icon: "do_not_disturb_on" },
};

export const executionStatusLabel = (s: ExecutionStatus) => EXECUTION[s].label;

export function ExecutionStatusChip({ status, className }: { status: ExecutionStatus; className?: string }) {
  const s = EXECUTION[status];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-label-sm text-label-sm font-semibold",
        s.cls,
        className,
      )}
    >
      {s.dot ? <span className={clsx("h-2 w-2 rounded-full", s.dot)} /> : <Icon name={s.icon!} className="text-[14px]" />}
      {s.label}
    </span>
  );
}

const CAMPAIGN: Record<CampaignStatus, string> = {
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-800",
  draft: "bg-surface-container-high text-on-surface-variant",
  stopped: "bg-error-container text-on-error-container",
};

export function CampaignStatusChip({ status }: { status: CampaignStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 font-label-sm text-label-sm font-semibold capitalize",
        CAMPAIGN[status],
      )}
    >
      {status}
    </span>
  );
}

/** Campaign-list style mode pill: pulsing dot for Live, flask for Simulation. */
export function ModePill({ mode, pulse = false }: { mode: OperatingMode; pulse?: boolean }) {
  if (mode === "live") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2.5 py-1 font-label-sm text-label-sm font-semibold text-on-secondary-container">
        <span className={clsx("h-1.5 w-1.5 rounded-full bg-primary", pulse && "animate-pulse")} />
        Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2.5 py-1 font-label-sm text-label-sm font-semibold text-on-surface-variant">
      <Icon name="science" className="text-[13px] text-primary" />
      Simulation
    </span>
  );
}

/** Small uppercase tag used in tables (dashboard / executions). */
export function ModeTag({ simulated }: { simulated: boolean }) {
  return simulated ? (
    <span className="rounded bg-surface-container-high px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
      Simulation
    </span>
  ) : (
    <span className="rounded bg-secondary-container px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-on-secondary-container">
      Live
    </span>
  );
}

const CONNECTION: Record<ConnectionStatus, string> = {
  active: "bg-emerald-50 text-emerald-800",
  expired: "bg-amber-50 text-amber-900",
  revoked: "bg-surface-container-high text-on-surface-variant",
  error: "bg-error-container text-on-error-container",
};

export function ConnectionStatusChip({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-label-sm text-label-sm font-semibold capitalize",
        CONNECTION[status],
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", status === "active" ? "bg-emerald-600" : "bg-current")} />
      {status}
    </span>
  );
}

const EVENT: Record<EventStatus, string> = {
  received: "bg-primary-fixed text-on-primary-fixed",
  processing: "bg-primary-fixed text-on-primary-fixed",
  processed: "bg-emerald-50 text-emerald-800",
  ignored: "bg-surface-container-high text-on-surface-variant",
  failed: "bg-error-container text-on-error-container",
};

export function EventStatusChip({ status }: { status: EventStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 font-label-sm text-label-sm font-semibold capitalize",
        EVENT[status],
      )}
    >
      {status}
    </span>
  );
}

export function actionLabel(type: "public_reply" | "private_reply") {
  return type === "public_reply" ? "Public Reply" : "Private DM";
}

export function actionIcon(type: "public_reply" | "private_reply") {
  return type === "public_reply" ? "forum" : "send";
}
