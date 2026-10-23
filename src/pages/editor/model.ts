// Editor state model: converts between the API's flat rule list and the grouped UI representation.
import type {
  Campaign,
  CampaignConfig,
  CampaignInput,
  GroupOperator,
  MatchType,
  OperatingMode,
  Template,
  TriggerRuleIn,
} from "@/lib/types";

export interface RuleRow {
  uid: string;
  keyword: string;
  match_type: MatchType;
  case_sensitive: boolean;
}

export interface RuleGroup {
  uid: string;
  key: string;
  operator: GroupOperator;
  rows: RuleRow[];
}

export interface Draft {
  name: string;
  description: string;
  mode: OperatingMode;
  connection_id: string | null;
  media_id: string | null;
  media_external_id: string;
  config: CampaignConfig;
  groups: RuleGroup[];
  exclusions: RuleRow[];
}

let counter = 0;
export const uid = () => `u${++counter}${Date.now().toString(36)}`;

export const MATCH_LABELS: Record<MatchType, string> = {
  contains: "Contains text",
  phrase: "Exact phrase",
  keyword: "Whole word",
  exact: "Entire comment",
};

export const EXCLUSION_LABELS: Partial<Record<MatchType, string>> = {
  contains: "Contains anywhere",
  keyword: "Whole word",
  phrase: "Exact whole phrase",
  exact: "Exact comment match",
};

export const DEFAULT_CONFIG: CampaignConfig = {
  actions: [],
  group_logic: "or",
  follower_requirement: "any",
  unknown_follower_fallback: "skip",
  variables: {},
  ignore_replies: true,
  max_actions_per_lead: null,
};

export const newRow = (keyword = ""): RuleRow => ({ uid: uid(), keyword, match_type: "contains", case_sensitive: false });

export function emptyDraft(mode: OperatingMode): Draft {
  return {
    name: "",
    description: "",
    mode,
    connection_id: null,
    media_id: null,
    media_external_id: "",
    config: { ...DEFAULT_CONFIG },
    groups: [{ uid: uid(), key: "g1", operator: "or", rows: [newRow()] }],
    exclusions: [],
  };
}

export function fromCampaign(c: Campaign): Draft {
  const groups = new Map<string, RuleGroup>();
  const exclusions: RuleRow[] = [];
  for (const r of [...c.rules].sort((a, b) => a.position - b.position)) {
    const row: RuleRow = { uid: uid(), keyword: r.keyword, match_type: r.match_type, case_sensitive: r.case_sensitive };
    if (r.action === "exclude") {
      exclusions.push(row);
      continue;
    }
    const group = groups.get(r.group_key) ?? { uid: uid(), key: r.group_key, operator: r.group_operator, rows: [] };
    group.rows.push(row);
    groups.set(r.group_key, group);
  }
  return {
    name: c.name,
    description: c.description ?? "",
    mode: c.mode,
    connection_id: c.connection_id,
    media_id: c.media_id,
    media_external_id: c.media_external_id ?? "",
    config: { ...DEFAULT_CONFIG, ...c.config, variables: { ...(c.config.variables ?? {}) }, actions: [...(c.config.actions ?? [])] },
    groups: groups.size ? [...groups.values()] : [{ uid: uid(), key: "g1", operator: "or", rows: [newRow()] }],
    exclusions,
  };
}

export function toRules(d: Draft): TriggerRuleIn[] {
  const include = d.groups.flatMap((g, gi) =>
    g.rows
      .filter((r) => r.keyword.trim())
      .map((r) => ({
        keyword: r.keyword.trim(),
        match_type: r.match_type,
        case_sensitive: r.case_sensitive,
        action: "include" as const,
        group_key: `g${gi + 1}`,
        group_operator: g.operator,
      })),
  );
  const exclude = d.exclusions
    .filter((r) => r.keyword.trim())
    .map((r) => ({
      keyword: r.keyword.trim(),
      match_type: r.match_type,
      case_sensitive: r.case_sensitive,
      action: "exclude" as const,
      group_key: "exclusions",
      group_operator: "or" as const,
    }));
  return [...include, ...exclude];
}

export function toInput(d: Draft): CampaignInput {
  return {
    name: d.name.trim(),
    description: d.description.trim() || null,
    mode: d.mode,
    connection_id: d.connection_id,
    media_id: d.media_id,
    media_external_id: d.media_id ? null : d.media_external_id.trim() || null,
    config: { ...d.config, actions: d.config.actions.filter((a) => a.template_id) },
    rules: toRules(d),
  };
}

const SYSTEM_VARIABLES = new Set(["username", "comment_text", "campaign_name"]);

export interface Issue {
  step: number;
  message: string;
}

export function validate(d: Draft, templates: Template[]): Issue[] {
  const issues: Issue[] = [];
  if (!d.name.trim()) issues.push({ step: 0, message: "Give the campaign a name." });
  if (!d.media_id && !d.media_external_id.trim()) issues.push({ step: 0, message: "Choose the post or Reel to watch." });
  if (d.mode === "live" && !d.connection_id) issues.push({ step: 0, message: "Live mode needs a connected Instagram account." });
  if (!toRules(d).some((r) => r.action === "include")) issues.push({ step: 1, message: "Add at least one trigger keyword." });
  const enabled = d.config.actions.filter((a) => a.enabled);
  if (!enabled.length) issues.push({ step: 3, message: "Enable at least one reply action." });
  for (const action of enabled) {
    const t = templates.find((x) => x.id === action.template_id);
    if (!t) {
      issues.push({ step: 3, message: "Pick a message template for each enabled action." });
      continue;
    }
    const missing = t.variables.filter((v) => !SYSTEM_VARIABLES.has(v) && !d.config.variables[v] && !t.fallbacks[v]);
    if (missing.length) issues.push({ step: 3, message: `"${t.name}" needs a value for ${missing.map((m) => `{{${m}}}`).join(", ")}.` });
  }
  return issues;
}

export function requiredVariables(d: Draft, templates: Template[]) {
  const names = new Set<string>();
  for (const a of d.config.actions.filter((x) => x.enabled)) {
    templates.find((t) => t.id === a.template_id)?.variables.forEach((v) => !SYSTEM_VARIABLES.has(v) && names.add(v));
  }
  return [...names];
}
