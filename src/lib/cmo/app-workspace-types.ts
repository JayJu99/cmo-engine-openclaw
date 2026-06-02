export type VaultNoteType = "app-note" | "daily-note" | "raw-capture";
export type CmoAuthMode = "supabase" | "legacy";
export type CMOContextQuality = "missing" | "placeholder" | "draft" | "confirmed";
export type AppWorkspaceTab = "dashboard" | "inputs" | "plan" | "tasks" | "sessions";
export type AppMemoryNoteKey = "positioning" | "audience" | "product" | "content" | "learnings" | "decisions" | "tasks";
export type PromotionSourceType = "cmo-session" | "raw-capture" | "daily-note";
export type PromotionCandidateStatus = "pending" | "promoted" | "skipped";
export type PriorityLevel = "P0" | "P1" | "P2";
export type PriorityTimeframe = "this week" | "this month" | "this quarter" | "custom";
export type PriorityStatus = "active" | "paused" | "completed" | "archived";
export type AppPlanType = "weekly" | "monthly";
export type AppPlanStatus = "draft" | "active" | "completed";
export type MetricsStatus = "missing" | "provided" | "connected";
export type CmoMetricStatus = "connected" | "missing" | "partial" | "placeholder";
export type CmoAppMetricDateRangePreset = "this_week" | "last_7_days" | "last_30_days" | "this_month" | "custom";
export type CmoChannelMetricStatus = "connected" | "missing" | "partial" | "placeholder";
export type CmoChannelMetricDateRangePreset = "today" | "yesterday" | "last_7_days" | "last_30_days" | "this_week" | "this_month" | "custom";
export type CmoChannel = "facebook";
export type CmoChannelMetricsSyncStatusValue = "success" | "failed" | "partial" | "skipped";
export type CmoBusinessMetricStatus = "connected" | "missing" | "partial" | "placeholder";
export type CmoBusinessMetricSourceType = "defillama" | "dune";
export type CmoBusinessMetricDomain = "business";
export type CmoBusinessMetricGroup = "dex_aggregator_volume" | "fees_usd" | "wld_aggregator_daily" | "wld_partner_stats_daily";
export type CmoBusinessMetricsResolverStatus = "connected" | "partial" | "missing";
export type TaskTrackerStatus = "connected" | "not_connected" | "fallback";
export type TaskSummarySource = "task-tracker" | "vault" | "placeholder";
export type ContextGraphHintSourceType = "markdown-link" | "session-reference" | "promotion-candidate" | "raw-capture" | "keyword-match";
export type ContextGraphHintConfidence = "high" | "medium" | "low";
export type ContextGraphStatus = "not_configured" | "empty" | "available" | "partial";
export type CmoDecisionStatus = "proposed" | "confirmed" | "rejected" | "deferred";
export type CmoDecisionConfidence = "low" | "medium" | "high";
export type CmoDecisionLayerExtractionStatus = "completed" | "partial" | "empty";
export type CmoDecisionReviewStatus = "unreviewed" | "confirmed" | "rejected" | "deferred";
export type CmoAssumptionReviewStatus = "unreviewed" | "accepted" | "risky" | "rejected";
export type CmoSuggestedActionReviewStatus = "unreviewed" | "reviewed";
export type CmoMemoryCandidateReviewStatus = "review_required" | "approved_for_promotion_later" | "rejected" | "deferred";
export type CmoTaskCandidateReviewStatus = "unreviewed" | "approved_for_task_later" | "rejected" | "deferred";
export type CmoMemoryCandidateType =
  | "product_truth"
  | "user_insight"
  | "growth_insight"
  | "constraint"
  | "channel"
  | "narrative"
  | "priority"
  | "open_question"
  | "other";

export interface AppWorkspace {
  id: string;
  name: string;
  slug: string;
  tenantId: string;
  workspaceId: string;
  sourceId: string;
  logicalAppPath: string;
  physicalAppVaultPath: string;
  appVaultPath: string;
  route: string;
  group: string;
  stage?: string;
  vaultPath: string;
  currentMission?: string;
  lastUpdated?: string;
  oneLiner?: string;
  currentGoal?: string;
  currentBottleneck?: string;
}

export interface VaultNoteRef {
  id: string;
  title: string;
  path: string;
  type: VaultNoteType;
  reason?: string;
  selected?: boolean;
  exists?: boolean;
  contentPreview?: string;
  frontmatterStatus?: string;
  contextQuality?: CMOContextQuality;
  qualityReason?: string;
}

export interface ContextGraphHint {
  id: string;
  title: string;
  path: string;
  reason: string;
  sourceType: ContextGraphHintSourceType;
  confidence: ContextGraphHintConfidence;
  contentPreview?: string;
  exists: boolean;
}

export interface CmoDecisionItem {
  id: string;
  title: string;
  statement: string;
  status: CmoDecisionStatus;
  rationale?: string;
  confidence: CmoDecisionConfidence;
  sourceSnippet?: string;
  reviewStatus?: CmoDecisionReviewStatus;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
}

export interface CmoAssumptionItem {
  id: string;
  statement: string;
  riskLevel?: "low" | "medium" | "high";
  confidence: CmoDecisionConfidence;
  sourceSnippet?: string;
  reviewStatus?: CmoAssumptionReviewStatus;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
}

export interface CmoSuggestedActionItem {
  id: string;
  title: string;
  description?: string;
  timeframeHint?: string;
  ownerHint?: string;
  priorityHint?: "low" | "medium" | "high";
  expectedImpact?: string;
  confidence: CmoDecisionConfidence;
  sourceSnippet?: string;
  reviewStatus?: CmoSuggestedActionReviewStatus;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
}

export interface CmoMemoryCandidateItem {
  id: string;
  type: CmoMemoryCandidateType;
  statement: string;
  reason?: string;
  reviewStatus: CmoMemoryCandidateReviewStatus;
  confidence: CmoDecisionConfidence;
  sourceSnippet?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
}

