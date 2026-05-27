export type CMOVaultCaptureEventType =
  | "cmo_session"
  | "echo_output"
  | "surf_research"
  | "surf_x_signal"
  | "last30days_trend"
  | "pulse_pack"
  | "cmo_decision"
  | "memory_candidate"
  | "ops_event";

export type CMOVaultCaptureMode = "off" | "dry_run" | "manual" | "auto_raw";
export type CMOVaultCaptureAuthMode = "supabase" | "legacy";

export type CMOVaultSourceAgent = "CMO" | "Echo" | "Surf";

export type CMOVaultSourceClass =
  | "verified_metric"
  | "official_source"
  | "source_backed_public"
  | "provided_input"
  | "social_signal"
  | "weak_trend_signal"
  | "cmo_interpretation"
  | "execution_artifact"
  | "user_feedback"
  | "team_feedback"
  | "operational_event"
  | "failure"
  | "composite";

export type CMOVaultReviewStatus =
  | "raw"
  | "review_candidate"
  | "cmo_approved"
  | "jay_approved"
  | "promoted"
  | "rejected"
  | "superseded";

export type CMOVaultVisibility = "private" | "workspace" | "organization" | "system" | "internal";

export interface CMOVaultEvidenceLink {
  label?: string;
  url: string;
  sourceClass?: CMOVaultSourceClass;
}

export interface CMOVaultDateRange {
  start?: string;
  end?: string;
}

export interface CMOVaultCaptureEvent {
  type: CMOVaultCaptureEventType;
  captureMode?: CMOVaultCaptureMode;
  title?: string;
  id?: string;
  sessionId?: string;
  requestId?: string;
  createdAt: string;
  authMode?: CMOVaultCaptureAuthMode;
  userId?: string;
  userEmail?: string;
  organizationId?: string;
  createdByUserId?: string;
  createdByEmail?: string;
  sourceUserId?: string;
  sourceUserEmail?: string;
  sourceUserMessageId?: string;
  workspaceId?: string;
  workspaceGroup?: string;
  project?: string;
  topic?: string;
  platform?: string;
  sourceAgent: CMOVaultSourceAgent;
  mode?: string;
  skill?: string;
  sourceClass: CMOVaultSourceClass;
  reviewStatus?: CMOVaultReviewStatus;
  visibility?: CMOVaultVisibility;
  dateRange?: CMOVaultDateRange;
  summary: string;
  keyFindings?: string[];
  payloadSummary?: string;
  rawExcerpt?: string;
  evidenceLinks?: CMOVaultEvidenceLink[];
  sourceUrls?: string[];
  related?: string[];
  warnings?: string[];
  nextChecks?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  captureOrigin?: "manual" | "auto";
  gbrainStatus?: "pending" | "processed" | "skipped";
  messageId?: string;
  redactionApplied?: boolean;
  redactionTypes?: string[];
}

export interface CMOVaultCaptureTarget {
  vaultId: "cmo-engine";
  vaultPath: string;
  relativePath: string;
  folder: string;
  filename: string;
  collisionPolicy: "append-counter" | "append-timestamp" | "merge-by-session";
}

export interface CMOVaultCaptureResult {
  ok: boolean;
  mode: "dry_run";
  target?: CMOVaultCaptureTarget;
  markdown?: string;
  savedToVault: false;
  warnings: string[];
  error?: string;
}
