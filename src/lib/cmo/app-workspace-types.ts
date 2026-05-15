export type VaultNoteType = "app-note" | "daily-note" | "raw-capture";
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
export type TaskTrackerStatus = "connected" | "not_connected" | "fallback";
export type TaskSummarySource = "task-tracker" | "vault" | "placeholder";

export interface AppWorkspace {
  id: string;
  name: string;
  slug: string;
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
  isDevelopmentFallback: boolean;
  contextUsedCount: number;
  contextQualitySummary?: CMOContextQualitySummary;
  savedToVault: boolean;
  rawCapturePath?: string;
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
export type ContextItemKind = "current_priority" | "app_memory" | "latest_sessions" | "promotion_candidates";
export type CmoRuntimeErrorReason =
  | "unsupported_chat_turn"
  | "timeout"
  | "invalid_response"
  | "empty_answer"
  | "execution_error";

export interface ContextItem {
  id: string;
  kind: ContextItemKind;
  title: string;
  source: {
    sourceId: string;
    type: "vault_note" | "vault_bundle" | "session_store" | "derived_candidates";
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
  exclusions: ContextExclusion[];
  contextQualitySummary: CMOContextQualitySummary;
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
}

export interface CMOChatSession {
  id: string;
  appId: string;
  appName: string;
  topic?: string;
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
  missingContext?: VaultNoteRef[];
  contextDiagnostics?: CMOContextDiagnostics;
  contextQualitySummary?: CMOContextQualitySummary;
  assumptions?: string[];
  suggestedActions?: CMOAppChatResponse["suggestedActions"];
  savedToVault?: boolean;
  rawCapturePath?: string;
  sessionNotePath?: string;
  relatedPriority?: string;
  relatedPlan?: string;
  relatedTasks?: string[];
}

export interface CMOAppChatRequest {
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
  contextDiagnostics?: CMOContextDiagnostics;
  contextQualitySummary?: CMOContextQualitySummary;
}

export interface RawCaptureRequest {
  workspaceId: string;
  date?: string;
  appId: string;
  appName: string;
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
  contextDiagnostics?: CMOContextDiagnostics;
  contextQualitySummary?: CMOContextQualitySummary;
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
