export const VAULT_AGENT_CONTRACT_VERSION = "cmo.vault-agent.v1" as const;
export const VAULT_AGENT_WRITER = "vault_agent" as const;
export const VAULT_AGENT_WRITER_VERSION = "m3.3a-dry-run" as const;
export const CANONICAL_VAULT_LANGUAGE = "en" as const;

export type VaultRecordType =
  | "turn_log"
  | "session_summary"
  | "daily_lesson"
  | "memory_candidate"
  | "decision_candidate"
  | "source_asset"
  | "source_note"
  | "visual_analysis"
  | "table_data_summary"
  | "workspace_candidate"
  | "workspace_knowledge"
  | "wiki_page";

export type VaultContextScope = "user" | "session" | "workspace" | "global";
export type VaultVisibility = "private" | "workspace" | "organization" | "system";
export type VaultTruthStatus = "raw" | "candidate" | "accepted" | "rejected" | "superseded";
export type VaultReviewStatus = "unreviewed" | "review_required" | "approved" | "rejected" | "deferred";
export type VaultGBrainStatus = "not_indexable" | "pending_index" | "indexed" | "skipped";
export type VaultPiiPolicy = "raw_private" | "redacted" | "safe_public" | "unknown";
export type VaultTranslationStatus = "not_required" | "pending" | "translated" | "mixed";
export type VaultSourceAgent = "CMO" | "Echo" | "Surf" | "Vault Agent" | "GBrain" | "User" | "System";

export interface TurnCompletedPackage {
  tenant_id: string;
  workspace_id: string;
  user_id?: string;
  user_ref?: string;
  session_id: string;
  turn_id?: string;
  message_id?: string;
  source_agent: VaultSourceAgent;
  title?: string;
  original_text?: string;
  canonical_summary?: string;
  original_language?: string;
  source_refs?: string[];
  related_records?: string[];
  created_at: string;
}

export interface VaultRecordFrontmatter {
  schema_version: typeof VAULT_AGENT_CONTRACT_VERSION;
  record_id: string;
  tenant_id: string;
  workspace_id?: string;
  user_id?: string;
  user_ref?: string;
  session_id?: string;
  turn_id?: string;
  message_id?: string;
  source_agent: VaultSourceAgent;
  writer: typeof VAULT_AGENT_WRITER;
  writer_version: typeof VAULT_AGENT_WRITER_VERSION;
  scope: VaultContextScope;
  visibility: VaultVisibility;
  record_type: VaultRecordType;
  truth_status: VaultTruthStatus;
  review_status: VaultReviewStatus;
  gbrain_status: VaultGBrainStatus;
  gbrain_index: boolean;
  agent_visible: boolean;
  pii_policy: VaultPiiPolicy;
  redaction_applied: boolean;
  original_language: string;
  canonical_language: typeof CANONICAL_VAULT_LANGUAGE;
  translation_status: VaultTranslationStatus;
  source_refs: string[];
  related_records: string[];
  created_at: string;
  updated_at: string;
}

export interface VaultAgentRecordInput {
  tenant_id?: string;
  workspace_id?: string;
  user_id?: string;
  user_ref?: string;
  session_id?: string;
  turn_id?: string;
  message_id?: string;
  source_agent?: VaultSourceAgent;
  scope?: VaultContextScope;
  visibility?: VaultVisibility;
  record_type: VaultRecordType;
  truth_status?: VaultTruthStatus;
  review_status?: VaultReviewStatus;
  gbrain_status?: VaultGBrainStatus;
  gbrain_index?: boolean;
  agent_visible?: boolean;
  pii_policy?: VaultPiiPolicy;
  redaction_applied?: boolean;
  original_language?: string;
  translation_status?: VaultTranslationStatus;
  source_refs?: string[];
  related_records?: string[];
  created_at?: string;
  updated_at?: string;
  title?: string;
  original_text?: string;
  canonical_summary?: string;
  safe_original_name?: string;
  source_asset_id?: string;
  source_note_id?: string;
  accepted_claims?: string[];
  cited_claims?: string[];
}

export interface NormalizedVaultRecord {
  frontmatter: VaultRecordFrontmatter;
  title: string;
  original_text?: string;
  canonical_summary?: string;
  safe_original_name?: string;
  source_asset_id?: string;
  source_note_id?: string;
  accepted_claims: string[];
  cited_claims: string[];
}

export interface VaultAgentWriteReceipt {
  schema_version: typeof VAULT_AGENT_CONTRACT_VERSION;
  record_id: string;
  status: "dry_run" | "validated" | "rejected";
  write_confirmed: false;
  target_path_preview?: string;
  markdown_preview?: string;
  validation_errors: string[];
  validation_warnings: string[];
  no_filesystem_write: true;
  no_gbrain_call: true;
}

export interface GBrainIndexDecision {
  gbrain_index: boolean;
  gbrain_status: VaultGBrainStatus;
  reason: string;
  required_filters: {
    tenant_id: string;
    workspace_id?: string;
    user_id?: string;
    user_ref?: string;
    session_id?: string;
  };
}

export interface PromotionDecision {
  eligible: boolean;
  target_truth_status: VaultTruthStatus;
  requires_review: boolean;
  reason: string;
  blocked_by: string[];
}

export interface VaultValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
