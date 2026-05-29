import { createHash } from "node:crypto";

import {
  CANONICAL_VAULT_LANGUAGE,
  VAULT_AGENT_CONTRACT_VERSION,
  VAULT_AGENT_WRITER,
  VAULT_AGENT_WRITER_VERSION,
  type NormalizedVaultRecord,
  type TurnCompletedPackage,
  type VaultAgentRecordInput,
  type VaultAgentWriteReceipt,
  type VaultRecordFrontmatter,
  type VaultRecordType,
} from "./vault-agent-contracts";
import {
  decideIndexability,
  decidePromotionEligibility,
  validateVaultRecord,
} from "./vault-scope-policy";

const SOURCE_PATH_TYPES = new Set<VaultRecordType>([
  "source_asset",
  "source_note",
  "visual_analysis",
  "table_data_summary",
]);

function text(value: string | undefined, fallback = ""): string {
  return value?.trim() || fallback;
}

function stableHash(parts: Array<string | undefined>): string {
  return createHash("sha256").update(parts.map((part) => part ?? "").join("|")).digest("hex").slice(0, 20);
}

function stableRecordId(input: Pick<VaultAgentRecordInput, "tenant_id" | "workspace_id" | "user_id" | "user_ref" | "session_id" | "turn_id" | "message_id" | "record_type" | "source_agent">): string {
  return `rec_${stableHash([
    input.tenant_id,
    input.workspace_id,
    input.user_id || input.user_ref,
    input.session_id,
    input.turn_id || input.message_id,
    input.record_type,
    input.source_agent,
  ])}`;
}

function slug(value: string, fallback = "record"): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
    .replace(/-+$/g, "");

  return normalized || fallback;
}

function safeTitle(value: string): string {
  return text(value, "Untitled").replace(/[/\\:*?"<>|\r\n]/g, "-").replace(/\s+/g, " ").slice(0, 120).trim() || "Untitled";
}

function createdParts(createdAt: string): { year: string; month: string } {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return { year: "1970", month: "01" };
  }

  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
  };
}

function defaultScope(type: VaultRecordType): VaultRecordFrontmatter["scope"] {
  if (type === "turn_log") return "session";
  if (type === "session_summary") return "session";
  if (SOURCE_PATH_TYPES.has(type)) return "workspace";
  if (type === "daily_lesson" || type === "workspace_candidate" || type === "workspace_knowledge" || type === "wiki_page") return "workspace";
  return "session";
}

function defaultTruthStatus(type: VaultRecordType): VaultRecordFrontmatter["truth_status"] {
  if (type === "turn_log" || type === "source_asset") return "raw";
  if (type === "workspace_knowledge" || type === "wiki_page") return "candidate";
  return "candidate";
}

function defaultReviewStatus(type: VaultRecordType): VaultRecordFrontmatter["review_status"] {
  if (type === "turn_log" || type === "source_asset") return "unreviewed";
  return "review_required";
}

function defaultPiiPolicy(type: VaultRecordType): VaultRecordFrontmatter["pii_policy"] {
  if (type === "turn_log" || type === "source_asset") return "raw_private";
  return "redacted";
}

function defaultIndex(type: VaultRecordType): Pick<VaultRecordFrontmatter, "gbrain_index" | "gbrain_status"> {
  if (type === "source_asset" || type === "turn_log") {
    return { gbrain_index: false, gbrain_status: "not_indexable" };
  }

  return { gbrain_index: true, gbrain_status: "pending_index" };
}

function asList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((item) => item.trim()).filter(Boolean)));
}

