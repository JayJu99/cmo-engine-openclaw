import type {
  GBrainIndexDecision,
  NormalizedVaultRecord,
  PromotionDecision,
  VaultValidationResult,
} from "./vault-agent-contracts";

const WORKSPACE_OR_SESSION_SCOPES = new Set(["workspace", "session"]);
const SOURCE_RECORD_TYPES = new Set(["source_asset", "source_note", "visual_analysis", "table_data_summary"]);
const PROCESSED_ENGLISH_TYPES = new Set([
  "session_summary",
  "daily_lesson",
  "memory_candidate",
  "decision_candidate",
  "source_note",
  "visual_analysis",
  "table_data_summary",
  "workspace_candidate",
  "workspace_knowledge",
  "wiki_page",
]);
const ACCEPTED_WORKSPACE_TYPES = new Set(["workspace_knowledge", "wiki_page"]);
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasUserIdentity(record: NormalizedVaultRecord): boolean {
  return Boolean(record.frontmatter.user_id || record.frontmatter.user_ref);
}

export function hasEmailLikeFrontmatter(record: NormalizedVaultRecord): boolean {
  const values = [
    record.frontmatter.user_id,
    record.frontmatter.user_ref,
    record.frontmatter.tenant_id,
    record.frontmatter.workspace_id,
    record.frontmatter.session_id,
  ].filter(Boolean);

  return values.some((value) => EMAIL_LIKE.test(String(value)));
}

