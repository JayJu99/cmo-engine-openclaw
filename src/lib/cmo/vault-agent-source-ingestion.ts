import {
  CANONICAL_VAULT_LANGUAGE,
  SOURCE_INGESTION_PACKAGE_SCHEMA_VERSION,
  type SourceIngestionPackage,
  type SourceIngestionScope,
  type SourceIngestionSourceType,
  type SourceIngestionVisibility,
} from "./vault-agent-contracts";
import type { CmoServerUserIdentity } from "./user-metadata";
import { resolveWorkspaceRegistryEntry } from "./workspace-registry";

export interface CmoSourceIngestionRequest {
  appId?: string;
  workspace_id?: string;
  workspaceId?: string;
  tenant_id?: string;
  tenantId?: string;
  source_title?: string;
  sourceTitle?: string;
  source_type?: SourceIngestionSourceType;
  sourceType?: SourceIngestionSourceType;
  source_text?: string;
  sourceText?: string;
  original_filename?: string;
  originalFilename?: string;
  original_language?: string;
  originalLanguage?: string;
  extracted_summary?: string;
  extractedSummary?: string;
  visual_summary?: string;
  visualSummary?: string;
  table_summary?: string;
  tableSummary?: string;
  scope?: SourceIngestionScope;
  visibility?: SourceIngestionVisibility;
  session_id?: string;
  sessionId?: string;
  source_refs?: string[];
  sourceRefs?: string[];
}

export interface SourceIngestionReceiptMetadata {
  source_ingestion_status: "completed" | "rejected" | "failed";
  source_record_ids?: Record<string, string>;
  source_target_paths?: Record<string, string>;
  source_write_performed?: boolean;
  source_warnings: string[];
  source_errors: string[];
  gbrain_called: false;
  promotion_performed: false;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : undefined;
}

function sourceType(value: unknown): SourceIngestionSourceType {
  return value === "text" ||
    value === "document" ||
    value === "image" ||
    value === "screenshot" ||
    value === "spreadsheet" ||
    value === "url" ||
    value === "other"
    ? value
    : "text";
}

function scopeValue(value: unknown, hasSession: boolean): SourceIngestionScope {
  if (value === "user" || value === "workspace" || value === "session") {
    return value;
  }

  return hasSession ? "session" : "workspace";
}

function visibilityValue(value: unknown): SourceIngestionVisibility {
  return value === "private" || value === "workspace" ? value : "workspace";
}

function stableUserRef(identity?: CmoServerUserIdentity): string {
  return identity?.userEmail?.trim() || identity?.createdByEmail?.trim() || "legacy_dashboard_user";
}

export function buildSourceIngestionPackage(
  input: CmoSourceIngestionRequest,
  identity?: CmoServerUserIdentity,
  now = new Date().toISOString(),
): SourceIngestionPackage {
  const appId = stringValue(input.appId) ?? stringValue(input.workspace_id) ?? stringValue(input.workspaceId);
  const registryEntry = appId ? resolveWorkspaceRegistryEntry(appId) : undefined;
  const workspaceId = registryEntry?.workspaceId ?? appId;
  const tenantId = stringValue(input.tenant_id) ?? stringValue(input.tenantId) ?? registryEntry?.tenantId;
  const sourceTitle = stringValue(input.source_title) ?? stringValue(input.sourceTitle);
  const sessionId = stringValue(input.session_id) ?? stringValue(input.sessionId);
  const userId = identity?.userId;
  const userRef = userId ? undefined : stableUserRef(identity);

  if (!tenantId) {
    throw new Error("tenant_id is required for source ingestion.");
  }

  if (!workspaceId) {
    throw new Error("workspace_id or appId is required for source ingestion.");
  }

  if (!sourceTitle) {
    throw new Error("source_title is required for source ingestion.");
  }

  const bodyText = stringValue(input.source_text) ?? stringValue(input.sourceText);
  const extractedSummary = stringValue(input.extracted_summary) ?? stringValue(input.extractedSummary);
  const visualSummary = stringValue(input.visual_summary) ?? stringValue(input.visualSummary);
  const tableSummary = stringValue(input.table_summary) ?? stringValue(input.tableSummary);

  if (!bodyText && !extractedSummary && !visualSummary && !tableSummary) {
    throw new Error("source_text, extracted_summary, visual_summary, or table_summary is required for source ingestion.");
  }

  return {
    schema_version: SOURCE_INGESTION_PACKAGE_SCHEMA_VERSION,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    ...(userId ? { user_id: userId } : { user_ref: userRef }),
    ...(sessionId ? { session_id: sessionId } : {}),
    source_type: sourceType(input.source_type ?? input.sourceType),
    source_title: sourceTitle,
    ...(stringValue(input.original_filename) ?? stringValue(input.originalFilename)
      ? { original_filename: stringValue(input.original_filename) ?? stringValue(input.originalFilename) }
      : {}),
    original_language: stringValue(input.original_language) ?? stringValue(input.originalLanguage) ?? "en",
    canonical_language: CANONICAL_VAULT_LANGUAGE,
    ...(bodyText ? { source_text: bodyText } : {}),
    ...(extractedSummary ? { extracted_summary: extractedSummary } : {}),
    ...(visualSummary ? { visual_summary: visualSummary } : {}),
    ...(tableSummary ? { table_summary: tableSummary } : {}),
    no_auto_promote: true,
    visibility: visibilityValue(input.visibility),
    scope: scopeValue(input.scope, Boolean(sessionId)),
    ...(stringList(input.source_refs) ?? stringList(input.sourceRefs)
      ? { source_refs: stringList(input.source_refs) ?? stringList(input.sourceRefs) }
      : {}),
    created_at: now,
  };
}
