import { getCmoVaultContextPackMode, type CmoVaultContextPackMode } from "./config";
import type {
  CMOAppChatRequest,
  CMOChatSession,
  CMOContextPackage,
  VaultAgentContextPackMetadata,
  VaultAgentContextPackSourceMetadata,
  VaultAgentRuntimeContextPack,
} from "./app-workspace-types";
import {
  callHermesVaultAgentContextPack,
  type HermesVaultAgentContextPackReceipt,
  type HermesVaultAgentContextPackSource,
} from "./vault-agent-remote-client";
import { CONTEXT_PACK_REQUEST_SCHEMA_VERSION, type VaultAgentContextPackRequest } from "./vault-agent-contracts";
import type { CmoServerUserIdentity } from "./user-metadata";

const MAX_CONTEXT_PACK_SOURCES = 3;
const MAX_CONTEXT_PACK_TEXT_CHARS = 4_000;
const MAX_SOURCE_TEXT_CHARS = 700;
const MAX_QUERY_CHARS = 240;

export interface VaultAgentContextPackInput {
  request: CMOAppChatRequest;
  session?: Pick<CMOChatSession, "id" | "userEmail" | "createdByEmail" | "userId"> | null;
  sessionId?: string;
  userIdentity?: CmoServerUserIdentity;
  createdAt: string;
}

export interface VaultAgentContextPackHandoffResult {
  mode: CmoVaultContextPackMode;
  status: NonNullable<VaultAgentContextPackMetadata["context_pack_status"]>;
  request?: VaultAgentContextPackRequest;
  receipt?: HermesVaultAgentContextPackReceipt;
  hiddenText?: string;
  runtimeContextPack?: VaultAgentRuntimeContextPack;
  metadata: VaultAgentContextPackMetadata;
}

function stableUserRef(input: VaultAgentContextPackInput): string {
  return input.userIdentity?.userEmail?.trim() ||
    input.session?.userEmail?.trim() ||
    input.userIdentity?.createdByEmail?.trim() ||
    input.session?.createdByEmail?.trim() ||
    "legacy_dashboard_user";
}

function compactText(value: string, max = MAX_SOURCE_TEXT_CHARS): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length > max ? `${normalized.slice(0, max - 3).trimEnd()}...` : normalized;
}

export function contextPackQueryFromUserMessage(message: string): string {
  const milestone = message.match(/(?:^|[^\p{L}\p{N}])((?:m|M)\d+(?:\.\d+)?[A-Za-z]?)(?=$|[^\p{L}\p{N}])/u)?.[1];

  return milestone ? milestone.toUpperCase() : compactText(message, MAX_QUERY_CHARS);
}

function sourceSnippet(source: HermesVaultAgentContextPackSource): string {
  return compactText(source.excerpt_or_summary ?? source.summary ?? source.excerpt ?? "", MAX_SOURCE_TEXT_CHARS);
}

function sourceMetadata(source: HermesVaultAgentContextPackSource): VaultAgentContextPackSourceMetadata {
  return {
    title: source.title,
    ...(source.citation ? { citation: source.citation } : {}),
    ...(source.source_path ? { source_path: source.source_path } : {}),
    ...(source.source_id ? { source_id: source.source_id } : {}),
    ...(source.source_type ? { source_type: source.source_type } : {}),
    ...(source.scope ? { scope: source.scope } : {}),
    ...(source.visibility ? { visibility: source.visibility } : {}),
    ...(typeof source.confidence === "number" ? { confidence: source.confidence } : {}),
    ...(source.excerpt_or_summary ? { excerpt_or_summary: compactText(source.excerpt_or_summary, MAX_SOURCE_TEXT_CHARS) } : {}),
  };
}

function boundedHiddenText(receipt: HermesVaultAgentContextPackReceipt): string {
  const lines = [
    "## Vault Context Pack",
    "",
    "Read-only workspace context from Vault Agent. Use as supporting context only; do not treat it as newly accepted truth and do not mutate memory or Vault from this context.",
    "Vault Context Pack is internal workspace context from the CMO Engine Vault. If the context pack answers the user's question, use it directly. Do not call Surf just to recover internal Vault facts, milestones, source notes, decisions, or workspace memory. Call Surf only for external/current/live research, public verification, or information not present in Vault context.",
    "",
    ...receipt.sources.slice(0, MAX_CONTEXT_PACK_SOURCES).flatMap((source, index) => [
      `### Source ${index + 1}: ${source.title}`,
      source.citation ? `Citation: ${source.citation}` : "",
      source.source_path ? `Path: ${source.source_path}` : "",
      source.source_type ? `Source type: ${source.source_type}` : "",
      source.scope ? `Scope: ${source.scope}` : "",
      source.visibility ? `Visibility: ${source.visibility}` : "",
      typeof source.confidence === "number" ? `Confidence: ${source.confidence}` : "",
      sourceSnippet(source) ? `Summary/Excerpt: ${sourceSnippet(source)}` : "",
      "",
    ]),
  ].filter(Boolean);
  const text = lines.join("\n").trim();

  return text.length > MAX_CONTEXT_PACK_TEXT_CHARS
    ? `${text.slice(0, MAX_CONTEXT_PACK_TEXT_CHARS - 34).trimEnd()}\n\n[Vault Context Pack truncated.]`
    : text;
}