export function validateVaultRecord(record: NormalizedVaultRecord): VaultValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fm = record.frontmatter;

  if (!fm.tenant_id) {
    errors.push("tenant_id is required.");
  }

  if (WORKSPACE_OR_SESSION_SCOPES.has(fm.scope) && !fm.workspace_id) {
    errors.push("workspace_id is required for workspace/session scoped records.");
  }

  if ((fm.scope === "user" || fm.scope === "session" || fm.visibility === "private") && !hasUserIdentity(record)) {
    errors.push("user_id or user_ref is required for private user/session records.");
  }

  if (fm.scope === "session" && !fm.session_id) {
    errors.push("session_id is required for session scoped records.");
  }

  if (fm.canonical_language !== "en") {
    errors.push("canonical_language must be en.");
  }

  if (PROCESSED_ENGLISH_TYPES.has(fm.record_type) && !record.canonical_summary?.trim()) {
    warnings.push("Processed record has no canonical English summary.");
  }

  if (fm.truth_status === "accepted" && ACCEPTED_WORKSPACE_TYPES.has(fm.record_type) && fm.source_refs.length === 0) {
    errors.push("Accepted workspace knowledge/wiki pages require safe provenance in source_refs.");
  }

  if ((fm.scope === "user" || fm.scope === "session") && fm.truth_status === "accepted" && fm.record_type !== "wiki_page") {
    errors.push("Session/user raw records cannot become accepted knowledge directly.");
  }

  if (fm.visibility !== "private" && (fm.scope === "user" || fm.scope === "session") && fm.truth_status === "raw") {
    errors.push("Private user/session raw content cannot cross into workspace/global context without a sanitized candidate.");
  }

  if (fm.record_type === "wiki_page" && fm.truth_status === "accepted") {
    const uncitedClaims = record.accepted_claims.filter((claim) => !record.cited_claims.includes(claim));
    if (uncitedClaims.length > 0) {
      errors.push("Accepted wiki page contains uncited accepted claims.");
    }
  }

  if (hasEmailLikeFrontmatter(record)) {
    warnings.push("Email-like frontmatter detected; record must not be indexed.");
  }

  if (SOURCE_RECORD_TYPES.has(fm.record_type) && !fm.workspace_id) {
    errors.push("Source records require workspace_id for 13 Sources pathing.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function decideIndexability(record: NormalizedVaultRecord): GBrainIndexDecision {
  const fm = record.frontmatter;
  const required_filters = {
    tenant_id: fm.tenant_id,
    ...(fm.workspace_id ? { workspace_id: fm.workspace_id } : {}),
    ...(fm.user_id ? { user_id: fm.user_id } : {}),
    ...(fm.user_ref ? { user_ref: fm.user_ref } : {}),
    ...(fm.session_id ? { session_id: fm.session_id } : {}),
  };

  if (!fm.tenant_id || (fm.scope !== "global" && !fm.workspace_id)) {
    return {
      gbrain_index: false,
      gbrain_status: "not_indexable",
      reason: "GBrain index/query rules require tenant and scoped workspace filters.",
      required_filters,
    };
  }

  if (hasEmailLikeFrontmatter(record)) {
    return {
      gbrain_index: false,
      gbrain_status: "not_indexable",
      reason: "Email-like frontmatter is present.",
      required_filters,
    };
  }

  if (fm.record_type === "source_asset") {
    return {
      gbrain_index: false,
      gbrain_status: "not_indexable",
      reason: "Original source assets/binaries are not indexable.",
      required_filters,
    };
  }

  if (fm.record_type === "source_note" && fm.redaction_applied) {
    return {
      gbrain_index: true,
      gbrain_status: "pending_index",
      reason: "Redacted source notes are indexable within tenant/workspace scope.",
      required_filters,
    };
  }

  if (fm.record_type === "visual_analysis") {
    const safe = fm.redaction_applied || fm.pii_policy === "safe_public" || fm.pii_policy === "redacted";
    return {
      gbrain_index: safe,
      gbrain_status: safe ? "pending_index" : "not_indexable",
      reason: safe ? "Visual analysis is redacted/safe." : "Visual analysis is not redacted or marked safe.",
      required_filters,
    };
  }

  if (fm.record_type === "turn_log") {
    const safe = fm.redaction_applied && Boolean(record.canonical_summary?.trim());
    return {
      gbrain_index: safe,
      gbrain_status: safe ? "pending_index" : "not_indexable",
      reason: safe ? "Raw turn log has safe summary and redaction." : "Raw turn logs are not indexable by default.",
      required_filters,
    };
  }

  if (fm.record_type === "workspace_candidate") {
    return {
      gbrain_index: true,
      gbrain_status: "pending_index",
      reason: "Workspace candidates are indexable as candidates only.",
      required_filters,
    };
  }

  if (fm.record_type === "workspace_knowledge" || fm.record_type === "wiki_page") {
    const safe = fm.truth_status === "accepted" && fm.source_refs.length > 0;
    return {
      gbrain_index: safe,
      gbrain_status: safe ? "pending_index" : "not_indexable",
      reason: safe ? "Accepted workspace knowledge has provenance." : "Accepted workspace knowledge/wiki page requires safe provenance.",
      required_filters,
    };
  }

  if (fm.truth_status === "candidate" || fm.review_status === "review_required") {
    return {
      gbrain_index: true,
      gbrain_status: "pending_index",
      reason: "Review candidate is indexable as candidate, not truth.",
      required_filters,
    };
  }

  return {
    gbrain_index: fm.gbrain_index,
    gbrain_status: fm.gbrain_status,
    reason: "Record uses normalized index fields.",
    required_filters,
  };
}

export function decidePromotionEligibility(record: NormalizedVaultRecord): PromotionDecision {
  const fm = record.frontmatter;
  const blocked_by: string[] = [];

  if (fm.truth_status === "raw") {
    blocked_by.push("raw_record");
  }

  if ((fm.scope === "user" || fm.scope === "session") && fm.visibility === "private") {
    blocked_by.push("private_scope_requires_sanitized_candidate");
  }

  if (fm.review_status !== "approved") {
    blocked_by.push("review_not_approved");
  }

  if (fm.source_refs.length === 0) {
    blocked_by.push("missing_safe_provenance");
  }

  if (fm.record_type === "workspace_candidate" || fm.record_type === "memory_candidate" || fm.record_type === "decision_candidate") {
    blocked_by.push("candidate_record_requires_review_gate");
  }

  return {
    eligible: blocked_by.length === 0,
    target_truth_status: blocked_by.length === 0 ? "accepted" : "candidate",
    requires_review: blocked_by.length > 0,
    reason: blocked_by.length === 0 ? "Record is eligible for accepted workspace knowledge." : "Record is not eligible for direct promotion.",
    blocked_by,
  };
}
