const nf = new Intl.NumberFormat("en-US");

export const formatNumber = (n: number | null | undefined) => (n == null ? "–" : nf.format(n));

export function compact(n: number) {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function percent(value: number | null | undefined, digits = 1) {
  return value == null ? "–" : `${(value * 100).toFixed(digits)}%`;
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const plural = (v: number, unit: string) => `${v} ${unit}${v === 1 ? "" : "s"} ago`;
  if (seconds < 45) return "just now";
  if (seconds < 3600) return plural(Math.max(1, Math.round(seconds / 60)), "min");
  if (seconds < 86400) return plural(Math.round(seconds / 3600), "hour");
  if (seconds < 604800) return plural(Math.round(seconds / 86400), "day");
  return formatDate(iso);
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}) {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...opts });
}

export function formatTime(iso: string | null | undefined) {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function daysUntil(iso: string | null | undefined) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

export function shortId(id: string) {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function initials(name: string | null | undefined) {
  const clean = (name ?? "?").replace(/^@/, "").replace(/[^a-zA-Z0-9 ._]/g, "");
  const parts = clean.split(/[ ._]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export const handle = (u: string | null | undefined) => (u ? `@${u.replace(/^@/, "")}` : "unknown user");