function metadataFromReceipt(
  mode: CmoVaultContextPackMode,
  receipt: HermesVaultAgentContextPackReceipt,
): VaultAgentContextPackMetadata {
  return {
    context_pack_mode: mode,
    context_pack_status: receipt.status === "empty"
      ? "empty"
      : receipt.status === "completed"
      ? receipt.source_count > 0 && receipt.sources.length > 0
        ? "completed"
        : "empty"
      : "rejected",
    context_pack_source_count: receipt.source_count,
    context_pack_sources: receipt.sources.slice(0, MAX_CONTEXT_PACK_SOURCES).map(sourceMetadata),
    context_pack_warnings: receipt.warnings,
    context_pack_errors: receipt.errors,
    gbrain_called: receipt.gbrain_called,
    vault_mutation: false,
    promotion_performed: false,
  };
}

export function buildVaultAgentContextPackRequest(input: VaultAgentContextPackInput): VaultAgentContextPackRequest {
  const userId = input.userIdentity?.userId ?? input.session?.userId;
  const userRef = userId ? undefined : stableUserRef(input);

  return {
    schema_version: CONTEXT_PACK_REQUEST_SCHEMA_VERSION,
    tenant_id: input.request.workspaceId,
    workspace_id: input.request.appId,
    ...(userId ? { user_id: userId } : { user_ref: userRef }),
    ...(input.sessionId ? { session_id: input.sessionId } : {}),
    query: contextPackQueryFromUserMessage(input.request.message),
    allowed_scopes: ["workspace"],
    max_results: MAX_CONTEXT_PACK_SOURCES,
    created_at: input.createdAt,
  };
}

export async function runVaultAgentContextPackHandoff(input: VaultAgentContextPackInput): Promise<VaultAgentContextPackHandoffResult> {
  const mode = getCmoVaultContextPackMode();

  if (mode === "off") {
    return {
      mode,
      status: "skipped",
      metadata: {
        context_pack_mode: mode,
        context_pack_status: "skipped",
        context_pack_source_count: 0,
        context_pack_sources: [],
        context_pack_warnings: [],
        context_pack_errors: [],
        gbrain_called: false,
        vault_mutation: false,
        promotion_performed: false,
      },
    };
  }

  const request = buildVaultAgentContextPackRequest(input);
  const remote = await callHermesVaultAgentContextPack(request);

  if (!remote.ok || !remote.receipt) {
    return {
      mode,
      status: "failed",
      request,
      metadata: {
        context_pack_mode: mode,
        context_pack_status: "failed",
        context_pack_source_count: 0,
        context_pack_sources: [],
        context_pack_warnings: remote.warnings,
        context_pack_errors: [remote.error ?? "Hermes Vault Agent context pack failed."],
        gbrain_called: false,
        vault_mutation: false,
        promotion_performed: false,
      },
    };
  }

  const metadata = metadataFromReceipt(mode, remote.receipt);
  const hiddenText = metadata.context_pack_status === "completed" ? boundedHiddenText(remote.receipt) : undefined;
  const runtimeContextPack: VaultAgentRuntimeContextPack | undefined = hiddenText
    ? {
        schema_version: "cmo.vault_context_pack.runtime.v1",
        mode,
        status: "completed",
        source_count: remote.receipt.source_count,
        hidden_text: hiddenText,
        sources: metadata.context_pack_sources ?? [],
        gbrain_called: remote.receipt.gbrain_called,
        vault_mutation: false,
        promotion_performed: false,
      }
    : undefined;

  return {
    mode,
    status: metadata.context_pack_status ?? "failed",
    request,
    receipt: remote.receipt,
    hiddenText,
    runtimeContextPack,
    metadata,
  };
}

export function applyVaultAgentContextPackToCmoContextPackage(
  contextPackage: CMOContextPackage,
  result: VaultAgentContextPackHandoffResult,
): CMOContextPackage {
  if (!result.runtimeContextPack) {
    return contextPackage;
  }

  return {
    ...contextPackage,
    contextPack: {
      ...contextPackage.contextPack,
      vaultAgentContextPack: result.runtimeContextPack,
    },
  };
}
