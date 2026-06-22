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
  source: "facebook_native" | "lens.facebook_page" | "placeholder" | "not_connected";
  sourceMeta?: {
    provider?: "meta" | "facebook" | string;
    pageName?: string | null;
    nativeStatus?: string | null;
    syncedAt?: string | null;
  };
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
  | "indexed_context_supplement"
  | "project_context";
export type CmoIndexedContextStatus = "off" | "skipped" | "used";
export type CmoRuntimeErrorReason =
  | "unsupported_chat_turn"
  | "timeout"
  | "invalid_response"
  | "empty_answer"
  | "execution_error";
export type HermesCmoChatStatus = "live" | "failed_then_existing_fallback" | "guardrail_violation_then_existing_fallback" | "interrupted";
export type HermesCmoDelegationsMode = "proposals_only" | "echo_surf_bounded";
export type CmoLensReadoutRangeKey = "this_week" | "last_7_days" | "last_30_days" | "this_month";
export type CmoProductRenderSource =
  | "hermes_cmo"
  | "fallback_after_hermes_failure"
  | "local_runtime_fallback"
  | "legacy_cmo_engine"
  | "direct_bridge"
  | "local_session_command";
export type CmoOuterTimeoutSource = "default_app_turn" | "creative_execute";
export type CmoRouteDecision = "app_turn" | "creative_execution" | "creative_ideation" | "creative_session" | "execute" | "tool_execute";
export type CmoStrategyMode = "DIAGNOSE" | "FOCUS" | "PRIORITIZE" | "REVIEW" | "RESET";
export type CmoDecisionLabel = "KEEP" | "CUT" | "TEST" | "SCALE" | "WAIT";
export type HermesCmoAgentUsed = "cmo" | "echo" | "surf" | "creative";
export type HermesCmoExecutableMode =
  | "echo.default"
  | "echo.source_translate"
  | "surf.default"
  | "surf.x"
  | "surf.trend"
  | "surf.pulse"
  | "creative"
  | "creative.default"
  | "creative.generate_image"
  | "creative.generate_video"
  | "creative.image_generation"
  | "creative_execution";
export type CmoCreativeDraftKind = "image" | "video";
export type CmoCreativeDecisionAction =
  | "propose_draft"
  | "present_draft"
  | "show_draft"
  | "refine_draft"
  | "execute"
  | "ask_clarification"
  | "blocked"
  | "cancel"
  | "none";

export interface CmoCreativeDraft {
  draft_id: string;
  kind: CmoCreativeDraftKind;
  title?: string;
  brief?: string;
  prompt?: string;
  negative_prompt?: string;
  format?: string;
  status?: string;
  created_turn_id?: string;
  updated_turn_id?: string;
}

export interface CmoCreativeAssetState {
  asset_id: string;
  kind: CmoCreativeDraftKind;
  status?: string;
  product_backed?: boolean;
  storage_backed?: boolean;
  preview_available?: boolean;
  download_available?: boolean;
  prompt?: string;
  visual_summary?: string;
  model?: string;
  operation?: string;
  mime_type?: string;
  asset_type?: CmoCreativeDraftKind;
  storage_path?: string;
  preview_url?: string;
  render_url?: string;
  signed_url?: string;
  transport_status?: string;
  sha256?: string;
  bytes?: number;
}

export interface CmoCreativeWorkingState {
  active_draft_id?: string | null;
  active_asset_id?: string | null;
  drafts: CmoCreativeDraft[];
  assets?: CmoCreativeAssetState[];
}

export interface CmoCreativeDecision {
  action: CmoCreativeDecisionAction;
  draft_id?: string;
  operation?: string;
  question?: string;
  reason?: string;
}

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
  user_id?: string;
  user_slug?: string;
  user_display_name?: string;
  email?: string;
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
  targetAgent: "echo" | "surf" | "creative";
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

export interface CmoActivityStepDisplay {
  key: string;
  label: string;
  status: "running" | "completed" | "failed" | "timed_out" | "waiting" | "skipped";
  detail?: string;
}