export function normalizeVaultRecord(input: VaultAgentRecordInput | TurnCompletedPackage): NormalizedVaultRecord {
  const recordInput = "record_type" in input
    ? input
    : {
        ...input,
        record_type: "turn_log" as const,
        scope: "session" as const,
        visibility: "private" as const,
        source_agent: input.source_agent,
        original_text: input.original_text,
        canonical_summary: input.canonical_summary,
      };
  const now = new Date().toISOString();
  const sourceAgent = recordInput.source_agent ?? "Vault Agent";
  const title = safeTitle(recordInput.title ?? recordInput.canonical_summary ?? recordInput.original_text ?? recordInput.record_type);
  const indexDefaults = defaultIndex(recordInput.record_type);
  const fm: VaultRecordFrontmatter = {
    schema_version: VAULT_AGENT_CONTRACT_VERSION,
    record_id: stableRecordId({ ...recordInput, source_agent: sourceAgent }),
    tenant_id: text(recordInput.tenant_id),
    workspace_id: text(recordInput.workspace_id) || undefined,
    user_id: text(recordInput.user_id) || undefined,
    user_ref: text(recordInput.user_ref) || undefined,
    session_id: text(recordInput.session_id) || undefined,
    turn_id: text(recordInput.turn_id) || undefined,
    message_id: text(recordInput.message_id) || undefined,
    source_agent: sourceAgent,
    writer: VAULT_AGENT_WRITER,
    writer_version: VAULT_AGENT_WRITER_VERSION,
    scope: recordInput.scope ?? defaultScope(recordInput.record_type),
    visibility: recordInput.visibility ?? "private",
    record_type: recordInput.record_type,
    truth_status: recordInput.truth_status ?? defaultTruthStatus(recordInput.record_type),
    review_status: recordInput.review_status ?? defaultReviewStatus(recordInput.record_type),
    gbrain_status: recordInput.gbrain_status ?? indexDefaults.gbrain_status,
    gbrain_index: recordInput.gbrain_index ?? indexDefaults.gbrain_index,
    agent_visible: recordInput.agent_visible ?? recordInput.visibility !== "private",
    pii_policy: recordInput.pii_policy ?? defaultPiiPolicy(recordInput.record_type),
    redaction_applied: recordInput.redaction_applied ?? false,
    original_language: text(recordInput.original_language, "unknown"),
    canonical_language: CANONICAL_VAULT_LANGUAGE,
    translation_status: recordInput.translation_status ?? (recordInput.original_language && recordInput.original_language !== "en" ? "pending" : "not_required"),
    source_refs: asList(recordInput.source_refs),
    related_records: asList(recordInput.related_records),
    created_at: text(recordInput.created_at, now),
    updated_at: text(recordInput.updated_at, text(recordInput.created_at, now)),
  };

  return {
    frontmatter: fm,
    title,
    original_text: text(recordInput.original_text) || undefined,
    canonical_summary: text(recordInput.canonical_summary) || undefined,
    safe_original_name: text(recordInput.safe_original_name) || undefined,
    source_asset_id: text(recordInput.source_asset_id) || undefined,
    source_note_id: text(recordInput.source_note_id) || undefined,
    accepted_claims: asList(recordInput.accepted_claims),
    cited_claims: asList(recordInput.cited_claims),
  };
}

export function buildSourceMapPath(workspaceId: string): string {
  return `13 Sources/Source Maps/${slug(workspaceId, "workspace")}.md`;
}

export function buildCanonicalPath(record: NormalizedVaultRecord): string {
  const fm = record.frontmatter;
  const { year, month } = createdParts(fm.created_at);
  const workspaceId = slug(fm.workspace_id ?? "unknown-workspace", "unknown-workspace");
  const titleSlug = slug(record.title);
  const sourceAssetId = slug(record.source_asset_id ?? fm.record_id, "source-asset");
  const sourceNoteId = slug(record.source_note_id ?? fm.record_id, "source-note");

  if (fm.record_type === "source_asset") {
    const safeName = safeTitle(record.safe_original_name ?? record.title);
    return `13 Sources/Assets/${workspaceId}/${year}/${month}/${sourceAssetId} - ${safeName}`;
  }

  if (fm.record_type === "source_note") {
    return `13 Sources/Source Notes/${workspaceId}/${year}/${month}/${sourceNoteId} - ${titleSlug}.md`;
  }

  if (fm.record_type === "visual_analysis") {
    return `13 Sources/Visual Analysis/${workspaceId}/${year}/${month}/${sourceNoteId} - ${titleSlug}.md`;
  }

  if (fm.record_type === "table_data_summary") {
    return `13 Sources/Tables & Data/${workspaceId}/${year}/${month}/${sourceNoteId} - ${titleSlug}.md`;
  }

  if (fm.record_type === "wiki_page") {
    return `12 Knowledge/Wiki/${workspaceId}/${titleSlug}.md`;
  }

  if (fm.record_type === "workspace_knowledge") {
    return `12 Knowledge/Workspace/${workspaceId}/${titleSlug}.md`;
  }

  return `09 Proposals/Vault Agent Dry Run/${workspaceId}/${year}/${month}/${fm.record_id} - ${titleSlug}.md`;
}

function yamlScalar(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === undefined || value === null) return '""';
  return JSON.stringify(value);
}

function yamlList(values: string[]): string {
  if (values.length === 0) return " []";
  return values.map((value) => `\n  - ${JSON.stringify(value)}`).join("");
}