export interface CmoTaskCandidateItem {
  id: string;
  title: string;
  description?: string;
  ownerHint?: string;
  dueDateHint?: string;
  priorityHint?: "low" | "medium" | "high";
  source: "cmo_session";
  pushStatus: "not_pushed";
  confidence: CmoDecisionConfidence;
  sourceSnippet?: string;
  reviewStatus?: CmoTaskCandidateReviewStatus;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
}

export interface CmoDecisionLayer {
  schemaVersion: "cmo.decision-layer.v1";
  workspaceId: string;
  appId: string;
  sourceId: string;
  sessionId: string;
  createdAt: string;
  extractionMode: "deterministic";
  extractionStatus: CmoDecisionLayerExtractionStatus;
  decisions: CmoDecisionItem[];
  assumptions: CmoAssumptionItem[];
  suggestedActions: CmoSuggestedActionItem[];
  memoryCandidates: CmoMemoryCandidateItem[];
  taskCandidates: CmoTaskCandidateItem[];
}

export interface AppMemoryNoteSummary {
  noteKey: AppMemoryNoteKey;
  title: string;
  path: string;
  exists: boolean;
  editable: boolean;
  status: CMOContextQuality;
  contextQuality: CMOContextQuality;
  qualityReason: string;
  preview: string;
  frontmatter: Record<string, string>;
  frontmatterStatus?: string;
  updatedAt?: string;
  hash?: string;
}

export interface AppMemoryNoteDetail extends AppMemoryNoteSummary {
  body: string;
  content: string;
  suggestedBody: string;
}

export interface AppMemoryUpdateRequest {
  body?: string;
  status?: CMOContextQuality;
  expectedHash?: string;
  resetToPlaceholder?: boolean;
}

export interface PromotionCandidate {
  id: string;
  sourceType: PromotionSourceType;
  sourcePath: string;
  appId: string;
  appName: string;
  topic: string;
  summary: string;
  context: string;
  suggestedTargetNoteKey: AppMemoryNoteKey;
  status: PromotionCandidateStatus;
  createdAt?: string;
}

export interface PromotionRequest {
  candidateId: string;
  targetNoteKey: AppMemoryNoteKey;
  summary: string;
  sourcePath: string;
  sourceType: PromotionSourceType;
  status: "draft";
  topic?: string;
  context?: string;
}

export interface PromotionResponse {
  status: "promoted";
  targetPath: string;
  appended: true;
  updatedContextQuality: CMOContextQualitySummary;
  targetNote: AppMemoryNoteSummary;
}

