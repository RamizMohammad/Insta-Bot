import clsx from "clsx";

import { Icon } from "./ui";

export function Pagination({
  total,
  limit,
  offset,
  onChange,
  onLimitChange,
  noun = "records",
  sizes = [10, 25, 50, 100],
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
  onLimitChange?: (limit: number) => void;
  noun?: string;
  sizes?: number[];
}) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const btn = "p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";
  return (
    <div className="flex h-14 flex-wrap items-center justify-between gap-space-sm bg-surface-container-low px-space-md">
      <div className="flex items-center gap-space-sm font-label-sm text-label-sm text-on-surface-variant">
        <span>
          Showing <span className="font-semibold text-on-surface">{from}–{to}</span> of{" "}
          <span className="font-semibold text-on-surface">{total.toLocaleString("en-US")}</span> {noun}
        </span>
        {onLimitChange && (
          <>
            <span className="hidden text-outline-variant sm:inline">|</span>
            <span className="hidden sm:inline">Rows per page:</span>
            <select
              aria-label="Rows per page"
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              className="rounded bg-surface-container-lowest px-2 py-1 font-label-sm text-label-sm text-on-surface focus:outline-none"
            >
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="First page" className={btn} disabled={page <= 1} onClick={() => onChange(0)}>
          <Icon name="first_page" className="text-[20px]" />
        </button>
        <button type="button" aria-label="Previous page" className={btn} disabled={page <= 1} onClick={() => onChange(offset - limit)}>
          <Icon name="chevron_left" className="text-[20px]" />
        </button>
        <span className={clsx("px-2 font-label-sm text-label-sm font-bold text-on-surface")}>
          Page {page} of {pages}
        </span>
        <button type="button" aria-label="Next page" className={btn} disabled={page >= pages} onClick={() => onChange(offset + limit)}>
          <Icon name="chevron_right" className="text-[20px]" />
        </button>
        <button type="button" aria-label="Last page" className={btn} disabled={page >= pages} onClick={() => onChange((pages - 1) * limit)}>
          <Icon name="last_page" className="text-[20px]" />
        </button>
      </div>
    </div>
  );
}