function frontmatterMarkdown(fm: VaultRecordFrontmatter): string {
  return [
    "---",
    `schema_version: ${yamlScalar(fm.schema_version)}`,
    `record_id: ${yamlScalar(fm.record_id)}`,
    `tenant_id: ${yamlScalar(fm.tenant_id)}`,
    `workspace_id: ${yamlScalar(fm.workspace_id ?? "")}`,
    `user_id: ${yamlScalar(fm.user_id ?? "")}`,
    `user_ref: ${yamlScalar(fm.user_ref ?? "")}`,
    `session_id: ${yamlScalar(fm.session_id ?? "")}`,
    `turn_id: ${yamlScalar(fm.turn_id ?? "")}`,
    `message_id: ${yamlScalar(fm.message_id ?? "")}`,
    `source_agent: ${yamlScalar(fm.source_agent)}`,
    `writer: ${yamlScalar(fm.writer)}`,
    `writer_version: ${yamlScalar(fm.writer_version)}`,
    `scope: ${yamlScalar(fm.scope)}`,
    `visibility: ${yamlScalar(fm.visibility)}`,
    `record_type: ${yamlScalar(fm.record_type)}`,
    `truth_status: ${yamlScalar(fm.truth_status)}`,
    `review_status: ${yamlScalar(fm.review_status)}`,
    `gbrain_status: ${yamlScalar(fm.gbrain_status)}`,
    `gbrain_index: ${yamlScalar(fm.gbrain_index)}`,
    `agent_visible: ${yamlScalar(fm.agent_visible)}`,
    `pii_policy: ${yamlScalar(fm.pii_policy)}`,
    `redaction_applied: ${yamlScalar(fm.redaction_applied)}`,
    `original_language: ${yamlScalar(fm.original_language)}`,
    `canonical_language: ${yamlScalar(fm.canonical_language)}`,
    `translation_status: ${yamlScalar(fm.translation_status)}`,
    `source_refs:${yamlList(fm.source_refs)}`,
    `related_records:${yamlList(fm.related_records)}`,
    `created_at: ${yamlScalar(fm.created_at)}`,
    `updated_at: ${yamlScalar(fm.updated_at)}`,
    "---",
  ].join("\n");
}

function wikilink(label: string, id: string | undefined): string | null {
  return id ? `- ${label}: [[${id}]]` : null;
}

function links(record: NormalizedVaultRecord): string {
  const fm = record.frontmatter;
  const items = [
    wikilink("Workspace", fm.workspace_id),
    wikilink("User", fm.user_id ?? fm.user_ref),
    wikilink("Session", fm.session_id),
    wikilink("Source Asset", record.source_asset_id),
    wikilink("Source Note", record.source_note_id),
    fm.record_type.includes("candidate") ? wikilink("Candidate", fm.record_id) : null,
    fm.record_type === "decision_candidate" ? wikilink("Decision", fm.record_id) : null,
    fm.record_type === "workspace_knowledge" || fm.record_type === "wiki_page" ? wikilink("Knowledge/Wiki page", fm.record_id) : null,
    ...fm.source_refs.map((ref) => `- Source Ref: [[${ref}]]`),
    ...fm.related_records.map((ref) => `- Related Record: [[${ref}]]`),
  ].filter((item): item is string => Boolean(item));

  return items.length ? items.join("\n") : "- None.";
}

export function buildMarkdownPreview(record: NormalizedVaultRecord): string {
  const indexDecision = decideIndexability(record);
  const promotionDecision = decidePromotionEligibility(record);

  return [
    frontmatterMarkdown(record.frontmatter),
    "",
    `# ${record.title}`,
    "",
    "## Canonical English Summary",
    record.canonical_summary?.trim() || "Pending canonical English summary.",
    "",
    "## Original / Raw",
    record.original_text?.trim() || "No original/raw text included in this dry-run package.",
    "",
    "## Links",
    links(record),
    "",
    "## Scope / Index Decision",
    `- GBrain index: ${indexDecision.gbrain_index ? "true" : "false"}`,
    `- GBrain status: ${indexDecision.gbrain_status}`,
    `- Reason: ${indexDecision.reason}`,
    "",
    "## Promotion Decision",
    `- Eligible: ${promotionDecision.eligible ? "true" : "false"}`,
    `- Target truth status: ${promotionDecision.target_truth_status}`,
    `- Requires review: ${promotionDecision.requires_review ? "true" : "false"}`,
    `- Reason: ${promotionDecision.reason}`,
  ].join("\n");
}

export function buildVaultAgentDryRunReceipt(input: VaultAgentRecordInput | TurnCompletedPackage): VaultAgentWriteReceipt {
  const record = normalizeVaultRecord(input);
  const validation = validateVaultRecord(record);
  const targetPath = buildCanonicalPath(record);
  const markdown = buildMarkdownPreview(record);

  return {
    schema_version: VAULT_AGENT_CONTRACT_VERSION,
    record_id: record.frontmatter.record_id,
    status: validation.valid ? "dry_run" : "rejected",
    write_confirmed: false,
    target_path_preview: targetPath,
    markdown_preview: markdown,
    validation_errors: validation.errors,
    validation_warnings: validation.warnings,
    no_filesystem_write: true,
    no_gbrain_call: true,
  };
}