export interface CmoEvidenceSourceDisplay {
  key: string;
  sourceLabel:
    | "Lens / GA4 ad-hoc query"
    | "Lens / Product metric-definition snapshot"
    | "Lens / Dune business metrics"
    | "Lens / Facebook channel metrics"
    | "Vault / Lens Daily Report"
    | "Lens / GA4 cached snapshot";
  summary?: string;
  confidence?: string;
  rows: Array<{
    label: string;
    value: string;
  }>;
  warnings?: string[];
  caveats?: string[];
  collapsedByDefault: boolean;
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
  hermesEndpointTimeoutSource?: "default_execute" | "creative_execute" | "tool_endpoint" | "tool_timeout_override";
  timeout_source?: "default_execute" | "creative_execute" | "tool_endpoint" | "tool_timeout_override";
  outer_timeout_source?: CmoOuterTimeoutSource;
  route_decision?: "execute" | "creative_execution" | "creative_ideation" | "creative_session" | "tool_execute";
  creative_long_running_turn?: boolean;
  creative_timeout_ms?: number;
  workspace_fallback_suppressed_for_creative?: boolean;
  creative_ideation_detected?: boolean;
  cmo_owns_creative_decision?: boolean;
  creative_execution_requested?: boolean;
  creative_execution_response_received?: boolean;
  creative_execution_owner?: "cmo";
  creative_ideation_response_received?: boolean;
  creative_session_response_received?: boolean;
  creative_state_update_present?: boolean;
  creative_decision_present?: boolean;
  creative_session_decision_action?: string;
  creative_session_active_draft_id?: string;
  creative_session_followup_detected?: boolean;
  creative_working_state_present?: boolean;
  execute_decision_source?: string;
  creative_subprocess_executed?: boolean;
  artifact_transport_attempted?: boolean;
  creative_decision_operation?: string;
  activity_event_types?: string[];
  raw_activity_event_types?: string[];
  activity_events_allowed_for_creative_ideation?: boolean;
  activity_events_allowed_for_creative_execution?: boolean;
  creative_ideation_canonicalized?: boolean;
  creative_session_canonicalized?: boolean;
  creative_execution_canonicalized?: boolean;
  rejected_activity_event_type?: string;
  creative_state_persisted?: boolean;
  answer_basis_mode?: string;
  creative_response_received?: boolean;
  creative_metadata_present?: boolean;
  creative_draft_active?: boolean;
  creative_active_draft_id?: string;
  creative_drafts_count?: number;
  active_creative_context_present?: boolean;
  active_creative_asset_resolved?: boolean;
  active_creative_asset_resolution_source?: string;
  active_creative_asset_id?: string;
  creative_session_active_asset_id?: string;
  creative_assets_count?: number;
  creative_session_from_asset?: boolean;
  reference_assets_count?: number;
  active_reference_asset_id?: string;
  reference_asset_fetch_url_present?: boolean;
  reference_asset_fetch_url_absolute?: boolean;
  reference_asset_auth_ref_present?: boolean;
  reference_asset_auth_header?: string;
  reference_asset_sha256_present?: boolean;
  reference_asset_bytes_present?: boolean;
  s2s_artifact_download_enabled?: boolean;
  s2s_artifact_download_auth_used?: boolean;
  s2s_artifact_download_auth_valid?: boolean;
  s2s_artifact_download_http_status?: number;
  artifact_transport_mode?: string;
  creative_decision?: CmoCreativeDecision;
  rejected_by_m1_validator?: boolean;
  rejected_field?: string;
  m1_validation_result?: "accepted";
  side_effects_present?: boolean;
  side_effects_allowed_for_creative?: boolean;
  rejected_side_effect_type?: string;
  hermesToolEndpointEnabled?: boolean;
  sideEffects?: false | Record<string, boolean>;
  side_effects?: false | Record<string, boolean>;
  write_side_effects?: false | Record<string, boolean>;
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
  dry_run_results_count?: number;
  latest_dry_run_status?: CmoVaultApprovedWriteDryRunResult["status"];
  latest_dry_run_approval_id?: string;
  latest_dry_run_write_allowed?: boolean;
  write_results_count?: number;
  latest_write_status?: CmoVaultApprovedWriteResult["status"];
  latest_write_approval_id?: string;
  latest_vault_path?: string;
  write_source_endpoint?: "/agents/cmo/chat";
  vault_agent_write?: boolean;
  vault_write_performed?: boolean;
  delegationsMode: HermesCmoDelegationsMode;
  counters: HermesCmoSafetyCounters;
  forbiddenCounters: HermesCmoForbiddenCounters;
  requestId: string;
  responseStatus: string;
  toolsUsed?: string[];
  tools_used?: string[];
  tool_capable_cmo?: boolean;
  cmo_call_surf_used?: boolean;
  cmo_call_echo_used?: boolean;
  toolReadsCount?: number;
  toolTraceSummary?: Record<string, unknown>;
  tool_trace_summary?: Record<string, unknown>;
  lensReadoutAttached?: boolean;
  lens_readout_attached?: boolean;
  lensReadoutContract?: string;
  lens_readout_contract?: string;
  lensReadoutRangeKey?: CmoLensReadoutRangeKey;
  lens_readout_range_key?: CmoLensReadoutRangeKey;
  lensReadoutStatus?: string;
  lens_readout_status?: string;
  lensReadoutDataStatus?: string;
  lens_readout_data_status?: string;
  lensReadoutContextWarning?: string;
  lens_readout_context_warning?: string;
  attachmentTraceSummary?: Record<string, unknown>;
  attachment_trace_summary?: Record<string, unknown>;
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
  lensReadoutContext?: Record<string, unknown>;
  lensReadoutContextWarning?: string;
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

export type CmoAsyncToolRunStatus = "pending" | "running" | "completed" | "failed" | "timed_out" | "interrupted" | "cancelled";

export interface CmoSessionAttachmentStorage {
  kind: "supabase_storage";
  bucket: string;
  path: string;
  ref: string;
}

export interface CmoSessionAttachment {
  schema_version: "cmo.session_attachment.v1";
  attachment_id: string;
  filename: string;
  mime_type:
    | "image/png"
    | "image/jpeg"
    | "image/webp"
    | "application/pdf"
    | "text/plain"
    | "text/markdown"
    | "text/csv"
    | "application/json";
  size_bytes: number;
  sha256: string;
  storage: CmoSessionAttachmentStorage;
  created_at: string;
  tenant_id?: string;
  workspace_id: string;
  app_id: string;
  session_id?: string;
  message_id?: string;
  user_id?: string;
  user_email?: string;
  user_caption?: string;
  purpose_hint: "user_uploaded_context";
  no_auto_promote_12_knowledge: true;
}

export interface CMOChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  authMode?: CmoAuthMode;
  userId?: string;
  userEmail?: string;
  userDisplayName?: string;
  userSlug?: string;
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
  cmoRunId?: string;
  cmoRunStatus?: CmoAsyncToolRunStatus;
  cmoRunEndpoint?: "/agents/cmo/tool-execute";
  cmoRunToolsUsed?: HermesCmoAgentUsed[];
  cmoRunStartedAt?: string;
  cmoRunCompletedAt?: string;
  cmoRunDurationMs?: number;
  cmoRunTimeoutMs?: number;
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
  outerTimeoutMs?: number;
  outerTimeoutSource?: CmoOuterTimeoutSource;
  routeDecision?: CmoRouteDecision;
  creativeExecutionRequested?: boolean;
  creativeResponseReceived?: boolean;
  creativeMetadataPresent?: boolean;
  creativeNormalizationError?: string;
  creativeFallbackUsed?: boolean;
  creativeRejectedByM1Validator?: boolean;
  creativeRejectedField?: string;
  creativeSideEffectsPresent?: boolean;
  creativeSideEffectsAllowedForCreative?: boolean;
  creativeRejectedSideEffectType?: string;
  creativeWorkingState?: CmoCreativeWorkingState;
  creativeDecision?: CmoCreativeDecision;
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
  attachments?: CmoSessionAttachment[];
  activeSourceId?: string;
  sessionSummary?: string;
  creativeAssets?: Record<string, unknown>[];
  creative_assets?: Record<string, unknown>[];
  sessionArtifacts?: Record<string, unknown>[];
  suggestedVaultUpdates?: Record<string, unknown>[];
  vaultUpdateApprovalEvents?: CmoVaultUpdateApprovalEvent[];
  vaultUpdateDryRunResults?: CmoVaultApprovedWriteDryRunResult[];
  vaultUpdateWriteResults?: CmoVaultApprovedWriteResult[];
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

export interface CmoVaultApprovedWriteDryRunResult {
  schema_version: "vault_agent.approved_write_dry_run.v1";
  approval_id: string;
  idempotency_key: string;
  approval_payload_hash: string;
  dry_run: true;
  write_allowed: boolean;
  vault_write_performed: false;
  target_preview?: unknown;
  frontmatter_preview?: unknown;
  body_preview?: string;
  side_effects?: false | Record<string, false>;
  warnings?: string[];
  errors?: string[];
  created_at: string;
  status?: "completed" | "failed" | "conflict";
  conflict?: boolean;
  previous_approval_payload_hash?: string;
  latest_approval_payload_hash?: string;
  product_approval_payload_hash?: string;
}

export interface CmoVaultApprovedWriteResult {
  schema_version: "vault_agent.approved_write_result.v1";
  approval_id: string;
  idempotency_key: string;
  approval_payload_hash: string;
  vault_write_performed: boolean;
  vault_path?: string;
  content_hash?: string;
  deduped?: boolean;
  conflict?: boolean;
  side_effects?: false | Record<string, boolean>;
  warnings?: string[];
  errors?: string[];
  created_at: string;
  status?: "completed" | "failed" | "conflict" | "deduped" | "rejected";
  gbrain_index?: false;
  promotion_performed?: false;
  previous_approval_payload_hash?: string;
  latest_approval_payload_hash?: string;
  product_approval_payload_hash?: string;
}

export interface CMOChatSession {
  id: string;
  appId: string;
  appName: string;
  topic?: string;
  authMode?: CmoAuthMode;
  userId?: string;
  userEmail?: string;
  userDisplayName?: string;
  userSlug?: string;
  organizationId?: string;
  createdByUserId?: string;
  createdByEmail?: string;
  messages: CMOChatMessage[];
  contextUsed: VaultNoteRef[];
  status: "pending" | "running" | "completed" | "failed" | "timed_out";
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
  cmoRunId?: string;
  cmoRunStatus?: CmoAsyncToolRunStatus;
  cmoRunEndpoint?: "/agents/cmo/tool-execute";
  cmoRunToolsUsed?: HermesCmoAgentUsed[];
  cmoRunStartedAt?: string;
  cmoRunCompletedAt?: string;
  cmoRunDurationMs?: number;
  cmoRunTimeoutMs?: number;
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
  outerTimeoutMs?: number;
  outerTimeoutSource?: CmoOuterTimeoutSource;
  routeDecision?: CmoRouteDecision;
  creativeExecutionRequested?: boolean;
  creativeResponseReceived?: boolean;
  creativeMetadataPresent?: boolean;
  creativeNormalizationError?: string;
  creativeFallbackUsed?: boolean;
  creativeRejectedByM1Validator?: boolean;
  creativeRejectedField?: string;
  creativeSideEffectsPresent?: boolean;
  creativeSideEffectsAllowedForCreative?: boolean;
  creativeRejectedSideEffectType?: string;
  creativeWorkingState?: CmoCreativeWorkingState;
  creativeDecision?: CmoCreativeDecision;
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
  attachments?: CmoSessionAttachment[];
  activeSourceId?: string;
  sessionSummary?: string;
  creativeAssets?: Record<string, unknown>[];
  creative_assets?: Record<string, unknown>[];
  sessionArtifacts?: Record<string, unknown>[];
  suggestedVaultUpdates?: Record<string, unknown>[];
  vaultUpdateApprovalEvents?: CmoVaultUpdateApprovalEvent[];
  vaultUpdateDryRunResults?: CmoVaultApprovedWriteDryRunResult[];
  vaultUpdateWriteResults?: CmoVaultApprovedWriteResult[];
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
  rangeKey?: CmoLensReadoutRangeKey;
  message: string;
  topic?: string;
  forceFallback?: boolean;
  attachments?: CmoSessionAttachment[];
  context: {
    selectedNotes: VaultNoteRef[];
    mode: "app_context";
  };
}

export interface CMOAppChatResponse {
  messageId: string;
  sessionId: string;
  status: "pending" | "running" | "completed" | "failed" | "timed_out";
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
  cmoRunId?: string;
  cmoRunStatus?: CmoAsyncToolRunStatus;
  cmoRunEndpoint?: string;
  cmoRunToolsUsed?: string[];
  cmoRunStartedAt?: string;
  cmoRunCompletedAt?: string;
  cmoRunDurationMs?: number;
  cmoRunTimeoutMs?: number;
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
  outerTimeoutMs?: number;
  outerTimeoutSource?: CmoOuterTimeoutSource;
  routeDecision?: CmoRouteDecision;
  creativeExecutionRequested?: boolean;
  creativeResponseReceived?: boolean;
  creativeMetadataPresent?: boolean;
  creativeNormalizationError?: string;
  creativeFallbackUsed?: boolean;
  creativeRejectedByM1Validator?: boolean;
  creativeRejectedField?: string;
  creativeSideEffectsPresent?: boolean;
  creativeSideEffectsAllowedForCreative?: boolean;
  creativeRejectedSideEffectType?: string;
  creativeWorkingState?: CmoCreativeWorkingState;
  creativeDecision?: CmoCreativeDecision;
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
  creativeAssets?: Record<string, unknown>[];
  creative_assets?: Record<string, unknown>[];
  sessionArtifacts?: Record<string, unknown>[];
  suggestedVaultUpdates?: Record<string, unknown>[];
  vaultUpdateApprovalEvents?: CmoVaultUpdateApprovalEvent[];
  vaultUpdateDryRunResults?: CmoVaultApprovedWriteDryRunResult[];
  vaultUpdateWriteResults?: CmoVaultApprovedWriteResult[];
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
  userDisplayName?: string;
  userSlug?: string;
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
