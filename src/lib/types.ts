// Types mirroring the InstaFlow backend schemas (app/schemas/*).

export type UUID = string;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface User {
  id: UUID;
  email: string;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
}

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export interface Workspace {
  id: UUID;
  name: string;
  owner_id: UUID;
  is_test_workspace: boolean;
  created_at: string;
  updated_at: string;
  role: WorkspaceRole | null;
}

export interface Member {
  id: UUID;
  user_id: UUID;
  role: WorkspaceRole;
  created_at: string;
}

export type ConnectionStatus = "active" | "expired" | "revoked" | "error";

export interface Connection {
  id: UUID;
  workspace_id: UUID;
  instagram_account_id: string;
  username: string | null;
  auth_method: "instagram_login" | "mock";
  status: ConnectionStatus;
  granted_permissions: string[];
  token_expires_at: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface Media {
  id: UUID;
  connection_id: UUID;
  external_media_id: string;
  media_type: string | null;
  permalink: string | null;
  caption: string | null;
  published_at: string | null;
  synced_at: string;
}

export type CampaignStatus = "draft" | "active" | "paused" | "stopped";
export type OperatingMode = "simulation" | "live";
export type MatchType = "keyword" | "exact" | "phrase" | "contains";
export type RuleAction = "include" | "exclude";
export type GroupOperator = "and" | "or";
export type ActionType = "public_reply" | "private_reply";
export type TriState = "true" | "false" | "unknown";
export type FollowerRequirement = "any" | "followers_only" | "non_followers_only";
export type FallbackBehavior = "skip" | "manual_review" | "proceed";

export interface TriggerRuleIn {
  keyword: string;
  match_type: MatchType;
  case_sensitive: boolean;
  action: RuleAction;
  group_key: string;
  group_operator: GroupOperator;
}

export interface TriggerRule extends TriggerRuleIn {
  id: UUID;
  position: number;
}

export interface ActionConfig {
  type: ActionType;
  template_id: UUID;
  enabled: boolean;
}

export interface CampaignConfig {
  actions: ActionConfig[];
  group_logic: GroupOperator;
  follower_requirement: FollowerRequirement;
  unknown_follower_fallback: FallbackBehavior;
  variables: Record<string, string>;
  ignore_replies: boolean;
  max_actions_per_lead: number | null;
}

export interface Campaign {
  id: UUID;
  workspace_id: UUID;
  connection_id: UUID | null;
  media_id: UUID | null;
  media_external_id: string | null;
  name: string;
  description: string | null;
  status: CampaignStatus;
  mode: OperatingMode;
  config: Partial<CampaignConfig>;
  rules: TriggerRule[];
  created_at: string;
  updated_at: string;
}

export interface CampaignInput {
  name: string;
  description?: string | null;
  mode: OperatingMode;
  connection_id?: UUID | null;
  media_id?: UUID | null;
  media_external_id?: string | null;
  config: CampaignConfig;
  rules: TriggerRuleIn[];
}

export interface RuleResult {
  rule_id: string | null;
  keyword: string;
  match_type: string;
  action: string;
  group: string;
  matched: boolean;
  reason: string;
}

export interface RuleEvaluation {
  matched: boolean;
  reason: string;
  normalized_text: string | null;
  matched_rules: RuleResult[];
  excluded_by: RuleResult[];
  groups: Record<string, boolean>;
  results: RuleResult[];
  eligibility?: Eligibility;
}

export interface Eligibility {
  decision: "proceed" | "skip" | "manual_review";
  condition: string;
  observed: string;
  reason: string;
}

export interface CampaignTestResult {
  matched: boolean;
  reason: string;
  evaluation: RuleEvaluation;
  eligibility: Eligibility;
  would_execute: boolean;
  actions: { action_type: ActionType; template_id: UUID; rendered_message: string | null; error: string | null }[];
  sent: boolean;
}

export interface CampaignAnalytics {
  campaign_id: UUID;
  total_executions: number;
  simulated: number;
  attempted: number;
  succeeded: number;
  failed: number;
  unknown: number;
  skipped: number;
  manual_review: number;
  pending: number;
  by_action: Record<string, Record<string, number>>;
}

export type TemplateType = "public_reply" | "private_reply";

export interface Template {
  id: UUID;
  workspace_id: UUID;
  name: string;
  type: TemplateType;
  body: string;
  variables: string[];
  fallbacks: Record<string, string>;
  action_config: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateVersion {
  version: number;
  name: string;
  body: string;
  variables: string[];
  fallbacks: Record<string, string>;
  changed_by_id: UUID | null;
  created_at: string;
}

export interface TemplatePreview {
  rendered: string;
  used_variables: string[];
  used_fallbacks: string[];
  length: number;
  max_length: number;
}

export type ExecutionStatus =
  | "queued"
  | "in_progress"
  | "retry_scheduled"
  | "succeeded"
  | "simulated"
  | "failed"
  | "unknown"
  | "skipped"
  | "manual_review"
  | "cancelled";

export type ErrorCategory =
  | "transient"
  | "permanent"
  | "ambiguous"
  | "rate_limited"
  | "authorization"
  | "unsupported"
  | "validation";

export interface Execution {
  id: UUID;
  workspace_id: UUID;
  campaign_id: UUID | null;
  event_id: UUID;
  lead_id: UUID | null;
  template_id: UUID | null;
  action_type: ActionType;
  status: ExecutionStatus;
  is_simulated: boolean;
  matched_rules: { rule_id: string | null; keyword: string; match_type: string; group: string; reason: string }[];
  evaluation: {
    reason?: string;
    eligibility?: Eligibility;
    groups?: Record<string, boolean>;
    manual_retries?: number;
    resolution?: { delivered: boolean; at: string };
  };
  rendered_message: string | null;
  attempt_count: number;
  external_response_id: string | null;
  error_category: ErrorCategory | null;
  error_detail: string | null;
  next_attempt_at: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  campaign_name: string | null;
  lead_username: string | null;
  comment_id: string | null;
  comment_text: string | null;
  media_id: string | null;
}

export type EventStatus = "received" | "processing" | "processed" | "ignored" | "failed";

export interface CampaignOutcome {
  campaign_id: string;
  matched?: boolean;
  reason?: string;
  eligibility?: Eligibility;
  executions: { action_type: ActionType; status: ExecutionStatus; created: boolean }[];
}

export interface WebhookEvent {
  id: UUID;
  workspace_id: UUID | null;
  source: "instagram" | "simulation";
  external_event_id: string | null;
  event_type: string;
  status: EventStatus;
  attempt_count: number;
  payload: {
    comment_id?: string;
    media_id?: string;
    text?: string | null;
    username?: string | null;
    follower_status?: TriState;
    campaign_id?: string;
  };
  result: { campaigns?: CampaignOutcome[]; reason?: string };
  error: { type?: string; message?: string } | null;
  received_at: string;
  processed_at: string | null;
}

export interface SimulateRequest {
  campaign_id: UUID;
  comment_id: string;
  media_id?: string | null;
  username?: string | null;
  comment_text: string;
  follower_status: TriState;
  fault?: "none" | "transient" | "rate_limited" | "ambiguous" | "permanent";
}

export interface SimulateResponse {
  event_id: UUID;
  duplicate: boolean;
  event_status: EventStatus;
  result: WebhookEvent["result"];
  executions: Execution[];
}

export interface Lead {
  id: UUID;
  workspace_id: UUID;
  external_user_id: string;
  username: string | null;
  tags: string[];
  notes: string | null;
  comment_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface AttentionItem {
  kind: "connection" | "failures" | "manual_review";
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  campaign_id: UUID | null;
  connection_id: UUID | null;
  count: number;
}

export interface DailyPoint {
  date: string;
  live: number;
  simulated: number;
  live_public: number;
  live_private: number;
  simulated_public: number;
  simulated_private: number;
}

export interface Overview {
  period_days: number;
  comments_received: number;
  comments_previous: number;
  comments_matched: number;
  last_event_at: string | null;
  actions: {
    total: number;
    succeeded: number;
    simulated: number;
    failed: number;
    unknown: number;
    manual_review: number;
    skipped: number;
    pending: number;
    public_replies: number;
    private_replies: number;
  };
  success_rate: number | null;
  daily: DailyPoint[];
  campaigns: { total: number; active: number; paused: number; draft: number; stopped: number };
  campaign_stats: {
    campaign_id: UUID;
    total: number;
    simulated: number;
    live: number;
    problems: number;
    last_execution_at: string | null;
  }[];
  attention: AttentionItem[];
}

export interface Readiness {
  status: "ready" | "unavailable";
  checks: {
    database: { ok: boolean; error?: string };
    redis: { ok: boolean; error?: string; worker_heartbeat_age_seconds?: number | null; worker_alive?: boolean };
  };
}