export interface CLevelPriority {
  id: string;
  title: string;
  source: string;
  priorityLevel: PriorityLevel;
  timeframe: PriorityTimeframe | string;
  owner: string;
  successMetric: string;
  whyNow: string;
  constraints: string;
  mustDo: string;
  mustNotDo: string;
  status: PriorityStatus;
  linkedDocs: string[];
  lastReviewedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultFileStatus {
  title: string;
  path: string;
  exists: boolean;
  kind: "file" | "folder";
  contextQuality?: CMOContextQuality;
  frontmatterStatus?: string;
}

export interface CMOSessionSummary {
  sessionId: string;
  appId: string;
  topic: string;
  createdAt: string;
  runtimeStatus?: CMORuntimeStatus;
  runtimeMode?: CmoRuntimeMode;
  runtimeProvider?: string;
  runtimeAgent?: string;
  isDevelopmentFallback: boolean;
  contextUsedCount: number;
  contextQualitySummary?: CMOContextQualitySummary;
  graphHintCount?: number;
  graphStatus?: ContextGraphStatus;
  savedToVault: boolean;
  rawCapturePath?: string;
  rawCaptureStatus?: "saved" | "failed" | "pending";
  rawCaptureError?: string;
  sessionNotePath?: string;
}

export interface AppDashboardSnapshot {
  appId: string;
  currentPriority?: CLevelPriority;
  currentMission?: string;
  metricsStatus: MetricsStatus;
  weekPlanStatus: AppPlanStatus | "missing";
  taskTrackerStatus: TaskTrackerStatus;
  latestSession?: CMOSessionSummary;
  latestRecap?: {
    title: string;
    path: string;
    exists: boolean;
  };
  runtimeStatus: CMORuntimeStatus;
  contextQuality: CMOContextQualitySummary;
  latestPromotion?: {
    title: string;
    targetPath: string;
    sourcePath?: string;
    promotedAt?: string;
  };
}

export interface CmoAppMetricsSnapshot {
  schemaVersion: "cmo.app-metrics.v1";
  workspaceId: string;
  appId: string;
  sourceId: string;
  dateRange: {
    preset: CmoAppMetricDateRangePreset;
    startDate: string;
    endDate: string;
    timezone: string;
  };
  compareToPrevious: boolean;
  status: CmoMetricStatus;
  lastUpdatedAt: string | null;
  metrics: CmoAppMetric[];
  diagnostics: {
    source: "json" | "placeholder" | "not_connected";
    missingMetrics: string[];
    notes: string[];
  };
}

export interface CmoAppMetric {
  id: string;
  label: string;
  value: number | null;
  displayValue: string;
  unit?: "users" | "percent" | "count" | "ratio";
  deltaValue?: number | null;
  deltaDisplay?: string;
  trend?: "up" | "down" | "flat" | "unknown";
  status: CmoMetricStatus;
  description?: string;
}

export interface CmoChannelMetricsSnapshot {
  schemaVersion: "cmo.channel-metrics.v1";
  workspaceId: string;
  appId: string;
  sourceId: string;
  channel: CmoChannel;
  source: "lens.facebook_page" | "placeholder" | "not_connected";
  dateRange: {
    preset: CmoChannelMetricDateRangePreset;
    startDate: string;
    endDate: string;
    timezone: string;
  };
  status: CmoChannelMetricStatus;
  lastUpdatedAt: string | null;
  metrics: CmoChannelMetric[];
  topPosts?: CmoTopContentItem[];
  diagnostics: {
    availableMetrics: string[];
    missingMetrics: string[];
    notes: string[];
  };
}

export interface CmoChannelMetric {
  id: string;
  label: string;
  value: number | null;
  displayValue: string;
  unit?: "count" | "percent" | "ratio";
  status: CmoChannelMetricStatus;
  description?: string;
  caveat?: string;
}

export interface CmoTopContentItem {
  id: string;
  postId?: string;
  createdTime?: string;
  permalinkUrl?: string;
  messagePreview?: string;
  inferredContentType?: string;
  views?: number | null;
  visibleEngagement?: number | null;
  engagementRate?: number | null;
  bucket?: "viral" | "strong" | "normal" | "low_sample" | "unknown";
}

export interface CmoChannelMetricsSyncStatus {
  schemaVersion: "cmo.channel-metrics-sync-status.v1";
  appId: string;
  channel: CmoChannel;
  status: CmoChannelMetricsSyncStatusValue;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  normalizedOutputPath: string;
  lensOutputPath: string;
  availableMetrics: string[];
  missingMetrics: string[];
  notes: string[];
}

export interface CmoBusinessMetricsSnapshot {
  schemaVersion: "cmo.business-metrics.v1";
  workspaceId: string;
  appId: string;
  sourceId: string;
  source: {
    type: CmoBusinessMetricSourceType;
    fetchedAt: string;
    sourceId?: string;
    label?: string;
    queryId?: string;
    queryName?: string;
  };
  metricDomain: CmoBusinessMetricDomain;
  metricGroup: CmoBusinessMetricGroup;
  dateRange: {
    preset?: string;
    startDate?: string;
    endDate?: string;
    timezone?: string;
  };
  status: CmoBusinessMetricStatus;
  lastUpdatedAt: string | null;
  metrics: CmoBusinessMetric[];
  diagnostics: {
    availableMetrics: string[];
    missingMetrics: string[];
    notes: string[];
  };
  series?: CmoBusinessMetricSeries[];
  tables?: CmoBusinessMetricTable[];
  sourceStats?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

export interface CmoBusinessMetric {
  id: string;
  label: string;
  value: number | null;
  textValue?: string;
  displayValue: string;
  unit?: "usd" | "count" | "ratio" | "percent";
  status: CmoBusinessMetricStatus;
  description?: string;
  caveat?: string;
}

export interface CmoBusinessMetricSeries {
  id: string;
  points: Array<Record<string, unknown>>;
}

export interface CmoBusinessMetricTable {
  id: string;
  rows: Array<Record<string, unknown>>;
}

export interface CmoBusinessMetricsResolverGroup {
  metricGroup: CmoBusinessMetricGroup;
  status: CmoBusinessMetricsResolverStatus;
  metrics: CmoBusinessMetric[];
}

export interface CmoBusinessMetricsResolverResult {
  schemaVersion: "cmo.business-metrics-resolver.v1";
  workspaceId: string;
  appId: string;
  sourceId: string;
  source: CmoBusinessMetricSourceType;
  status: CmoBusinessMetricsResolverStatus;
  lastUpdatedAt: string | null;
  groups: CmoBusinessMetricsResolverGroup[];
  summaryText: string;
  caveats: string[];
}

export interface AppPlan {
  id: string;
  appId: string;
  type: AppPlanType;
  period: string;
  primaryObjective: string;
  linkedPriorityId: string;
  missions: string[];
  tasks: string[];
  risks: string[];
  successMetrics: string[];
  status: AppPlanStatus;
  sourceSessionId?: string;
  path: string;
  exists: boolean;
}

export interface AppTaskSummary {
  appId: string;
  source: TaskSummarySource;
  connected: boolean;
  status: TaskTrackerStatus;
  message: string;
  sourcePath?: string;
  countsByStatus: {
    done: number;
    inProgress: number;
    needAction: number;
    blocked: number;
    backlog: number;
  };
  blockers: string[];
  assignees: Array<{
    name: string;
    count: number;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    assignee?: string;
    source?: string;
  }>;
}

export interface PriorityNoteState {
  path: string;
  exists: boolean;
  content: string;
  activePriority?: CLevelPriority;
  priorities: CLevelPriority[];
}

export interface AppWorkspacePlanState {
  weekly: AppPlan;
  monthly: AppPlan;
}

export interface CMOContextNote {
  title: string;
  path: string;
  type: VaultNoteType;
  exists: true;
  content: string;
  truncated: boolean;
  frontmatterStatus?: string;
  contextQuality: CMOContextQuality;
  qualityReason: string;
}

export interface CMOMissingContextNote {
  title: string;
  path: string;
  type?: VaultNoteType;
  exists: false;
  content: "";
  truncated: false;
  reason: "file_not_found" | "invalid_path" | "outside_app_scope";
  frontmatterStatus?: string;
  contextQuality: "missing";
  qualityReason: string;
}

export interface CMOContextQualitySummary {
  selectedCount: number;
  existingCount: number;
  missingCount: number;
  confirmedCount: number;
  draftCount: number;
  placeholderCount: number;
  placeholderOrDraftCount: number;
}

export type ContextPackPolicyVersion = "context-pack-v1";
export type CmoRuntimeMode = "live" | "fallback" | "configured_but_unreachable";
export type ContextPackRuntimeMode = CmoRuntimeMode | "connected" | "not_configured" | "runtime_error";
export type ContextItemKind =
  | "current_priority"
  | "app_memory"
  | "latest_sessions"
  | "promotion_candidates"
  | "business_metrics"
  | "indexed_context_supplement";
export type CmoIndexedContextStatus = "off" | "skipped" | "used";
export type CmoRuntimeErrorReason =
  | "unsupported_chat_turn"
  | "timeout"
  | "invalid_response"
  | "empty_answer"
  | "execution_error";
export type HermesCmoChatStatus = "live" | "failed_then_existing_fallback" | "guardrail_violation_then_existing_fallback";
export type HermesCmoDelegationsMode = "proposals_only" | "echo_surf_bounded";
export type CmoProductRenderSource =
  | "hermes_cmo"
  | "fallback_after_hermes_failure"
  | "local_runtime_fallback"
  | "legacy_cmo_engine"
  | "direct_bridge"
  | "local_session_command";
export type CmoStrategyMode = "DIAGNOSE" | "FOCUS" | "PRIORITIZE" | "REVIEW" | "RESET";
export type CmoDecisionLabel = "KEEP" | "CUT" | "TEST" | "SCALE" | "WAIT";
export type HermesCmoAgentUsed = "cmo" | "echo" | "surf";
export type HermesCmoExecutableMode = "echo.default" | "echo.source_translate" | "surf.default" | "surf.x" | "surf.trend" | "surf.pulse";

export interface HermesCmoSafetyCounters {
  surfCalls: number;
  echoCalls: number;
  vaultAgentCalls: number;
  vaultWrites: number;
  directSupabaseMutations: number;
  openclawCalls: number;
}

export interface HermesCmoForbiddenCounters {
  vaultAgentCalls: number;
  vaultWrites: number;
  openclawCalls: number;
  directSupabaseMutations: number;
}

export interface CmoRuntimeContext {
  now_iso: string;
  timezone: string;
  timezone_label: string;
  locale: string;
  user_display_name?: string;
}

export interface CmoSourceReviewContext {
  schema_version: "cmo.source_review_context.v1";
  mode: "review_only" | "session_local";
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  session_id: string;
  request_id: string;
  source: Record<string, unknown>;
  extraction: Record<string, unknown>;
  safety: {
    read_only: true;
    vault_mutation: false;
    gbrain_mutation: false;
    no_promotion: true;
  };
  persistence?: {
    saved_to_vault: false;
    truth_status: "session_only";
    review_status: "temporary";
    no_auto_promote: true;
  };
}

export interface CmoSourceQualityReport {
  extraction_status: "completed" | "partial" | "failed";
  main_content_quality: "good" | "partial" | "low";
  extraction_coverage: "static_html" | "rendered_dom" | "deep_crawl" | "partial";
  warnings: string[];
}

export type CmoSessionSourceReadDepth = "snippet" | "extracted_text" | "browser_rendered" | "full_doc" | "partial";
export type CmoSessionSourceCacheRole = "context_hint" | "fallback_only" | "high_quality_evidence";

export interface CmoSourceAnswerContext {
  type: "source_answer_context";
  schema_version: "cmo.source_answer_context.v1";
  workspace_id: string;
  session_id: string;
  source_id: string;
  query: string;
  query_type: "can_read" | "summarize" | "translate" | "specific_question" | "review" | "unknown";
  action: "can_read" | "summarize" | "translate" | "answer_question" | "review" | "unknown";
  answerable: boolean;
  relevant_snippets: string[];
  used_source_fields: Array<"extracted_summary" | "source_text_cache" | "source_text_excerpt" | "refetch">;
  source_title?: string;
  original_url?: string;
  canonical_url?: string;
  content_hash?: string;
  truth_status: "session_only";
  saved_to_vault: false;
  no_auto_promote: true;
  reason?: "not_found_in_current_extraction" | "extraction_partial" | "no_active_source";
  extraction_quality?: "good" | "partial" | "low";
  extraction_coverage?: "static_html" | "rendered_dom" | "deep_crawl" | "partial";
  read_depth?: CmoSessionSourceReadDepth;
  cache_role?: CmoSessionSourceCacheRole;
  nav_heavy?: boolean;
  tool_read_recommended?: boolean;
  warnings?: string[];
  suggested_next_step?: "deep_read_or_rendered_fetch";
}

export interface CmoSessionLocalSource {
  type: "session_local_source";
  schema_version: "cmo.session_local_source.v1";
  workspace_id: string;
  session_id: string;
  turn_id: string;
  source_id: string;
  source_type: string;
  source_title: string;
  original_url?: string;
  canonical_url?: string;
  original_filename?: string;
  extracted_summary?: string;
  source_text_excerpt?: string;
  source_text_cache?: string;
  extraction_status: "completed" | "partial" | "failed";
  main_content_quality?: "good" | "partial" | "low";
  extraction_coverage?: "static_html" | "rendered_dom" | "deep_crawl" | "partial";
  read_depth?: CmoSessionSourceReadDepth;
  cache_role?: CmoSessionSourceCacheRole;
  nav_heavy?: boolean;
  tool_read_recommended?: boolean;
  warnings?: string[];
  full_artifact_ref?: string;
  content_hash?: string;
  saved_to_vault: false;
  official_project_source: false;
  truth_status: "session_only";
  review_status: "temporary";
  no_auto_promote: true;
  safety: {
    read_only: true;
    vault_mutation: false;
    gbrain_mutation: false;
    promotion_performed: false;
  };
}

export interface CmoSessionLocalResearchResult {
  type: "session_local_research_result";
  schema_version: "cmo.session_local_research_result.v1";
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  user_id: string;
  session_id: string;
  turn_id: string;
  created_turn_id: string;
  research_id: string;
  source_agent: "surf";
  research_type: "competitor_landscape" | "external_research";
  user_question: string;
  competitors?: Array<Record<string, unknown> | string>;
  adjacent_products?: Array<Record<string, unknown> | string>;
  sources_used?: Array<Record<string, unknown> | string>;
  key_findings?: string[];
  evidence_gaps?: string[];
  created_at: string;
  truth_status: "session_only";
  saved_to_vault: false;
  no_auto_promote: true;
  safety: {
    read_only: true;
    vault_mutation: false;
    gbrain_mutation: false;
    promotion_performed: false;
  };
}

export interface HermesCmoActivityEventSummary {
  eventId: string;
  type: string;
  status: string;
  message: string;
  userVisible: boolean;
  sourceAgent?: HermesCmoAgentUsed;
  sourceMode?: "cmo.default" | "cmo.tool_capable" | HermesCmoExecutableMode;
}

export interface HermesCmoDelegationSummaryItem {
  delegationId: string;
  targetAgent: "echo" | "surf";
  mode: HermesCmoExecutableMode;
  objective: string;
  status: "completed" | "failed" | "skipped";
  summary: string;
  failureReason?: string;
}

export interface HermesCmoPlatformPersistenceSummary {
  sessionJsonSaved: boolean;
  rawCaptureSaved: boolean;
  rawCaptureStatus?: "saved" | "failed" | "pending";
  supabaseIndexingStatus: "indexed" | "skipped" | "failed";
}

export interface HermesCmoChatMetadata {
  runtimeMode: "hermes_cmo";
  runtimeStatus: "live" | "fallback";
  calledHermesCmo: true;
  hermesRequestSent?: true;
  productRenderSource?: "hermes_cmo" | "fallback_after_hermes_failure";
  selectedHermesEndpoint?: string;
  hermesEndpointKind?: "execute" | "tool_execute" | "agent_chat";
  endpoint_kind?: "execute" | "tool_execute" | "agent_chat";
  runtime_kind?: "ai_agent";
  requested_endpoint?: string;
  fallback_used?: boolean;
  fallback_reason?: string;
  fallback_from?: string;
  fallback_to?: string;
  hermesEndpointTimeoutMs?: number;
  hermesToolEndpointEnabled?: boolean;
  sideEffects?: false | Record<string, false>;
  side_effects?: false | Record<string, false>;
  vault_context_usage?: unknown;
  contract_warnings?: string[];
  contract_warnings_count?: number;
  state_contract?: Record<string, unknown>;
  artifacts_out_count?: number;
  artifact_refs_count?: number;
  decisions_count?: number;
  session_summary_update_present?: boolean;
  suggested_vault_updates_count?: number;
  approval_events_count?: number;
  latest_approval_action?: CmoVaultUpdateReviewAction;
  vault_write_performed?: false;
  delegationsMode: HermesCmoDelegationsMode;
  counters: HermesCmoSafetyCounters;
  forbiddenCounters: HermesCmoForbiddenCounters;
  requestId: string;
  responseStatus: string;
  toolsUsed?: string[];
  tools_used?: string[];
  toolReadsCount?: number;
  contextResolution?: Record<string, unknown>;
  context_resolution?: Record<string, unknown>;
  answerBasis?: Record<string, unknown>;
  answer_basis?: Record<string, unknown>;
  strategyMode?: CmoStrategyMode;
  mainBottleneck?: string;
  decisionLabel?: CmoDecisionLabel;
  currentStep?: string;
  activityEventsCount: number;
  activityEvents?: HermesCmoActivityEventSummary[];
  delegationSummary?: HermesCmoDelegationSummaryItem[];
  agentsUsed?: HermesCmoAgentUsed[];
  surfCalls?: number;
  echoCalls?: number;
  platformPersistenceSummary?: HermesCmoPlatformPersistenceSummary;
}

export interface VaultAgentDryRunMetadata {
  vault_handoff_mode?: "off" | "dry_run" | "dry_run_remote" | "write_remote";
  vault_handoff_status?: "skipped" | "dry_run_valid" | "dry_run_invalid" | "completed" | "failed" | "rejected";
  dry_run_record_id?: string;
  dry_run_target_path?: string;
  dry_run_indexability?: {
    gbrain_index: boolean;
    gbrain_status: string;
    reason: string;
  };
  vault_write_performed?: boolean;
  vault_deduped?: boolean;
  vault_record_id?: string;
  vault_target_path?: string;
  vault_target_absolute_path?: string;
  vault_content_hash?: string;
  vault_path_safety?: unknown;
  vault_warnings?: string[];
  vault_errors?: string[];
  gbrain_called?: false;
  memory_mutation?: false;
  vault_handoff_warnings?: string[];
  vault_handoff_errors?: string[];
}

export interface VaultAgentContextPackSourceMetadata {
  title: string;
  citation?: string;
  source_path?: string;
  source_id?: string;
  source_type?: string;
  scope?: string;
  visibility?: string;
  confidence?: number;
  excerpt_or_summary?: string;
}

export interface VaultAgentContextPackMetadata {
  context_pack_mode?: "off" | "pilot_remote";
  context_pack_status?: "skipped" | "completed" | "empty" | "failed" | "rejected";
  context_pack_source_count?: number;
  context_pack_sources?: VaultAgentContextPackSourceMetadata[];
  context_pack_errors?: string[];
  context_pack_warnings?: string[];
  gbrain_called?: boolean;
  vault_mutation?: false;
  promotion_performed?: false;
}

export interface VaultAgentRuntimeContextPack {
  schema_version: "cmo.vault_context_pack.runtime.v1";
  mode: "pilot_remote";
  status: "completed";
  source_count: number;
  hidden_text: string;
  sources: VaultAgentContextPackSourceMetadata[];
  gbrain_called: boolean;
  vault_mutation: false;
  promotion_performed: false;
}

export interface ContextItem {
  id: string;
  kind: ContextItemKind;
  title: string;
  source: {
    sourceId: string;
    type: "vault_note" | "vault_bundle" | "session_store" | "derived_candidates" | "business_metrics_json" | "indexed_context_preview";
    label: string;
    path?: string;
  };
  inclusionReason: string;
  exists: boolean;
  content: string;
  contentPreview: string;
  contextQuality: CMOContextQuality;
  tokenEstimate: number;
  truncated: boolean;
  itemCount?: number;
}

export interface ContextExclusion {
  id: string;
  label: string;
  reason: string;
  policy: "excluded_by_context_pack_v1";
}

export interface ContextPack {
  policyVersion: ContextPackPolicyVersion;
  workspaceId: string;
  appId: string;
  sourceId: string;
  logicalAppPath: string;
  physicalAppVaultPath: string;
  appVaultPath: string;
  physicalVaultPath: string;
  runtimeMode: ContextPackRuntimeMode;
  tokenBudget: {
    maxInputTokens: number;
    estimatedTokens: number;
    maxItemChars: number;
  };
  items: ContextItem[];
  graphHints?: ContextGraphHint[];
  graphHintCount?: number;
  graphStatus?: ContextGraphStatus;
  exclusions: ContextExclusion[];
  contextQualitySummary: CMOContextQualitySummary;
  vaultAgentContextPack?: VaultAgentRuntimeContextPack;
  sourceReviewContext?: CmoSourceReviewContext;
  sourceAnswerContext?: CmoSourceAnswerContext;
}

export interface CMOContextBriefSection {
  id: ContextItemKind;
  label: string;
  status: "included" | "missing" | "empty";
  itemCount: number;
  quality?: CMOContextQuality;
}

export interface CMOContextBrief {
  policyVersion: ContextPackPolicyVersion;
  workspaceId: string;
  appId: string;
  appName: string;
  logicalAppPath: string;
  appVaultPath: string;
  runtimeMode: ContextPackRuntimeMode;
  sections: CMOContextBriefSection[];
  graphHints?: ContextGraphHint[];
  graphHintCount?: number;
  graphStatus?: ContextGraphStatus;
  exclusions: ContextExclusion[];
  contextQualitySummary: CMOContextQualitySummary;
  tokenBudget: ContextPack["tokenBudget"];
}

export interface CMOContextDiagnostics extends CMOContextQualitySummary {
  selectedCount: number;
  existingCount: number;
  missingCount: number;
  totalChars: number;
}

export interface CMOContextPackage {
  workspaceId: string;
  sourceId: string;
  runtimeWorkspaceId?: string;
  runtimeContext?: CmoRuntimeContext;
  sourceReviewContext?: CmoSourceReviewContext;
  sourceAnswerContext?: CmoSourceAnswerContext;
  sessionLocalSources?: CmoSessionLocalSource[];
  sessionLocalResearchResults?: CmoSessionLocalResearchResult[];
  activeSourceId?: string;
  mode: "app_context";
  contextPack: ContextPack;
  app: {
    id: string;
    name: string;
    vaultPath: string;
    logicalAppPath: string;
    physicalAppVaultPath: string;
    appVaultPath: string;
    group?: string;
    stage?: string;
    currentMission?: string;
    oneLiner?: string;
    currentGoal?: string;
    currentBottleneck?: string;
  };
  userMessage: string;
  selectedContext: CMOContextNote[];
  missingContext: CMOMissingContextNote[];
  graphHints?: ContextGraphHint[];
  graphHintCount?: number;
  graphStatus?: ContextGraphStatus;
  contextQualitySummary: CMOContextQualitySummary;
  instructions: {
    role: "strategic CMO";
    doNotOverpromise: true;
    answerStyle: "operator-grade, concise, decision-oriented";
    mustStateAssumptions: true;
    mustReferenceContextUsed: true;
    useSelectedNotesOnly: true;
    doNotClaimAllVaultRag: true;
    doNotPretendDurableMemoryComplete: true;
    mustStatePlaceholderLimitations: true;
    askForConfirmationWhenContextIsDraft: true;
    suggestFillingAppMemoryWhenRelevant: true;
    graphHintsAreSupportingOnly?: true;
    appMemoryAndPriorityOverrideGraphHints?: true;
    mentionGraphUncertaintyWhenDraftOrRaw?: true;
  };
}

export type CMORuntimeStatus =
  | "live"
  | "connected"
  | "configured_but_unreachable"
  | "live_failed_then_fallback"
  | "development_fallback"
  | "runtime_error"
  | "not_configured";

export interface CMOChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  authMode?: CmoAuthMode;
  userId?: string;
  userEmail?: string;
  sourceUserId?: string;
  sourceUserEmail?: string;
  sourceUserMessageId?: string;
  runtimeMode?: CmoRuntimeMode;
  runtimeStatus?: CMORuntimeStatus;
  runtimeProvider?: string;
  runtimeAgent?: string;
  runtimeErrorReason?: CmoRuntimeErrorReason;
  productRenderSource?: CmoProductRenderSource;
  productFallbackReason?: string;
  hermesRequestSent?: boolean;
  calledHermesCmo?: boolean;
  hermesCmoStatus?: HermesCmoChatStatus;
  hermesCmoErrorReason?: string;
  hermesCmoCounters?: HermesCmoSafetyCounters;
  hermesCmoMetadata?: HermesCmoChatMetadata;
  strategyMode?: CmoStrategyMode;
  mainBottleneck?: string;
  decisionLabel?: CmoDecisionLabel;
  currentStep?: string;
  activityEvents?: HermesCmoActivityEventSummary[];
  delegationSummary?: HermesCmoDelegationSummaryItem[];
  agentsUsed?: HermesCmoAgentUsed[];
  surfCalls?: number;
  echoCalls?: number;
  forbiddenCounters?: HermesCmoForbiddenCounters;
  platformPersistenceSummary?: HermesCmoPlatformPersistenceSummary;
  delegationsMode?: HermesCmoDelegationsMode;
  vaultAgentDryRun?: VaultAgentDryRunMetadata;
  vaultAgentContextPack?: VaultAgentContextPackMetadata;
  contextUsedCount?: number;
  graphHintCount?: number;
  indexedContextStatus?: CmoIndexedContextStatus;
  indexedContextSourcesCount?: number;
  indexedContextFallbackReason?: string;
  requestReceivedAt?: string;
  liveAttemptStartedAt?: string;
  liveAttemptDurationMs?: number;
  fallbackDurationMs?: number;
  totalDurationMs?: number;
  timeoutMs?: number;
  contextSourceCount?: number;
  contextCharLength?: number;
  indexedSupplementCharLength?: number;
  authDurationMs?: number;
  sessionResolutionDurationMs?: number;
  contextPackBuildDurationMs?: number;
  indexedContextBuildDurationMs?: number;
  runtimeContext?: CmoRuntimeContext;
  sourceReviewContext?: CmoSourceReviewContext;
  sourceAnswerContext?: CmoSourceAnswerContext;
  sessionLocalSources?: CmoSessionLocalSource[];
  sessionLocalResearchResults?: CmoSessionLocalResearchResult[];
  activeSourceId?: string;
  sessionSummary?: string;
  sessionArtifacts?: Record<string, unknown>[];
  suggestedVaultUpdates?: Record<string, unknown>[];
  vaultUpdateApprovalEvents?: CmoVaultUpdateApprovalEvent[];
}

export type CmoVaultUpdateReviewAction = "approved" | "rejected" | "deferred";

export interface CmoVaultUpdateApprovalEvent {
  schema_version: "cmo.vault_update_approval.v1";
  approval_id: string;
  tenant_id: string;
  workspace_id: string;
  session_id: string;
  turn_id: string;
  source_endpoint: "/agents/cmo/chat";
  source_response_id: string;
  action: CmoVaultUpdateReviewAction;
  review_status: CmoVaultUpdateReviewAction;
  approved_by: "user_or_product";
  approved_at: string;
  reviewed_update: Record<string, unknown>;
  approved_update?: Record<string, unknown>;
  rejected_update?: Record<string, unknown>;
  deferred_update?: Record<string, unknown>;
  vault_write_performed: false;
}

export interface CMOChatSession {
  id: string;
  appId: string;
  appName: string;
  topic?: string;
  authMode?: CmoAuthMode;
  userId?: string;
  userEmail?: string;
  organizationId?: string;
  createdByUserId?: string;
  createdByEmail?: string;
  messages: CMOChatMessage[];
  contextUsed: VaultNoteRef[];
  status: "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  isDevelopmentFallback?: boolean;
  isRuntimeFallback?: boolean;
  runtimeStatus?: CMORuntimeStatus;
  runtimeMode?: CmoRuntimeMode;
  attemptedRuntimeMode?: CmoRuntimeMode;
  runtimeLabel?: string;
  runtimeError?: string;
  runtimeErrorReason?: CmoRuntimeErrorReason;
  runtimeProvider?: string;
  runtimeAgent?: string;
  productRenderSource?: CmoProductRenderSource;
  productFallbackReason?: string;
  hermesRequestSent?: boolean;
  calledHermesCmo?: boolean;
  hermesCmoStatus?: HermesCmoChatStatus;
  hermesCmoErrorReason?: string;
  hermesCmoCounters?: HermesCmoSafetyCounters;
  hermesCmoMetadata?: HermesCmoChatMetadata;
  strategyMode?: CmoStrategyMode;
  mainBottleneck?: string;
  decisionLabel?: CmoDecisionLabel;
  currentStep?: string;
  activityEvents?: HermesCmoActivityEventSummary[];
  delegationSummary?: HermesCmoDelegationSummaryItem[];
  agentsUsed?: HermesCmoAgentUsed[];
  surfCalls?: number;
  echoCalls?: number;
  forbiddenCounters?: HermesCmoForbiddenCounters;
  platformPersistenceSummary?: HermesCmoPlatformPersistenceSummary;
  delegationsMode?: HermesCmoDelegationsMode;
  vaultAgentDryRun?: VaultAgentDryRunMetadata;
  vaultAgentContextPack?: VaultAgentContextPackMetadata;
  missingContext?: VaultNoteRef[];
  contextDiagnostics?: CMOContextDiagnostics;
  contextQualitySummary?: CMOContextQualitySummary;
  graphHints?: ContextGraphHint[];
  graphHintCount?: number;
  graphStatus?: ContextGraphStatus;
  indexedContextStatus?: CmoIndexedContextStatus;
  indexedContextSourcesCount?: number;
  indexedContextFallbackReason?: string;
  requestReceivedAt?: string;
  liveAttemptStartedAt?: string;
  liveAttemptDurationMs?: number;
  fallbackDurationMs?: number;
  totalDurationMs?: number;
  timeoutMs?: number;
  contextSourceCount?: number;
  contextCharLength?: number;
  indexedSupplementCharLength?: number;
  authDurationMs?: number;
  sessionResolutionDurationMs?: number;
  contextPackBuildDurationMs?: number;
  indexedContextBuildDurationMs?: number;
  runtimeContext?: CmoRuntimeContext;
  sourceReviewContext?: CmoSourceReviewContext;
  sourceAnswerContext?: CmoSourceAnswerContext;
  sessionLocalSources?: CmoSessionLocalSource[];
  sessionLocalResearchResults?: CmoSessionLocalResearchResult[];
  activeSourceId?: string;
  sessionSummary?: string;
  sessionArtifacts?: Record<string, unknown>[];
  suggestedVaultUpdates?: Record<string, unknown>[];
  vaultUpdateApprovalEvents?: CmoVaultUpdateApprovalEvent[];
  decisionLayer?: CmoDecisionLayer;
  assumptions?: string[];
  suggestedActions?: CMOAppChatResponse["suggestedActions"];
  savedToVault?: boolean;
  sessionNotePath?: string;
  relatedPriority?: string;
  relatedPlan?: string;
  relatedTasks?: string[];
  rawCapturePath?: string;
  rawCaptureStatus?: "saved" | "failed" | "pending";
  rawCaptureError?: string;
}

export interface CMOAppChatRequest {
  tenantId?: string;
  workspaceId: string;
  appId: string;
  appName: string;
  sessionId?: string;
  message: string;
  topic?: string;
  forceFallback?: boolean;
  context: {
    selectedNotes: VaultNoteRef[];
    mode: "app_context";
  };
}

export interface CMOAppChatResponse {
  messageId: string;
  sessionId: string;
  status: "completed" | "failed";
  answer: string;
  assumptions: string[];
  suggestedActions: Array<{
    type: string;
    label: string;
  }>;
  contextUsed: VaultNoteRef[];
  missingContext: VaultNoteRef[];
  isDevelopmentFallback: boolean;
  isRuntimeFallback?: boolean;
  runtimeStatus: CMORuntimeStatus;
  runtimeMode?: CmoRuntimeMode;
  attemptedRuntimeMode?: CmoRuntimeMode;
  runtimeLabel: string;
  runtimeError?: string;
  runtimeErrorReason?: CmoRuntimeErrorReason;
  runtimeProvider?: string;
  runtimeAgent?: string;
  productRenderSource?: CmoProductRenderSource;
  productFallbackReason?: string;
  hermesRequestSent?: boolean;
  calledHermesCmo?: boolean;
  hermesCmoStatus?: HermesCmoChatStatus;
  hermesCmoErrorReason?: string;
  hermesCmoCounters?: HermesCmoSafetyCounters;
  hermesCmoMetadata?: HermesCmoChatMetadata;
  strategyMode?: CmoStrategyMode;
  mainBottleneck?: string;
  decisionLabel?: CmoDecisionLabel;
  currentStep?: string;
  activityEvents?: HermesCmoActivityEventSummary[];
  delegationSummary?: HermesCmoDelegationSummaryItem[];
  agentsUsed?: HermesCmoAgentUsed[];
  surfCalls?: number;
  echoCalls?: number;
  forbiddenCounters?: HermesCmoForbiddenCounters;
  platformPersistenceSummary?: HermesCmoPlatformPersistenceSummary;
  delegationsMode?: HermesCmoDelegationsMode;
  contextDiagnostics?: CMOContextDiagnostics;
  contextQualitySummary?: CMOContextQualitySummary;
  graphHints?: ContextGraphHint[];
  graphHintCount?: number;
  graphStatus?: ContextGraphStatus;
  indexedContextStatus?: CmoIndexedContextStatus;
  indexedContextSourcesCount?: number;
  indexedContextFallbackReason?: string;
  requestReceivedAt?: string;
  liveAttemptStartedAt?: string;
  liveAttemptDurationMs?: number;
  fallbackDurationMs?: number;
  totalDurationMs?: number;
  timeoutMs?: number;
  contextSourceCount?: number;
  contextCharLength?: number;
  indexedSupplementCharLength?: number;
  authDurationMs?: number;
  sessionResolutionDurationMs?: number;
  contextPackBuildDurationMs?: number;
  indexedContextBuildDurationMs?: number;
  runtimeContext?: CmoRuntimeContext;
  sourceReviewContext?: CmoSourceReviewContext;
  sourceAnswerContext?: CmoSourceAnswerContext;
  sessionLocalSources?: CmoSessionLocalSource[];
  sessionLocalResearchResults?: CmoSessionLocalResearchResult[];
  activeSourceId?: string;
  sessionSummary?: string;
  sessionArtifacts?: Record<string, unknown>[];
  suggestedVaultUpdates?: Record<string, unknown>[];
  vaultUpdateApprovalEvents?: CmoVaultUpdateApprovalEvent[];
  decisionLayer?: CmoDecisionLayer;
  rawCapturePath?: string;
  rawCaptureStatus?: "saved" | "failed" | "pending";
  rawCaptureError?: string;
}

export interface RawCaptureRequest {
  workspaceId: string;
  date?: string;
  appId: string;
  appName: string;
  authMode?: CmoAuthMode;
  userId?: string;
  userEmail?: string;
  organizationId?: string;
  createdByUserId?: string;
  createdByEmail?: string;
  visibility?: "private" | "workspace" | "organization" | "system";
  captureOrigin?: "auto" | "manual";
  sourceClass?: string;
  reviewStatus?: string;
  gbrainStatus?: string;
  topic?: string;
  source: "cmo-chat" | string;
  summary: string;
  relatedSource?: "cmo-session" | string;
  sessionId?: string;
  sessionNotePath?: string;
  relatedPriority?: string;
  relatedPlan?: string;
  selectedContextNotes?: VaultNoteRef[];
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  contextUsed: VaultNoteRef[];
  missingContext?: VaultNoteRef[];
  runtimeStatus?: CMORuntimeStatus;
  runtimeMode?: CmoRuntimeMode;
  attemptedRuntimeMode?: CmoRuntimeMode;
  isDevelopmentFallback?: boolean;
  isRuntimeFallback?: boolean;
  runtimeErrorReason?: CmoRuntimeErrorReason;
  runtimeProvider?: string;
  runtimeAgent?: string;
  contextDiagnostics?: CMOContextDiagnostics;
  contextQualitySummary?: CMOContextQualitySummary;
  graphHints?: ContextGraphHint[];
  graphHintCount?: number;
  graphStatus?: ContextGraphStatus;
  decisionLayer?: CmoDecisionLayer;
  assumptions?: string[];
  suggestedActions?: CMOAppChatResponse["suggestedActions"];
  openQuestions?: string[];
}

export interface RawCaptureResponse {
  status: "saved";
  path: string;
  appended: boolean;
}

export interface DailyNoteGenerateRequest {
  workspaceId: string;
  date?: string;
  sourceRawPath?: string;
}

export interface DailyNoteGenerateResponse {
  status: "saved";
  path: string;
  sourceRawPath: string;
  generatedFromRawCaptures: boolean;
}
