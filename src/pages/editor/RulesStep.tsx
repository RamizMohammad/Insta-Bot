import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";

import { Icon, Segmented } from "@/components/ui";
import type { GroupOperator, MatchType } from "@/lib/types";

import { EXCLUSION_LABELS, MATCH_LABELS, newRow, uid, type Draft, type RuleGroup, type RuleRow } from "./model";

const fieldClass =
  "w-full rounded-lg bg-surface-container-lowest px-space-md py-1.5 font-body-md text-body-md text-on-surface shadow-sm focus:outline-none focus:ring-2 disabled:opacity-60";

const item = {
  initial: { opacity: 0, y: -6, height: 0 },
  animate: { opacity: 1, y: 0, height: "auto" },
  exit: { opacity: 0, height: 0, transition: { duration: 0.18 } },
};

function IncludeRow({
  row,
  index,
  disabled,
  onChange,
  onRemove,
  onToExclusion,
}: {
  row: RuleRow;
  index: string;
  disabled: boolean;
  onChange: (r: RuleRow) => void;
  onRemove: () => void;
  onToExclusion: () => void;
}) {
  const multiple = row.match_type !== "exact" && row.keyword.includes(",");
  return (
    <motion.div layout {...item} className="overflow-hidden">
      <div className="flex flex-col justify-between gap-space-md rounded-xl bg-surface-container-low p-space-md transition-colors hover:bg-surface-container md:flex-row md:items-center">
        <div className="grid flex-1 grid-cols-1 items-center gap-space-sm sm:grid-cols-12">
          <div className="flex flex-col gap-0.5 sm:col-span-5">
            <label htmlFor={`kw-${index}`} className="font-label-sm text-label-sm text-secondary">
              Trigger Keyword(s)
            </label>
            <div className="relative flex items-center">
              <input
                id={`kw-${index}`}
                disabled={disabled}
                className={clsx(fieldClass, "focus:ring-primary", multiple && "pr-10")}
                value={row.keyword}
                placeholder="e.g. guide, pdf"
                onChange={(e) => onChange({ ...row, keyword: e.target.value })}
              />
              {multiple && (
                <span className="absolute right-2 rounded bg-surface-container px-1 font-label-sm text-label-sm text-secondary" title="Comma-separated words are alternatives">
                  OR
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-0.5 sm:col-span-4">
            <label htmlFor={`mt-${index}`} className="font-label-sm text-label-sm text-secondary">
              Match Operator
            </label>
            <select
              id={`mt-${index}`}
              disabled={disabled}
              className={clsx(fieldClass, "cursor-pointer px-space-sm focus:ring-primary")}
              value={row.match_type}
              onChange={(e) => onChange({ ...row, match_type: e.target.value as MatchType })}
            >
              {(Object.keys(MATCH_LABELS) as MatchType[]).map((m) => (
                <option key={m} value={m}>
                  {MATCH_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-0.5 sm:col-span-3">
            <span className="font-label-sm text-label-sm text-secondary">Sensitivity</span>
            <label className="flex cursor-pointer items-center gap-space-xs py-1">
              <input
                type="checkbox"
                disabled={disabled}
                className="h-4 w-4 cursor-pointer rounded accent-primary"
                checked={row.case_sensitive}
                onChange={(e) => onChange({ ...row, case_sensitive: e.target.checked })}
              />
              <span className="font-label-sm text-label-sm text-secondary">Case sensitive</span>
            </label>
          </div>
        </div>
        <div className="flex items-center gap-space-sm self-end md:self-center">
          <div className="flex items-center rounded-lg bg-surface-container-lowest p-0.5 shadow-sm">
            <span className="rounded bg-primary-container px-space-sm py-1 font-label-sm text-label-sm font-semibold text-on-primary">Include</span>
            <button
              type="button"
              disabled={disabled}
              onClick={onToExclusion}
              className="cursor-pointer rounded px-space-sm py-1 font-label-sm text-label-sm text-secondary hover:text-on-surface"
            >
              Exclude
            </button>
          </div>
          <button type="button" aria-label="Remove rule" disabled={disabled} onClick={onRemove} className="rounded-lg p-1 text-secondary transition-colors hover:text-error">
            <Icon name="close" className="text-[18px]" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function GroupCard({
  group,
  index,
  disabled,
  canDelete,
  onChange,
  onDelete,
  onMoveToExclusions,
}: {
  group: RuleGroup;
  index: number;
  disabled: boolean;
  canDelete: boolean;
  onChange: (g: RuleGroup) => void;
  onDelete: () => void;
  onMoveToExclusions: (row: RuleRow) => void;
}) {
  const updateRow = (r: RuleRow) => onChange({ ...group, rows: group.rows.map((x) => (x.uid === r.uid ? r : x)) });
  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} className="flex flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-space-sm bg-surface-container-low p-space-md">
        <div className="flex items-center gap-space-sm">
          <span className="rounded bg-primary-container px-2 py-0.5 font-label-sm text-label-sm font-semibold uppercase text-on-primary">
            Group {String(index + 1).padStart(2, "0")}
          </span>
          <span className="font-title-sm text-title-sm text-on-surface">{index === 0 ? "Primary Intent Keywords" : "Secondary Intent Keywords"}</span>
          <span className="font-label-sm text-label-sm text-secondary">({index === 0 ? "Lead capture triggers" : "Alternative triggers"})</span>
        </div>
        <div className="flex items-center gap-space-sm">
          <div className="flex items-center rounded-lg bg-surface-container-lowest p-0.5 shadow-sm">
            {(["and", "or"] as GroupOperator[]).map((op) => (
              <button
                key={op}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...group, operator: op })}
                className={clsx(
                  "rounded px-space-sm py-1 font-label-sm text-label-sm transition-colors",
                  group.operator === op ? "bg-secondary-container font-semibold text-primary" : "text-secondary hover:text-on-surface",
                )}
              >
                {op === "and" ? "Match ALL (AND)" : "Match ANY (OR)"}
              </button>
            ))}
          </div>
          {canDelete && (
            <button type="button" aria-label="Delete group" disabled={disabled} onClick={onDelete} className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-error-container/40 hover:text-error">
              <Icon name="delete" className="text-[18px]" />
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-space-md p-space-md">
        <AnimatePresence initial={false}>
          {group.rows.map((row, ri) => (
            <IncludeRow
              key={row.uid}
              row={row}
              index={`${index}-${ri}`}
              disabled={disabled}
              onChange={updateRow}
              onRemove={() => onChange({ ...group, rows: group.rows.filter((x) => x.uid !== row.uid) })}
              onToExclusion={() => onMoveToExclusions(row)}
            />
          ))}
        </AnimatePresence>
        <div className="flex justify-start pt-space-xs">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...group, rows: [...group.rows, newRow()] })}
            className="flex items-center gap-space-xs rounded-lg bg-surface-container px-space-md py-1.5 font-label-sm text-label-sm font-semibold text-primary transition-colors hover:bg-secondary-container disabled:opacity-50"
          >
            <Icon name="add" className="text-[16px]" />
            <span>Add condition rule</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export function RulesStep({ draft, setDraft, disabled }: { draft: Draft; setDraft: (d: Draft) => void; disabled: boolean }) {
  const setGroup = (g: RuleGroup) => setDraft({ ...draft, groups: draft.groups.map((x) => (x.uid === g.uid ? g : x)) });
  const setExclusion = (r: RuleRow) => setDraft({ ...draft, exclusions: draft.exclusions.map((x) => (x.uid === r.uid ? r : x)) });
  return (
    <div className="flex flex-col gap-space-lg">
      <div className="flex flex-col justify-between gap-space-sm rounded-xl bg-surface-container-lowest p-space-md shadow-sm md:flex-row md:items-center">
        <div className="flex items-center gap-space-sm">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary-container text-primary">
            <Icon name="account_tree" className="text-[20px]" />
          </div>
          <div>
            <h2 className="font-title-sm text-title-sm text-on-surface">Global Rule Group Evaluation</h2>
            <p className="font-body-sm text-body-sm text-secondary">Define relationship between independent rule blocks below</p>
          </div>
        </div>
        <Segmented
          id="group-logic"
          size="md"
          value={draft.config.group_logic}
          onChange={(v) => !disabled && setDraft({ ...draft, config: { ...draft.config, group_logic: v } })}
          options={[
            { value: "or", label: "Evaluate: ANY group matches (OR)" },
            { value: "and", label: "Evaluate: ALL groups must match (AND)" },
          ]}
        />
      </div>

      <AnimatePresence initial={false}>
        {draft.groups.map((g, i) => (
          <GroupCard
            key={g.uid}
            group={g}
            index={i}
            disabled={disabled}
            canDelete={draft.groups.length > 1}
            onChange={setGroup}
            onDelete={() => setDraft({ ...draft, groups: draft.groups.filter((x) => x.uid !== g.uid) })}
            onMoveToExclusions={(row) =>
              setDraft({
                ...draft,
                groups: draft.groups.map((x) => (x.uid === g.uid ? { ...x, rows: x.rows.filter((r) => r.uid !== row.uid) } : x)),
                exclusions: [...draft.exclusions, row],
              })
            }
          />
        ))}
      </AnimatePresence>

      <motion.div layout className="flex flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-space-sm bg-error-container/40 p-space-md">
          <div className="flex items-center gap-space-sm">
            <span className="rounded bg-error px-2 py-0.5 font-label-sm text-label-sm font-semibold uppercase text-on-error">Exclusions</span>
            <span className="font-title-sm text-title-sm text-on-surface">Spam, Harassment &amp; Opt-out Shield</span>
          </div>
          <span className="rounded-full bg-error-container px-space-sm py-0.5 font-label-sm text-label-sm font-medium text-on-error-container">
            Discard trigger if ANY match (OR)
          </span>
        </div>
        <div className="flex flex-col gap-space-md p-space-md">
          <AnimatePresence initial={false}>
            {draft.exclusions.map((row, i) => (
              <motion.div key={row.uid} layout {...item} className="overflow-hidden">
                <div className="flex flex-col justify-between gap-space-md rounded-xl bg-surface-container-low p-space-md md:flex-row md:items-center">
                  <div className="grid flex-1 grid-cols-1 items-center gap-space-sm sm:grid-cols-12">
                    <div className="flex flex-col gap-0.5 sm:col-span-6">
                      <label htmlFor={`ex-${i}`} className="font-label-sm text-label-sm text-secondary">
                        Negative Keywords (Comma separated)
                      </label>
                      <input
                        id={`ex-${i}`}
                        disabled={disabled}
                        className={clsx(fieldClass, "focus:ring-error")}
                        value={row.keyword}
                        placeholder="scam, fake, bot"
                        onChange={(e) => setExclusion({ ...row, keyword: e.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5 sm:col-span-6">
                      <label htmlFor={`ext-${i}`} className="font-label-sm text-label-sm text-secondary">
                        Match Type
                      </label>
                      <select
                        id={`ext-${i}`}
                        disabled={disabled}
                        className={clsx(fieldClass, "cursor-pointer px-space-sm focus:ring-error")}
                        value={row.match_type}
                        onChange={(e) => setExclusion({ ...row, match_type: e.target.value as MatchType })}
                      >
                        {(Object.keys(EXCLUSION_LABELS) as MatchType[]).map((m) => (
                          <option key={m} value={m}>
                            {EXCLUSION_LABELS[m]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-space-sm self-end md:self-center">
                    <span className="rounded bg-error px-space-md py-1 font-label-sm text-label-sm font-semibold text-on-error shadow-sm">Excluded</span>
                    <button
                      type="button"
                      aria-label="Remove exclusion"
                      disabled={disabled}
                      onClick={() => setDraft({ ...draft, exclusions: draft.exclusions.filter((x) => x.uid !== row.uid) })}
                      className="rounded-lg p-1 text-secondary transition-colors hover:text-error"
                    >
                      <Icon name="close" className="text-[18px]" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {draft.exclusions.length === 0 && (
            <p className="font-body-sm text-body-sm text-on-surface-variant">No exclusions. Add words like “scam” or “stop” to keep the automation away from spam and opt-outs.</p>
          )}
          <div className="flex justify-start">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setDraft({ ...draft, exclusions: [...draft.exclusions, { ...newRow(), match_type: "keyword" }] })}
              className="flex items-center gap-space-xs rounded-lg bg-surface-container px-space-md py-1.5 font-label-sm text-label-sm font-semibold text-error transition-colors hover:bg-error-container/30 disabled:opacity-50"
            >
              <Icon name="add" className="text-[16px]" />
              <span>Add negative filter rule</span>
            </button>
          </div>
        </div>
      </motion.div>

      <motion.button
        layout
        type="button"
        disabled={disabled}
        whileHover={{ scale: disabled ? 1 : 1.005 }}
        whileTap={{ scale: 0.995 }}
        onClick={() => setDraft({ ...draft, groups: [...draft.groups, { uid: uid(), key: `g${draft.groups.length + 1}`, operator: "or", rows: [newRow()] }] })}
        className="flex w-full flex-col items-center justify-center gap-space-xs rounded-xl bg-surface-container-low py-space-lg text-primary shadow-sm transition-all hover:bg-surface-container disabled:opacity-50"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary-container text-primary">
          <Icon name="add_box" className="text-[20px]" />
        </div>
        <span className="font-title-sm text-title-sm text-on-surface">
          Add Secondary Rule Group ({draft.config.group_logic === "or" ? "OR" : "AND"} condition)
        </span>
        <span className="font-body-sm text-body-sm text-secondary">Target secondary intents like "pricing", "cost", or DM requests</span>
      </motion.button>
    </div>
  );
}
