import { createHash, randomUUID } from "crypto";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import path from "path";

import type {
  CMOAppChatRequest,
  CMOAppChatResponse,
  CMOContextDiagnostics,
  CMOContextQuality,
  CMOContextQualitySummary,
  CMOChatMessage,
  CMOChatSession,
  CMORuntimeStatus,
  CmoCreativeAssetState,
  CmoCreativeDecision,
  CmoCreativeWorkingState,
  CmoAsyncToolRunStatus,
  CmoAuthMode,
  CmoDecisionLabel,
  CmoProductRenderSource,
  CmoRuntimeErrorReason,
  CmoRuntimeMode,
  CmoSessionAttachment,
  CmoSessionLocalSource,
  CmoSourceAnswerContext,
  CmoSourceReviewContext,
  CmoStrategyMode,
  CmoVaultApprovedWriteDryRunResult,
  CmoVaultApprovedWriteResult,
  CmoVaultUpdateApprovalEvent,
  CmoVaultUpdateReviewAction,
  CmoAssumptionReviewStatus,
  CmoDecisionLayer,
  CmoDecisionReviewStatus,
  CmoIndexedContextStatus,
  CmoLensReadoutRangeKey,
  HermesCmoActivityEventSummary,
  HermesCmoAgentUsed,
  HermesCmoChatMetadata,
  HermesCmoChatStatus,
  HermesCmoDelegationSummaryItem,
  HermesCmoDelegationsMode,
  HermesCmoForbiddenCounters,
  HermesCmoPlatformPersistenceSummary,
  HermesCmoSafetyCounters,
  VaultAgentDryRunMetadata,
  VaultAgentContextPackMetadata,
  CmoMemoryCandidateReviewStatus,
  CmoSessionLocalResearchResult,
  CmoSuggestedActionReviewStatus,
  CmoTaskCandidateReviewStatus,
  ContextGraphHint,
  ContextGraphHintConfidence,
  ContextGraphHintSourceType,
  ContextGraphStatus,
  VaultNoteRef,
} from "@/lib/cmo/app-workspace-types";
import {
  bindCmoAttachmentsToTurn,
  cmoAttachmentsForHermes,
  normalizeCmoSessionAttachments,
} from "@/lib/cmo/attachments";
import { getAppWorkspace } from "@/lib/cmo/app-workspaces";
import { buildContextPack, withContextPackMessage } from "@/lib/cmo/context-pack-builder";
import { summarizeContextQuality } from "@/lib/cmo/context-quality";
import { buildDecisionLayer } from "@/lib/cmo/decision-layer";
import { CmoAdapterError } from "@/lib/cmo/errors";
import { extractCreativeAssetsFromHermesResponse, hasCreativeExecutionMetadata } from "@/lib/cmo/creative-agent";
import {
  applyCreativeAssetStateUpdate,
  applySuggestedCreativeStateUpdate,
  extractCreativeDecision,
  extractSuggestedCreativeStateUpdate,
  hasCreativeWorkingStateDrafts,
  isProductBackedRenderableCreativeAsset,
  normalizeCreativeDecision,
  normalizeCreativeWorkingState,
  sanitizeCreativeAssetStates,
} from "@/lib/cmo/creative-draft-state";
import { isCreativeConversationOnlyIntent, isPureAcknowledgementIntent, routeIntentForMessage } from "@/lib/cmo/app-routing-intent";
import { executeMixedCmoEcho, isMixedCmoEchoRequest, mixedEchoNeedsClarification, buildMixedCmoEchoRuntimeMessage, maybeHandleEchoBridge } from "@/lib/cmo/echo-bridge";
import { buildCmoEvidenceRuntimeMessage, executeCmoSurfEvidence } from "@/lib/cmo/cmo-surf-orchestrator";
import {
  HERMES_CMO_PROPOSALS_ONLY,
  mapCmoChatToHermesCmoRequest,
  mapHermesCmoResponseToChatResult,
  sanitizeHermesCmoMappedChatResult,
  validateHermesCmoChatCounters,
} from "@/lib/cmo/hermes-cmo-chat-mapper";
import { resolveHermesCmoChatRoute, shouldUseHermesCmoChat } from "@/lib/cmo/hermes-cmo-chat-router";
import { runHermesCmoRuntime, type HermesCmoRuntimeResult } from "@/lib/cmo/hermes-cmo-runtime";
import {
  failedHermesCmoChatV11Metadata,
  fallbackHermesCmoChatV11Metadata,
  mapHermesCmoChatV11ToChatResult,
  mergeHermesCmoChatV11Artifacts,
  mergeHermesCmoChatV11SessionSummary,
  runHermesCmoChatV11,
  sanitizeHermesCmoChatV11Records,
  writeHermesCmoChatV11FallbackTrace,
} from "@/lib/cmo/hermes-cmo-chat-v11";
import { OUTBOUND_HERMES_CALLSITE_GUARD_VERSION } from "@/lib/cmo/hermes-outbound-payload-sanitizer";
import { maybeHandleSurfBridge } from "@/lib/cmo/surf-bridge";
import { FallbackRuntime, getRuntimeRegistry } from "@/lib/cmo/runtime";
import {
  getCmoHermesApiKey,
  getCmoHermesBaseUrl,
  getCmoHermesCmoAsyncToolRunTimeoutMs,
  getCmoHermesCreativeExecuteTimeoutMs,
  getCmoHermesTimeoutMs,
  getCmoVaultAgentHandoffMode,
} from "@/lib/cmo/config";
import { indexChatMessages, indexChatSession, type CmoIndexResult } from "@/lib/cmo/supabase-indexing";
import { applyIndexedContextSupplement, buildIndexedContextSupplement } from "@/lib/cmo/indexed-context-canary";
import { getLensReadoutContextForAppSafe, isCmoLensDirectContextEnabled } from "@/lib/cmo/lens-readout-context";
import { legacyUserIdentity, normalizeCmoRuntimeUserIdentity, type CmoServerUserIdentity } from "@/lib/cmo/user-metadata";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";
import { buildRuntimeContext, buildSourceReviewContextFromMessage } from "@/lib/cmo/source-acquisition";
import {
  buildSourceAnswerContext,
  buildSourceQualityReport,
  sourceCacheRole,
  sourceReadDepth,
  sourceToolReadRecommended,
} from "@/lib/cmo/source-acquisition/source-reader";
import { autoCaptureTurnOnce, type AutoCaptureResult } from "@/lib/cmo/vault-auto-capture";
import { applyVaultAgentContextPackToCmoContextPackage, runVaultAgentContextPackHandoff } from "@/lib/cmo/vault-agent-context-pack-handoff";
import { runVaultAgentDryRunHandoff } from "@/lib/cmo/vault-agent-handoff-builder";
import { vaultAgentDryRunMetadataForPersistence } from "@/lib/cmo/vault-agent-handoff-persistence";

const APP_CHAT_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "app-chat");
const DEFAULT_LIMIT = 20;
const CONTEXT_SIZE_WARNING_CHARS = 32_000;
const INDEXED_SUPPLEMENT_WARNING_CHARS = 4_000;
const LEGACY_AUTO_CAPTURE_WRITE_REMOTE_SKIP_REASON = "skipped_legacy_auto_capture_because_vault_agent_write_remote_enabled";
const MAX_SUGGESTED_VAULT_UPDATES_SESSION = 24;
const MAX_VAULT_UPDATE_APPROVAL_EVENTS = 80;
const PRODUCT_OUTBOUND_CREATIVE_CONTEXT_BLOCKED_MESSAGE =
  "Product blocked this Creative follow-up because the final outbound request still contained unsafe local artifact text after scrub. Please retry the turn; if it repeats, start a clean session so Product can rebuild context without polluted metadata.";
const PRODUCT_OUTBOUND_CREATIVE_CONTEXT_BLOCKED_ERROR =
  "Product blocked Hermes CMO request because the final outbound body still contained unsafe local path, secret, or artifact text after scrub.";
const PRODUCT_CREATIVE_CONTRACT_VIOLATION_MESSAGE =
  "Product blocked this Creative response because the turn was marked non-mutating, but Hermes returned an image execution. The previous active asset was preserved.";

const isProductOutboundCreativeContextBlock = (reason: string): boolean =>
  reason.includes(PRODUCT_OUTBOUND_CREATIVE_CONTEXT_BLOCKED_ERROR);

function creativeAssetsFromHermesPayload(input: {
  response: unknown;
  tenantId: string;
  workspaceId: string;
  appId: string;
  jobId?: string;
  createdAt: string;
}): Record<string, unknown>[] {
  return extractCreativeAssetsFromHermesResponse(input.response, {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    appId: input.appId,
    jobId: input.jobId,
    createdAt: input.createdAt,
  }).map((asset) => ({ ...asset }));
}

type ActiveCreativeAssetResolutionSource = "creativeWorkingState" | "sessionArtifacts" | "messageCreativeAssets" | "none";

interface ActiveCreativeAssetResolution {
  asset?: CmoCreativeAssetState;
  source: ActiveCreativeAssetResolutionSource;
}

function isReferenceableCreativeImageAsset(asset: CmoCreativeAssetState | undefined): asset is CmoCreativeAssetState {
  return Boolean(asset?.kind === "image" && isProductBackedRenderableCreativeAsset(asset));
}

function normalizeCreativeAssetCandidates(values: unknown[]): CmoCreativeAssetState[] {
  const candidates = values.flatMap((value) => {
      if (Array.isArray(value)) {
        return value;
      }

      if (!isRecord(value)) {
        return [];
      }

      return [value];
    });

  return sanitizeCreativeAssetStates(candidates).filter(isReferenceableCreativeImageAsset);
}

function messageCreativeAssetCandidates(message: CMOChatMessage): CmoCreativeAssetState[] {
  const record = message as unknown as Record<string, unknown>;

  return normalizeCreativeAssetCandidates([
    record.creative_assets,
    record.creativeAssets,
    record.artifacts,
  ]);
}

function resolveActiveCreativeAsset(session: CMOChatSession | null): ActiveCreativeAssetResolution {
  if (!session) {
    return { source: "none" };
  }

  const workingStateAssets = (session.creativeWorkingState?.assets ?? []).filter(isReferenceableCreativeImageAsset);
  const activeAssetId = session.creativeWorkingState?.active_asset_id;
  const sessionArtifactAssets = normalizeCreativeAssetCandidates(session.sessionArtifacts ?? []);
  const messageCreativeAssets = [...session.messages].reverse().flatMap(messageCreativeAssetCandidates);
  const messageSessionArtifactAssets = [...session.messages].reverse().flatMap((message) => normalizeCreativeAssetCandidates(message.sessionArtifacts ?? []));
  const allKnownAssets = [
    ...workingStateAssets,
    ...sessionArtifactAssets,
    ...messageCreativeAssets,
    ...messageSessionArtifactAssets,
  ];

  if (activeAssetId) {
    const activeAsset = allKnownAssets.find((asset) => asset.asset_id === activeAssetId);

    if (isReferenceableCreativeImageAsset(activeAsset)) {
      return { asset: activeAsset, source: "creativeWorkingState" };
    }
  }

  const stateAsset = workingStateAssets.at(-1);
  if (stateAsset) {
    return { asset: stateAsset, source: "creativeWorkingState" };
  }

  const sessionArtifactAsset = sessionArtifactAssets.at(-1);
  if (sessionArtifactAsset) {
    return { asset: sessionArtifactAsset, source: "sessionArtifacts" };
  }

  const messageAsset = messageCreativeAssets.at(0) ?? messageSessionArtifactAssets.at(0);
  if (messageAsset) {
    return { asset: messageAsset, source: "messageCreativeAssets" };
  }

  return { source: "none" };
}
const MAX_VAULT_UPDATE_DRY_RUN_RESULTS = 40;
const MAX_VAULT_UPDATE_WRITE_RESULTS = 40;
const VAULT_AGENT_APPROVED_WRITE_DRY_RUN_ENDPOINT = "/agents/vault-agent/approved-write-dry-run";
const VAULT_AGENT_APPROVED_WRITE_ENDPOINT = "/agents/vault-agent/approved-write";
const VAULT_AGENT_RAW_ACTIVITY_LOG_ENDPOINT = "/agents/vault-agent/raw-activity-log";

export interface CmoAppChatTimingInput {
  requestReceivedAt?: string;
  authDurationMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function lensReadoutRangeKey(value: unknown): CmoLensReadoutRangeKey {
  return value === "last_7_days" || value === "last_30_days" || value === "this_month" ? value : "this_week";
}

function isLensReadoutRangeKey(value: unknown): value is CmoLensReadoutRangeKey {
  return value === "this_week" || value === "last_7_days" || value === "last_30_days" || value === "this_month";
}

function lensReadoutMetadata(input: {
  context?: Record<string, unknown> | null;
  warning?: string;
}): Partial<HermesCmoChatMetadata> {
  const context = input.context;
  const status = isRecord(context?.status) ? context.status : {};
  const rangeKey = lensReadoutRangeKey(context?.rangeKey);
  const metadata: Partial<HermesCmoChatMetadata> = input.warning
    ? {
        lensReadoutAttached: false,
        lens_readout_attached: false,
        lensReadoutContextWarning: input.warning,
        lens_readout_context_warning: input.warning,
      }
    : {};

  if (context?.contract === "lens.readout_context.v1") {
    return {
      ...metadata,
      lensReadoutAttached: true,
      lens_readout_attached: true,
      lensReadoutContract: "lens.readout_context.v1",
      lens_readout_contract: "lens.readout_context.v1",
      lensReadoutRangeKey: rangeKey,
      lens_readout_range_key: rangeKey,
      ...(typeof status.overall === "string" ? { lensReadoutStatus: status.overall, lens_readout_status: status.overall } : {}),
      ...(typeof status.dataStatus === "string" ? { lensReadoutDataStatus: status.dataStatus, lens_readout_data_status: status.dataStatus } : {}),
    };
  }

  return metadata;
}

function sourceReviewUserId(identity: CmoServerUserIdentity): string {
  return identity.userId?.trim() || identity.userEmail?.trim() || identity.createdByEmail?.trim() || "legacy_dashboard_user";
}

function compactSessionSourceText(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();

  return compact.length > maxChars ? `${compact.slice(0, maxChars - 3).trimEnd()}...` : compact;
}

function prefixedContentHash(value: string): string {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function sourceRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sessionSourceStatus(value: string | undefined): CmoSessionLocalSource["extraction_status"] {
  return value === "completed" || value === "partial" ? value : "failed";
}

function sessionLocalSourceFromReviewContext(reviewContext: CmoSourceReviewContext): CmoSessionLocalSource | undefined {
  const source = reviewContext.source;
  const extraction = reviewContext.extraction;
  const status = sessionSourceStatus(sourceRecordString(extraction, "status"));

  if (status === "failed") {
    return undefined;
  }

  const sourceId = sourceRecordString(source, "source_id");
  const sourceTitle = sourceRecordString(source, "source_title") || sourceRecordString(source, "canonical_url") || "Session source";
  const sourceType = sourceRecordString(source, "source_type") || "text";
  const summary = sourceRecordString(extraction, "extracted_summary");
  const sourceText = sourceRecordString(extraction, "source_text") ?? sourceRecordString(extraction, "source_text_excerpt");
  const contentHash = sourceRecordString(extraction, "content_hash");
  const warnings = Array.isArray(extraction.warnings) ? extraction.warnings.filter((item): item is string => typeof item === "string") : [];
  const mainContentQuality = sourceRecordString(extraction, "main_content_quality");
  const extractionCoverage = sourceRecordString(extraction, "extraction_coverage");

  if (!sourceId) {
    return undefined;
  }

  return {
    type: "session_local_source",
    schema_version: "cmo.session_local_source.v1",
    workspace_id: reviewContext.workspace_id,
    session_id: reviewContext.session_id,
    turn_id: reviewContext.request_id,
    source_id: sourceId,
    source_type: sourceType,
    source_title: sourceTitle,
    ...(sourceRecordString(source, "original_url") ? { original_url: sourceRecordString(source, "original_url") } : {}),
    ...(sourceRecordString(source, "canonical_url") ? { canonical_url: sourceRecordString(source, "canonical_url") } : {}),
    ...(sourceRecordString(source, "original_filename") ? { original_filename: sourceRecordString(source, "original_filename") } : {}),
    ...(summary ? { extracted_summary: compactSessionSourceText(summary, 1000) } : {}),
    ...(sourceText ? { source_text_excerpt: compactSessionSourceText(sourceText, 1200) } : {}),
    ...(sourceText ? { source_text_cache: compactSessionSourceText(sourceText, 16000) } : {}),
    extraction_status: status,
    ...(mainContentQuality === "good" || mainContentQuality === "partial" || mainContentQuality === "low" ? { main_content_quality: mainContentQuality } : {}),
    ...(extractionCoverage === "static_html" || extractionCoverage === "rendered_dom" || extractionCoverage === "deep_crawl" || extractionCoverage === "partial" ? { extraction_coverage: extractionCoverage } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(contentHash ? { content_hash: prefixedContentHash(contentHash) } : {}),
    saved_to_vault: false,
    official_project_source: false,
    truth_status: "session_only",
    review_status: "temporary",
    no_auto_promote: true,
    safety: {
      read_only: true,
      vault_mutation: false,
      gbrain_mutation: false,
      promotion_performed: false,
    },
  };
}

function withSessionSourceRoutingMetadata(source: CmoSessionLocalSource): CmoSessionLocalSource {
  const quality = buildSourceQualityReport(source);

  return {
    ...source,
    ...quality,
    read_depth: sourceReadDepth(source, quality),
    cache_role: sourceCacheRole(source, quality),
    nav_heavy: quality.warnings.includes("nav_heavy"),
    tool_read_recommended: sourceToolReadRecommended(source, { query_type: "unknown" }, quality),
  };
}

function mergeSessionLocalSources(existing: CmoSessionLocalSource[] | undefined, next: CmoSessionLocalSource | undefined): CmoSessionLocalSource[] {
  const scopedExisting = existing ?? [];

  if (!next) {
    return scopedExisting.slice(0, 3);
  }

  return [next, ...scopedExisting.filter((source) => source.source_id !== next.source_id)].slice(0, 3);
}

const RESEARCH_UNSAFE_KEYS = /^(api_key|authorization|body|content|cookie|cookies|credential|credentials|env|file_body|file_content|full_content|full_source|full_text|headers|html|markdown|password|private_key|raw|raw_.*|secret|secrets|source_text.*|text|token|tool_args|tool_result)$/i;

function compactResearchText(value: string, maxChars = 360): string {
  return compactSessionSourceText(value, maxChars);
}

function safeResearchScalar(value: unknown): unknown {
  if (typeof value === "string") {
    return compactResearchText(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function safeResearchRecord(value: Record<string, unknown>): Record<string, unknown> | null {
  const safe: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    if (RESEARCH_UNSAFE_KEYS.test(key)) {
      continue;
    }

    const scalar = safeResearchScalar(nested);
    if (scalar !== undefined) {
      safe[key] = scalar;
    }
  }

  return Object.keys(safe).length > 0 ? safe : null;
}

function safeResearchList(value: unknown, maxItems = 8): Array<Record<string, unknown> | string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string" && item.trim()) {
        return compactResearchText(item);
      }

      if (isRecord(item)) {
        return safeResearchRecord(item);
      }

      return null;
    })
    .filter((item): item is Record<string, unknown> | string => Boolean(item))
    .slice(0, maxItems);
}

function safeResearchStringList(value: unknown, maxItems = 12): string[] {
  return safeResearchList(value, maxItems)
    .map((item) => (typeof item === "string" ? item : stringValue(item.summary ?? item.title ?? item.name ?? item.label)))
    .filter((item) => Boolean(item))
    .slice(0, maxItems);
}

function candidateString(value: Record<string, unknown>, keys: string[], maxChars = 500): string {
  for (const key of keys) {
    const item = value[key];

    if (typeof item === "string" && item.trim()) {
      return compactSessionSourceText(item, maxChars);
    }
  }

  return "";
}

function suggestedVaultUpdateStableKey(candidate: Record<string, unknown>): string {
  const explicitId = candidateString(candidate, ["candidate_key", "candidate_id", "update_id", "id"], 160);

  if (explicitId) {
    return explicitId;
  }

  const kind = candidateString(candidate, ["kind", "type"], 120);
  const subject = candidateString(candidate, ["subject", "title", "name"], 240);
  const summary = candidateString(candidate, ["summary", "statement", "description"], 500);
  const hash = createHash("sha256").update([kind, subject, summary].join("\n")).digest("hex").slice(0, 16);

  return `vault_update_${hash}`;
}

function normalizeSuggestedVaultUpdateCandidate(value: Record<string, unknown>, existing?: Record<string, unknown>): Record<string, unknown> {
  const candidateKey = suggestedVaultUpdateStableKey(value);
  const currentStatus = candidateString(existing ?? {}, ["review_status"], 80);
  const incomingStatus = candidateString(value, ["review_status"], 80);
  const reviewStatus = currentStatus && ["needs_review", "draft", "approved", "rejected", "deferred"].includes(currentStatus)
    ? currentStatus
    : incomingStatus && ["needs_review", "draft", "approved", "rejected", "deferred"].includes(incomingStatus)
      ? incomingStatus
      : "needs_review";

  return {
    ...value,
    candidate_key: candidateKey,
    truth_status: "draft",
    review_status: reviewStatus,
    status: reviewStatus === "needs_review" ? "draft" : reviewStatus,
    vault_write_performed: false,
    requires_user_or_product_approval: true,
    ...(existing?.reviewed_at ? { reviewed_at: existing.reviewed_at } : {}),
    ...(existing?.reviewed_by ? { reviewed_by: existing.reviewed_by } : {}),
  };
}

function mergeSuggestedVaultUpdates(
  existing: Record<string, unknown>[] | undefined,
  next: Record<string, unknown>[] | undefined,
): Record<string, unknown>[] {
  const existingCandidates = sanitizeHermesCmoChatV11Records(existing, MAX_SUGGESTED_VAULT_UPDATES_SESSION);
  const existingByKey = new Map<string, Record<string, unknown>>();

  for (const candidate of existingCandidates) {
    const normalized = normalizeSuggestedVaultUpdateCandidate(candidate);
    existingByKey.set(String(normalized.candidate_key), normalized);
  }

  const merged = new Map(existingByKey);

  for (const candidate of sanitizeHermesCmoChatV11Records(next, MAX_SUGGESTED_VAULT_UPDATES_SESSION)) {
    const key = suggestedVaultUpdateStableKey(candidate);
    merged.set(key, normalizeSuggestedVaultUpdateCandidate(candidate, existingByKey.get(key)));
  }

  return Array.from(merged.values()).slice(-MAX_SUGGESTED_VAULT_UPDATES_SESSION);
}

function normalizeVaultUpdateApprovalAction(value: unknown): CmoVaultUpdateReviewAction | undefined {
  return value === "approved" || value === "rejected" || value === "deferred" ? value : undefined;
}

function normalizeVaultUpdateApprovalEvents(value: unknown): CmoVaultUpdateApprovalEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): CmoVaultUpdateApprovalEvent | null => {
      if (!isRecord(item) || item.schema_version !== "cmo.vault_update_approval.v1") {
        return null;
      }

      const action = normalizeVaultUpdateApprovalAction(item.action);
      const reviewedUpdateSource =
        isRecord(item.reviewed_update) ? item.reviewed_update :
        action === "approved" && isRecord(item.approved_update) ? item.approved_update :
        action === "rejected" && isRecord(item.rejected_update) ? item.rejected_update :
        action === "deferred" && isRecord(item.deferred_update) ? item.deferred_update :
        null;
      const reviewedUpdate = reviewedUpdateSource
        ? normalizeSuggestedVaultUpdateCandidate(sanitizeHermesCmoChatV11Records([reviewedUpdateSource], 1)[0] ?? {})
        : null;

      if (!action || !reviewedUpdate) {
        return null;
      }

      return {
        schema_version: "cmo.vault_update_approval.v1",
        approval_id: candidateString(item, ["approval_id"], 160) || `approval_${randomUUID()}`,
        tenant_id: candidateString(item, ["tenant_id"], 160) || "holdstation",
        workspace_id: candidateString(item, ["workspace_id"], 160),
        session_id: candidateString(item, ["session_id"], 160),
        turn_id: candidateString(item, ["turn_id"], 160),
        source_endpoint: "/agents/cmo/chat",
        source_response_id: candidateString(item, ["source_response_id"], 160),
        action,
        review_status: action,
        approved_by: "user_or_product",
        approved_at: candidateString(item, ["approved_at"], 80) || new Date(0).toISOString(),
        reviewed_update: reviewedUpdate,
        ...(action === "approved" ? { approved_update: reviewedUpdate } : {}),
        ...(action === "rejected" ? { rejected_update: reviewedUpdate } : {}),
        ...(action === "deferred" ? { deferred_update: reviewedUpdate } : {}),
        vault_write_performed: false,
      };
    })
    .filter((item): item is CmoVaultUpdateApprovalEvent => Boolean(item))
    .slice(-MAX_VAULT_UPDATE_APPROVAL_EVENTS);
}

const VAULT_APPROVED_WRITE_DRY_RUN_SIDE_EFFECT_KEYS = [
  "executed_echo",
  "executed_surf",
  "executed_vault_agent",
  "vault_context_retrieval",
  "vault_write",
  "memory_mutation",
  "gbrain_mutation",
  "supabase_mutation",
  "session_mutation",
  "raw_capture",
  "repo_mutation",
  "kanban",
  "openclaw",
  "publishing",
  "source_auto_save",
  "knowledge_promotion",
] as const;

const VAULT_APPROVED_WRITE_DRY_RUN_SIDE_EFFECT_KEY_SET = new Set<string>(VAULT_APPROVED_WRITE_DRY_RUN_SIDE_EFFECT_KEYS);

function normalizeVaultApprovedWriteDryRunSideEffects(value: unknown): { sideEffects?: false | Record<string, false>; errors: string[] } {
  if (value === false || value === undefined) {
    return { sideEffects: value === false ? false : Object.fromEntries(VAULT_APPROVED_WRITE_DRY_RUN_SIDE_EFFECT_KEYS.map((key) => [key, false])) as Record<string, false>, errors: [] };
  }

  if (!isRecord(value)) {
    return { sideEffects: Object.fromEntries(VAULT_APPROVED_WRITE_DRY_RUN_SIDE_EFFECT_KEYS.map((key) => [key, false])) as Record<string, false>, errors: ["invalid_side_effects"] };
  }

  const errors: string[] = [];
  const sideEffects = Object.fromEntries(VAULT_APPROVED_WRITE_DRY_RUN_SIDE_EFFECT_KEYS.map((key) => [key, false])) as Record<string, false>;

  for (const [key, item] of Object.entries(value)) {
    if (!VAULT_APPROVED_WRITE_DRY_RUN_SIDE_EFFECT_KEY_SET.has(key)) {
      continue;
    }

    if (item !== false && item !== undefined) {
      errors.push(`unsafe_side_effect:${key}`);
    }
  }

  return { sideEffects, errors };
}

function normalizeDryRunStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return compactSessionSourceText(item, 240);
      }

      if (isRecord(item)) {
        const message = candidateString(item, ["message"], 240);

        if (message) {
          return message;
        }

        const type = candidateString(item, ["type"], 240);

        if (type) {
          return type;
        }

        const safe = normalizeSafeMetadataValue(item);

        return safe === undefined ? "" : compactSessionSourceText(JSON.stringify(safe), 240);
      }

      if (typeof item === "number" || typeof item === "boolean") {
        return compactSessionSourceText(String(item), 240);
      }

      return "";
    })
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeDryRunBodyPreview(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return compactSessionSourceText(value, 4_000);
  }

  const safe = normalizeSafeMetadataValue(value);

  if (safe === undefined) {
    return undefined;
  }

  return compactSessionSourceText(JSON.stringify(safe, null, 2), 4_000);
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])]),
  );
}

function productApprovalPayloadHash(approvalEvent: CmoVaultUpdateApprovalEvent): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableJsonValue(dryRunRequestEnvelope(approvalEvent)))).digest("hex")}`;
}

function normalizeVaultApprovedWriteDryRunResult(
  value: unknown,
  fallbackApprovalId = "",
  fallbackCreatedAt = new Date().toISOString(),
): CmoVaultApprovedWriteDryRunResult | null {
  if (!isRecord(value) || value.schema_version !== "vault_agent.approved_write_dry_run.v1") {
    return null;
  }

  const approvalId = candidateString(value, ["approval_id"], 160) || fallbackApprovalId;
  const idempotencyKey = candidateString(value, ["idempotency_key"], 240);
  const approvalPayloadHash = candidateString(value, ["approval_payload_hash"], 240);

  if (!approvalId || !idempotencyKey || !approvalPayloadHash || value.dry_run !== true) {
    return null;
  }

  const sideEffects = normalizeVaultApprovedWriteDryRunSideEffects(value.side_effects);
  const warnings = normalizeDryRunStringList(value.warnings);
  const unsafeVaultWritePerformed = value.vault_write_performed !== undefined && value.vault_write_performed !== false;
  const errors = [
    ...normalizeDryRunStringList(value.errors),
    ...sideEffects.errors,
    ...(unsafeVaultWritePerformed ? ["unsafe_vault_write_performed"] : []),
  ].slice(0, 20);
  const targetPreview = normalizeSafeMetadataValue(value.target_preview ?? value.target_path ?? value.target);
  const frontmatterPreview = normalizeSafeMetadataValue(value.frontmatter_preview ?? value.frontmatter);
  const bodyPreview = normalizeDryRunBodyPreview(value.body_preview ?? value.body);
  const status = value.status === "conflict" || value.status === "failed" || value.status === "completed"
    ? errors.length && value.status === "completed"
      ? "failed"
      : value.status
    : errors.length
      ? "failed"
      : "completed";

  return {
    schema_version: "vault_agent.approved_write_dry_run.v1",
    approval_id: approvalId,
    idempotency_key: idempotencyKey,
    approval_payload_hash: approvalPayloadHash,
    dry_run: true,
    write_allowed: value.write_allowed === true && errors.length === 0,
    vault_write_performed: false,
    ...(targetPreview !== undefined ? { target_preview: targetPreview } : {}),
    ...(frontmatterPreview !== undefined ? { frontmatter_preview: frontmatterPreview } : {}),
    ...(bodyPreview ? { body_preview: bodyPreview } : {}),
    ...(sideEffects.sideEffects !== undefined ? { side_effects: sideEffects.sideEffects } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(errors.length ? { errors } : {}),
    created_at: candidateString(value, ["created_at"], 80) || fallbackCreatedAt,
    status,
    ...(value.conflict === true ? { conflict: true } : {}),
    ...(candidateString(value, ["previous_approval_payload_hash"], 240) ? { previous_approval_payload_hash: candidateString(value, ["previous_approval_payload_hash"], 240) } : {}),
    ...(candidateString(value, ["latest_approval_payload_hash"], 240) ? { latest_approval_payload_hash: candidateString(value, ["latest_approval_payload_hash"], 240) } : {}),
    ...(candidateString(value, ["product_approval_payload_hash"], 240) ? { product_approval_payload_hash: candidateString(value, ["product_approval_payload_hash"], 240) } : {}),
  };
}

function normalizeVaultApprovedWriteDryRunResults(value: unknown): CmoVaultApprovedWriteDryRunResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const merged = new Map<string, CmoVaultApprovedWriteDryRunResult>();

  for (const item of value) {
    const normalized = normalizeVaultApprovedWriteDryRunResult(item);

    if (normalized) {
      merged.set(normalized.approval_id, normalized);
    }
  }

  return Array.from(merged.values()).slice(-MAX_VAULT_UPDATE_DRY_RUN_RESULTS);
}

function mergeVaultApprovedWriteDryRunResults(
  existing: CmoVaultApprovedWriteDryRunResult[] | undefined,
  next: CmoVaultApprovedWriteDryRunResult,
): CmoVaultApprovedWriteDryRunResult[] {
  const merged = new Map<string, CmoVaultApprovedWriteDryRunResult>();

  for (const item of normalizeVaultApprovedWriteDryRunResults(existing)) {
    merged.set(item.approval_id, item);
  }

  merged.set(next.approval_id, next);

  return Array.from(merged.values()).slice(-MAX_VAULT_UPDATE_DRY_RUN_RESULTS);
}

function dryRunResultMetadata(results: CmoVaultApprovedWriteDryRunResult[]): Pick<
  HermesCmoChatMetadata,
  "dry_run_results_count" | "latest_dry_run_status" | "latest_dry_run_approval_id" | "latest_dry_run_write_allowed" | "vault_write_performed" | "endpoint_kind" | "runtime_kind"
> {
  const latest = results.at(-1);

  return {
    dry_run_results_count: results.length,
    ...(latest?.status ? { latest_dry_run_status: latest.status } : {}),
    ...(latest?.approval_id ? { latest_dry_run_approval_id: latest.approval_id } : {}),
    ...(typeof latest?.write_allowed === "boolean" ? { latest_dry_run_write_allowed: latest.write_allowed } : {}),
    vault_write_performed: false,
    endpoint_kind: "agent_chat",
    runtime_kind: "ai_agent",
  };
}

function normalizeVaultApprovedWriteSideEffects(value: unknown): { sideEffects?: false | Record<string, boolean>; errors: string[] } {
  if (value === false || value === undefined) {
    return { sideEffects: value === false ? false : undefined, errors: [] };
  }

  if (!isRecord(value)) {
    return { errors: ["invalid_side_effects"] };
  }

  const sideEffects: Record<string, boolean> = {};
  const errors: string[] = [];

  for (const [key, item] of Object.entries(value)) {
    if (!VAULT_APPROVED_WRITE_DRY_RUN_SIDE_EFFECT_KEY_SET.has(key)) {
      continue;
    }

    if (typeof item === "boolean") {
      sideEffects[key] = item;
      if (
        item === true &&
        key !== "vault_write" &&
        key !== "executed_vault_agent"
      ) {
        errors.push(`unsafe_side_effect:${key}`);
      }
    } else if (item !== undefined) {
      errors.push(`unsafe_side_effect:${key}`);
    }
  }

  return { sideEffects: Object.keys(sideEffects).length ? sideEffects : undefined, errors };
}

function normalizeVaultApprovedWriteResult(
  value: unknown,
  fallbackApprovalId = "",
  fallbackCreatedAt = new Date().toISOString(),
): CmoVaultApprovedWriteResult | null {
  if (!isRecord(value) || value.schema_version !== "vault_agent.approved_write_result.v1") {
    return null;
  }

  const approvalId = candidateString(value, ["approval_id"], 160) || fallbackApprovalId;
  const idempotencyKey = candidateString(value, ["idempotency_key"], 240);
  const approvalPayloadHash = candidateString(value, ["approval_payload_hash"], 240);

  if (!approvalId || !idempotencyKey || !approvalPayloadHash) {
    return null;
  }

  const sideEffects = normalizeVaultApprovedWriteSideEffects(value.side_effects);
  const warnings = normalizeDryRunStringList(value.warnings);
  const conflict = value.conflict === true;
  const deduped = value.deduped === true;
  const vaultPath = candidateString(value, ["vault_path", "target_path"], 600);
  const contentHash = candidateString(value, ["content_hash"], 240);
  const receiptClaimsWrite = value.vault_write_performed === true;
  const returnedStatus = value.status === "completed" || value.status === "failed" || value.status === "conflict" || value.status === "deduped" || value.status === "rejected"
    ? value.status
    : undefined;
  const completedWithoutWriteProof = returnedStatus === "completed" && receiptClaimsWrite !== true && deduped !== true;
  const errors = [
    ...normalizeDryRunStringList(value.errors),
    ...sideEffects.errors,
    ...(receiptClaimsWrite && !vaultPath ? ["missing_vault_path"] : []),
    ...(receiptClaimsWrite && !contentHash ? ["missing_content_hash"] : []),
    ...(completedWithoutWriteProof ? ["write_not_performed"] : []),
  ].slice(0, 20);
  const vaultWritePerformed = receiptClaimsWrite && Boolean(vaultPath) && Boolean(contentHash) && !conflict && errors.length === 0;
  const status = conflict
    ? "conflict"
    : returnedStatus === "rejected"
      ? "rejected"
    : errors.length
      ? "failed"
      : deduped
        ? "deduped"
        : returnedStatus
          ? returnedStatus
          : "completed";

  return {
    schema_version: "vault_agent.approved_write_result.v1",
    approval_id: approvalId,
    idempotency_key: idempotencyKey,
    approval_payload_hash: approvalPayloadHash,
    vault_write_performed: vaultWritePerformed,
    ...(vaultPath ? { vault_path: vaultPath } : {}),
    ...(contentHash ? { content_hash: contentHash } : {}),
    ...(deduped ? { deduped: true } : {}),
    ...(conflict ? { conflict: true } : {}),
    ...(sideEffects.sideEffects !== undefined ? { side_effects: sideEffects.sideEffects } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(errors.length ? { errors } : {}),
    created_at: candidateString(value, ["created_at"], 80) || fallbackCreatedAt,
    status,
    ...(value.gbrain_index === false ? { gbrain_index: false } : {}),
    ...(value.promotion_performed === false ? { promotion_performed: false } : {}),
    ...(candidateString(value, ["previous_approval_payload_hash"], 240) ? { previous_approval_payload_hash: candidateString(value, ["previous_approval_payload_hash"], 240) } : {}),
    ...(candidateString(value, ["latest_approval_payload_hash"], 240) ? { latest_approval_payload_hash: candidateString(value, ["latest_approval_payload_hash"], 240) } : {}),
    ...(candidateString(value, ["product_approval_payload_hash"], 240) ? { product_approval_payload_hash: candidateString(value, ["product_approval_payload_hash"], 240) } : {}),
  };
}

function normalizeVaultApprovedWriteResults(value: unknown): CmoVaultApprovedWriteResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const merged = new Map<string, CmoVaultApprovedWriteResult>();

  for (const item of value) {
    const normalized = normalizeVaultApprovedWriteResult(item);

    if (normalized) {
      merged.set(normalized.approval_id, normalized);
    }
  }

  return Array.from(merged.values()).slice(-MAX_VAULT_UPDATE_WRITE_RESULTS);
}

function mergeVaultApprovedWriteResults(
  existing: CmoVaultApprovedWriteResult[] | undefined,
  next: CmoVaultApprovedWriteResult,
): CmoVaultApprovedWriteResult[] {
  const merged = new Map<string, CmoVaultApprovedWriteResult>();

  for (const item of normalizeVaultApprovedWriteResults(existing)) {
    merged.set(item.approval_id, item);
  }

  merged.set(next.approval_id, next);

  return Array.from(merged.values()).slice(-MAX_VAULT_UPDATE_WRITE_RESULTS);
}

function writeResultMetadata(results: CmoVaultApprovedWriteResult[]): Pick<
  HermesCmoChatMetadata,
  "write_results_count" | "latest_write_status" | "latest_write_approval_id" | "latest_vault_path" | "requested_endpoint" | "write_source_endpoint" | "vault_agent_write" | "vault_write_performed" | "write_side_effects"
> {
  const latest = results.at(-1);

  return {
    write_results_count: results.length,
    ...(latest?.status ? { latest_write_status: latest.status } : {}),
    ...(latest?.approval_id ? { latest_write_approval_id: latest.approval_id } : {}),
    ...(latest?.vault_path ? { latest_vault_path: latest.vault_path } : {}),
    requested_endpoint: VAULT_AGENT_APPROVED_WRITE_ENDPOINT,
    write_source_endpoint: "/agents/cmo/chat",
    vault_agent_write: true,
    vault_write_performed: latest?.vault_write_performed === true,
    ...(latest?.side_effects !== undefined ? { write_side_effects: latest.side_effects } : {}),
  };
}

function normalizeSessionLocalResearchResult(value: unknown): CmoSessionLocalResearchResult | undefined {
  if (!isRecord(value) || value.type !== "session_local_research_result" || value.schema_version !== "cmo.session_local_research_result.v1") {
    return undefined;
  }

  const tenantId = normalizeOptionalString(value.tenant_id);
  const workspaceId = normalizeOptionalString(value.workspace_id);
  const appId = normalizeOptionalString(value.app_id);
  const userId = normalizeOptionalString(value.user_id);
  const sessionId = normalizeOptionalString(value.session_id);
  const turnId = normalizeOptionalString(value.turn_id);
  const createdTurnId = normalizeOptionalString(value.created_turn_id);
  const researchId = normalizeOptionalString(value.research_id);
  const userQuestion = normalizeOptionalString(value.user_question);
  const createdAt = normalizeOptionalString(value.created_at);
  const researchType = value.research_type === "competitor_landscape" ? "competitor_landscape" : value.research_type === "external_research" ? "external_research" : undefined;

  if (!tenantId || !workspaceId || !appId || !userId || !sessionId || !turnId || !createdTurnId || !researchId || !userQuestion || !createdAt || !researchType) {
    return undefined;
  }

  const competitors = safeResearchList(value.competitors, 8);
  const adjacentProducts = safeResearchList(value.adjacent_products, 8);
  const sourcesUsed = safeResearchList(value.sources_used, 12);
  const keyFindings = safeResearchStringList(value.key_findings, 12);
  const evidenceGaps = safeResearchStringList(value.evidence_gaps, 8);

  return {
    type: "session_local_research_result",
    schema_version: "cmo.session_local_research_result.v1",
    tenant_id: tenantId,
    workspace_id: workspaceId,
    app_id: appId,
    user_id: userId,
    session_id: sessionId,
    turn_id: turnId,
    created_turn_id: createdTurnId,
    research_id: researchId,
    source_agent: "surf",
    research_type: researchType,
    user_question: compactResearchText(userQuestion, 500),
    ...(competitors.length > 0 ? { competitors } : {}),
    ...(adjacentProducts.length > 0 ? { adjacent_products: adjacentProducts } : {}),
    ...(sourcesUsed.length > 0 ? { sources_used: sourcesUsed } : {}),
    ...(keyFindings.length > 0 ? { key_findings: keyFindings } : {}),
    ...(evidenceGaps.length > 0 ? { evidence_gaps: evidenceGaps } : {}),
    created_at: createdAt,
    truth_status: "session_only",
    saved_to_vault: false,
    no_auto_promote: true,
    safety: {
      read_only: true,
      vault_mutation: false,
      gbrain_mutation: false,
      promotion_performed: false,
    },
  };
}

function normalizeSessionLocalResearchResults(value: unknown, workspaceId?: string, sessionId?: string): CmoSessionLocalResearchResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeSessionLocalResearchResult)
    .filter((result): result is CmoSessionLocalResearchResult => Boolean(result))
    .filter((result) => (workspaceId ? result.workspace_id === workspaceId : true))
    .filter((result) => (sessionId ? result.session_id === sessionId : true))
    .slice(0, 3);
}

function mergeSessionLocalResearchResults(
  existing: CmoSessionLocalResearchResult[] | undefined,
  next: CmoSessionLocalResearchResult | undefined,
): CmoSessionLocalResearchResult[] {
  const scopedExisting = existing ?? [];

  if (!next) {
    return scopedExisting.slice(0, 3);
  }

  return [next, ...scopedExisting.filter((result) => result.research_id !== next.research_id)].slice(0, 3);
}

function sessionLocalResearchResultFromHermesResult(input: {
  hermesResult: HermesCmoRuntimeResult;
  tenantId: string;
  workspaceId: string;
  appId: string;
  userId: string;
  sessionId: string;
  turnId: string;
  createdAt: string;
  userQuestion: string;
}): CmoSessionLocalResearchResult | undefined {
  const execution = input.hermesResult.delegationSummary.find(
    (item) => item.targetAgent === "surf" && item.status === "completed" && isRecord(item.response),
  );
  const response = isRecord(execution?.response) ? execution.response : null;
  const researchPack = isRecord(response?.research_pack)
    ? response.research_pack
    : isRecord(response?.researchPack)
      ? response.researchPack
      : {};

  if (!execution || !response) {
    return undefined;
  }

  const competitors = safeResearchList(response.competitors ?? researchPack.competitors, 8);
  const adjacentProducts = safeResearchList(response.adjacent_products ?? response.adjacentProducts ?? researchPack.adjacent_products ?? researchPack.adjacentProducts, 8);
  const sourcesUsed = safeResearchList(response.sources_used ?? researchPack.sources_used, 12);
  const keyFindings = safeResearchStringList(response.key_findings ?? researchPack.key_findings, 12);
  const evidenceGaps = safeResearchStringList(response.evidence_gaps ?? researchPack.evidence_gaps, 8);

  if (competitors.length === 0 && adjacentProducts.length === 0 && sourcesUsed.length === 0 && keyFindings.length === 0) {
    return undefined;
  }

  return {
    type: "session_local_research_result",
    schema_version: "cmo.session_local_research_result.v1",
    tenant_id: input.tenantId,
    workspace_id: input.workspaceId,
    app_id: input.appId,
    user_id: input.userId,
    session_id: input.sessionId,
    turn_id: input.turnId,
    created_turn_id: input.turnId,
    research_id: `research_${execution.delegationId}`,
    source_agent: "surf",
    research_type: competitors.length > 0 || adjacentProducts.length > 0 ? "competitor_landscape" : "external_research",
    user_question: compactResearchText(input.userQuestion, 500),
    ...(competitors.length > 0 ? { competitors } : {}),
    ...(adjacentProducts.length > 0 ? { adjacent_products: adjacentProducts } : {}),
    ...(sourcesUsed.length > 0 ? { sources_used: sourcesUsed } : {}),
    ...(keyFindings.length > 0 ? { key_findings: keyFindings } : {}),
    ...(evidenceGaps.length > 0 ? { evidence_gaps: evidenceGaps } : {}),
    created_at: input.createdAt,
    truth_status: "session_only",
    saved_to_vault: false,
    no_auto_promote: true,
    safety: {
      read_only: true,
      vault_mutation: false,
      gbrain_mutation: false,
      promotion_performed: false,
    },
  };
}

function sourceReviewContextFromSessionLocalSource(
  source: CmoSessionLocalSource | undefined,
  input: {
    tenantId: string;
    userId: string;
  },
): CmoSourceReviewContext | undefined {
  if (!source) {
    return undefined;
  }

  return {
    schema_version: "cmo.source_review_context.v1",
    mode: "session_local",
    tenant_id: input.tenantId,
    workspace_id: source.workspace_id,
    user_id: input.userId,
    session_id: source.session_id,
    request_id: source.turn_id,
    source: {
      source_type: source.source_type,
      source_title: source.source_title,
      ...(source.original_url ? { original_url: source.original_url } : {}),
      ...(source.canonical_url ? { canonical_url: source.canonical_url } : {}),
      ...(source.original_filename ? { original_filename: source.original_filename } : {}),
      source_id: source.source_id,
      workspace_id: source.workspace_id,
    },
    extraction: {
      status: source.extraction_status,
      ...(source.extracted_summary ? { extracted_summary: source.extracted_summary } : {}),
      ...(source.source_text_excerpt ? { source_text_excerpt: source.source_text_excerpt } : {}),
      ...(source.main_content_quality ? { main_content_quality: source.main_content_quality } : {}),
      ...(source.extraction_coverage ? { extraction_coverage: source.extraction_coverage } : {}),
      ...(source.read_depth ? { read_depth: source.read_depth } : {}),
      ...(source.cache_role ? { cache_role: source.cache_role } : {}),
      ...(typeof source.nav_heavy === "boolean" ? { nav_heavy: source.nav_heavy } : {}),
      ...(typeof source.tool_read_recommended === "boolean" ? { tool_read_recommended: source.tool_read_recommended } : {}),
      ...(source.warnings ? { warnings: source.warnings } : {}),
      ...(source.content_hash ? { content_hash: source.content_hash } : {}),
    },
    safety: {
      read_only: true,
      vault_mutation: false,
      gbrain_mutation: false,
      no_promotion: true,
    },
    persistence: {
      saved_to_vault: false,
      truth_status: "session_only",
      review_status: "temporary",
      no_auto_promote: true,
    },
  };
}

function normalizeContextQuality(value: unknown): CMOContextQuality | undefined {
  return value === "missing" || value === "placeholder" || value === "draft" || value === "confirmed" ? value : undefined;
}

function normalizeGraphStatus(value: unknown): ContextGraphStatus | undefined {
  return value === "not_configured" || value === "empty" || value === "available" || value === "partial" ? value : undefined;
}

function normalizeGraphSourceType(value: unknown): ContextGraphHintSourceType {
  return value === "markdown-link" ||
    value === "session-reference" ||
    value === "promotion-candidate" ||
    value === "raw-capture" ||
    value === "keyword-match"
    ? value
    : "keyword-match";
}

function normalizeGraphConfidence(value: unknown): ContextGraphHintConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizeDecisionReviewStatus(value: unknown): CmoDecisionReviewStatus | undefined {
  return value === "unreviewed" || value === "confirmed" || value === "rejected" || value === "deferred" ? value : undefined;
}

function normalizeAssumptionReviewStatus(value: unknown): CmoAssumptionReviewStatus | undefined {
  return value === "unreviewed" || value === "accepted" || value === "risky" || value === "rejected" ? value : undefined;
}

function normalizeSuggestedActionReviewStatus(value: unknown): CmoSuggestedActionReviewStatus | undefined {
  return value === "unreviewed" || value === "reviewed" ? value : undefined;
}

function normalizeMemoryCandidateReviewStatus(value: unknown): CmoMemoryCandidateReviewStatus {
  return value === "approved_for_promotion_later" || value === "rejected" || value === "deferred" ? value : "review_required";
}

function normalizeTaskCandidateReviewStatus(value: unknown): CmoTaskCandidateReviewStatus | undefined {
  return value === "unreviewed" || value === "approved_for_task_later" || value === "rejected" || value === "deferred" ? value : undefined;
}

function normalizeDecisionLayer(value: unknown): CmoDecisionLayer | undefined {
  if (!isRecord(value) || value.schemaVersion !== "cmo.decision-layer.v1") {
    return undefined;
  }

  const sessionId = stringValue(value.sessionId);
  const workspaceId = stringValue(value.workspaceId);
  const appId = stringValue(value.appId);
  const sourceId = stringValue(value.sourceId);
  const createdAt = stringValue(value.createdAt);

  if (!sessionId || !workspaceId || !appId || !sourceId || !createdAt) {
    return undefined;
  }

  const confidence = (item: unknown): CmoDecisionLayer["decisions"][number]["confidence"] =>
    isRecord(item) && (item.confidence === "high" || item.confidence === "medium" || item.confidence === "low") ? item.confidence : "low";
  const optionalString = (item: unknown, key: string) => isRecord(item) && typeof item[key] === "string" && item[key].trim() ? item[key].trim() : undefined;
  const text = (item: unknown, key: string, fallback = "") => isRecord(item) ? stringValue(item[key], fallback) : fallback;
  const decisions: CmoDecisionLayer["decisions"] = [];
  const assumptions: CmoDecisionLayer["assumptions"] = [];
  const suggestedActions: CmoDecisionLayer["suggestedActions"] = [];
  const memoryCandidates: CmoDecisionLayer["memoryCandidates"] = [];
  const taskCandidates: CmoDecisionLayer["taskCandidates"] = [];

  if (Array.isArray(value.decisions)) {
    value.decisions.forEach((item, index) => {
        const status = isRecord(item) && (item.status === "proposed" || item.status === "confirmed" || item.status === "rejected" || item.status === "deferred")
          ? item.status
          : "proposed";
        const statement = text(item, "statement");

        if (statement) {
          decisions.push({
            id: text(item, "id", `decision_${index + 1}`),
            title: text(item, "title", statement.slice(0, 96)),
            statement,
            status,
            rationale: optionalString(item, "rationale"),
            confidence: confidence(item),
            sourceSnippet: optionalString(item, "sourceSnippet"),
            reviewStatus: normalizeDecisionReviewStatus(isRecord(item) ? item.reviewStatus : undefined) ?? "unreviewed",
            reviewedAt: optionalString(item, "reviewedAt"),
            reviewedBy: optionalString(item, "reviewedBy"),
            reviewNote: optionalString(item, "reviewNote"),
          });
        }
      });
  }

  if (Array.isArray(value.assumptions)) {
    value.assumptions.forEach((item, index) => {
        const statement = text(item, "statement");
        const riskLevel = isRecord(item) && (item.riskLevel === "low" || item.riskLevel === "medium" || item.riskLevel === "high") ? item.riskLevel : undefined;

        if (statement) {
          assumptions.push({
            id: text(item, "id", `assumption_${index + 1}`),
            statement,
            riskLevel,
            confidence: confidence(item),
            sourceSnippet: optionalString(item, "sourceSnippet"),
            reviewStatus: normalizeAssumptionReviewStatus(isRecord(item) ? item.reviewStatus : undefined) ?? "unreviewed",
            reviewedAt: optionalString(item, "reviewedAt"),
            reviewedBy: optionalString(item, "reviewedBy"),
            reviewNote: optionalString(item, "reviewNote"),
          });
        }
      });
  }

  if (Array.isArray(value.suggestedActions)) {
    value.suggestedActions.forEach((item, index) => {
        const title = text(item, "title");

        if (title) {
          suggestedActions.push({
            id: text(item, "id", `action_${index + 1}`),
            title,
            description: optionalString(item, "description"),
            timeframeHint: optionalString(item, "timeframeHint"),
            ownerHint: optionalString(item, "ownerHint"),
            priorityHint: isRecord(item) && (item.priorityHint === "low" || item.priorityHint === "medium" || item.priorityHint === "high") ? item.priorityHint : undefined,
            expectedImpact: optionalString(item, "expectedImpact"),
            confidence: confidence(item),
            sourceSnippet: optionalString(item, "sourceSnippet"),
            reviewStatus: normalizeSuggestedActionReviewStatus(isRecord(item) ? item.reviewStatus : undefined) ?? "unreviewed",
            reviewedAt: optionalString(item, "reviewedAt"),
            reviewedBy: optionalString(item, "reviewedBy"),
            reviewNote: optionalString(item, "reviewNote"),
          });
        }
      });
  }

  const memoryTypes = new Set(["product_truth", "user_insight", "growth_insight", "constraint", "channel", "narrative", "priority", "open_question", "other"]);

  if (Array.isArray(value.memoryCandidates)) {
    value.memoryCandidates.forEach((item, index) => {
        const statement = text(item, "statement");

        if (statement) {
          memoryCandidates.push({
            id: text(item, "id", `memory_${index + 1}`),
            type: isRecord(item) && typeof item.type === "string" && memoryTypes.has(item.type) ? item.type as CmoDecisionLayer["memoryCandidates"][number]["type"] : "other",
            statement,
            reason: optionalString(item, "reason"),
            reviewStatus: normalizeMemoryCandidateReviewStatus(isRecord(item) ? item.reviewStatus : undefined),
            confidence: confidence(item),
            sourceSnippet: optionalString(item, "sourceSnippet"),
            reviewedAt: optionalString(item, "reviewedAt"),
            reviewedBy: optionalString(item, "reviewedBy"),
            reviewNote: optionalString(item, "reviewNote"),
          });
        }
      });
  }

  if (Array.isArray(value.taskCandidates)) {
    value.taskCandidates.forEach((item, index) => {
        const title = text(item, "title");

        if (title) {
          taskCandidates.push({
            id: text(item, "id", `task_${index + 1}`),
            title,
            description: optionalString(item, "description"),
            ownerHint: optionalString(item, "ownerHint"),
            dueDateHint: optionalString(item, "dueDateHint"),
            priorityHint: isRecord(item) && (item.priorityHint === "low" || item.priorityHint === "medium" || item.priorityHint === "high") ? item.priorityHint : undefined,
            source: "cmo_session",
            pushStatus: "not_pushed",
            confidence: confidence(item),
            sourceSnippet: optionalString(item, "sourceSnippet"),
            reviewStatus: normalizeTaskCandidateReviewStatus(isRecord(item) ? item.reviewStatus : undefined) ?? "unreviewed",
            reviewedAt: optionalString(item, "reviewedAt"),
            reviewedBy: optionalString(item, "reviewedBy"),
            reviewNote: optionalString(item, "reviewNote"),
          });
        }
      });
  }
  const extractionStatus = value.extractionStatus === "completed" || value.extractionStatus === "partial" || value.extractionStatus === "empty"
    ? value.extractionStatus
    : "partial";

  return {
    schemaVersion: "cmo.decision-layer.v1",
    workspaceId,
    appId,
    sourceId,
    sessionId,
    createdAt,
    extractionMode: "deterministic",
    extractionStatus,
    decisions,
    assumptions,
    suggestedActions,
    memoryCandidates,
    taskCandidates,
  };
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 120);
}

function sessionPath(sessionId: string): string {
  return path.join(APP_CHAT_DIR, `${safeId(sessionId)}.json`);
}

function sessionJsonIndexPath(sessionId: string): string {
  return path.relative(process.cwd(), sessionPath(sessionId)).replaceAll("\\", "/");
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeVaultNote(value: unknown, index: number): VaultNoteRef | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = stringValue(value.title, `Context ${index + 1}`);
  const pathValue = stringValue(value.path);

  if (!pathValue) {
    return null;
  }

  return {
    id: stringValue(value.id, `context_${index + 1}`),
    title,
    path: pathValue,
    type: value.type === "daily-note" || value.type === "raw-capture" ? value.type : "app-note",
    reason: stringValue(value.reason),
    selected: value.selected === false ? false : true,
    exists: typeof value.exists === "boolean" ? value.exists : undefined,
    contentPreview: stringValue(value.contentPreview),
    frontmatterStatus: stringValue(value.frontmatterStatus),
    contextQuality: normalizeContextQuality(value.contextQuality),
    qualityReason: stringValue(value.qualityReason),
  };
}

function normalizeSelectedNotes(value: unknown): VaultNoteRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => normalizeVaultNote(item, index))
    .filter((item): item is VaultNoteRef => Boolean(item));
}

function normalizeGraphHint(value: unknown, index: number): ContextGraphHint | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = stringValue(value.title, `Graph hint ${index + 1}`);
  const pathValue = stringValue(value.path);

  if (!title || !pathValue) {
    return null;
  }

  return {
    id: stringValue(value.id, `graph_${index + 1}`),
    title,
    path: pathValue,
    reason: stringValue(value.reason),
    sourceType: normalizeGraphSourceType(value.sourceType ?? value.source_type),
    confidence: normalizeGraphConfidence(value.confidence),
    contentPreview: stringValue(value.contentPreview ?? value.content_preview) || undefined,
    exists: value.exists === false ? false : true,
  };
}

function normalizeGraphHints(value: unknown): ContextGraphHint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => normalizeGraphHint(item, index))
    .filter((item): item is ContextGraphHint => Boolean(item));
}

export function isAppChatPayload(body: unknown): body is CMOAppChatRequest {
  if (!isRecord(body)) {
    return false;
  }

  return Boolean(body.appId || body.appName || (isRecord(body.context) && body.context.mode === "app_context"));
}

function normalizeAppChatRequest(body: unknown): CMOAppChatRequest {
  if (!isRecord(body)) {
    throw new CmoAdapterError("App chat request body must be an object", 400, "cmo_app_chat_invalid_request");
  }

  const appId = stringValue(body.appId);
  const knownApp = appId ? getAppWorkspace(appId) : undefined;
  const appName = stringValue(body.appName, knownApp?.name ?? "Selected app");
  const message = stringValue(body.message ?? body.question ?? body.input);

  if (!appId) {
    throw new CmoAdapterError("appId is required", 400, "cmo_app_chat_app_id_required");
  }

  if (!knownApp) {
    throw new CmoAdapterError(`Unknown appId: ${appId}`, 404, "cmo_app_chat_unknown_app");
  }

  if (!message) {
    throw new CmoAdapterError("message is required", 400, "cmo_app_chat_message_required");
  }

  const registryEntry = requireWorkspaceRegistryEntry(knownApp.id);
  const requestedWorkspaceId = stringValue(body.workspaceId);
  const legacyHoldstationMiniAppScope =
    knownApp.id === "holdstation-mini-app" && requestedWorkspaceId === registryEntry.tenantId;
  const workspaceId = legacyHoldstationMiniAppScope
    ? registryEntry.workspaceId
    : requestedWorkspaceId || registryEntry.workspaceId;

  if (workspaceId !== registryEntry.workspaceId) {
    throw new CmoAdapterError(`Unsupported workspaceId: ${workspaceId}`, 400, "cmo_app_chat_unsupported_workspace");
  }

  return {
    tenantId: registryEntry.tenantId,
    workspaceId,
    appId: knownApp.id,
    appName,
    sessionId: stringValue(body.sessionId) || undefined,
    rangeKey: lensReadoutRangeKey(body.rangeKey ?? (isRecord(body.context) ? body.context.rangeKey : undefined)),
    message,
    topic: stringValue(body.topic),
    forceFallback: body.forceFallback === true || (isRecord(body.context) && body.context.forceFallback === true),
    attachments: normalizeCmoSessionAttachments(body.attachments)
      .filter((attachment) => attachment.workspace_id === workspaceId && attachment.app_id === knownApp.id)
      .slice(0, 8),
    context: {
      mode: "app_context",
      selectedNotes: [],
    },
  };
}

function normalizeRuntimeStatus(value: unknown, isDevelopmentFallback: boolean): CMOChatSession["runtimeStatus"] {
  if (
    value === "connected" ||
    value === "live" ||
    value === "configured_but_unreachable" ||
    value === "live_failed_then_fallback" ||
    value === "development_fallback" ||
    value === "runtime_error" ||
    value === "not_configured"
  ) {
    return value;
  }

  return isDevelopmentFallback ? "development_fallback" : undefined;
}

function normalizeRuntimeMode(value: unknown, runtimeStatus: CMOChatSession["runtimeStatus"], isDevelopmentFallback: boolean): CmoRuntimeMode | undefined {
  if (value === "live" || value === "fallback" || value === "configured_but_unreachable") {
    return value;
  }

  if (runtimeStatus === "connected" || runtimeStatus === "live") {
    return "live";
  }

  if (runtimeStatus === "configured_but_unreachable" || runtimeStatus === "runtime_error") {
    return "configured_but_unreachable";
  }

  return isDevelopmentFallback ? "fallback" : undefined;
}

function normalizeRuntimeErrorReason(value: unknown): CmoRuntimeErrorReason | undefined {
  return value === "unsupported_chat_turn" ||
    value === "timeout" ||
    value === "invalid_response" ||
    value === "empty_answer" ||
    value === "execution_error"
    ? value
    : undefined;
}

function normalizeRuntimeProvider(value: unknown): string | undefined {
  const normalized = stringValue(value);

  return normalized || undefined;
}

function normalizeProductRenderSource(value: unknown): CmoProductRenderSource | undefined {
  return value === "hermes_cmo" ||
    value === "fallback_after_hermes_failure" ||
    value === "local_runtime_fallback" ||
    value === "legacy_cmo_engine" ||
    value === "direct_bridge" ||
    value === "local_session_command"
    ? value
    : undefined;
}

function normalizeOuterTimeoutSource(value: unknown): CMOChatSession["outerTimeoutSource"] | undefined {
  return value === "default_app_turn" || value === "creative_execute" ? value : undefined;
}

function normalizeRouteDecision(value: unknown): CMOChatSession["routeDecision"] | undefined {
  return value === "app_turn" ||
    value === "creative_execution" ||
    value === "creative_ideation" ||
    value === "creative_session" ||
    value === "execute" ||
    value === "tool_execute" ||
    value === "cmo_agent"
    ? value
    : undefined;
}

function normalizeContextDiagnostics(value: unknown): CMOContextDiagnostics | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const selectedCount = Number(value.selectedCount);
  const existingCount = Number(value.existingCount);
  const missingCount = Number(value.missingCount);
  const totalChars = Number(value.totalChars);

  if (![selectedCount, existingCount, missingCount, totalChars].every(Number.isFinite)) {
    return undefined;
  }

  const confirmedCount = Number(value.confirmedCount);
  const draftCount = Number(value.draftCount);
  const placeholderCount = Number(value.placeholderCount);
  const placeholderOrDraftCount = Number(value.placeholderOrDraftCount);

  return {
    selectedCount: Math.max(0, Math.floor(selectedCount)),
    existingCount: Math.max(0, Math.floor(existingCount)),
    missingCount: Math.max(0, Math.floor(missingCount)),
    confirmedCount: Number.isFinite(confirmedCount) ? Math.max(0, Math.floor(confirmedCount)) : 0,
    draftCount: Number.isFinite(draftCount) ? Math.max(0, Math.floor(draftCount)) : 0,
    placeholderCount: Number.isFinite(placeholderCount) ? Math.max(0, Math.floor(placeholderCount)) : 0,
    placeholderOrDraftCount: Number.isFinite(placeholderOrDraftCount)
      ? Math.max(0, Math.floor(placeholderOrDraftCount))
      : Number.isFinite(draftCount) && Number.isFinite(placeholderCount)
        ? Math.max(0, Math.floor(draftCount)) + Math.max(0, Math.floor(placeholderCount))
        : 0,
    totalChars: Math.max(0, Math.floor(totalChars)),
  };
}

function normalizeContextQualitySummary(value: unknown, fallbackNotes: VaultNoteRef[]): CMOContextQualitySummary {
  if (isRecord(value)) {
    const selectedCount = Number(value.selectedCount);
    const existingCount = Number(value.existingCount);
    const missingCount = Number(value.missingCount);
    const confirmedCount = Number(value.confirmedCount);
    const draftCount = Number(value.draftCount);
    const placeholderCount = Number(value.placeholderCount);
    const placeholderOrDraftCount = Number(value.placeholderOrDraftCount);

    if ([selectedCount, existingCount, missingCount, confirmedCount, draftCount, placeholderCount].every(Number.isFinite)) {
      return {
        selectedCount: Math.max(0, Math.floor(selectedCount)),
        existingCount: Math.max(0, Math.floor(existingCount)),
        missingCount: Math.max(0, Math.floor(missingCount)),
        confirmedCount: Math.max(0, Math.floor(confirmedCount)),
        draftCount: Math.max(0, Math.floor(draftCount)),
        placeholderCount: Math.max(0, Math.floor(placeholderCount)),
        placeholderOrDraftCount: Number.isFinite(placeholderOrDraftCount)
          ? Math.max(0, Math.floor(placeholderOrDraftCount))
          : Math.max(0, Math.floor(draftCount)) + Math.max(0, Math.floor(placeholderCount)),
      };
    }
  }

  return summarizeContextQuality(fallbackNotes);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => stringValue(item)).filter(Boolean);
}

function normalizeSafeTraceSummary(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries: Array<[string, unknown]> = [];

  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) {
      continue;
    }

    if (typeof item === "string") {
      if (item.length <= 300) {
        entries.push([key, item]);
      }
      continue;
    }

    if (typeof item === "number") {
      if (Number.isFinite(item)) {
        entries.push([key, item]);
      }
      continue;
    }

    if (typeof item === "boolean" || item === null) {
      entries.push([key, item]);
      continue;
    }

    if (Array.isArray(item) && item.length <= 20 && item.every((entry) => typeof entry === "string" && entry.length <= 120)) {
      entries.push([key, item]);
    }
  }

  return entries.length ? Object.fromEntries(entries) : undefined;
}

const UNSAFE_CREATIVE_DIAGNOSTIC_TEXT_PATTERN =
  /(\[hermes_local_artifact_path_redacted\]|hermes_local_artifact_path_redacted|\.png_redact|(?:^|\s)file:|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|\/(?:tmp|var|Users|home|mnt|private|Volumes)\b|conversion_h_|creative-agent-images|cmo-creative-execute|creative[_\s-]*image[_\s-]*asset[_\s-]*refine)/i;
const UNSAFE_CREATIVE_DIAGNOSTIC_WRAPPER_PATTERN =
  /^\s*(?:\{|\[|Creative[_\s-]*image[_\s-]*asset[_\s-]*refine\s*[:={\[]|reference_assets\s*[:={\[]|conversion_h_|creative-agent-images\b|cmo-creative-execute\b)/i;
const UNSAFE_CREATIVE_DIAGNOSTIC_LINE_PATTERN =
  /(\[hermes_local_artifact_path_redacted\]|hermes_local_artifact_path_redacted|\.png_redact|(?:^|\s)file:|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|\/(?:tmp|var|Users|home|mnt|private|Volumes)\b|conversion_h_|creative-agent-images|cmo-creative-execute|reference_assets)/i;

function normalizeSafeCreativeDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 40)
      .map(normalizeSafeCreativeDiagnosticValue)
      .filter((item) => item !== undefined);

    return items.length ? items : undefined;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([key]) => /^[a-zA-Z0-9_.-]{1,80}$/.test(key))
      .map(([key, item]) => [key, normalizeSafeCreativeDiagnosticValue(item)] as const)
      .filter(([, item]) => item !== undefined);

    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  if (typeof value === "string") {
    const text = stringValue(value);

    if (!text || UNSAFE_CREATIVE_DIAGNOSTIC_TEXT_PATTERN.test(text)) {
      return undefined;
    }

    return text.length > 1200 ? `${text.slice(0, 1197).trimEnd()}...` : text;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "boolean" || value === null) {
    return value;
  }

  return undefined;
}

function normalizeSafeCreativeDiagnosticRecord(value: unknown): Record<string, unknown> | undefined {
  const normalized = normalizeSafeCreativeDiagnosticValue(value);

  return isRecord(normalized) ? normalized : undefined;
}

function scrubPersistedReplayText(value: unknown, fallback = ""): string {
  const text = stringValue(value, fallback);

  if (!text) {
    return "";
  }

  if (
    UNSAFE_CREATIVE_DIAGNOSTIC_WRAPPER_PATTERN.test(text) &&
    UNSAFE_CREATIVE_DIAGNOSTIC_TEXT_PATTERN.test(text)
  ) {
    return "";
  }

  if (!UNSAFE_CREATIVE_DIAGNOSTIC_LINE_PATTERN.test(text)) {
    return text;
  }

  const scrubbed = text
    .split(/\r?\n/)
    .filter((line) => !UNSAFE_CREATIVE_DIAGNOSTIC_LINE_PATTERN.test(line))
    .join("\n")
    .trim();

  return scrubbed;
}

function normalizeSuggestedActions(value: unknown): CMOAppChatResponse["suggestedActions"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const label = stringValue(item.label);

      return label
        ? {
            type: stringValue(item.type, "runtime_suggestion"),
            label,
          }
        : null;
    })
    .filter((item): item is CMOAppChatResponse["suggestedActions"][number] => Boolean(item));
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = stringValue(value);

  return normalized || undefined;
}

function normalizeSourceReviewContext(value: unknown): CmoSourceReviewContext | undefined {
  if (!isRecord(value) || value.schema_version !== "cmo.source_review_context.v1") {
    return undefined;
  }

  const mode = value.mode === "session_local" ? "session_local" : value.mode === "review_only" ? "review_only" : undefined;
  const workspaceId = normalizeOptionalString(value.workspace_id);
  const sessionId = normalizeOptionalString(value.session_id);
  const requestId = normalizeOptionalString(value.request_id);
  const source = isRecord(value.source) ? value.source : undefined;
  const extraction = isRecord(value.extraction) ? value.extraction : undefined;

  if (!mode || !workspaceId || !sessionId || !requestId || !source || !extraction) {
    return undefined;
  }

  return {
    schema_version: "cmo.source_review_context.v1",
    mode,
    tenant_id: normalizeOptionalString(value.tenant_id) ?? "holdstation",
    workspace_id: workspaceId,
    user_id: normalizeOptionalString(value.user_id) ?? "legacy_dashboard_user",
    session_id: sessionId,
    request_id: requestId,
    source,
    extraction,
    safety: {
      read_only: true,
      vault_mutation: false,
      gbrain_mutation: false,
      no_promotion: true,
    },
    ...(isRecord(value.persistence)
      ? {
          persistence: {
            saved_to_vault: false,
            truth_status: "session_only",
            review_status: "temporary",
            no_auto_promote: true,
          },
        }
      : {}),
  };
}

function normalizeSourceReadDepth(value: unknown): CmoSessionLocalSource["read_depth"] {
  return value === "snippet" || value === "extracted_text" || value === "browser_rendered" || value === "full_doc" || value === "partial"
    ? value
    : undefined;
}

function normalizeSourceCacheRole(value: unknown): CmoSessionLocalSource["cache_role"] {
  return value === "context_hint" || value === "fallback_only" || value === "high_quality_evidence" ? value : undefined;
}

function normalizeSourceAnswerContext(value: unknown): CmoSourceAnswerContext | undefined {
  if (!isRecord(value) || value.type !== "source_answer_context" || value.schema_version !== "cmo.source_answer_context.v1") {
    return undefined;
  }

  const workspaceId = normalizeOptionalString(value.workspace_id);
  const sessionId = normalizeOptionalString(value.session_id);
  const sourceId = normalizeOptionalString(value.source_id);
  const query = normalizeOptionalString(value.query);

  if (!workspaceId || !sessionId || !sourceId || !query || typeof value.answerable !== "boolean") {
    return undefined;
  }

  return {
    type: "source_answer_context",
    schema_version: "cmo.source_answer_context.v1",
    workspace_id: workspaceId,
    session_id: sessionId,
    source_id: sourceId,
    query,
    query_type:
      value.query_type === "can_read" ||
      value.query_type === "summarize" ||
      value.query_type === "translate" ||
      value.query_type === "specific_question" ||
      value.query_type === "review" ||
      value.query_type === "unknown"
        ? value.query_type
        : "unknown",
    action:
      value.action === "can_read" ||
      value.action === "summarize" ||
      value.action === "translate" ||
      value.action === "answer_question" ||
      value.action === "review" ||
      value.action === "unknown"
        ? value.action
        : "unknown",
    answerable: value.answerable,
    relevant_snippets: Array.isArray(value.relevant_snippets) ? value.relevant_snippets.filter((item): item is string => typeof item === "string") : [],
    used_source_fields: Array.isArray(value.used_source_fields)
      ? value.used_source_fields.filter((item): item is CmoSourceAnswerContext["used_source_fields"][number] =>
          item === "extracted_summary" || item === "source_text_cache" || item === "source_text_excerpt" || item === "refetch")
      : [],
    ...(normalizeOptionalString(value.source_title) ? { source_title: normalizeOptionalString(value.source_title) } : {}),
    ...(normalizeOptionalString(value.original_url) ? { original_url: normalizeOptionalString(value.original_url) } : {}),
    ...(normalizeOptionalString(value.canonical_url) ? { canonical_url: normalizeOptionalString(value.canonical_url) } : {}),
    ...(normalizeOptionalString(value.content_hash) ? { content_hash: normalizeOptionalString(value.content_hash) } : {}),
    truth_status: "session_only",
    saved_to_vault: false,
    no_auto_promote: true,
    ...(value.reason === "not_found_in_current_extraction" || value.reason === "extraction_partial" || value.reason === "no_active_source" ? { reason: value.reason } : {}),
    ...(value.extraction_quality === "good" || value.extraction_quality === "partial" || value.extraction_quality === "low" ? { extraction_quality: value.extraction_quality } : {}),
    ...(value.extraction_coverage === "static_html" || value.extraction_coverage === "rendered_dom" || value.extraction_coverage === "deep_crawl" || value.extraction_coverage === "partial" ? { extraction_coverage: value.extraction_coverage } : {}),
    ...(normalizeSourceReadDepth(value.read_depth) ? { read_depth: normalizeSourceReadDepth(value.read_depth) } : {}),
    ...(normalizeSourceCacheRole(value.cache_role) ? { cache_role: normalizeSourceCacheRole(value.cache_role) } : {}),
    ...(typeof value.nav_heavy === "boolean" ? { nav_heavy: value.nav_heavy } : {}),
    ...(typeof value.tool_read_recommended === "boolean" ? { tool_read_recommended: value.tool_read_recommended } : {}),
    ...(Array.isArray(value.warnings) ? { warnings: value.warnings.filter((item): item is string => typeof item === "string") } : {}),
    ...(value.suggested_next_step === "deep_read_or_rendered_fetch" ? { suggested_next_step: "deep_read_or_rendered_fetch" } : {}),
  };
}

function normalizeSessionLocalSource(value: unknown): CmoSessionLocalSource | undefined {
  if (!isRecord(value) || value.type !== "session_local_source" || value.schema_version !== "cmo.session_local_source.v1") {
    return undefined;
  }

  const workspaceId = normalizeOptionalString(value.workspace_id);
  const sessionId = normalizeOptionalString(value.session_id);
  const turnId = normalizeOptionalString(value.turn_id);
  const sourceId = normalizeOptionalString(value.source_id);
  const sourceTitle = normalizeOptionalString(value.source_title);
  const extractionStatus = sessionSourceStatus(normalizeOptionalString(value.extraction_status));

  if (!workspaceId || !sessionId || !turnId || !sourceId || !sourceTitle || extractionStatus === "failed") {
    return undefined;
  }

  return {
    type: "session_local_source",
    schema_version: "cmo.session_local_source.v1",
    workspace_id: workspaceId,
    session_id: sessionId,
    turn_id: turnId,
    source_id: sourceId,
    source_type: normalizeOptionalString(value.source_type) ?? "text",
    source_title: sourceTitle,
    ...(normalizeOptionalString(value.original_url) ? { original_url: normalizeOptionalString(value.original_url) } : {}),
    ...(normalizeOptionalString(value.canonical_url) ? { canonical_url: normalizeOptionalString(value.canonical_url) } : {}),
    ...(normalizeOptionalString(value.original_filename) ? { original_filename: normalizeOptionalString(value.original_filename) } : {}),
    ...(normalizeOptionalString(value.extracted_summary) ? { extracted_summary: normalizeOptionalString(value.extracted_summary) } : {}),
    ...(normalizeOptionalString(value.source_text_excerpt) ? { source_text_excerpt: normalizeOptionalString(value.source_text_excerpt) } : {}),
    ...(normalizeOptionalString(value.source_text_cache) ? { source_text_cache: normalizeOptionalString(value.source_text_cache) } : {}),
    extraction_status: extractionStatus,
    ...(value.main_content_quality === "good" || value.main_content_quality === "partial" || value.main_content_quality === "low" ? { main_content_quality: value.main_content_quality } : {}),
    ...(value.extraction_coverage === "static_html" || value.extraction_coverage === "rendered_dom" || value.extraction_coverage === "deep_crawl" || value.extraction_coverage === "partial" ? { extraction_coverage: value.extraction_coverage } : {}),
    ...(normalizeSourceReadDepth(value.read_depth) ? { read_depth: normalizeSourceReadDepth(value.read_depth) } : {}),
    ...(normalizeSourceCacheRole(value.cache_role) ? { cache_role: normalizeSourceCacheRole(value.cache_role) } : {}),
    ...(typeof value.nav_heavy === "boolean" ? { nav_heavy: value.nav_heavy } : {}),
    ...(typeof value.tool_read_recommended === "boolean" ? { tool_read_recommended: value.tool_read_recommended } : {}),
    ...(Array.isArray(value.warnings) ? { warnings: value.warnings.filter((item): item is string => typeof item === "string") } : {}),
    ...(normalizeOptionalString(value.full_artifact_ref) ? { full_artifact_ref: normalizeOptionalString(value.full_artifact_ref) } : {}),
    ...(normalizeOptionalString(value.content_hash) ? { content_hash: normalizeOptionalString(value.content_hash) } : {}),
    saved_to_vault: false,
    official_project_source: false,
    truth_status: "session_only",
    review_status: "temporary",
    no_auto_promote: true,
    safety: {
      read_only: true,
      vault_mutation: false,
      gbrain_mutation: false,
      promotion_performed: false,
    },
  };
}

function normalizeSessionLocalSources(value: unknown, workspaceId?: string, sessionId?: string): CmoSessionLocalSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeSessionLocalSource)
    .filter((source): source is CmoSessionLocalSource => Boolean(source))
    .filter((source) => (workspaceId ? source.workspace_id === workspaceId : true))
    .filter((source) => (sessionId ? source.session_id === sessionId : true))
    .slice(0, 3);
}

function normalizeOptionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function normalizeAuthMode(value: unknown): CmoAuthMode | undefined {
  return value === "supabase" || value === "legacy" ? value : undefined;
}

function normalizeIndexedContextStatus(value: unknown): CmoIndexedContextStatus | undefined {
  return value === "off" || value === "skipped" || value === "used" ? value : undefined;
}

function normalizeHermesCmoChatStatus(value: unknown): HermesCmoChatStatus | undefined {
  return value === "live" ||
    value === "failed_then_existing_fallback" ||
    value === "guardrail_violation_then_existing_fallback" ||
    value === "interrupted"
    ? value
    : undefined;
}

function normalizeHermesCmoDelegationsMode(value: unknown): HermesCmoDelegationsMode | undefined {
  return value === HERMES_CMO_PROPOSALS_ONLY || value === "echo_surf_bounded" ? value : undefined;
}

function normalizeHermesCmoCounters(value: unknown): HermesCmoSafetyCounters | undefined {
  const validation = validateHermesCmoChatCounters({ safety_counters: value });

  return validation.ok ? validation.counters : undefined;
}

function normalizeHermesCmoForbiddenCounters(value: unknown): HermesCmoForbiddenCounters | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const directSupabaseMutations =
    normalizeOptionalNonNegativeNumber(value.directSupabaseMutations ?? value.supabaseWrites) ?? undefined;
  const vaultAgentCalls =
    value.vaultAgentCalls === undefined ? 0 : normalizeOptionalNonNegativeNumber(value.vaultAgentCalls);
  const vaultWrites = normalizeOptionalNonNegativeNumber(value.vaultWrites) ?? undefined;
  const openclawCalls = normalizeOptionalNonNegativeNumber(value.openclawCalls) ?? undefined;

  return typeof vaultAgentCalls === "number" &&
    typeof vaultWrites === "number" &&
    typeof openclawCalls === "number" &&
    typeof directSupabaseMutations === "number"
    ? {
        vaultAgentCalls,
        vaultWrites,
        openclawCalls,
        directSupabaseMutations,
      }
    : undefined;
}

function normalizeStrategyMode(value: unknown): CmoStrategyMode | undefined {
  return value === "DIAGNOSE" || value === "FOCUS" || value === "PRIORITIZE" || value === "REVIEW" || value === "RESET"
    ? value
    : undefined;
}

function normalizeDecisionLabel(value: unknown): CmoDecisionLabel | undefined {
  return value === "KEEP" || value === "CUT" || value === "TEST" || value === "SCALE" || value === "WAIT"
    ? value
    : undefined;
}

function normalizeHermesCmoAgentUsed(value: unknown): HermesCmoAgentUsed | undefined {
  return value === "cmo" || value === "echo" || value === "surf" || value === "creative" ? value : undefined;
}

function normalizeHermesCmoActivityEvents(value: unknown): HermesCmoActivityEventSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((event): HermesCmoActivityEventSummary | null => {
      if (!isRecord(event)) {
        return null;
      }

      const eventId = stringValue(event.eventId);
      const type = stringValue(event.type);
      const status = stringValue(event.status);
      const message = stringValue(event.message);

      return eventId && type && status && message
        ? {
            eventId,
            type,
            status,
            message,
            userVisible: event.userVisible === true,
            ...(normalizeHermesCmoAgentUsed(event.sourceAgent) ? { sourceAgent: normalizeHermesCmoAgentUsed(event.sourceAgent) } : {}),
            ...(stringValue(event.sourceMode) ? { sourceMode: stringValue(event.sourceMode) as HermesCmoActivityEventSummary["sourceMode"] } : {}),
          }
        : null;
    })
    .filter((event): event is HermesCmoActivityEventSummary => Boolean(event));
}

function normalizeHermesCmoDelegationSummary(value: unknown): HermesCmoDelegationSummaryItem[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((item): HermesCmoDelegationSummaryItem | null => {
      if (!isRecord(item)) {
        return null;
      }

      const targetAgent = item.targetAgent === "echo" || item.targetAgent === "surf" || item.targetAgent === "creative" ? item.targetAgent : null;
      const mode = stringValue(item.mode) as HermesCmoDelegationSummaryItem["mode"];
      const status =
        item.status === "completed" || item.status === "failed" || item.status === "skipped" ? item.status : null;
      const delegationId = stringValue(item.delegationId);
      const objective = stringValue(item.objective);
      const summary = stringValue(item.summary);

      return targetAgent && delegationId && objective && status && summary
        ? {
            delegationId,
            targetAgent,
            mode,
            objective,
            status,
            summary,
            ...(stringValue(item.failureReason) ? { failureReason: stringValue(item.failureReason) } : {}),
          }
        : null;
    })
    .filter((item): item is HermesCmoDelegationSummaryItem => Boolean(item));
}

function normalizeHermesCmoPlatformPersistenceSummary(value: unknown): HermesCmoPlatformPersistenceSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const status = value.supabaseIndexingStatus;

  if (status !== "indexed" && status !== "skipped" && status !== "failed") {
    return undefined;
  }

  return {
    sessionJsonSaved: value.sessionJsonSaved === true,
    rawCaptureSaved: value.rawCaptureSaved === true,
    ...(value.rawCaptureStatus === "saved" || value.rawCaptureStatus === "failed" || value.rawCaptureStatus === "pending"
      ? { rawCaptureStatus: value.rawCaptureStatus }
      : {}),
    supabaseIndexingStatus: status,
  };
}

function normalizeContractWarnings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const warnings = value
    .map((item) => typeof item === "string" ? compactSessionSourceText(item, 240) : "")
    .filter(Boolean)
    .slice(0, 20);

  return warnings;
}

function normalizeSafeMetadataValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return compactSessionSourceText(value, 500);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 12)
      .map((item) => normalizeSafeMetadataValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (!isRecord(value) || depth >= 3) {
    return undefined;
  }

  const safe: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    if (RESEARCH_UNSAFE_KEYS.test(key)) {
      continue;
    }

    const normalized = normalizeSafeMetadataValue(nested, depth + 1);
    if (normalized !== undefined) {
      safe[key] = normalized;
    }
  }

  return Object.keys(safe).length ? safe : undefined;
}

function normalizeStateContractMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const normalized = normalizeSafeMetadataValue(value);
  return isRecord(normalized) ? normalized : undefined;
}

function supabaseIndexingStatus(results: CmoIndexResult[]): HermesCmoPlatformPersistenceSummary["supabaseIndexingStatus"] {
  if (results.some((result) => result.status === "failed")) {
    return "failed";
  }

  if (results.some((result) => result.status === "indexed")) {
    return "indexed";
  }

  return "skipped";
}

function attachHermesCmoPlatformPersistence(
  session: CMOChatSession,
  assistantId: string,
  summary: HermesCmoPlatformPersistenceSummary,
): CMOChatSession {
  const metadataWithPersistence = session.hermesCmoMetadata
    ? {
        ...session.hermesCmoMetadata,
        platformPersistenceSummary: summary,
      }
    : undefined;

  return {
    ...session,
    platformPersistenceSummary: summary,
    ...(metadataWithPersistence ? { hermesCmoMetadata: metadataWithPersistence } : {}),
    messages: session.messages.map((message) =>
      message.id === assistantId
        ? {
            ...message,
            platformPersistenceSummary: summary,
            ...(message.hermesCmoMetadata
              ? {
                  hermesCmoMetadata: {
                    ...message.hermesCmoMetadata,
                    platformPersistenceSummary: summary,
                  },
                }
              : {}),
          }
        : message,
    ),
  };
}

function normalizeHermesCmoMetadata(value: unknown): HermesCmoChatMetadata | undefined {
  if (
    !isRecord(value) ||
    value.runtimeMode !== "hermes_cmo" ||
    (value.runtimeStatus !== "live" && value.runtimeStatus !== "fallback") ||
    value.calledHermesCmo !== true
  ) {
    return undefined;
  }

  const counters = normalizeHermesCmoCounters(value.counters);
  const forbiddenCounters = normalizeHermesCmoForbiddenCounters(value.forbiddenCounters ?? value.counters);
  const requestId = stringValue(value.requestId);
  const responseStatus = stringValue(value.responseStatus);
  const activityEventsCount = normalizeOptionalNonNegativeNumber(value.activityEventsCount);

  if (!counters || !forbiddenCounters || !requestId || !responseStatus || typeof activityEventsCount !== "number") {
    return undefined;
  }

  const activityEvents = normalizeHermesCmoActivityEvents(value.activityEvents);
  const delegationSummary = normalizeHermesCmoDelegationSummary(value.delegationSummary);
  const agentsUsed = Array.isArray(value.agentsUsed)
    ? value.agentsUsed.map(normalizeHermesCmoAgentUsed).filter((agent): agent is HermesCmoAgentUsed => Boolean(agent))
    : undefined;
  const toolsUsed = normalizeStringList(value.toolsUsed);
  const toolsUsedSnake = normalizeStringList(value.tools_used);
  const toolTraceSummary = normalizeSafeTraceSummary(value.toolTraceSummary ?? value.tool_trace_summary);
  const platformPersistenceSummary = normalizeHermesCmoPlatformPersistenceSummary(value.platformPersistenceSummary);
  const contractWarnings = normalizeContractWarnings(value.contract_warnings);
  const stateContract = normalizeStateContractMetadata(value.state_contract);
  const safeRoute = normalizeSafeCreativeDiagnosticRecord(value.route ?? value.hermes_route);
  const safeIntentDecision = normalizeSafeCreativeDiagnosticRecord(value.intent_decision);
  const safeSpecialistCalls = Array.isArray(value.specialist_calls)
    ? normalizeSafeCreativeDiagnosticValue(value.specialist_calls)
    : undefined;
  const safeDiagnostics = normalizeSafeCreativeDiagnosticRecord(value.diagnostics ?? value.hermes_diagnostics);
  const finalSessionWriteProjection = normalizeSafeCreativeDiagnosticRecord(value.final_session_write_projection);
  const creativeDecision = normalizeCreativeDecision(normalizeSafeCreativeDiagnosticValue(value.creative_decision));
  const sideEffects = value.sideEffects === false
    ? false
    : isRecord(value.sideEffects) && Object.values(value.sideEffects).every((item) => item === false)
      ? Object.fromEntries(Object.entries(value.sideEffects)) as Record<string, false>
      : undefined;
  const writeSideEffects = value.write_side_effects === false
    ? false
    : isRecord(value.write_side_effects) && Object.values(value.write_side_effects).every((item) => typeof item === "boolean")
      ? Object.fromEntries(Object.entries(value.write_side_effects)) as Record<string, boolean>
      : undefined;

  return {
    runtimeMode: "hermes_cmo",
    runtimeStatus: value.runtimeStatus,
    calledHermesCmo: true,
    ...(value.hermesRequestSent === true ? { hermesRequestSent: true } : {}),
    ...(value.productRenderSource === "hermes_cmo" || value.productRenderSource === "fallback_after_hermes_failure"
      ? { productRenderSource: value.productRenderSource }
      : {}),
    ...(stringValue(value.selectedHermesEndpoint) ? { selectedHermesEndpoint: stringValue(value.selectedHermesEndpoint) } : {}),
    ...(value.hermesEndpointKind === "execute" || value.hermesEndpointKind === "tool_execute" || value.hermesEndpointKind === "agent_chat" || value.hermesEndpointKind === "cmo_agent"
      ? { hermesEndpointKind: value.hermesEndpointKind }
      : {}),
    ...(value.endpoint_kind === "execute" || value.endpoint_kind === "tool_execute" || value.endpoint_kind === "agent_chat" || value.endpoint_kind === "cmo_agent"
      ? { endpoint_kind: value.endpoint_kind }
      : {}),
    ...(value.runtime_kind === "ai_agent" ? { runtime_kind: "ai_agent" } : {}),
    ...(stringValue(value.requested_endpoint) ? { requested_endpoint: stringValue(value.requested_endpoint) } : {}),
    ...(typeof value.fallback_used === "boolean" ? { fallback_used: value.fallback_used } : {}),
    ...(stringValue(value.fallback_reason) ? { fallback_reason: stringValue(value.fallback_reason) } : {}),
    ...(stringValue(value.fallback_from) ? { fallback_from: stringValue(value.fallback_from) } : {}),
    ...(stringValue(value.fallback_to) ? { fallback_to: stringValue(value.fallback_to) } : {}),
    ...(finalSessionWriteProjection ? { final_session_write_projection: finalSessionWriteProjection } : {}),
    ...(typeof value.hermesEndpointTimeoutMs === "number" && Number.isFinite(value.hermesEndpointTimeoutMs)
      ? { hermesEndpointTimeoutMs: Math.max(0, Math.floor(value.hermesEndpointTimeoutMs)) }
      : {}),
    ...(value.hermesEndpointTimeoutSource === "default_execute" ||
    value.hermesEndpointTimeoutSource === "creative_execute" ||
    value.hermesEndpointTimeoutSource === "tool_endpoint" ||
    value.hermesEndpointTimeoutSource === "tool_timeout_override" ||
    value.hermesEndpointTimeoutSource === "unified_agent"
      ? { hermesEndpointTimeoutSource: value.hermesEndpointTimeoutSource }
      : {}),
    ...(value.timeout_source === "default_execute" ||
    value.timeout_source === "creative_execute" ||
    value.timeout_source === "tool_endpoint" ||
    value.timeout_source === "tool_timeout_override" ||
    value.timeout_source === "unified_agent"
      ? { timeout_source: value.timeout_source }
      : {}),
    ...(value.outer_timeout_source === "default_app_turn" || value.outer_timeout_source === "creative_execute"
      ? { outer_timeout_source: value.outer_timeout_source }
      : {}),
    ...(value.route_decision === "execute" ||
    value.route_decision === "creative_execution" ||
    value.route_decision === "creative_ideation" ||
    value.route_decision === "creative_session" ||
    value.route_decision === "tool_execute" ||
    value.route_decision === "cmo_agent"
      ? { route_decision: value.route_decision }
      : {}),
    ...(safeRoute ? { route: safeRoute, hermes_route: safeRoute } : {}),
    ...(safeIntentDecision ? { intent_decision: safeIntentDecision } : {}),
    ...(Array.isArray(safeSpecialistCalls) ? { specialist_calls: safeSpecialistCalls.filter(isRecord) } : {}),
    ...(creativeDecision ? { creative_decision: creativeDecision } : {}),
    ...(safeDiagnostics ? { diagnostics: safeDiagnostics, hermes_diagnostics: safeDiagnostics } : {}),
    ...(typeof value.creative_long_running_turn === "boolean" ? { creative_long_running_turn: value.creative_long_running_turn } : {}),
    ...(typeof value.creative_timeout_ms === "number" && Number.isFinite(value.creative_timeout_ms)
      ? { creative_timeout_ms: Math.max(0, Math.floor(value.creative_timeout_ms)) }
      : {}),
    ...(typeof value.workspace_fallback_suppressed_for_creative === "boolean"
      ? { workspace_fallback_suppressed_for_creative: value.workspace_fallback_suppressed_for_creative }
      : {}),
    ...(value.creative_ideation_detected === true ? { creative_ideation_detected: true } : {}),
    ...(value.cmo_owns_creative_decision === true ? { cmo_owns_creative_decision: true } : {}),
    ...(value.creative_execution_requested === true ? { creative_execution_requested: true } : {}),
    ...(value.creative_execution_response_received === true ? { creative_execution_response_received: true } : {}),
    ...(value.creative_execution_owner === "cmo" ? { creative_execution_owner: "cmo" } : {}),
    ...(value.creative_ideation_response_received === true ? { creative_ideation_response_received: true } : {}),
    ...(value.creative_session_response_received === true ? { creative_session_response_received: true } : {}),
    ...(value.creative_conversation_response_received === true ? { creative_conversation_response_received: true } : {}),
    ...(stringValue(value.creative_conversation_mode) ? { creative_conversation_mode: stringValue(value.creative_conversation_mode) } : {}),
    ...(value.creative_conversation_only === true ? { creative_conversation_only: true } : {}),
    ...(value.creative_noop_acknowledgement === true ? { creative_noop_acknowledgement: true } : {}),
    ...(value.creative_prompt_proposal_only === true ? { creative_prompt_proposal_only: true } : {}),
    ...(value.creative_mutation_requested === true ? { creative_mutation_requested: true } : {}),
    ...(stringValue(value.creative_followup_intent_class) ? { creative_followup_intent_class: stringValue(value.creative_followup_intent_class) } : {}),
    ...(stringValue(value.creative_semantic_intent_class) ? { creative_semantic_intent_class: stringValue(value.creative_semantic_intent_class) } : {}),
    ...(typeof value.mutation_allowed === "boolean" ? { mutation_allowed: value.mutation_allowed } : {}),
    ...(typeof value.execution_allowed === "boolean" ? { execution_allowed: value.execution_allowed } : {}),
    ...(typeof value.draft_update_allowed === "boolean" ? { draft_update_allowed: value.draft_update_allowed } : {}),
    ...(stringValue(value.expected_response) ? { expected_response: stringValue(value.expected_response) } : {}),
    ...(typeof value.creative_mutation_allowed === "boolean" ? { creative_mutation_allowed: value.creative_mutation_allowed } : {}),
    ...(typeof value.creative_execution_allowed === "boolean" ? { creative_execution_allowed: value.creative_execution_allowed } : {}),
    ...(typeof value.creative_draft_update_allowed === "boolean" ? { creative_draft_update_allowed: value.creative_draft_update_allowed } : {}),
    ...(stringValue(value.creative_expected_response) ? { creative_expected_response: stringValue(value.creative_expected_response) } : {}),
    ...(value.creative_no_execute_modifier_detected === true ? { creative_no_execute_modifier_detected: true } : {}),
    ...(value.product_contract_violation === true ? { product_contract_violation: true } : {}),
    ...(stringValue(value.contract_violation_reason) ? { contract_violation_reason: stringValue(value.contract_violation_reason) } : {}),
    ...(typeof value.request_execution_allowed === "boolean" ? { request_execution_allowed: value.request_execution_allowed } : {}),
    ...(typeof value.request_mutation_allowed === "boolean" ? { request_mutation_allowed: value.request_mutation_allowed } : {}),
    ...(value.assistant_response_suppressed_for_noop === true ? { assistant_response_suppressed_for_noop: true } : {}),
    ...(value.creative_conversation_rejected === true ? { creative_conversation_rejected: true } : {}),
    ...(stringValue(value.creative_conversation_rejection_reason) ? { creative_conversation_rejection_reason: stringValue(value.creative_conversation_rejection_reason) } : {}),
    ...(stringValue(value.creative_conversation_rejected_answer_preview) ? { creative_conversation_rejected_answer_preview: stringValue(value.creative_conversation_rejected_answer_preview) } : {}),
    ...(stringValue(value.native_response_answer_basis_mode) ? { native_response_answer_basis_mode: stringValue(value.native_response_answer_basis_mode) } : {}),
    ...(stringValue(value.native_response_creative_decision_action) ? { native_response_creative_decision_action: stringValue(value.native_response_creative_decision_action) } : {}),
    ...(typeof value.native_response_path_like_answer_detected === "boolean" ? { native_response_path_like_answer_detected: value.native_response_path_like_answer_detected } : {}),
    ...(value.user_visible_answer_guard_triggered === true ? { user_visible_answer_guard_triggered: true } : {}),
    ...(stringValue(value.user_visible_answer_guard_reason) ? { user_visible_answer_guard_reason: stringValue(value.user_visible_answer_guard_reason) } : {}),
    ...(typeof value.creative_asset_mutation === "boolean" ? { creative_asset_mutation: value.creative_asset_mutation } : {}),
    ...(typeof value.creative_state_mutation === "boolean" ? { creative_state_mutation: value.creative_state_mutation } : {}),
    ...(stringValue(value.reference_asset_fetch_status) ? { reference_asset_fetch_status: stringValue(value.reference_asset_fetch_status) } : {}),
    ...(typeof value.local_image_path_available === "boolean" ? { local_image_path_available: value.local_image_path_available } : {}),
    ...(typeof value.creative_visual_inspection_attempted === "boolean" ? { creative_visual_inspection_attempted: value.creative_visual_inspection_attempted } : {}),
    ...(typeof value.creative_visual_inspection_used === "boolean" ? { creative_visual_inspection_used: value.creative_visual_inspection_used } : {}),
    ...(stringValue(value.creative_visual_inspection_status) ? { creative_visual_inspection_status: stringValue(value.creative_visual_inspection_status) } : {}),
    ...(stringValue(value.creative_visual_inspection_error) ? { creative_visual_inspection_error: stringValue(value.creative_visual_inspection_error) } : {}),
    ...(stringValue(value.creative_answer_source) ? { creative_answer_source: stringValue(value.creative_answer_source) } : {}),
    ...(normalizeSafeCreativeDiagnosticValue(value.creative_visual_observations) !== undefined
      ? { creative_visual_observations: normalizeSafeCreativeDiagnosticValue(value.creative_visual_observations) }
      : {}),
    ...(typeof value.creative_post_generation_visual_inspection_attempted === "boolean"
      ? { creative_post_generation_visual_inspection_attempted: value.creative_post_generation_visual_inspection_attempted }
      : {}),
    ...(typeof value.creative_post_generation_visual_inspection_used === "boolean"
      ? { creative_post_generation_visual_inspection_used: value.creative_post_generation_visual_inspection_used }
      : {}),
    ...(stringValue(value.creative_post_generation_visual_inspection_status)
      ? { creative_post_generation_visual_inspection_status: stringValue(value.creative_post_generation_visual_inspection_status) }
      : {}),
    ...(normalizeSafeCreativeDiagnosticValue(value.creative_post_generation_visual_metadata) !== undefined
      ? { creative_post_generation_visual_metadata: normalizeSafeCreativeDiagnosticValue(value.creative_post_generation_visual_metadata) }
      : {}),
    ...(typeof value.creative_state_update_present === "boolean" ? { creative_state_update_present: value.creative_state_update_present } : {}),
    ...(typeof value.creative_decision_present === "boolean" ? { creative_decision_present: value.creative_decision_present } : {}),
    ...(stringValue(value.creative_session_decision_action) ? { creative_session_decision_action: stringValue(value.creative_session_decision_action) } : {}),
    ...(stringValue(value.creative_session_active_draft_id) ? { creative_session_active_draft_id: stringValue(value.creative_session_active_draft_id) } : {}),
    ...(typeof value.active_creative_context_present === "boolean" ? { active_creative_context_present: value.active_creative_context_present } : {}),
    ...(typeof value.active_creative_asset_resolved === "boolean" ? { active_creative_asset_resolved: value.active_creative_asset_resolved } : {}),
    ...(value.active_creative_asset_resolution_source === "creativeWorkingState" ||
    value.active_creative_asset_resolution_source === "sessionArtifacts" ||
    value.active_creative_asset_resolution_source === "messageCreativeAssets" ||
    value.active_creative_asset_resolution_source === "none"
      ? { active_creative_asset_resolution_source: value.active_creative_asset_resolution_source }
      : {}),
    ...(stringValue(value.active_asset_id) ? { active_asset_id: stringValue(value.active_asset_id) } : {}),
    ...(stringValue(value.active_creative_asset_id) ? { active_creative_asset_id: stringValue(value.active_creative_asset_id) } : {}),
    ...(stringValue(value.creative_session_active_asset_id) ? { creative_session_active_asset_id: stringValue(value.creative_session_active_asset_id) } : {}),
    ...(typeof value.creative_assets_count === "number" && Number.isFinite(value.creative_assets_count)
      ? { creative_assets_count: Math.max(0, Math.floor(value.creative_assets_count)) }
      : {}),
    ...(typeof value.creative_session_from_asset === "boolean" ? { creative_session_from_asset: value.creative_session_from_asset } : {}),
    ...(typeof value.reference_assets_count === "number" && Number.isFinite(value.reference_assets_count)
      ? { reference_assets_count: Math.max(0, Math.floor(value.reference_assets_count)) }
      : {}),
    ...(typeof value.reference_asset_fetch_url_present === "boolean" ? { reference_asset_fetch_url_present: value.reference_asset_fetch_url_present } : {}),
    ...(typeof value.reference_asset_sha256_present === "boolean" ? { reference_asset_sha256_present: value.reference_asset_sha256_present } : {}),
    ...(typeof value.reference_asset_bytes_present === "boolean" ? { reference_asset_bytes_present: value.reference_asset_bytes_present } : {}),
    ...(stringValue(value.artifact_transport_mode) ? { artifact_transport_mode: stringValue(value.artifact_transport_mode) } : {}),
    ...(typeof value.route_overrode_tool_execute_due_to_creative_context === "boolean"
      ? { route_overrode_tool_execute_due_to_creative_context: value.route_overrode_tool_execute_due_to_creative_context }
      : {}),
    ...(typeof value.tool_execute_suppressed_for_creative_followup === "boolean"
      ? { tool_execute_suppressed_for_creative_followup: value.tool_execute_suppressed_for_creative_followup }
      : {}),
    ...(typeof value.creative_session_followup_detected === "boolean" ? { creative_session_followup_detected: value.creative_session_followup_detected } : {}),
    ...(typeof value.creative_working_state_present === "boolean" ? { creative_working_state_present: value.creative_working_state_present } : {}),
    ...(stringValue(value.execute_decision_source) ? { execute_decision_source: stringValue(value.execute_decision_source) } : {}),
    ...(typeof value.creative_subprocess_executed === "boolean" ? { creative_subprocess_executed: value.creative_subprocess_executed } : {}),
    ...(typeof value.artifact_transport_attempted === "boolean" ? { artifact_transport_attempted: value.artifact_transport_attempted } : {}),
    ...(stringValue(value.creative_decision_operation) ? { creative_decision_operation: stringValue(value.creative_decision_operation) } : {}),
    ...(Array.isArray(value.activity_event_types) ? { activity_event_types: value.activity_event_types.map((item) => stringValue(item)).filter((item): item is string => Boolean(item)) } : {}),
    ...(Array.isArray(value.raw_activity_event_types) ? { raw_activity_event_types: value.raw_activity_event_types.map((item) => stringValue(item)).filter((item): item is string => Boolean(item)) } : {}),
    ...(typeof value.activity_events_allowed_for_creative_ideation === "boolean"
      ? { activity_events_allowed_for_creative_ideation: value.activity_events_allowed_for_creative_ideation }
      : {}),
    ...(typeof value.activity_events_allowed_for_creative_execution === "boolean"
      ? { activity_events_allowed_for_creative_execution: value.activity_events_allowed_for_creative_execution }
      : {}),
    ...(typeof value.activity_event_repaired === "boolean" ? { activity_event_repaired: value.activity_event_repaired } : {}),
    ...(stringValue(value.activity_event_repair_reason) ? { activity_event_repair_reason: stringValue(value.activity_event_repair_reason) } : {}),
    ...(typeof value.activity_event_ignored_for_creative_conversation === "boolean"
      ? { activity_event_ignored_for_creative_conversation: value.activity_event_ignored_for_creative_conversation }
      : {}),
    ...(stringValue(value.activity_event_ignore_reason) ? { activity_event_ignore_reason: stringValue(value.activity_event_ignore_reason) } : {}),
    ...(typeof value.creative_ideation_canonicalized === "boolean" ? { creative_ideation_canonicalized: value.creative_ideation_canonicalized } : {}),
    ...(typeof value.creative_session_canonicalized === "boolean" ? { creative_session_canonicalized: value.creative_session_canonicalized } : {}),
    ...(typeof value.creative_execution_canonicalized === "boolean" ? { creative_execution_canonicalized: value.creative_execution_canonicalized } : {}),
    ...(stringValue(value.rejected_activity_event_type) ? { rejected_activity_event_type: stringValue(value.rejected_activity_event_type) } : {}),
    ...(typeof value.creative_state_persisted === "boolean" ? { creative_state_persisted: value.creative_state_persisted } : {}),
    ...(stringValue(value.answer_basis_mode) ? { answer_basis_mode: stringValue(value.answer_basis_mode) } : {}),
    ...(value.creative_response_received === true ? { creative_response_received: true } : {}),
    ...(typeof value.creative_metadata_present === "boolean" ? { creative_metadata_present: value.creative_metadata_present } : {}),
    ...(typeof value.creative_draft_active === "boolean" ? { creative_draft_active: value.creative_draft_active } : {}),
    ...(stringValue(value.creative_active_draft_id) ? { creative_active_draft_id: stringValue(value.creative_active_draft_id) } : {}),
    ...(typeof value.creative_drafts_count === "number" && Number.isFinite(value.creative_drafts_count)
      ? { creative_drafts_count: Math.max(0, Math.floor(value.creative_drafts_count)) }
      : {}),
    ...(creativeDecision ? { creative_decision: creativeDecision } : {}),
    ...(typeof value.rejected_by_m1_validator === "boolean" ? { rejected_by_m1_validator: value.rejected_by_m1_validator } : {}),
    ...(stringValue(value.rejected_field) ? { rejected_field: stringValue(value.rejected_field) } : {}),
    ...(value.m1_validation_result === "accepted" ? { m1_validation_result: "accepted" } : {}),
    ...(typeof value.side_effects_present === "boolean" ? { side_effects_present: value.side_effects_present } : {}),
    ...(typeof value.side_effects_allowed_for_creative === "boolean" ? { side_effects_allowed_for_creative: value.side_effects_allowed_for_creative } : {}),
    ...(stringValue(value.rejected_side_effect_type) ? { rejected_side_effect_type: stringValue(value.rejected_side_effect_type) } : {}),
    ...(typeof value.hermesToolEndpointEnabled === "boolean" ? { hermesToolEndpointEnabled: value.hermesToolEndpointEnabled } : {}),
    ...(value.tool_capable_cmo === true ? { tool_capable_cmo: true } : {}),
    ...(sideEffects !== undefined ? { sideEffects, side_effects: sideEffects } : {}),
    ...(value.vault_context_usage !== undefined ? { vault_context_usage: value.vault_context_usage } : {}),
    ...(contractWarnings ? { contract_warnings: contractWarnings, contract_warnings_count: contractWarnings.length } : {}),
    ...(typeof value.contract_warnings_count === "number" && Number.isFinite(value.contract_warnings_count)
      ? { contract_warnings_count: Math.max(0, Math.floor(value.contract_warnings_count)) }
      : {}),
    ...(stateContract ? { state_contract: stateContract } : {}),
    ...(typeof value.artifacts_out_count === "number" && Number.isFinite(value.artifacts_out_count)
      ? { artifacts_out_count: Math.max(0, Math.floor(value.artifacts_out_count)) }
      : {}),
    ...(typeof value.artifact_refs_count === "number" && Number.isFinite(value.artifact_refs_count)
      ? { artifact_refs_count: Math.max(0, Math.floor(value.artifact_refs_count)) }
      : {}),
    ...(typeof value.decisions_count === "number" && Number.isFinite(value.decisions_count)
      ? { decisions_count: Math.max(0, Math.floor(value.decisions_count)) }
      : {}),
    ...(typeof value.session_summary_update_present === "boolean"
      ? { session_summary_update_present: value.session_summary_update_present }
      : {}),
    ...(typeof value.suggested_vault_updates_count === "number" && Number.isFinite(value.suggested_vault_updates_count)
      ? { suggested_vault_updates_count: Math.max(0, Math.floor(value.suggested_vault_updates_count)) }
      : {}),
    ...(typeof value.approval_events_count === "number" && Number.isFinite(value.approval_events_count)
      ? { approval_events_count: Math.max(0, Math.floor(value.approval_events_count)) }
      : {}),
    ...(normalizeVaultUpdateApprovalAction(value.latest_approval_action) ? { latest_approval_action: normalizeVaultUpdateApprovalAction(value.latest_approval_action) } : {}),
    ...(typeof value.dry_run_results_count === "number" && Number.isFinite(value.dry_run_results_count)
      ? { dry_run_results_count: Math.max(0, Math.floor(value.dry_run_results_count)) }
      : {}),
    ...(value.latest_dry_run_status === "completed" || value.latest_dry_run_status === "failed" || value.latest_dry_run_status === "conflict"
      ? { latest_dry_run_status: value.latest_dry_run_status }
      : {}),
    ...(stringValue(value.latest_dry_run_approval_id) ? { latest_dry_run_approval_id: stringValue(value.latest_dry_run_approval_id) } : {}),
    ...(typeof value.latest_dry_run_write_allowed === "boolean" ? { latest_dry_run_write_allowed: value.latest_dry_run_write_allowed } : {}),
    ...(typeof value.write_results_count === "number" && Number.isFinite(value.write_results_count)
      ? { write_results_count: Math.max(0, Math.floor(value.write_results_count)) }
      : {}),
    ...(value.latest_write_status === "completed" || value.latest_write_status === "failed" || value.latest_write_status === "conflict" || value.latest_write_status === "deduped"
      ? { latest_write_status: value.latest_write_status }
      : {}),
    ...(stringValue(value.latest_write_approval_id) ? { latest_write_approval_id: stringValue(value.latest_write_approval_id) } : {}),
    ...(stringValue(value.latest_vault_path) ? { latest_vault_path: stringValue(value.latest_vault_path) } : {}),
    ...(value.write_source_endpoint === "/agents/cmo/chat" ? { write_source_endpoint: "/agents/cmo/chat" } : {}),
    ...(value.vault_agent_write === true ? { vault_agent_write: true } : {}),
    ...(writeSideEffects !== undefined ? { write_side_effects: writeSideEffects } : {}),
    ...(typeof value.vault_write_performed === "boolean" ? { vault_write_performed: value.vault_write_performed } : {}),
    delegationsMode: normalizeHermesCmoDelegationsMode(value.delegationsMode) ?? HERMES_CMO_PROPOSALS_ONLY,
    counters,
    forbiddenCounters,
    requestId,
    responseStatus,
    ...(toolsUsed.length ? { toolsUsed } : {}),
    ...(toolsUsedSnake.length ? { tools_used: toolsUsedSnake } : toolsUsed.length ? { tools_used: toolsUsed } : {}),
    ...(toolTraceSummary ? { toolTraceSummary, tool_trace_summary: toolTraceSummary } : {}),
    ...(value.cmo_call_surf_used === true ? { cmo_call_surf_used: true } : {}),
    ...(value.cmo_call_echo_used === true ? { cmo_call_echo_used: true } : {}),
    ...(typeof value.toolReadsCount === "number" && Number.isFinite(value.toolReadsCount) ? { toolReadsCount: Math.max(0, Math.floor(value.toolReadsCount)) } : {}),
    ...(typeof value.lensReadoutAttached === "boolean" ? { lensReadoutAttached: value.lensReadoutAttached } : {}),
    ...(typeof value.lens_readout_attached === "boolean" ? { lens_readout_attached: value.lens_readout_attached } : {}),
    ...(stringValue(value.lensReadoutContract) ? { lensReadoutContract: stringValue(value.lensReadoutContract) } : {}),
    ...(stringValue(value.lens_readout_contract) ? { lens_readout_contract: stringValue(value.lens_readout_contract) } : {}),
    ...(isLensReadoutRangeKey(value.lensReadoutRangeKey) ? { lensReadoutRangeKey: value.lensReadoutRangeKey } : {}),
    ...(isLensReadoutRangeKey(value.lens_readout_range_key) ? { lens_readout_range_key: value.lens_readout_range_key } : {}),
    ...(stringValue(value.lensReadoutStatus) ? { lensReadoutStatus: stringValue(value.lensReadoutStatus) } : {}),
    ...(stringValue(value.lens_readout_status) ? { lens_readout_status: stringValue(value.lens_readout_status) } : {}),
    ...(stringValue(value.lensReadoutDataStatus) ? { lensReadoutDataStatus: stringValue(value.lensReadoutDataStatus) } : {}),
    ...(stringValue(value.lens_readout_data_status) ? { lens_readout_data_status: stringValue(value.lens_readout_data_status) } : {}),
    ...(stringValue(value.lensReadoutContextWarning) ? { lensReadoutContextWarning: stringValue(value.lensReadoutContextWarning) } : {}),
    ...(stringValue(value.lens_readout_context_warning) ? { lens_readout_context_warning: stringValue(value.lens_readout_context_warning) } : {}),
    ...(isRecord(value.attachmentTraceSummary)
      ? { attachmentTraceSummary: value.attachmentTraceSummary }
      : isRecord(value.attachment_trace_summary)
        ? { attachmentTraceSummary: value.attachment_trace_summary }
        : {}),
    ...(isRecord(value.attachment_trace_summary)
      ? { attachment_trace_summary: value.attachment_trace_summary }
      : isRecord(value.attachmentTraceSummary)
        ? { attachment_trace_summary: value.attachmentTraceSummary }
        : {}),
    ...(normalizeStrategyMode(value.strategyMode) ? { strategyMode: normalizeStrategyMode(value.strategyMode) } : {}),
    ...(stringValue(value.mainBottleneck) ? { mainBottleneck: stringValue(value.mainBottleneck) } : {}),
    ...(normalizeDecisionLabel(value.decisionLabel) ? { decisionLabel: normalizeDecisionLabel(value.decisionLabel) } : {}),
    ...(stringValue(value.currentStep) ? { currentStep: stringValue(value.currentStep) } : {}),
    activityEventsCount,
    ...(activityEvents ? { activityEvents } : {}),
    ...(delegationSummary ? { delegationSummary } : {}),
    ...(agentsUsed ? { agentsUsed } : {}),
    ...(typeof value.surfCalls === "number" && Number.isFinite(value.surfCalls) ? { surfCalls: Math.max(0, Math.floor(value.surfCalls)) } : {}),
    ...(typeof value.echoCalls === "number" && Number.isFinite(value.echoCalls) ? { echoCalls: Math.max(0, Math.floor(value.echoCalls)) } : {}),
    ...(platformPersistenceSummary ? { platformPersistenceSummary } : {}),
  };
}

function normalizeVaultAgentDryRunMetadata(value: unknown): VaultAgentDryRunMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const mode = value.vault_handoff_mode === "dry_run" || value.vault_handoff_mode === "dry_run_remote" || value.vault_handoff_mode === "write_remote"
    ? value.vault_handoff_mode
    : value.vault_handoff_mode === "off"
      ? "off"
      : undefined;
  const status = value.vault_handoff_status === "skipped" ||
    value.vault_handoff_status === "dry_run_valid" ||
    value.vault_handoff_status === "dry_run_invalid" ||
    value.vault_handoff_status === "completed" ||
    value.vault_handoff_status === "failed" ||
    value.vault_handoff_status === "rejected"
    ? value.vault_handoff_status
    : undefined;

  if (!mode && !status) {
    return undefined;
  }

  const indexability = isRecord(value.dry_run_indexability)
    ? {
        gbrain_index: value.dry_run_indexability.gbrain_index === true,
        gbrain_status: stringValue(value.dry_run_indexability.gbrain_status),
        reason: stringValue(value.dry_run_indexability.reason),
      }
    : undefined;

  return {
    ...(mode ? { vault_handoff_mode: mode } : {}),
    ...(status ? { vault_handoff_status: status } : {}),
    dry_run_record_id: normalizeOptionalString(value.dry_run_record_id),
    dry_run_target_path: normalizeOptionalString(value.dry_run_target_path),
    ...(indexability ? { dry_run_indexability: indexability } : {}),
    ...(typeof value.vault_write_performed === "boolean" ? { vault_write_performed: value.vault_write_performed } : {}),
    ...(typeof value.vault_deduped === "boolean" ? { vault_deduped: value.vault_deduped } : {}),
    vault_record_id: normalizeOptionalString(value.vault_record_id),
    vault_target_path: normalizeOptionalString(value.vault_target_path),
    vault_target_absolute_path: normalizeOptionalString(value.vault_target_absolute_path),
    vault_content_hash: normalizeOptionalString(value.vault_content_hash),
    ...(value.vault_path_safety !== undefined ? { vault_path_safety: value.vault_path_safety } : {}),
    vault_warnings: normalizeStringList(value.vault_warnings),
    vault_errors: normalizeStringList(value.vault_errors),
    ...(value.gbrain_called === false ? { gbrain_called: false } : {}),
    ...(value.memory_mutation === false ? { memory_mutation: false } : {}),
    vault_handoff_warnings: normalizeStringList(value.vault_handoff_warnings),
    vault_handoff_errors: normalizeStringList(value.vault_handoff_errors),
  };
}

function normalizeVaultAgentContextPackMetadata(value: unknown): VaultAgentContextPackMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const mode = value.context_pack_mode === "pilot_remote" || value.context_pack_mode === "off" ? value.context_pack_mode : undefined;
  const status = value.context_pack_status === "skipped" ||
    value.context_pack_status === "completed" ||
    value.context_pack_status === "empty" ||
    value.context_pack_status === "failed" ||
    value.context_pack_status === "rejected"
    ? value.context_pack_status
    : undefined;

  if (!mode && !status) {
    return undefined;
  }

  const sources = Array.isArray(value.context_pack_sources)
    ? value.context_pack_sources
        .map((item) => {
          if (!isRecord(item)) {
            return null;
          }

          const title = stringValue(item.title);

          if (!title) {
            return null;
          }

          return {
            title,
            ...(normalizeOptionalString(item.citation) ? { citation: normalizeOptionalString(item.citation) } : {}),
            ...(normalizeOptionalString(item.source_path) ? { source_path: normalizeOptionalString(item.source_path) } : {}),
            ...(normalizeOptionalString(item.source_id) ? { source_id: normalizeOptionalString(item.source_id) } : {}),
            ...(normalizeOptionalString(item.source_type) ? { source_type: normalizeOptionalString(item.source_type) } : {}),
            ...(normalizeOptionalString(item.scope) ? { scope: normalizeOptionalString(item.scope) } : {}),
            ...(normalizeOptionalString(item.visibility) ? { visibility: normalizeOptionalString(item.visibility) } : {}),
            ...(typeof item.confidence === "number" && Number.isFinite(item.confidence) ? { confidence: item.confidence } : {}),
            ...(normalizeOptionalString(item.excerpt_or_summary) ? { excerpt_or_summary: normalizeOptionalString(item.excerpt_or_summary) } : {}),
          };
        })
        .filter((item): item is NonNullable<VaultAgentContextPackMetadata["context_pack_sources"]>[number] => Boolean(item))
    : undefined;

  return {
    ...(mode ? { context_pack_mode: mode } : {}),
    ...(status ? { context_pack_status: status } : {}),
    context_pack_source_count: normalizeOptionalNonNegativeNumber(value.context_pack_source_count),
    ...(sources ? { context_pack_sources: sources } : {}),
    context_pack_errors: normalizeStringList(value.context_pack_errors),
    context_pack_warnings: normalizeStringList(value.context_pack_warnings),
    ...(typeof value.gbrain_called === "boolean" ? { gbrain_called: value.gbrain_called } : {}),
    ...(value.vault_mutation === false ? { vault_mutation: false } : {}),
    ...(value.promotion_performed === false ? { promotion_performed: false } : {}),
  };
}

function skippedLegacyAutoCaptureForVaultAgentWriteRemote(): AutoCaptureResult {
  return {
    ok: true,
    savedToVault: false,
    warnings: [LEGACY_AUTO_CAPTURE_WRITE_REMOTE_SKIP_REASON],
    skipped: true,
    skipReason: LEGACY_AUTO_CAPTURE_WRITE_REMOTE_SKIP_REASON,
  };
}

function rawCaptureStatusForAutoCapture(result: AutoCaptureResult): CMOChatSession["rawCaptureStatus"] {
  if (result.savedToVault) {
    return "saved";
  }

  return result.skipped ? "pending" : "failed";
}

function rawCaptureErrorForAutoCapture(result: AutoCaptureResult): string | undefined {
  return result.error ?? result.skipReason;
}

function normalizeCmoRunStatus(value: unknown): CmoAsyncToolRunStatus | undefined {
  return value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "timed_out" ||
    value === "interrupted" ||
    value === "cancelled"
    ? value
    : undefined;
}

function stoppedToolRunAnswer(): string {
  return "CMO run was stopped. You can retry this run or continue in the same session.";
}

function pendingToolRunAnswer(): string {
  return "CMO is working...";
}

function failedToolRunAnswer(): string {
  return "CMO could not complete the research run. Try narrowing the request or retry.";
}

function shouldStartAsyncHermesCmoToolRun(endpointKind: string): boolean {
  return endpointKind === "tool_execute";
}

interface VaultAgentRawActivityLogRequest {
  schema_version: "vault_agent.raw_activity_log.request.v1";
  workspace_id: string;
  user_id: string;
  supabase_user_id?: string;
  user_slug?: string;
  user_display_name?: string;
  email?: string;
  session_id: string;
  event_id: string;
  created_at: string;
  activity_text: string;
  link_metadata: Array<Record<string, string>>;
}

interface VaultAgentRawActivityLogReceipt {
  schema_version?: string;
  status?: string;
  raw_activity_logged?: boolean;
  vault_write_performed?: boolean;
  vault_path?: string;
  deduped?: boolean;
  knowledge_write?: boolean;
  accepted_knowledge_write?: boolean;
  promotion_performed?: boolean;
  gbrain_indexed?: boolean;
  errors?: unknown;
  warnings?: unknown;
}

function asyncRawActivityLogRequest(input: {
  request: CMOAppChatRequest;
  session: CMOChatSession;
  userIdentity: CmoServerUserIdentity;
  userMessageId: string;
  assistantMessageId: string;
  answer: string;
  createdAt: string;
}): VaultAgentRawActivityLogRequest {
  const runtimeUser = normalizeCmoRuntimeUserIdentity(input.userIdentity);
  const userId = input.userIdentity.userId ?? input.session.userId ?? runtimeUser.user_id ?? "unknown_user";
  const attachments = normalizeCmoSessionAttachments(input.session.attachments)
    .filter((attachment) => attachment.message_id === input.userMessageId || !attachment.message_id)
    .map((attachment) => ({
      attachment_id: attachment.attachment_id,
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      size_bytes: String(attachment.size_bytes),
      sha256: attachment.sha256,
      storage_kind: attachment.storage.kind,
      storage_ref: attachment.storage.ref,
      storage_path: attachment.storage.path,
      no_auto_promote_12_knowledge: "true",
    }));

  return {
    schema_version: "vault_agent.raw_activity_log.request.v1",
    workspace_id: input.request.workspaceId,
    user_id: userId,
    ...(input.userIdentity.userId ? { supabase_user_id: input.userIdentity.userId } : {}),
    user_slug: runtimeUser.user_slug,
    ...(runtimeUser.user_display_name ? { user_display_name: runtimeUser.user_display_name } : {}),
    ...(runtimeUser.email ? { email: runtimeUser.email } : {}),
    session_id: input.session.id,
    event_id: input.assistantMessageId,
    created_at: input.createdAt,
    activity_text: `User: ${input.request.message}\n\nCMO: ${input.answer}`,
    link_metadata: [
      {
        source_endpoint: "/agents/cmo/tool-execute",
        cmo_run_endpoint: "/agents/cmo/tool-execute",
        turn_id: input.userMessageId,
        run_id: input.assistantMessageId,
      },
      ...attachments,
    ],
  };
}

function creativeStateMetadata(
  creativeWorkingState: CmoCreativeWorkingState | undefined,
  creativeDecision: CmoCreativeDecision | undefined,
): Partial<HermesCmoChatMetadata> {
  const sanitizedCreativeWorkingState = normalizeCreativeWorkingState(creativeWorkingState);
  const creativeStatePersisted = Boolean(
    sanitizedCreativeWorkingState &&
      (
        sanitizedCreativeWorkingState.drafts.length > 0 ||
        (sanitizedCreativeWorkingState.assets?.length ?? 0) > 0 ||
        sanitizedCreativeWorkingState.active_draft_id ||
        sanitizedCreativeWorkingState.active_asset_id
      ),
  );
  const creativeAssetsCount = sanitizedCreativeWorkingState?.assets?.length ?? 0;
  const activeAssetId = sanitizedCreativeWorkingState?.active_asset_id;

  return {
    ...(hasCreativeWorkingStateDrafts(sanitizedCreativeWorkingState) ? { creative_draft_active: true } : {}),
    ...(sanitizedCreativeWorkingState?.active_draft_id ? { creative_active_draft_id: sanitizedCreativeWorkingState.active_draft_id } : {}),
    ...(sanitizedCreativeWorkingState?.active_draft_id ? { creative_session_active_draft_id: sanitizedCreativeWorkingState.active_draft_id } : {}),
    ...(activeAssetId ? { active_creative_asset_id: activeAssetId } : {}),
    ...(activeAssetId ? { creative_session_active_asset_id: activeAssetId } : {}),
    ...(sanitizedCreativeWorkingState ? { creative_drafts_count: sanitizedCreativeWorkingState.drafts.length } : {}),
    ...(sanitizedCreativeWorkingState ? { creative_assets_count: creativeAssetsCount } : {}),
    ...(creativeStatePersisted ? { active_creative_context_present: true } : {}),
    ...(creativeAssetsCount > 0 || activeAssetId ? { creative_session_from_asset: true } : {}),
    ...(creativeDecision ? { creative_decision: creativeDecision } : {}),
    ...(creativeDecision ? { creative_session_decision_action: creativeDecision.action } : {}),
    ...(creativeDecision?.operation ? { creative_decision_operation: creativeDecision.operation } : {}),
    ...(creativeDecision?.action === "execute" ? { execute_decision_source: "hermes_cmo_creative_decision" } : {}),
    creative_state_persisted: creativeStatePersisted,
  };
}

function isGenericCreativeSuccessWithoutAssetAnswer(value: string): boolean {
  const genericCreativeSuccessPattern = new RegExp(
    ["Creative execution completed", "returned generated asset", "metadata"].join(".*"),
    "i",
  );

  return !value.trim() || genericCreativeSuccessPattern.test(value);
}

function booleanFromRecords(records: Array<Record<string, unknown> | undefined>, key: string): boolean | undefined {
  for (const record of records) {
    const value = record?.[key];

    if (typeof value === "boolean") {
      return value;
    }
  }

  return undefined;
}

function numberFromRecords(records: Array<Record<string, unknown> | undefined>, key: string): number | undefined {
  for (const record of records) {
    const value = record?.[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }

  return undefined;
}

function stringFromRecords(records: Array<Record<string, unknown> | undefined>, key: string): string | undefined {
  for (const record of records) {
    const value = stringValue(record?.[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function creativeContractViolationMetadata(result: HermesCmoRuntimeResult): Partial<HermesCmoChatMetadata> | null {
  const request = result.request as unknown as Record<string, unknown>;
  const response = result.response as unknown as Record<string, unknown>;
  const structuredOutput = recordValue(result.response.structured_output) ?? {};
  const requestRecords = [
    recordValue(request.intent),
    recordValue(request.input),
    recordValue(request.constraints),
    recordValue(request.tool_policy),
    recordValue(request.context_pack),
  ];
  const requestExecutionAllowed = booleanFromRecords(requestRecords, "execution_allowed") ??
    booleanFromRecords(requestRecords, "creative_execution_allowed");
  const requestMutationAllowed = booleanFromRecords(requestRecords, "mutation_allowed") ??
    booleanFromRecords(requestRecords, "creative_mutation_allowed");

  if (requestExecutionAllowed !== false && requestMutationAllowed !== false) {
    return null;
  }

  const answerBasis = recordValue(result.response.answer_basis) ?? {};
  const creativeDecision = extractCreativeDecision(result.response);
  const action = stringValue(creativeDecision?.action);
  const operation = stringValue(creativeDecision?.operation);
  const creativeAssetsCount = numberFromRecords([response, structuredOutput], "creative_assets_count") ?? 0;
  const creativeAssetMutation = booleanFromRecords([response, structuredOutput], "creative_asset_mutation");
  const responseExecution =
    answerBasis.mode === "creative_execution" ||
    action === "execute" ||
    /^creative\.(?:edit|generate|image|video)/i.test(operation ?? "") ||
    creativeAssetsCount > 0 ||
    creativeAssetMutation === true ||
    hasCreativeExecutionMetadata(result.response);

  if (!responseExecution) {
    return null;
  }

  return {
    product_contract_violation: true,
    contract_violation_reason: "hermes_returned_execution_when_execution_forbidden",
    request_execution_allowed: requestExecutionAllowed ?? true,
    request_mutation_allowed: requestMutationAllowed ?? true,
    execution_allowed: requestExecutionAllowed,
    mutation_allowed: requestMutationAllowed,
    creative_execution_allowed: requestExecutionAllowed,
    creative_mutation_allowed: requestMutationAllowed,
    creative_followup_intent_class: stringFromRecords(requestRecords, "creative_followup_intent_class"),
    creative_semantic_intent_class: stringFromRecords(requestRecords, "creative_semantic_intent_class"),
    expected_response: stringFromRecords(requestRecords, "expected_response"),
    creative_expected_response: stringFromRecords(requestRecords, "creative_expected_response"),
    answer_basis_mode: stringValue(answerBasis.mode),
    native_response_answer_basis_mode: stringValue(answerBasis.mode),
    native_response_creative_decision_action: action,
    creative_decision_operation: operation,
    creative_assets_count: 0,
    creative_asset_mutation: false,
    creative_state_mutation: false,
    fallback_used: false,
    workspace_fallback_suppressed_for_creative: true,
  };
}

function hermesResponseIndicatesCreativeExecution(result: HermesCmoRuntimeResult, creativeArtifacts: unknown[]): boolean {
  const response = result.response as unknown as Record<string, unknown>;
  const structuredOutput = recordValue(result.response.structured_output) ?? {};
  const answerBasis = recordValue(result.response.answer_basis) ?? {};
  const route = recordValue(response.route) ?? {};
  const creativeDecision = extractCreativeDecision(result.response);
  const creativeAssetsCount = numberFromRecords([response, structuredOutput], "creative_assets_count") ?? 0;

  return (
    answerBasis.mode === "creative_execution" ||
    route.kind === "creative_execution" ||
    route.routed_to_creative === true ||
    creativeDecision?.action === "execute" ||
    creativeArtifacts.length > 0 ||
    creativeAssetsCount > 0 ||
    hasCreativeExecutionMetadata(result.response)
  );
}

function arrayFieldLength(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function hermesUnifiedCmoAgentCurrentTurnTextAnswer(input: {
  result: HermesCmoRuntimeResult;
  normalizedAnswer: string;
  creativeArtifacts: unknown[];
}): boolean {
  const { result, normalizedAnswer, creativeArtifacts } = input;

  if (
    result.hermesCmoEndpointKind !== "cmo_agent" ||
    result.response.status !== "completed" ||
    !normalizedAnswer.trim() ||
    userVisibleAnswerPathLike(normalizedAnswer)
  ) {
    return false;
  }

  const response = result.response as unknown as Record<string, unknown>;
  const structuredOutput = recordValue(result.response.structured_output) ?? {};
  const answerBasis = recordValue(result.response.answer_basis) ?? {};
  const route = recordValue(response.route) ?? {};
  const creativeDecision = extractCreativeDecision(result.response);
  const creativeAssetsCount = numberFromRecords([response, structuredOutput], "creative_assets_count");
  const responseAssetsLength = arrayFieldLength(response.creative_assets);
  const structuredAssetsLength = arrayFieldLength(structuredOutput.creative_assets);
  const returnedAssetCount = Math.max(
    creativeArtifacts.length,
    creativeAssetsCount ?? 0,
    responseAssetsLength ?? 0,
    structuredAssetsLength ?? 0,
  );
  const creativeAssetMutation = booleanFromRecords([response, structuredOutput], "creative_asset_mutation");
  const creativeStateMutation = booleanFromRecords([response, structuredOutput], "creative_state_mutation");
  const routeKind = stringValue(route.kind);
  const answerBasisMode = stringValue(answerBasis.mode);
  const creativeDecisionAction = stringValue(creativeDecision?.action);
  const advisoryOrDirectResponse =
    routeKind === "cmo_agent" ||
    answerBasisMode === "cmo_agent" ||
    (
      creativeDecisionAction !== "execute" &&
      creativeAssetMutation !== true &&
      creativeStateMutation !== true &&
      (routeKind === "creative_review" || answerBasisMode === "creative_conversation" || Boolean(creativeDecisionAction))
    );

  return advisoryOrDirectResponse && returnedAssetCount === 0;
}

function creativeMissingRenderableAssetWarning(): string {
  return [
    "## Creative Asset Not Ready",
    "",
    "Creative returned generation metadata, but Product could not find a renderable Product-backed asset for this turn.",
    "",
    "No preview card was shown because the asset was missing a durable Product preview/download reference.",
  ].join("\n");
}

async function readHermesRawActivityJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error("Hermes Vault Agent raw-activity-log returned an empty response.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Hermes Vault Agent raw-activity-log returned malformed JSON.");
  }
}

function normalizeRawActivityReceipt(value: unknown): VaultAgentRawActivityLogReceipt {
  const payload = isRecord(value) && isRecord(value.raw_activity_log) ? value.raw_activity_log : value;

  if (!isRecord(payload)) {
    throw new Error("Hermes Vault Agent raw-activity-log response was malformed.");
  }

  const receipt: VaultAgentRawActivityLogReceipt = {
    schema_version: typeof payload.schema_version === "string" ? payload.schema_version : undefined,
    status: typeof payload.status === "string" ? payload.status : undefined,
    raw_activity_logged: typeof payload.raw_activity_logged === "boolean" ? payload.raw_activity_logged : undefined,
    vault_write_performed: typeof payload.vault_write_performed === "boolean" ? payload.vault_write_performed : undefined,
    vault_path: typeof payload.vault_path === "string" ? payload.vault_path : undefined,
    deduped: typeof payload.deduped === "boolean" ? payload.deduped : undefined,
    knowledge_write: typeof payload.knowledge_write === "boolean" ? payload.knowledge_write : undefined,
    accepted_knowledge_write: typeof payload.accepted_knowledge_write === "boolean" ? payload.accepted_knowledge_write : undefined,
    promotion_performed: typeof payload.promotion_performed === "boolean" ? payload.promotion_performed : undefined,
    gbrain_indexed: typeof payload.gbrain_indexed === "boolean" ? payload.gbrain_indexed : undefined,
    errors: payload.errors,
    warnings: payload.warnings,
  };

  const completed = receipt.status === "completed";
  const logged = receipt.raw_activity_logged === true;
  const deduped = receipt.deduped === true;

  if (!completed || (!logged && !deduped)) {
    throw new Error("Hermes Vault Agent raw-activity-log did not complete.");
  }

  if (logged) {
    if (receipt.vault_write_performed !== true) {
      throw new Error("Hermes Vault Agent raw-activity-log missing vault_write_performed=true.");
    }

    if (!receipt.vault_path?.startsWith("90 Runtime/Raw Activity/")) {
      throw new Error("Hermes Vault Agent raw-activity-log returned an unsafe vault_path.");
    }
  }

  if (receipt.vault_path && !receipt.vault_path.startsWith("90 Runtime/Raw Activity/")) {
    throw new Error("Hermes Vault Agent raw-activity-log returned an unsafe vault_path.");
  }

  if (deduped && receipt.vault_write_performed !== false) {
    throw new Error("Hermes Vault Agent raw-activity-log dedupe receipt must not perform a write.");
  }

  if (
    receipt.knowledge_write === true ||
    receipt.accepted_knowledge_write === true ||
    receipt.promotion_performed === true ||
    receipt.gbrain_indexed === true
  ) {
    throw new Error("Hermes Vault Agent raw-activity-log reported a forbidden mutation.");
  }

  return receipt;
}

async function callVaultAgentRawActivityLog(requestEnvelope: VaultAgentRawActivityLogRequest): Promise<VaultAgentRawActivityLogReceipt> {
  const baseUrl = getCmoHermesBaseUrl();
  const apiKey = getCmoHermesApiKey();
  const timeoutMs = getCmoHermesTimeoutMs();

  if (!baseUrl) {
    throw new Error("CMO_HERMES_BASE_URL is not configured.");
  }

  if (!apiKey) {
    throw new Error("CMO_HERMES_API_KEY is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${VAULT_AGENT_RAW_ACTIVITY_LOG_ENDPOINT}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestEnvelope),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await readHermesRawActivityJson(response);

    if (!response.ok) {
      throw new Error(`Hermes Vault Agent raw-activity-log failed with HTTP ${response.status}.`);
    }

    return normalizeRawActivityReceipt(payload);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Hermes Vault Agent raw-activity-log request timed out.");
    }

    throw error instanceof Error ? error : new Error("Hermes Vault Agent raw-activity-log failed.");
  } finally {
    clearTimeout(timeout);
  }
}

async function attachAsyncToolRunRawActivityLog(input: {
  request: CMOAppChatRequest;
  session: CMOChatSession;
  userIdentity: CmoServerUserIdentity;
  userMessageId: string;
  assistantMessageId: string;
  answer: string;
  createdAt: string;
  activityEvents?: HermesCmoActivityEventSummary[];
  delegationSummary?: HermesCmoDelegationSummaryItem[];
  agentsUsed?: HermesCmoAgentUsed[];
  surfCalls?: number;
  echoCalls?: number;
}): Promise<CMOChatSession> {
  if (input.session.status !== "completed") {
    return input.session;
  }

  try {
    const requestEnvelope = asyncRawActivityLogRequest(input);
    const receipt = await callVaultAgentRawActivityLog(requestEnvelope);
    const rawCapturePath = receipt.vault_path;
    const rawCaptureStatus: CMOChatSession["rawCaptureStatus"] = "saved";

    return {
      ...input.session,
      ...(rawCapturePath ? { rawCapturePath } : {}),
      rawCaptureStatus,
      messages: input.session.messages.map((message) =>
        message.id === input.assistantMessageId ? {
          ...message,
          ...(rawCapturePath ? { rawCapturePath } : {}),
          rawCaptureStatus,
        } : message,
      ),
    };
  } catch (error) {
    const rawCaptureError = error instanceof Error ? error.message : "Async raw activity logging failed.";

    return {
      ...input.session,
      rawCaptureStatus: "failed",
      rawCaptureError,
      messages: input.session.messages.map((message) =>
        message.id === input.assistantMessageId ? {
          ...message,
          rawCaptureStatus: "failed",
          rawCaptureError,
        } : message,
      ),
    };
  }
}

function asyncToolRunReplayHistory(messages: CMOChatMessage[], pendingAssistantId: string): CMOChatMessage[] {
  return messages.filter((message) => {
    if (message.id === pendingAssistantId) {
      return false;
    }

    if (message.role !== "user" && message.role !== "assistant") {
      return false;
    }

    if (!message.content.trim()) {
      return false;
    }

    if (message.role === "assistant" && (message.cmoRunStatus === "pending" || message.cmoRunStatus === "running")) {
      return false;
    }

    return !/^CMO is working\.\.\.(?:\s+Researching signals\.\.\.\s+Synthesizing answer\.\.\.)?$/i.test(message.content.replace(/\s+/g, " ").trim());
  });
}

function isTimedOutHermesError(reason: string): boolean {
  return /timed out|timeout|AbortError/i.test(reason);
}

function reasonToken(reason: string, key: string): string | undefined {
  const token = reason.match(new RegExp(`\\b${key}=([^\\s.]+)`, "i"))?.[1];

  return token && token !== "none" ? token.trim() : undefined;
}

function decodedReasonToken(reason: string, key: string): string | undefined {
  const token = reasonToken(reason, key);

  if (!token) {
    return undefined;
  }

  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

function creativeM1RejectedField(reason: string): string | undefined {
  if (
    !/rejected_by_m1_validator=true/i.test(reason) ||
    !(/creative_metadata_present=true/i.test(reason) || /creative_ideation_response_received=true/i.test(reason) || /creative_session_response_received=true/i.test(reason) || /creative_conversation_response_received=true/i.test(reason) || /answer_basis_mode=creative_(?:ideation|session|refinement|conversation)/i.test(reason))
  ) {
    return undefined;
  }

  const explicit = reason.match(/\brejected_field=([^.\s]+)/i)?.[1];
  const rejected = explicit ?? reason.match(/Rejected field:\s*([^.\n]+)/i)?.[1];

  return rejected?.trim();
}

function creativeConversationRejectionDiagnostics(reason: string): Partial<HermesCmoChatMetadata> {
  const conversationRejected =
    /creative_conversation_rejected=true/i.test(reason) ||
    /creative_conversation_response_received=true/i.test(reason) ||
    /answer_basis_mode=creative_conversation/i.test(reason);

  if (!conversationRejected) {
    return {};
  }

  return {
    creative_conversation_response_received: true,
    creative_conversation_rejected: true,
    ...(reasonToken(reason, "creative_conversation_rejection_reason")
      ? { creative_conversation_rejection_reason: reasonToken(reason, "creative_conversation_rejection_reason") }
      : {}),
    ...(decodedReasonToken(reason, "creative_conversation_rejected_answer_preview")
      ? { creative_conversation_rejected_answer_preview: decodedReasonToken(reason, "creative_conversation_rejected_answer_preview") }
      : {}),
    ...(reasonToken(reason, "native_response_answer_basis_mode")
      ? { native_response_answer_basis_mode: reasonToken(reason, "native_response_answer_basis_mode") }
      : {}),
    ...(reasonToken(reason, "native_response_creative_decision_action")
      ? { native_response_creative_decision_action: reasonToken(reason, "native_response_creative_decision_action") }
      : {}),
    ...(reasonToken(reason, "native_response_path_like_answer_detected")
      ? { native_response_path_like_answer_detected: /true/i.test(reasonToken(reason, "native_response_path_like_answer_detected") ?? "") }
      : {}),
  };
}

const unsafeUserVisibleAnswerPattern =
  /(\[hermes_local_artifact_path_redacted\]|hermes_local_artifact_path_redacted|\/tmp\/|\/Users\/|\/home\/|\/var\/|\/mnt\/|\/private\/|\/Volumes\/|conversion_h_|creative-agent-images|cmo-creative-execute|creative[_\s-]*image[_\s-]*asset[_\s-]*refine|reference_assets|\.(?:png|jpe?g|webp|mp4|webm)\b)/i;

function userVisibleAnswerPathLike(value: string): boolean {
  return unsafeUserVisibleAnswerPattern.test(value);
}

function safeBlockedUserVisibleAnswer(creativeNativeTurn: boolean): string {
  return creativeNativeTurn
    ? "Creative response was blocked because Product detected internal artifact path text in the user-visible answer. The active Creative asset is unchanged."
    : "CMO response was blocked because Product detected internal artifact path text in the user-visible answer.";
}

interface CompletedUnifiedCmoAgentPersistState {
  rawHermesStatus: string;
  rawHermesAnswer: string;
  normalizedHermesAnswer: string;
  route?: Record<string, unknown>;
  intentDecision?: Record<string, unknown>;
  creativeDecision?: Record<string, unknown>;
  answerBasis?: Record<string, unknown>;
  answerBasisMode?: string;
  diagnostics?: Record<string, unknown>;
}

function hermesAnswerTextForFinalProjection(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!isRecord(value)) {
    return "";
  }

  for (const key of ["body", "content", "text", "summary"]) {
    const text = stringValue(value[key]);

    if (text) {
      return text;
    }
  }

  return "";
}

function hermesCmoAgentUsableAnswerText(response: HermesCmoRuntimeResult["response"]): string {
  const answerText = hermesAnswerTextForFinalProjection(response.answer);

  if (answerText) {
    return answerText;
  }

  const userVisible = recordValue(response.user_visible);
  const userVisibleAnswer = userVisible ? hermesAnswerTextForFinalProjection(userVisible.answer ?? userVisible) : "";

  return userVisibleAnswer;
}

function completedUnifiedCmoAgentPersistStateFromHermesResult(input: {
  result: HermesCmoRuntimeResult;
  normalizedAnswer: string;
  creativeArtifacts: unknown[];
}): CompletedUnifiedCmoAgentPersistState | undefined {
  const { result, normalizedAnswer, creativeArtifacts } = input;

  if (
    result.hermesCmoEndpointKind !== "cmo_agent" ||
    result.response.status !== "completed" ||
    !normalizedAnswer.trim() ||
    userVisibleAnswerPathLike(normalizedAnswer)
  ) {
    return undefined;
  }

  const response = result.response as unknown as Record<string, unknown>;
  const route = recordValue(response.route);
  const routeKind = stringValue(route?.kind);
  const answerBasis = recordValue(result.response.answer_basis) ?? {};
  const answerBasisMode = stringValue(answerBasis.mode, "cmo_agent");
  const currentTurnTextAnswer = hermesUnifiedCmoAgentCurrentTurnTextAnswer({
    result,
    normalizedAnswer,
    creativeArtifacts,
  });

  if (!currentTurnTextAnswer && routeKind !== "cmo_agent" && routeKind !== "creative_execution" && creativeArtifacts.length === 0) {
    return undefined;
  }

  return {
    rawHermesStatus: result.response.status,
    rawHermesAnswer: hermesAnswerTextForFinalProjection(result.response.answer),
    normalizedHermesAnswer: normalizedAnswer,
    ...(route ? { route } : {}),
    ...(recordValue(result.response.intent_decision) ? { intentDecision: recordValue(result.response.intent_decision) } : {}),
    ...(recordValue(result.response.creative_decision) ? { creativeDecision: recordValue(result.response.creative_decision) } : {}),
    answerBasis,
    answerBasisMode,
    ...(recordValue(result.response.diagnostics) ? { diagnostics: recordValue(result.response.diagnostics) } : {}),
  };
}

function completedUnifiedCmoAgentMetadata(
  existing: HermesCmoChatMetadata | undefined,
  completed: CompletedUnifiedCmoAgentPersistState,
): HermesCmoChatMetadata {
  const metadataWithoutFallbackFields = { ...(existing ?? failedHermesCmoChatV11Metadata("req_cmo_agent_final_write", "completed_cmo_agent_final_write")) };
  const metadataRecord = metadataWithoutFallbackFields as Record<string, unknown>;
  for (const key of [
    "fallback_reason",
    "fallback_from",
    "fallback_to",
    "timeout_source",
    "outer_timeout_source",
    "hermesEndpointTimeoutSource",
    "hermesEndpointTimeoutMs",
    "creative_timeout_ms",
    "creative_long_running_turn",
    "creative_execution_requested",
    "creativeExecutionRequested",
    "creative_metadata_present",
    "creativeMetadataPresent",
    "creative_response_received",
    "creativeResponseReceived",
    "creative_execution_response_received",
    "creative_fallback_used",
    "creativeFallbackUsed",
  ]) {
    delete metadataRecord[key];
  }

  return {
    ...metadataWithoutFallbackFields,
    runtimeStatus: "live",
    productRenderSource: "hermes_cmo",
    route_decision: "cmo_agent",
    answer_basis_mode: completed.answerBasisMode ?? stringValue(completed.answerBasis?.mode, "cmo_agent"),
    fallback_used: false,
    ...(completed.route ? { route: completed.route, hermes_route: completed.route } : {}),
    ...(completed.intentDecision ? { intent_decision: completed.intentDecision } : {}),
    ...(completed.creativeDecision ? { creative_decision: completed.creativeDecision } : {}),
    ...(completed.answerBasis ? { answerBasis: completed.answerBasis, answer_basis: completed.answerBasis } : {}),
    ...(completed.diagnostics ? { diagnostics: completed.diagnostics, hermes_diagnostics: completed.diagnostics } : {}),
    final_session_write_projection: {
      session_write_invariant: "completed_cmo_agent_answer_wins",
      raw_hermes_status: completed.rawHermesStatus,
      raw_hermes_answer: completed.rawHermesAnswer,
      normalized_hermes_answer: completed.normalizedHermesAnswer,
      final_persisted_answer: completed.normalizedHermesAnswer,
      runtimeStatus: "live",
      productRenderSource: "hermes_cmo",
      fallback_used: false,
      route_kind: stringValue(completed.route?.kind),
      answer_basis_mode: completed.answerBasisMode ?? stringValue(completed.answerBasis?.mode, "cmo_agent"),
    },
  };
}

function applyCompletedUnifiedCmoAgentFinalWriteInvariant(input: {
  session: CMOChatSession;
  userMessageId: string;
  assistantMessageId: string;
  completed?: CompletedUnifiedCmoAgentPersistState;
}): CMOChatSession {
  const completed = input.completed;

  if (!completed?.normalizedHermesAnswer.trim()) {
    return input.session;
  }

  const hermesCmoMetadata = completedUnifiedCmoAgentMetadata(input.session.hermesCmoMetadata, completed);
  let assistantReplaced = false;
  const messages: CMOChatMessage[] = [];

  for (const message of input.session.messages) {
    const sameAssistantTurn =
      message.role === "assistant" &&
      (message.id === input.assistantMessageId || message.sourceUserMessageId === input.userMessageId);

    if (!sameAssistantTurn) {
      messages.push(message);
      continue;
    }

    if (assistantReplaced) {
      continue;
    }

    assistantReplaced = true;
    messages.push({
      ...message,
      id: input.assistantMessageId,
      content: completed.normalizedHermesAnswer,
      runtimeMode: "live",
      runtimeStatus: "live",
      runtimeProvider: "hermes",
      runtimeAgent: "cmo",
      runtimeErrorReason: undefined,
      fallbackDurationMs: undefined,
      timeoutMs: undefined,
      outerTimeoutMs: undefined,
      outerTimeoutSource: undefined,
      routeDecision: "cmo_agent",
      productRenderSource: "hermes_cmo",
      productFallbackReason: undefined,
      hermesRequestSent: true,
      calledHermesCmo: true,
      hermesCmoStatus: "live",
      hermesCmoErrorReason: undefined,
      creativeExecutionRequested: undefined,
      creativeResponseReceived: undefined,
      creativeMetadataPresent: undefined,
      creativeFallbackUsed: undefined,
      hermesCmoMetadata,
    });
  }

  if (!assistantReplaced) {
    messages.push({
      id: input.assistantMessageId,
      role: "assistant",
      content: completed.normalizedHermesAnswer,
      createdAt: input.session.updatedAt,
      sourceUserMessageId: input.userMessageId,
      runtimeMode: "live",
      runtimeStatus: "live",
      runtimeProvider: "hermes",
      runtimeAgent: "cmo",
      fallbackDurationMs: undefined,
      timeoutMs: undefined,
      outerTimeoutMs: undefined,
      outerTimeoutSource: undefined,
      routeDecision: "cmo_agent",
      productRenderSource: "hermes_cmo",
      hermesRequestSent: true,
      calledHermesCmo: true,
      hermesCmoStatus: "live",
      hermesCmoMetadata,
    });
  }

  return {
    ...input.session,
    status: "completed",
    isDevelopmentFallback: false,
    isRuntimeFallback: false,
    runtimeStatus: "live",
    runtimeMode: "live",
    attemptedRuntimeMode: "live",
    runtimeError: undefined,
    runtimeErrorReason: undefined,
    fallbackDurationMs: undefined,
    timeoutMs: undefined,
    outerTimeoutMs: undefined,
    outerTimeoutSource: undefined,
    routeDecision: "cmo_agent",
    productRenderSource: "hermes_cmo",
    productFallbackReason: undefined,
    hermesRequestSent: true,
    calledHermesCmo: true,
    hermesCmoStatus: "live",
    hermesCmoErrorReason: undefined,
    creativeExecutionRequested: undefined,
    creativeResponseReceived: undefined,
    creativeMetadataPresent: undefined,
    creativeFallbackUsed: undefined,
    hermesCmoMetadata,
    messages,
  };
}

function logFinalSessionWriteProjection(input: {
  session: CMOChatSession;
  userMessageId: string;
  assistantMessageId: string;
  completed?: CompletedUnifiedCmoAgentPersistState;
}): void {
  if (!input.completed) {
    return;
  }

  const assistant = input.session.messages.find((message) => message.id === input.assistantMessageId);
  const metadata = assistant?.hermesCmoMetadata ?? input.session.hermesCmoMetadata;
  const route = recordValue(metadata?.route ?? metadata?.hermes_route);
  const answerBasis = recordValue(metadata?.answer_basis ?? metadata?.answerBasis);

  console.info("[cmo-app-chat] final session write projection", {
    session_id: input.session.id,
    user_turn_id: input.userMessageId,
    assistant_message_id: input.assistantMessageId,
    raw_hermes_status: input.completed.rawHermesStatus,
    raw_hermes_answer: input.completed.rawHermesAnswer,
    normalized_hermes_answer: input.completed.normalizedHermesAnswer,
    final_persisted_answer: assistant?.content ?? "",
    runtimeStatus: assistant?.runtimeStatus ?? input.session.runtimeStatus,
    productRenderSource: assistant?.productRenderSource ?? input.session.productRenderSource,
    fallback_used: metadata?.fallback_used === true,
    fallback_reason: metadata?.fallback_reason,
    route_kind: route?.kind,
    answer_basis_mode: answerBasis?.mode ?? metadata?.answer_basis_mode,
  });
}

function isCreativeIdeationM1Rejection(reason: string): boolean {
  return (
    /rejected_by_m1_validator=true/i.test(reason) &&
    (/creative_ideation_response_received=true/i.test(reason) || /creative_session_response_received=true/i.test(reason) || /answer_basis_mode=creative_(?:ideation|session|refinement)/i.test(reason))
  );
}

function parseCreativeRejectedSideEffectType(reason: string): string | undefined {
  if (!/creative_metadata_present=true/i.test(reason) || !/side_effects_present=true/i.test(reason) || !/side_effects_allowed_for_creative=false/i.test(reason)) {
    return undefined;
  }

  const rejected = reason.match(/\brejected_side_effect_type=([^.\s]+)/i)?.[1];

  return rejected?.trim();
}

function safeCmoRunToolsUsed(agentsUsed: HermesCmoAgentUsed[] | undefined): HermesCmoAgentUsed[] | undefined {
  return agentsUsed?.filter((agent) => agent === "cmo" || agent === "surf" || agent === "echo" || agent === "creative");
}

function messageUserMetadata(identity: CmoServerUserIdentity): Pick<CMOChatMessage, "authMode" | "userId" | "userEmail" | "userDisplayName" | "userSlug"> {
  return {
    authMode: identity.authMode,
    ...(identity.userId ? { userId: identity.userId } : {}),
    ...(identity.userEmail ? { userEmail: identity.userEmail } : {}),
    ...(identity.userDisplayName ? { userDisplayName: identity.userDisplayName } : {}),
    ...(identity.userSlug ? { userSlug: identity.userSlug } : {}),
  };
}

function assistantSourceMetadata(
  identity: CmoServerUserIdentity,
  userMessageId: string,
): Pick<CMOChatMessage, "authMode" | "sourceUserId" | "sourceUserEmail" | "sourceUserMessageId"> {
  return {
    authMode: identity.authMode,
    ...(identity.userId ? { sourceUserId: identity.userId } : {}),
    ...(identity.userEmail ? { sourceUserEmail: identity.userEmail } : {}),
    sourceUserMessageId: userMessageId,
  };
}

function appendMessage(session: CMOChatSession, message: CMOChatMessage): CMOChatSession {
  return {
    ...session,
    messages: [...session.messages, message],
    updatedAt: message.createdAt,
  };
}

function messagesWithTurnScopedAssistantAttachments(messages: CMOChatMessage[]): CMOChatMessage[] {
  const userAttachmentsByMessageId = new Map<string, CmoSessionAttachment[]>();

  for (const message of messages) {
    if (message.role === "user") {
      userAttachmentsByMessageId.set(message.id, normalizeCmoSessionAttachments(message.attachments));
    }
  }

  let previousUserAttachments: CmoSessionAttachment[] = [];

  return messages.map((message) => {
    if (message.role === "user") {
      previousUserAttachments = normalizeCmoSessionAttachments(message.attachments);
      return message;
    }

    if (message.role !== "assistant") {
      return message;
    }

    const sourceAttachments = message.sourceUserMessageId
      ? userAttachmentsByMessageId.get(message.sourceUserMessageId) ?? []
      : previousUserAttachments;

    if (sourceAttachments.length) {
      return {
        ...message,
        attachments: sourceAttachments,
      };
    }

    if (!message.attachments?.length) {
      return message;
    }

    const messageWithoutAttachments = { ...message };
    delete messageWithoutAttachments.attachments;

    return messageWithoutAttachments;
  });
}

function normalizeSession(value: unknown): CMOChatSession | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringValue(value.id);
  const appId = stringValue(value.appId);
  const appName = stringValue(value.appName, "Selected app");

  if (!id || !appId) {
    return null;
  }

  const normalizedMessages = Array.isArray(value.messages)
    ? value.messages
        .map((message, index): CMOChatMessage | null => {
          if (!isRecord(message)) {
            return null;
          }

          const role =
            message.role === "assistant" || message.role === "system" || message.role === "user"
              ? message.role
              : "assistant";

          return {
            id: stringValue(message.id, `message_${index + 1}`),
            role,
            content: role === "assistant" ? scrubPersistedReplayText(message.content) : stringValue(message.content),
            createdAt: stringValue(message.createdAt, new Date(0).toISOString()),
            authMode: normalizeAuthMode(message.authMode),
            userId: normalizeOptionalString(message.userId),
            userEmail: normalizeOptionalString(message.userEmail),
            userDisplayName: normalizeOptionalString(message.userDisplayName),
            userSlug: normalizeOptionalString(message.userSlug),
            sourceUserId: normalizeOptionalString(message.sourceUserId),
            sourceUserEmail: normalizeOptionalString(message.sourceUserEmail),
            sourceUserMessageId: normalizeOptionalString(message.sourceUserMessageId),
            runtimeMode: normalizeRuntimeMode(message.runtimeMode, normalizeRuntimeStatus(message.runtimeStatus, false), false),
            runtimeStatus: normalizeRuntimeStatus(message.runtimeStatus, false),
            runtimeProvider: normalizeRuntimeProvider(message.runtimeProvider),
            runtimeAgent: normalizeRuntimeProvider(message.runtimeAgent),
            runtimeErrorReason: normalizeRuntimeErrorReason(message.runtimeErrorReason),
            productRenderSource: normalizeProductRenderSource(message.productRenderSource),
            productFallbackReason: normalizeOptionalString(message.productFallbackReason),
            hermesRequestSent: message.hermesRequestSent === true ? true : undefined,
            calledHermesCmo: message.calledHermesCmo === true ? true : undefined,
            hermesCmoStatus: normalizeHermesCmoChatStatus(message.hermesCmoStatus),
            hermesCmoErrorReason: normalizeOptionalString(message.hermesCmoErrorReason),
            hermesCmoCounters: normalizeHermesCmoCounters(message.hermesCmoCounters),
            hermesCmoMetadata: normalizeHermesCmoMetadata(message.hermesCmoMetadata),
            strategyMode: normalizeStrategyMode(message.strategyMode),
            mainBottleneck: normalizeOptionalString(message.mainBottleneck),
            decisionLabel: normalizeDecisionLabel(message.decisionLabel),
            currentStep: normalizeOptionalString(message.currentStep),
            activityEvents: normalizeHermesCmoActivityEvents(message.activityEvents),
            delegationSummary: normalizeHermesCmoDelegationSummary(message.delegationSummary),
            agentsUsed: Array.isArray(message.agentsUsed)
              ? message.agentsUsed.map(normalizeHermesCmoAgentUsed).filter((agent): agent is HermesCmoAgentUsed => Boolean(agent))
              : undefined,
            surfCalls: normalizeOptionalNonNegativeNumber(message.surfCalls),
            echoCalls: normalizeOptionalNonNegativeNumber(message.echoCalls),
            forbiddenCounters: normalizeHermesCmoForbiddenCounters(message.forbiddenCounters),
            platformPersistenceSummary: normalizeHermesCmoPlatformPersistenceSummary(message.platformPersistenceSummary),
            delegationsMode: normalizeHermesCmoDelegationsMode(message.delegationsMode),
            vaultAgentDryRun: normalizeVaultAgentDryRunMetadata(message.vaultAgentDryRun),
            vaultAgentContextPack: normalizeVaultAgentContextPackMetadata(message.vaultAgentContextPack),
            cmoRunId: normalizeOptionalString(message.cmoRunId),
            cmoRunStatus: normalizeCmoRunStatus(message.cmoRunStatus),
            cmoRunEndpoint: message.cmoRunEndpoint === "/agents/cmo/tool-execute" ? message.cmoRunEndpoint : undefined,
            cmoRunToolsUsed: Array.isArray(message.cmoRunToolsUsed)
              ? message.cmoRunToolsUsed.map(normalizeHermesCmoAgentUsed).filter((agent): agent is HermesCmoAgentUsed => Boolean(agent))
              : undefined,
            cmoRunStartedAt: normalizeOptionalString(message.cmoRunStartedAt),
            cmoRunCompletedAt: normalizeOptionalString(message.cmoRunCompletedAt),
            cmoRunDurationMs: normalizeOptionalNonNegativeNumber(message.cmoRunDurationMs),
            cmoRunTimeoutMs: normalizeOptionalNonNegativeNumber(message.cmoRunTimeoutMs),
            contextUsedCount: typeof message.contextUsedCount === "number" && Number.isFinite(message.contextUsedCount) ? Math.max(0, Math.floor(message.contextUsedCount)) : undefined,
            graphHintCount: typeof message.graphHintCount === "number" && Number.isFinite(message.graphHintCount) ? Math.max(0, Math.floor(message.graphHintCount)) : undefined,
            indexedContextStatus: normalizeIndexedContextStatus(message.indexedContextStatus),
            indexedContextSourcesCount: typeof message.indexedContextSourcesCount === "number" && Number.isFinite(message.indexedContextSourcesCount) ? Math.max(0, Math.floor(message.indexedContextSourcesCount)) : undefined,
            indexedContextFallbackReason: normalizeOptionalString(message.indexedContextFallbackReason),
            requestReceivedAt: normalizeOptionalString(message.requestReceivedAt),
            liveAttemptStartedAt: normalizeOptionalString(message.liveAttemptStartedAt),
            liveAttemptDurationMs: normalizeOptionalNonNegativeNumber(message.liveAttemptDurationMs),
            fallbackDurationMs: normalizeOptionalNonNegativeNumber(message.fallbackDurationMs),
            totalDurationMs: normalizeOptionalNonNegativeNumber(message.totalDurationMs),
            timeoutMs: normalizeOptionalNonNegativeNumber(message.timeoutMs),
            outerTimeoutMs: normalizeOptionalNonNegativeNumber(message.outerTimeoutMs ?? message.outer_timeout_ms),
            outerTimeoutSource: normalizeOuterTimeoutSource(message.outerTimeoutSource ?? message.outer_timeout_source),
            routeDecision: normalizeRouteDecision(message.routeDecision ?? message.route_decision),
            creativeExecutionRequested: message.creativeExecutionRequested === true || message.creative_execution_requested === true ? true : undefined,
            creativeResponseReceived: message.creativeResponseReceived === true || message.creative_response_received === true ? true : undefined,
            creativeMetadataPresent: typeof (message.creativeMetadataPresent ?? message.creative_metadata_present) === "boolean"
              ? Boolean(message.creativeMetadataPresent ?? message.creative_metadata_present)
              : undefined,
            active_asset_id: normalizeOptionalString(message.active_asset_id),
            active_creative_asset_id: normalizeOptionalString(message.active_creative_asset_id),
            creative_session_active_asset_id: normalizeOptionalString(message.creative_session_active_asset_id),
            creativeNormalizationError: normalizeOptionalString(message.creativeNormalizationError ?? message.creative_normalization_error ?? message.normalization_error),
            creativeFallbackUsed: typeof (message.creativeFallbackUsed ?? message.creative_fallback_used ?? message.fallback_used) === "boolean"
              ? Boolean(message.creativeFallbackUsed ?? message.creative_fallback_used ?? message.fallback_used)
              : undefined,
            creativeRejectedByM1Validator: message.creativeRejectedByM1Validator === true || message.rejected_by_m1_validator === true ? true : undefined,
            creativeRejectedField: normalizeOptionalString(message.creativeRejectedField ?? message.rejected_field),
            creativeSideEffectsPresent: typeof (message.creativeSideEffectsPresent ?? message.side_effects_present) === "boolean"
              ? Boolean(message.creativeSideEffectsPresent ?? message.side_effects_present)
              : undefined,
            creativeSideEffectsAllowedForCreative: typeof (message.creativeSideEffectsAllowedForCreative ?? message.side_effects_allowed_for_creative) === "boolean"
              ? Boolean(message.creativeSideEffectsAllowedForCreative ?? message.side_effects_allowed_for_creative)
              : undefined,
            creativeRejectedSideEffectType: normalizeOptionalString(message.creativeRejectedSideEffectType ?? message.rejected_side_effect_type),
            creativeWorkingState: normalizeCreativeWorkingState(message.creativeWorkingState ?? message.creative_working_state),
            creativeDecision: normalizeCreativeDecision(message.creativeDecision ?? message.creative_decision),
            contextSourceCount: normalizeOptionalNonNegativeNumber(message.contextSourceCount),
            contextCharLength: normalizeOptionalNonNegativeNumber(message.contextCharLength),
            indexedSupplementCharLength: normalizeOptionalNonNegativeNumber(message.indexedSupplementCharLength),
            authDurationMs: normalizeOptionalNonNegativeNumber(message.authDurationMs),
            sessionResolutionDurationMs: normalizeOptionalNonNegativeNumber(message.sessionResolutionDurationMs),
            contextPackBuildDurationMs: normalizeOptionalNonNegativeNumber(message.contextPackBuildDurationMs),
            indexedContextBuildDurationMs: normalizeOptionalNonNegativeNumber(message.indexedContextBuildDurationMs),
            runtimeContext: isRecord(message.runtimeContext) ? message.runtimeContext as unknown as CMOChatMessage["runtimeContext"] : undefined,
            sourceReviewContext: normalizeSourceReviewContext(message.sourceReviewContext),
            sourceAnswerContext: normalizeSourceAnswerContext(message.sourceAnswerContext),
            sessionLocalResearchResults: normalizeSessionLocalResearchResults(message.sessionLocalResearchResults, undefined, id),
            attachments: normalizeCmoSessionAttachments(message.attachments),
            sessionSummary: normalizeOptionalString(message.sessionSummary),
            creativeAssets: sanitizeHermesCmoChatV11Records(message.creativeAssets ?? message.creative_assets, undefined, { allowTopLevelContent: true })
              .filter(isProductBackedRenderableCreativeAsset),
            creative_assets: sanitizeHermesCmoChatV11Records(message.creative_assets ?? message.creativeAssets, undefined, { allowTopLevelContent: true })
              .filter(isProductBackedRenderableCreativeAsset),
            sessionArtifacts: sanitizeHermesCmoChatV11Records(message.sessionArtifacts, undefined, { allowTopLevelContent: true }),
            suggestedVaultUpdates: mergeSuggestedVaultUpdates(undefined, sanitizeHermesCmoChatV11Records(message.suggestedVaultUpdates)),
            vaultUpdateApprovalEvents: normalizeVaultUpdateApprovalEvents(message.vaultUpdateApprovalEvents),
            vaultUpdateDryRunResults: normalizeVaultApprovedWriteDryRunResults(message.vaultUpdateDryRunResults),
            vaultUpdateWriteResults: normalizeVaultApprovedWriteResults(message.vaultUpdateWriteResults),
          };
        })
        .filter((message): message is CMOChatMessage => Boolean(message))
    : [];
  const messages = messagesWithTurnScopedAssistantAttachments(normalizedMessages);
  const contextUsed = normalizeSelectedNotes(value.contextUsed);
  const missingContext = normalizeSelectedNotes(value.missingContext);
  const graphHints = normalizeGraphHints(value.graphHints);
  const decisionLayer = normalizeDecisionLayer(value.decisionLayer);
  const contextDiagnostics = normalizeContextDiagnostics(value.contextDiagnostics);
  const runtimeStatus = normalizeRuntimeStatus(value.runtimeStatus, value.isDevelopmentFallback === true);
  const persistedSessionLocalSources = normalizeSessionLocalSources(value.sessionLocalSources, undefined, id);
  const messageSessionLocalSources = [...messages].reverse()
    .map((message) => message.sourceReviewContext ? sessionLocalSourceFromReviewContext(message.sourceReviewContext) : undefined)
    .filter((source): source is CmoSessionLocalSource => Boolean(source));
  const sessionLocalSources = persistedSessionLocalSources.length
    ? persistedSessionLocalSources
    : mergeSessionLocalSources(messageSessionLocalSources, undefined);
  const persistedSessionLocalResearchResults = normalizeSessionLocalResearchResults(value.sessionLocalResearchResults, undefined, id);
  const messageSessionLocalResearchResults = [...messages].reverse()
    .flatMap((message) => message.sessionLocalResearchResults ?? []);
  const sessionLocalResearchResults = persistedSessionLocalResearchResults.length
    ? persistedSessionLocalResearchResults
    : mergeSessionLocalResearchResults(messageSessionLocalResearchResults, undefined);
  const attachments = normalizeCmoSessionAttachments(value.attachments).length
    ? normalizeCmoSessionAttachments(value.attachments)
    : normalizeCmoSessionAttachments(messages.flatMap((message) => message.attachments ?? []));
  const activeSourceId = normalizeOptionalString(value.activeSourceId);
  const sessionSummary = normalizeOptionalString(value.sessionSummary);
  const sessionCreativeAssets = sanitizeHermesCmoChatV11Records(value.creativeAssets ?? value.creative_assets, undefined, { allowTopLevelContent: true })
    .filter(isProductBackedRenderableCreativeAsset);
  const sessionArtifacts = sanitizeHermesCmoChatV11Records(value.sessionArtifacts, undefined, { allowTopLevelContent: true });
  const creativeWorkingState = normalizeCreativeWorkingState(value.creativeWorkingState ?? value.creative_working_state);
  const creativeDecision = normalizeCreativeDecision(value.creativeDecision ?? value.creative_decision);
  const suggestedVaultUpdates = mergeSuggestedVaultUpdates(undefined, sanitizeHermesCmoChatV11Records(value.suggestedVaultUpdates));
  const vaultUpdateApprovalEvents = normalizeVaultUpdateApprovalEvents(value.vaultUpdateApprovalEvents);
  const vaultUpdateDryRunResults = normalizeVaultApprovedWriteDryRunResults(value.vaultUpdateDryRunResults);
  const vaultUpdateWriteResults = normalizeVaultApprovedWriteResults(value.vaultUpdateWriteResults);
  const normalizedActiveSourceId = activeSourceId && sessionLocalSources.some((source) => source.source_id === activeSourceId)
    ? activeSourceId
    : sessionLocalSources[0]?.source_id;

  return {
    id,
    appId,
    appName,
    topic: stringValue(value.topic),
    authMode: normalizeAuthMode(value.authMode),
    userId: normalizeOptionalString(value.userId),
    userEmail: normalizeOptionalString(value.userEmail),
    userDisplayName: normalizeOptionalString(value.userDisplayName),
    userSlug: normalizeOptionalString(value.userSlug),
    organizationId: normalizeOptionalString(value.organizationId),
    createdByUserId: normalizeOptionalString(value.createdByUserId),
    createdByEmail: normalizeOptionalString(value.createdByEmail),
    messages,
    contextUsed,
    status: value.status === "pending" || value.status === "running" || value.status === "failed" || value.status === "timed_out" ? value.status : "completed",
    createdAt: stringValue(value.createdAt, new Date(0).toISOString()),
    updatedAt: stringValue(value.updatedAt, new Date(0).toISOString()),
    isDevelopmentFallback: value.isDevelopmentFallback === true,
    isRuntimeFallback: value.isRuntimeFallback === true,
    runtimeStatus,
    runtimeMode: normalizeRuntimeMode(value.runtimeMode, runtimeStatus, value.isDevelopmentFallback === true),
    attemptedRuntimeMode: normalizeRuntimeMode(value.attemptedRuntimeMode, runtimeStatus, false),
    runtimeLabel: stringValue(value.runtimeLabel),
    runtimeError: stringValue(value.runtimeError),
    runtimeErrorReason: normalizeRuntimeErrorReason(value.runtimeErrorReason),
    runtimeProvider: normalizeRuntimeProvider(value.runtimeProvider),
    runtimeAgent: normalizeRuntimeProvider(value.runtimeAgent),
    productRenderSource: normalizeProductRenderSource(value.productRenderSource),
    productFallbackReason: normalizeOptionalString(value.productFallbackReason),
    hermesRequestSent: value.hermesRequestSent === true ? true : undefined,
    calledHermesCmo: value.calledHermesCmo === true ? true : undefined,
    hermesCmoStatus: normalizeHermesCmoChatStatus(value.hermesCmoStatus),
    hermesCmoErrorReason: normalizeOptionalString(value.hermesCmoErrorReason),
    hermesCmoCounters: normalizeHermesCmoCounters(value.hermesCmoCounters),
    hermesCmoMetadata: normalizeHermesCmoMetadata(value.hermesCmoMetadata),
    strategyMode: normalizeStrategyMode(value.strategyMode),
    mainBottleneck: normalizeOptionalString(value.mainBottleneck),
    decisionLabel: normalizeDecisionLabel(value.decisionLabel),
    currentStep: normalizeOptionalString(value.currentStep),
    activityEvents: normalizeHermesCmoActivityEvents(value.activityEvents),
    delegationSummary: normalizeHermesCmoDelegationSummary(value.delegationSummary),
    agentsUsed: Array.isArray(value.agentsUsed)
      ? value.agentsUsed.map(normalizeHermesCmoAgentUsed).filter((agent): agent is HermesCmoAgentUsed => Boolean(agent))
      : undefined,
    surfCalls: normalizeOptionalNonNegativeNumber(value.surfCalls),
    echoCalls: normalizeOptionalNonNegativeNumber(value.echoCalls),
    forbiddenCounters: normalizeHermesCmoForbiddenCounters(value.forbiddenCounters),
    platformPersistenceSummary: normalizeHermesCmoPlatformPersistenceSummary(value.platformPersistenceSummary),
    delegationsMode: normalizeHermesCmoDelegationsMode(value.delegationsMode),
    vaultAgentDryRun: normalizeVaultAgentDryRunMetadata(value.vaultAgentDryRun),
    vaultAgentContextPack: normalizeVaultAgentContextPackMetadata(value.vaultAgentContextPack),
    cmoRunId: normalizeOptionalString(value.cmoRunId),
    cmoRunStatus: normalizeCmoRunStatus(value.cmoRunStatus),
    cmoRunEndpoint: value.cmoRunEndpoint === "/agents/cmo/tool-execute" ? value.cmoRunEndpoint : undefined,
    cmoRunToolsUsed: Array.isArray(value.cmoRunToolsUsed)
      ? value.cmoRunToolsUsed.map(normalizeHermesCmoAgentUsed).filter((agent): agent is HermesCmoAgentUsed => Boolean(agent))
      : undefined,
    cmoRunStartedAt: normalizeOptionalString(value.cmoRunStartedAt),
    cmoRunCompletedAt: normalizeOptionalString(value.cmoRunCompletedAt),
    cmoRunDurationMs: normalizeOptionalNonNegativeNumber(value.cmoRunDurationMs),
    cmoRunTimeoutMs: normalizeOptionalNonNegativeNumber(value.cmoRunTimeoutMs),
    missingContext,
    contextDiagnostics,
    contextQualitySummary: normalizeContextQualitySummary(value.contextQualitySummary ?? contextDiagnostics, [...contextUsed, ...missingContext]),
    graphHints,
    graphHintCount: typeof value.graphHintCount === "number" && Number.isFinite(value.graphHintCount) ? Math.max(0, Math.floor(value.graphHintCount)) : graphHints.length,
    graphStatus: normalizeGraphStatus(value.graphStatus),
    indexedContextStatus: normalizeIndexedContextStatus(value.indexedContextStatus),
    indexedContextSourcesCount: typeof value.indexedContextSourcesCount === "number" && Number.isFinite(value.indexedContextSourcesCount) ? Math.max(0, Math.floor(value.indexedContextSourcesCount)) : undefined,
    indexedContextFallbackReason: normalizeOptionalString(value.indexedContextFallbackReason),
    requestReceivedAt: normalizeOptionalString(value.requestReceivedAt),
    liveAttemptStartedAt: normalizeOptionalString(value.liveAttemptStartedAt),
    liveAttemptDurationMs: normalizeOptionalNonNegativeNumber(value.liveAttemptDurationMs),
    fallbackDurationMs: normalizeOptionalNonNegativeNumber(value.fallbackDurationMs),
    totalDurationMs: normalizeOptionalNonNegativeNumber(value.totalDurationMs),
    timeoutMs: normalizeOptionalNonNegativeNumber(value.timeoutMs),
    outerTimeoutMs: normalizeOptionalNonNegativeNumber(value.outerTimeoutMs ?? value.outer_timeout_ms),
    outerTimeoutSource: normalizeOuterTimeoutSource(value.outerTimeoutSource ?? value.outer_timeout_source),
    routeDecision: normalizeRouteDecision(value.routeDecision ?? value.route_decision),
    creativeExecutionRequested: value.creativeExecutionRequested === true || value.creative_execution_requested === true ? true : undefined,
    creativeResponseReceived: value.creativeResponseReceived === true || value.creative_response_received === true ? true : undefined,
    creativeMetadataPresent: typeof (value.creativeMetadataPresent ?? value.creative_metadata_present) === "boolean"
      ? Boolean(value.creativeMetadataPresent ?? value.creative_metadata_present)
      : undefined,
    active_asset_id: normalizeOptionalString(value.active_asset_id),
    active_creative_asset_id: normalizeOptionalString(value.active_creative_asset_id),
    creative_session_active_asset_id: normalizeOptionalString(value.creative_session_active_asset_id),
    creativeNormalizationError: normalizeOptionalString(value.creativeNormalizationError ?? value.creative_normalization_error ?? value.normalization_error),
    creativeFallbackUsed: typeof (value.creativeFallbackUsed ?? value.creative_fallback_used ?? value.fallback_used) === "boolean"
      ? Boolean(value.creativeFallbackUsed ?? value.creative_fallback_used ?? value.fallback_used)
      : undefined,
    creativeRejectedByM1Validator: value.creativeRejectedByM1Validator === true || value.rejected_by_m1_validator === true ? true : undefined,
    creativeRejectedField: normalizeOptionalString(value.creativeRejectedField ?? value.rejected_field),
    creativeSideEffectsPresent: typeof (value.creativeSideEffectsPresent ?? value.side_effects_present) === "boolean"
      ? Boolean(value.creativeSideEffectsPresent ?? value.side_effects_present)
      : undefined,
    creativeSideEffectsAllowedForCreative: typeof (value.creativeSideEffectsAllowedForCreative ?? value.side_effects_allowed_for_creative) === "boolean"
      ? Boolean(value.creativeSideEffectsAllowedForCreative ?? value.side_effects_allowed_for_creative)
      : undefined,
    creativeRejectedSideEffectType: normalizeOptionalString(value.creativeRejectedSideEffectType ?? value.rejected_side_effect_type),
    creativeWorkingState,
    creativeDecision,
    contextSourceCount: normalizeOptionalNonNegativeNumber(value.contextSourceCount),
    contextCharLength: normalizeOptionalNonNegativeNumber(value.contextCharLength),
    indexedSupplementCharLength: normalizeOptionalNonNegativeNumber(value.indexedSupplementCharLength),
    authDurationMs: normalizeOptionalNonNegativeNumber(value.authDurationMs),
    sessionResolutionDurationMs: normalizeOptionalNonNegativeNumber(value.sessionResolutionDurationMs),
    contextPackBuildDurationMs: normalizeOptionalNonNegativeNumber(value.contextPackBuildDurationMs),
    indexedContextBuildDurationMs: normalizeOptionalNonNegativeNumber(value.indexedContextBuildDurationMs),
    runtimeContext: isRecord(value.runtimeContext) ? value.runtimeContext as unknown as CMOChatSession["runtimeContext"] : undefined,
    sourceReviewContext: normalizeSourceReviewContext(value.sourceReviewContext),
    sourceAnswerContext: normalizeSourceAnswerContext(value.sourceAnswerContext),
    sessionLocalSources,
    sessionLocalResearchResults,
    ...(attachments.length ? { attachments } : {}),
    ...(normalizedActiveSourceId ? { activeSourceId: normalizedActiveSourceId } : {}),
    ...(sessionSummary ? { sessionSummary } : {}),
    ...(sessionCreativeAssets.length ? { creativeAssets: sessionCreativeAssets, creative_assets: sessionCreativeAssets } : {}),
    ...(sessionArtifacts.length ? { sessionArtifacts } : {}),
    ...(suggestedVaultUpdates.length ? { suggestedVaultUpdates } : {}),
    ...(vaultUpdateApprovalEvents.length ? { vaultUpdateApprovalEvents } : {}),
    ...(vaultUpdateDryRunResults.length ? { vaultUpdateDryRunResults } : {}),
    ...(vaultUpdateWriteResults.length ? { vaultUpdateWriteResults } : {}),
    decisionLayer,
    assumptions: normalizeStringList(value.assumptions),
    suggestedActions: normalizeSuggestedActions(value.suggestedActions),
    savedToVault: value.savedToVault === true,
    rawCapturePath: normalizeOptionalString(value.rawCapturePath),
    rawCaptureStatus: value.rawCaptureStatus === "saved" || value.rawCaptureStatus === "failed" || value.rawCaptureStatus === "pending" ? value.rawCaptureStatus : undefined,
    rawCaptureError: normalizeOptionalString(value.rawCaptureError),
    sessionNotePath: normalizeOptionalString(value.sessionNotePath),
    relatedPriority: normalizeOptionalString(value.relatedPriority),
    relatedPlan: normalizeOptionalString(value.relatedPlan),
    relatedTasks: normalizeStringList(value.relatedTasks),
  };
}

export async function createAppChatSession(
  body: unknown,
  userIdentity: CmoServerUserIdentity = legacyUserIdentity(),
  timing: CmoAppChatTimingInput = {},
): Promise<CMOAppChatResponse> {
  const requestStartedMs = Date.now();
  const requestReceivedAt = timing.requestReceivedAt ?? new Date().toISOString();
  const request = normalizeAppChatRequest(body);
  const now = new Date().toISOString();
  const sessionResolutionStartedMs = Date.now();
  const existingSession = request.sessionId ? await readAppChatSession(request.sessionId) : null;
  const continuedSession = existingSession?.appId === request.appId ? existingSession : null;
  let creativeWorkingState: CmoCreativeWorkingState | undefined = normalizeCreativeWorkingState(continuedSession?.creativeWorkingState);
  let creativeDecision: CmoCreativeDecision | undefined = continuedSession?.creativeDecision;
  const activeCreativeAssetResolution = resolveActiveCreativeAsset(continuedSession);
  creativeWorkingState = activeCreativeAssetResolution.asset
    ? applyCreativeAssetStateUpdate(creativeWorkingState, [activeCreativeAssetResolution.asset])
    : creativeWorkingState;
  const creativeWorkingStatePresent = hasCreativeWorkingStateDrafts(creativeWorkingState);
  const activeCreativeAssetId = creativeWorkingState?.active_asset_id;
  const creativeAssetsCount = creativeWorkingState?.assets?.length ?? 0;
  const sessionResolutionDurationMs = Date.now() - sessionResolutionStartedMs;
  const messageId = `msg_${randomUUID().slice(0, 12)}`;
  const assistantId = `msg_${randomUUID().slice(0, 12)}`;
  const cmoRunId = `run_${randomUUID().slice(0, 12)}`;
  const sessionId = continuedSession?.id ?? `session_${safeId(request.workspaceId)}_${now.replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const turnAttachments = bindCmoAttachmentsToTurn({
    attachments: request.attachments ?? [],
    sessionId,
    messageId,
    ...(userIdentity.userId ? { userId: userIdentity.userId } : {}),
    ...(userIdentity.userEmail ? { userEmail: userIdentity.userEmail } : {}),
  });
  const sessionAttachments = normalizeCmoSessionAttachments([
    ...(continuedSession?.attachments ?? []),
    ...turnAttachments,
  ]);
  const localCommand = continuedSession ? parseLocalChatCommand(request.message) : null;

  if (localCommand && continuedSession) {
    return handleLocalChatCommand(localCommand, request, continuedSession, now, messageId, assistantId, userIdentity);
  }

  const runtime = request.forceFallback
    ? new FallbackRuntime({
        status: "live_failed_then_fallback",
        mode: "fallback",
        label: "CMO smoke fallback",
        reason: "Live app-chat intentionally bypassed for fallback smoke.",
      })
    : await getRuntimeRegistry().selectRuntime();
  const contextPackBuildStartedMs = Date.now();
  const baseContextPackResult = withContextPackMessage(
    await buildContextPack({
      workspaceId: request.workspaceId,
      appId: request.appId,
      runtimeMode: runtime.mode,
    }),
    request.message,
  );
  const contextPackBuildDurationMs = Date.now() - contextPackBuildStartedMs;
  const indexedContextBuildStartedMs = Date.now();
  const indexedContextSupplement = await buildIndexedContextSupplement({
    appId: request.appId,
    query: request.message,
    limit: 6,
    userId: userIdentity.userId ?? "",
    userEmail: userIdentity.userEmail,
    isOwnerOrAdmin: userIdentity.authMode === "legacy",
  });
  const indexedContextBuildDurationMs = Date.now() - indexedContextBuildStartedMs;
  const indexedContextStatus: CmoIndexedContextStatus = indexedContextSupplement.used
    ? "used"
    : indexedContextSupplement.enabled
      ? "skipped"
      : "off";
  const indexedContextSourcesCount = indexedContextSupplement.sources.length;
  const indexedContextFallbackReason = indexedContextSupplement.fallbackReason;
  const contextPackResult = applyIndexedContextSupplement(baseContextPackResult, indexedContextSupplement);
  let { contextPackage } = contextPackResult;
  const { contextUsed, missingContext, contextDiagnostics, contextQualitySummary } = contextPackResult;
  const vaultAgentContextPackHandoff = await runVaultAgentContextPackHandoff({
    request,
    session: continuedSession,
    sessionId,
    userIdentity,
    createdAt: now,
  });
  const vaultAgentContextPackMetadata = vaultAgentContextPackHandoff.mode === "off"
    ? undefined
    : vaultAgentContextPackHandoff.metadata;
  contextPackage = applyVaultAgentContextPackToCmoContextPackage(contextPackage, vaultAgentContextPackHandoff);
  const runtimeContext = buildRuntimeContext({ nowIso: now, userIdentity });
  const requestTenantId = request.tenantId ?? "holdstation";
  const requestUserId = sourceReviewUserId(userIdentity);
  const sourceReviewContext = await buildSourceReviewContextFromMessage({
    tenantId: requestTenantId,
    workspaceId: request.workspaceId,
    userId: requestUserId,
    sessionId,
    requestId: messageId,
    message: request.message,
    nowIso: now,
    timezone: runtimeContext.timezone,
  });
  const rawNewSessionLocalSource = sourceReviewContext ? sessionLocalSourceFromReviewContext(sourceReviewContext) : undefined;
  const newSessionLocalSource = rawNewSessionLocalSource ? withSessionSourceRoutingMetadata(rawNewSessionLocalSource) : undefined;
  const sessionLocalSources = mergeSessionLocalSources(
    continuedSession?.sessionLocalSources?.filter((source) => source.workspace_id === request.workspaceId && source.session_id === sessionId),
    newSessionLocalSource,
  );
  let sessionLocalResearchResults = mergeSessionLocalResearchResults(
    continuedSession?.sessionLocalResearchResults?.filter((result) =>
      result.tenant_id === requestTenantId &&
      result.workspace_id === request.workspaceId &&
      result.app_id === request.appId &&
      result.user_id === requestUserId &&
      result.session_id === sessionId),
    undefined,
  );
  const activeSourceId = newSessionLocalSource?.source_id ?? continuedSession?.activeSourceId ?? sessionLocalSources[0]?.source_id;
  const activeSessionLocalSource = activeSourceId
    ? sessionLocalSources.find((source) => source.source_id === activeSourceId)
    : undefined;
  const activeSourceReviewContext = newSessionLocalSource
    ? sourceReviewContextFromSessionLocalSource(newSessionLocalSource, {
        tenantId: requestTenantId,
        userId: requestUserId,
      })
    : sourceReviewContext ?? sourceReviewContextFromSessionLocalSource(activeSessionLocalSource, {
        tenantId: requestTenantId,
        userId: requestUserId,
      });
  const preliminaryHermesCmoRoute = resolveHermesCmoChatRoute({
    appId: request.appId,
    message: request.message,
    forceFallback: request.forceFallback,
    hasCreativeWorkingState: creativeWorkingStatePresent,
    creativeWorkingState,
  });
  const legacyHermesCmoChatRequested = !request.forceFallback && shouldUseHermesCmoChat(request.appId);
  const preliminaryHermesCmoChatRequested =
    legacyHermesCmoChatRequested ||
    preliminaryHermesCmoRoute.endpointKind === "agent_chat" ||
    preliminaryHermesCmoRoute.endpointKind === "cmo_agent";
  const sourceAnswerContext = await buildSourceAnswerContext({
    source: activeSessionLocalSource,
    query: request.message,
    workspaceId: request.workspaceId,
    sessionId,
    nowIso: now,
    allowRefetch: !preliminaryHermesCmoChatRequested,
  });
  const sourceOrToolTask = sourceAnswerContext?.tool_read_recommended === true || turnAttachments.length > 0;
  const hermesCmoRoute = resolveHermesCmoChatRoute({
    appId: request.appId,
    message: request.message,
    forceFallback: request.forceFallback,
    hasSourceOrToolTask: sourceOrToolTask,
    hasCreativeWorkingState: creativeWorkingStatePresent,
    creativeWorkingState,
  });
  const hermesCmoChatV11Requested = hermesCmoRoute.endpointKind === "agent_chat";
  const hermesCmoUnifiedAgentRequested = hermesCmoRoute.endpointKind === "cmo_agent";
  const hermesCmoCreativeExecutionRequested = hermesCmoRoute.reason === "creative_execution";
  const hermesCmoNativeCreativeRequested =
    hermesCmoRoute.reason === "creative_execution" ||
    hermesCmoRoute.reason === "creative_ideation" ||
    hermesCmoRoute.reason === "creative_session";
  const creativeIdeationDetected = hermesCmoRoute.reason === "creative_ideation";
  const creativeSessionFollowupDetected = hermesCmoRoute.reason === "creative_session";
  const creativeConversationOnlyIntent = hermesCmoRoute.reason === "creative_session" && isCreativeConversationOnlyIntent(request.message);
  const creativeAcknowledgementNoopIntent = creativeConversationOnlyIntent && isPureAcknowledgementIntent(request.message);
  const routeOverrodeToolExecuteDueToCreativeContext = hermesCmoRoute.reason === "creative_session" && creativeWorkingStatePresent;
  const toolExecuteSuppressedForCreativeFollowup = hermesCmoRoute.endpointKind === "execute" && hermesCmoRoute.reason === "creative_session";
  const productPredictedCreativeLongRunningTurn =
    hermesCmoRoute.reason === "creative_execution" ||
    (!hermesCmoUnifiedAgentRequested && hermesCmoRoute.reason === "creative_session" && !creativeConversationOnlyIntent && (
      Boolean(activeCreativeAssetId) ||
      creativeAssetsCount > 0 ||
      Boolean(activeCreativeAssetResolution.asset) ||
      creativeWorkingStatePresent
    ));
  const hermesCmoCreativeLongRunningTurn = productPredictedCreativeLongRunningTurn;
  const creativeWorkingStateForHermes =
    hermesCmoNativeCreativeRequested || hermesCmoUnifiedAgentRequested ? creativeWorkingState : undefined;
  const hermesCmoLegacyRequested =
    legacyHermesCmoChatRequested ||
    hermesCmoUnifiedAgentRequested ||
    hermesCmoRoute.endpointKind === "tool_execute" ||
    hermesCmoCreativeExecutionRequested ||
    hermesCmoRoute.reason === "creative_ideation" ||
    hermesCmoRoute.reason === "creative_session";
  const hermesCmoChatRequested = hermesCmoChatV11Requested || hermesCmoLegacyRequested;
  const lensReadoutContextResult = isCmoLensDirectContextEnabled()
    ? await getLensReadoutContextForAppSafe({
        appId: request.appId,
        rangeKey: request.rangeKey ?? "this_week",
      })
    : { context: null, warning: undefined };
  const lensReadoutContext = lensReadoutContextResult.context;
  const lensReadoutContextWarning = lensReadoutContextResult.warning?.code;
  contextPackage = {
    ...contextPackage,
    runtimeContext,
    ...(activeSourceReviewContext ? { sourceReviewContext: activeSourceReviewContext } : {}),
    ...(sourceAnswerContext ? { sourceAnswerContext } : {}),
    ...(lensReadoutContext ? { lensReadoutContext: lensReadoutContext as unknown as Record<string, unknown> } : {}),
    ...(lensReadoutContextWarning ? { lensReadoutContextWarning } : {}),
    sessionLocalSources,
    sessionLocalResearchResults,
    ...(sessionAttachments.length ? { attachments: sessionAttachments } : {}),
    ...(activeSourceId ? { activeSourceId } : {}),
    contextPack: {
      ...contextPackage.contextPack,
      ...(activeSourceReviewContext ? { sourceReviewContext: activeSourceReviewContext } : {}),
      ...(sourceAnswerContext ? { sourceAnswerContext } : {}),
    },
  };
  const contextSourceCount = contextPackage.contextPack.items.filter((item) => item.exists).length;
  const contextCharLength = contextPackage.contextPack.items.reduce((total, item) => total + item.content.length, 0);
  const indexedSupplementCharLength = indexedContextSupplement.used ? indexedContextSupplement.text.length : 0;
  if (contextCharLength > CONTEXT_SIZE_WARNING_CHARS) {
    console.warn("[cmo-app-chat] Context pack is large; live app-turn may time out.", {
      appId: request.appId,
      sessionId: continuedSession?.id,
      contextCharLength,
      contextSourceCount,
    });
  }
  if (indexedSupplementCharLength > INDEXED_SUPPLEMENT_WARNING_CHARS) {
    console.warn("[cmo-app-chat] Indexed context supplement is large; keeping supplemental context bounded is recommended.", {
      appId: request.appId,
      sessionId: continuedSession?.id,
      indexedSupplementCharLength,
      indexedContextSourcesCount,
    });
  }
  const graphHints = contextPackage.graphHints ?? [];
  const graphHintCount = contextPackage.graphHintCount ?? graphHints.length;
  const graphStatus = contextPackage.graphStatus ?? "empty";
  let answer = "";
  let status: CMOChatSession["status"] = "completed";
  let assumptions: string[] = [];
  let suggestedActions: CMOAppChatResponse["suggestedActions"] = [];
  let isDevelopmentFallback = false;
  let isRuntimeFallback = false;
  let runtimeStatus: CMORuntimeStatus = "not_configured";
  let runtimeMode: CmoRuntimeMode = runtime.mode;
  let attemptedRuntimeMode: CmoRuntimeMode | undefined;
  let runtimeLabel = "OpenClaw CMO runtime";
  let runtimeError = "";
  let runtimeErrorReason: CmoRuntimeErrorReason | undefined;
  let runtimeProvider: string | undefined;
  let runtimeAgent: string | undefined;
  let liveAttemptStartedAt: string | undefined;
  let liveAttemptDurationMs: number | undefined;
  let fallbackDurationMs: number | undefined;
  let timeoutMs: number | undefined;
  let outerTimeoutMs: number | undefined;
  let outerTimeoutSource: CMOChatSession["outerTimeoutSource"] | undefined;
  let routeDecision: CMOChatSession["routeDecision"] | undefined;
  let creativeExecutionRequested: boolean | undefined;
  let creativeResponseReceived: boolean | undefined;
  let creativeMetadataPresent: boolean | undefined;
  let creativeNormalizationError: string | undefined;
  let creativeFallbackUsed: boolean | undefined;
  let creativeRejectedByM1Validator: boolean | undefined;
  let creativeRejectedField: string | undefined;
  let creativeSideEffectsPresent: boolean | undefined;
  let creativeSideEffectsAllowedForCreative: boolean | undefined;
  let creativeRejectedSideEffectType: string | undefined;
  let calledHermesCmo = false;
  let hermesCmoStatus: HermesCmoChatStatus | undefined;
  let hermesCmoErrorReason: string | undefined;
  let hermesCmoCounters: HermesCmoSafetyCounters | undefined;
  let hermesCmoMetadata: HermesCmoChatMetadata | undefined;
  let strategyMode: CmoStrategyMode | undefined;
  let mainBottleneck: string | undefined;
  let decisionLabel: CmoDecisionLabel | undefined;
  let currentStep: string | undefined;
  let activityEvents: HermesCmoActivityEventSummary[] | undefined;
  let delegationSummary: HermesCmoDelegationSummaryItem[] | undefined;
  let agentsUsed: HermesCmoAgentUsed[] | undefined;
  let surfCalls: number | undefined;
  let echoCalls: number | undefined;
  let forbiddenCounters: HermesCmoForbiddenCounters | undefined;
  let delegationsMode: HermesCmoDelegationsMode | undefined;
  let usedHermesCmoChat = false;
  let hermesCmoChatV11Attempted = false;
  let hermesRequestSent = false;
  let productRenderSource: CmoProductRenderSource | undefined;
  let productFallbackReason: string | undefined;
  let completedUnifiedCmoAgentAnswer: string | undefined;
  let completedUnifiedCmoAgentAnswerBasisMode: string | undefined;
  let completedUnifiedCmoAgentPersistState: CompletedUnifiedCmoAgentPersistState | undefined;
  let currentTurnCreativeLongRunningTurn = hermesCmoCreativeLongRunningTurn;
  let sessionSummary = continuedSession?.sessionSummary;
  let sessionArtifacts = continuedSession?.sessionArtifacts ?? [];
  let turnCreativeArtifacts: Record<string, unknown>[] = [];
  let suggestedVaultUpdates = continuedSession?.suggestedVaultUpdates ?? [];
  const vaultUpdateApprovalEvents = continuedSession?.vaultUpdateApprovalEvents ?? [];
  const vaultUpdateDryRunResults = continuedSession?.vaultUpdateDryRunResults ?? [];
  const vaultUpdateWriteResults = continuedSession?.vaultUpdateWriteResults ?? [];

  if (shouldStartAsyncHermesCmoToolRun(hermesCmoRoute.endpointKind)) {
    const asyncToolRunTimeoutMs = getCmoHermesCmoAsyncToolRunTimeoutMs();
    const pendingAnswer = pendingToolRunAnswer();
    const pendingDecisionLayer = buildDecisionLayer({
      workspaceId: request.workspaceId,
      appId: request.appId,
      sourceId: contextPackage.sourceId,
      sessionId,
      createdAt: now,
      answer: pendingAnswer,
      runtimeAssumptions: [],
      runtimeSuggestedActions: [],
    });
    const pendingTimingMetadata = {
      requestReceivedAt,
      ...(typeof timing.authDurationMs === "number" ? { authDurationMs: Math.max(0, Math.floor(timing.authDurationMs)) } : {}),
      sessionResolutionDurationMs,
      contextPackBuildDurationMs,
      indexedContextBuildDurationMs,
      totalDurationMs: Date.now() - requestStartedMs,
      contextSourceCount,
      contextCharLength,
      indexedSupplementCharLength,
    };
    const pendingSession: CMOChatSession = {
      id: sessionId,
      appId: request.appId,
      appName: request.appName,
      topic: continuedSession?.topic || request.topic || request.message.slice(0, 96),
      authMode: continuedSession?.authMode ?? userIdentity.authMode,
      userId: continuedSession?.userId ?? userIdentity.userId,
      userEmail: continuedSession?.userEmail ?? userIdentity.userEmail,
      userDisplayName: continuedSession?.userDisplayName ?? userIdentity.userDisplayName,
      userSlug: continuedSession?.userSlug ?? userIdentity.userSlug,
      organizationId: continuedSession?.organizationId ?? userIdentity.organizationId,
      createdByUserId: continuedSession?.createdByUserId ?? userIdentity.createdByUserId,
      createdByEmail: continuedSession?.createdByEmail ?? userIdentity.createdByEmail,
      status: "pending",
      createdAt: continuedSession?.createdAt ?? now,
      updatedAt: now,
      contextUsed,
      missingContext,
      assumptions: [],
      suggestedActions: [],
      isDevelopmentFallback: false,
      isRuntimeFallback: false,
      runtimeStatus: "live",
      runtimeMode: "live",
      attemptedRuntimeMode: "live",
      runtimeLabel: "Hermes CMO async tool orchestration",
      runtimeProvider: "hermes",
      runtimeAgent: "cmo",
      productRenderSource: "hermes_cmo",
      hermesRequestSent: true,
      calledHermesCmo: true,
      hermesCmoStatus: "live",
      delegationsMode: HERMES_CMO_PROPOSALS_ONLY,
      cmoRunId,
      cmoRunStatus: "pending",
      cmoRunEndpoint: "/agents/cmo/tool-execute",
      cmoRunStartedAt: now,
      cmoRunTimeoutMs: asyncToolRunTimeoutMs,
      runtimeContext,
      ...(creativeWorkingState ? { creativeWorkingState } : {}),
      ...(creativeDecision ? { creativeDecision } : {}),
      ...(sourceReviewContext ? { sourceReviewContext } : {}),
      ...(sourceAnswerContext ? { sourceAnswerContext } : {}),
      sessionLocalSources,
      sessionLocalResearchResults,
      ...(sessionAttachments.length ? { attachments: sessionAttachments } : {}),
      ...(activeSourceId ? { activeSourceId } : {}),
      ...(sessionSummary ? { sessionSummary } : {}),
      ...(sessionArtifacts.length ? { sessionArtifacts } : {}),
      ...(suggestedVaultUpdates.length ? { suggestedVaultUpdates } : {}),
      ...(vaultUpdateApprovalEvents.length ? { vaultUpdateApprovalEvents } : {}),
      ...(vaultUpdateDryRunResults.length ? { vaultUpdateDryRunResults } : {}),
      ...(vaultUpdateWriteResults.length ? { vaultUpdateWriteResults } : {}),
      contextDiagnostics,
      contextQualitySummary,
      graphHints,
      graphHintCount,
      graphStatus,
      indexedContextStatus,
      indexedContextSourcesCount,
      ...(indexedContextFallbackReason ? { indexedContextFallbackReason } : {}),
      ...pendingTimingMetadata,
      decisionLayer: pendingDecisionLayer,
      rawCaptureStatus: "pending",
      messages: [
        ...(continuedSession?.messages ?? []),
        {
          id: messageId,
          role: "user",
          content: request.message,
          createdAt: now,
          ...messageUserMetadata(userIdentity),
          runtimeContext,
          ...(creativeWorkingState ? { creativeWorkingState } : {}),
          ...(creativeDecision ? { creativeDecision } : {}),
          ...(sourceReviewContext ? { sourceReviewContext } : {}),
          ...(sourceAnswerContext ? { sourceAnswerContext } : {}),
          sessionLocalResearchResults,
          ...(turnAttachments.length ? { attachments: turnAttachments } : {}),
        },
        {
          id: assistantId,
          role: "assistant",
          content: pendingAnswer,
          createdAt: now,
          ...assistantSourceMetadata(userIdentity, messageId),
          runtimeMode: "live",
          runtimeStatus: "live",
          runtimeProvider: "hermes",
          runtimeAgent: "cmo",
          productRenderSource: "hermes_cmo",
          hermesRequestSent: true,
          calledHermesCmo: true,
          hermesCmoStatus: "live",
          delegationsMode: HERMES_CMO_PROPOSALS_ONLY,
          cmoRunId,
          cmoRunStatus: "pending",
          cmoRunEndpoint: "/agents/cmo/tool-execute",
          cmoRunStartedAt: now,
          cmoRunTimeoutMs: asyncToolRunTimeoutMs,
          runtimeContext,
          ...(creativeWorkingState ? { creativeWorkingState } : {}),
          ...(creativeDecision ? { creativeDecision } : {}),
          ...(sourceReviewContext ? { sourceReviewContext } : {}),
          ...(sourceAnswerContext ? { sourceAnswerContext } : {}),
          sessionLocalSources,
          sessionLocalResearchResults,
          ...(turnAttachments.length ? { attachments: turnAttachments } : {}),
          contextUsedCount: contextUsed.length,
          graphHintCount,
          indexedContextStatus,
          indexedContextSourcesCount,
          ...(indexedContextFallbackReason ? { indexedContextFallbackReason } : {}),
          ...pendingTimingMetadata,
        },
      ],
    };

    await writeJsonFile(sessionPath(sessionId), pendingSession);

    const completeAsyncHermesCmoToolRun = async () => {
      const runningAt = new Date().toISOString();
      const currentBeforeRunning = await readAppChatSession(sessionId);
      if (!asyncToolRunStillActive(currentBeforeRunning, assistantId, cmoRunId)) {
        return;
      }

      await writeJsonFile(sessionPath(sessionId), {
        ...currentBeforeRunning,
        status: "running",
        updatedAt: runningAt,
        cmoRunId,
        cmoRunStatus: "running",
        cmoRunTimeoutMs: asyncToolRunTimeoutMs,
        messages: currentBeforeRunning.messages.map((message) => message.id === assistantId ? { ...message, cmoRunId, cmoRunStatus: "running", cmoRunTimeoutMs: asyncToolRunTimeoutMs } : message),
      });

      const runStartedMs = Date.now();
      const runStartedAt = runningAt;
      let finalSession: CMOChatSession;

      try {
        const hermesAttachmentRefs = await cmoAttachmentsForHermes(turnAttachments);
        const hermesRequest = mapCmoChatToHermesCmoRequest({
          contextPack: contextPackage.contextPack,
          contextPackage,
          message: request.message,
          history: asyncToolRunReplayHistory(pendingSession.messages, assistantId),
          request,
          contextUsed,
          missingContext,
          sessionId,
          userMessageId: messageId,
          createdAt: now,
          userIdentity,
          inputMaterialAttachments: hermesAttachmentRefs,
          creativeWorkingState: creativeWorkingStateForHermes,
          creativeIdeationDetected,
          creativeSessionFollowupDetected,
          activeCreativeAssetResolutionSource: activeCreativeAssetResolution.source,
        });
        const hermesResult = await runHermesCmoRuntime(hermesRequest, { toolTimeoutMs: asyncToolRunTimeoutMs });
        const counterValidation = validateHermesCmoChatCounters(hermesResult);

        if (!counterValidation.ok) {
          throw new Error(counterValidation.errorReason ?? "invalid_counters_schema");
        }

        const mappedHermesResult = sanitizeHermesCmoMappedChatResult(mapHermesCmoResponseToChatResult(hermesResult));
        const creativeContractViolation = creativeContractViolationMetadata(hermesResult);
        let completedCreativeWorkingState = applySuggestedCreativeStateUpdate(
          pendingSession.creativeWorkingState,
          creativeContractViolation ? undefined : extractSuggestedCreativeStateUpdate(hermesResult.response),
        );
        const completedCreativeDecision = creativeContractViolation
          ? pendingSession.creativeDecision
          : extractCreativeDecision(hermesResult.response) ?? pendingSession.creativeDecision;
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - runStartedMs;
        const toolsUsed = safeCmoRunToolsUsed(mappedHermesResult.hermesCmoMetadata.agentsUsed);
        const completedResearchResults = mergeSessionLocalResearchResults(
          sessionLocalResearchResults,
          sessionLocalResearchResultFromHermesResult({
            hermesResult,
            tenantId: requestTenantId,
            workspaceId: request.workspaceId,
            appId: request.appId,
            userId: requestUserId,
            sessionId,
            turnId: messageId,
            createdAt: now,
            userQuestion: request.message,
          }),
        );
        const completedCreativeArtifacts = creativeContractViolation ? [] : creativeAssetsFromHermesPayload({
          response: hermesResult.response,
          tenantId: requestTenantId,
          workspaceId: request.workspaceId,
          appId: request.appId,
          jobId: cmoRunId,
          createdAt: completedAt,
        });
        turnCreativeArtifacts = completedCreativeArtifacts;
        completedCreativeWorkingState = applyCreativeAssetStateUpdate(completedCreativeWorkingState, completedCreativeArtifacts);
        mappedHermesResult.hermesCmoMetadata = {
          ...mappedHermesResult.hermesCmoMetadata,
          ...(creativeContractViolation ?? {}),
          ...creativeStateMetadata(completedCreativeWorkingState, completedCreativeDecision),
          ...lensReadoutMetadata({
            context: lensReadoutContext as unknown as Record<string, unknown> | null,
            warning: lensReadoutContextWarning,
          }),
        };
        const completedSessionArtifacts = mergeHermesCmoChatV11Artifacts(
          sessionArtifacts,
          completedCreativeArtifacts,
        );
        const completedAnswer = creativeContractViolation ? PRODUCT_CREATIVE_CONTRACT_VIOLATION_MESSAGE : mappedHermesResult.answer;
        const completedDecisionLayer = buildDecisionLayer({
          workspaceId: request.workspaceId,
          appId: request.appId,
          sourceId: contextPackage.sourceId,
          sessionId,
          createdAt: completedAt,
          answer: completedAnswer,
          runtimeAssumptions: mappedHermesResult.assumptions,
          runtimeSuggestedActions: mappedHermesResult.suggestedActions,
        });
        const completionMetadata = {
          liveAttemptStartedAt: runStartedAt,
          liveAttemptDurationMs: durationMs,
          totalDurationMs: Date.now() - requestStartedMs,
          ...(normalizeRouteDecision(hermesResult.hermesCmoRouteDecision) ? { routeDecision: normalizeRouteDecision(hermesResult.hermesCmoRouteDecision), route_decision: normalizeRouteDecision(hermesResult.hermesCmoRouteDecision) } : {}),
          cmoRunId,
          cmoRunStatus: "completed" as const,
          cmoRunEndpoint: "/agents/cmo/tool-execute" as const,
          ...(toolsUsed?.length ? { cmoRunToolsUsed: toolsUsed } : {}),
          cmoRunStartedAt: runStartedAt,
          cmoRunCompletedAt: completedAt,
          cmoRunDurationMs: durationMs,
          cmoRunTimeoutMs: asyncToolRunTimeoutMs,
        };

        finalSession = {
          ...pendingSession,
          status: "completed",
          updatedAt: completedAt,
          assumptions: mappedHermesResult.assumptions,
          suggestedActions: mappedHermesResult.suggestedActions,
          isDevelopmentFallback: mappedHermesResult.isDevelopmentFallback,
          isRuntimeFallback: mappedHermesResult.isRuntimeFallback,
          runtimeStatus: mappedHermesResult.runtimeStatus,
          runtimeMode: mappedHermesResult.runtimeMode,
          runtimeLabel: mappedHermesResult.runtimeLabel,
          runtimeProvider: mappedHermesResult.runtimeProvider,
          runtimeAgent: mappedHermesResult.runtimeAgent,
          hermesCmoStatus: mappedHermesResult.hermesCmoStatus,
          hermesCmoCounters: mappedHermesResult.hermesCmoCounters,
          hermesCmoMetadata: mappedHermesResult.hermesCmoMetadata,
          strategyMode: mappedHermesResult.hermesCmoMetadata.strategyMode,
          mainBottleneck: mappedHermesResult.hermesCmoMetadata.mainBottleneck,
          decisionLabel: mappedHermesResult.hermesCmoMetadata.decisionLabel,
          currentStep: mappedHermesResult.hermesCmoMetadata.currentStep,
          activityEvents: mappedHermesResult.hermesCmoMetadata.activityEvents,
          delegationSummary: mappedHermesResult.hermesCmoMetadata.delegationSummary,
          agentsUsed: mappedHermesResult.hermesCmoMetadata.agentsUsed,
          surfCalls: mappedHermesResult.hermesCmoMetadata.surfCalls,
          echoCalls: mappedHermesResult.hermesCmoMetadata.echoCalls,
          forbiddenCounters: mappedHermesResult.hermesCmoMetadata.forbiddenCounters,
          delegationsMode: mappedHermesResult.delegationsMode,
          creativeWorkingState: completedCreativeWorkingState,
          creativeDecision: completedCreativeDecision,
          ...(completedSessionArtifacts.length ? { sessionArtifacts: completedSessionArtifacts } : {}),
          sessionLocalResearchResults: completedResearchResults,
          decisionLayer: completedDecisionLayer,
          rawCaptureStatus: "pending",
          ...completionMetadata,
          messages: pendingSession.messages.map((message) => message.id === assistantId ? {
            ...message,
            content: completedAnswer,
            runtimeStatus: mappedHermesResult.runtimeStatus,
            runtimeMode: mappedHermesResult.runtimeMode,
            runtimeProvider: mappedHermesResult.runtimeProvider,
            runtimeAgent: mappedHermesResult.runtimeAgent,
            hermesCmoStatus: mappedHermesResult.hermesCmoStatus,
            hermesCmoCounters: mappedHermesResult.hermesCmoCounters,
            hermesCmoMetadata: mappedHermesResult.hermesCmoMetadata,
            strategyMode: mappedHermesResult.hermesCmoMetadata.strategyMode,
            mainBottleneck: mappedHermesResult.hermesCmoMetadata.mainBottleneck,
            decisionLabel: mappedHermesResult.hermesCmoMetadata.decisionLabel,
            currentStep: mappedHermesResult.hermesCmoMetadata.currentStep,
            activityEvents: mappedHermesResult.hermesCmoMetadata.activityEvents,
            delegationSummary: mappedHermesResult.hermesCmoMetadata.delegationSummary,
            agentsUsed: mappedHermesResult.hermesCmoMetadata.agentsUsed,
            surfCalls: mappedHermesResult.hermesCmoMetadata.surfCalls,
            echoCalls: mappedHermesResult.hermesCmoMetadata.echoCalls,
            forbiddenCounters: mappedHermesResult.hermesCmoMetadata.forbiddenCounters,
            delegationsMode: mappedHermesResult.delegationsMode,
            creativeWorkingState: completedCreativeWorkingState,
            creativeDecision: completedCreativeDecision,
            ...(completedCreativeArtifacts.length ? { sessionArtifacts: completedCreativeArtifacts } : {}),
            sessionLocalResearchResults: completedResearchResults,
            ...completionMetadata,
          } : message),
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Hermes CMO tool run failed.";
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - runStartedMs;
        const runStatus: CmoAsyncToolRunStatus = isTimedOutHermesError(reason) ? "timed_out" : "failed";
        const safeAnswer = failedToolRunAnswer();
        const failedDecisionLayer = buildDecisionLayer({
          workspaceId: request.workspaceId,
          appId: request.appId,
          sourceId: contextPackage.sourceId,
          sessionId,
          createdAt: completedAt,
          answer: safeAnswer,
          runtimeAssumptions: [],
          runtimeSuggestedActions: [],
        });
        const failureMetadata = {
          liveAttemptStartedAt: runStartedAt,
          liveAttemptDurationMs: durationMs,
          totalDurationMs: Date.now() - requestStartedMs,
          cmoRunId,
          cmoRunStatus: runStatus,
          cmoRunEndpoint: "/agents/cmo/tool-execute" as const,
          cmoRunStartedAt: runStartedAt,
          cmoRunCompletedAt: completedAt,
          cmoRunDurationMs: durationMs,
          cmoRunTimeoutMs: asyncToolRunTimeoutMs,
        };

        finalSession = {
          ...pendingSession,
          status: runStatus,
          updatedAt: completedAt,
          runtimeStatus: "runtime_error",
          runtimeMode: "configured_but_unreachable",
          runtimeError: reason,
          runtimeErrorReason: runStatus === "timed_out" ? "timeout" : "execution_error",
          productFallbackReason: "async_tool_run_failed",
          hermesCmoErrorReason: reason,
          decisionLayer: failedDecisionLayer,
          rawCaptureStatus: "pending",
          ...failureMetadata,
          messages: pendingSession.messages.map((message) => message.id === assistantId ? {
            ...message,
            content: safeAnswer,
            runtimeStatus: "runtime_error",
            runtimeMode: "configured_but_unreachable",
            runtimeErrorReason: runStatus === "timed_out" ? "timeout" : "execution_error",
            productFallbackReason: "async_tool_run_failed",
            hermesCmoErrorReason: reason,
            ...failureMetadata,
          } : message),
        };
      }

      const currentBeforeFinalize = await readAppChatSession(sessionId);
      if (!asyncToolRunStillActive(currentBeforeFinalize, assistantId, cmoRunId)) {
        return;
      }
      finalSession = mergeAsyncToolRunFinalSession(currentBeforeFinalize, finalSession, assistantId);

      if (finalSession.status === "completed") {
        finalSession = await attachAsyncToolRunRawActivityLog({
          request,
          session: finalSession,
          userIdentity,
          userMessageId: messageId,
          assistantMessageId: assistantId,
          answer: finalSession.messages.find((message) => message.id === assistantId)?.content ?? "",
          createdAt: finalSession.updatedAt,
          activityEvents: finalSession.activityEvents,
          delegationSummary: finalSession.delegationSummary,
          agentsUsed: finalSession.agentsUsed,
          surfCalls: finalSession.surfCalls,
          echoCalls: finalSession.echoCalls,
        });
      }

      const currentBeforeFinalWrite = await readAppChatSession(sessionId);
      if (!asyncToolRunStillActive(currentBeforeFinalWrite, assistantId, cmoRunId)) {
        return;
      }
      finalSession = mergeAsyncToolRunFinalSession(currentBeforeFinalWrite, finalSession, assistantId);
      await writeJsonFile(sessionPath(sessionId), finalSession);
    };

    void completeAsyncHermesCmoToolRun().catch((error) => {
      console.warn("[cmo-app-chat] Async Hermes CMO tool run failed after pending response.", {
        appId: request.appId,
        sessionId,
        reason: error instanceof Error ? error.message : String(error),
      });
    });

    return {
      messageId: assistantId,
      sessionId,
      status: "pending",
      answer: pendingAnswer,
      assumptions: [],
      suggestedActions: [],
      contextUsed,
      missingContext,
      isDevelopmentFallback: false,
      isRuntimeFallback: false,
      runtimeStatus: "live",
      runtimeMode: "live",
      attemptedRuntimeMode: "live",
      runtimeLabel: "Hermes CMO async tool orchestration",
      runtimeProvider: "hermes",
      runtimeAgent: "cmo",
      productRenderSource: "hermes_cmo",
      hermesRequestSent: true,
      calledHermesCmo: true,
      hermesCmoStatus: "live",
      delegationsMode: HERMES_CMO_PROPOSALS_ONLY,
      cmoRunId,
      cmoRunStatus: "pending",
      cmoRunEndpoint: "/agents/cmo/tool-execute",
      cmoRunStartedAt: now,
      cmoRunTimeoutMs: asyncToolRunTimeoutMs,
      contextDiagnostics,
      contextQualitySummary,
      graphHints,
      graphHintCount,
      graphStatus,
      indexedContextStatus,
      indexedContextSourcesCount,
      ...(indexedContextFallbackReason ? { indexedContextFallbackReason } : {}),
      ...pendingTimingMetadata,
      decisionLayer: pendingDecisionLayer,
      rawCaptureStatus: "pending",
    };
  }

  if (hermesCmoChatV11Requested) {
    const hermesStartedAt = new Date().toISOString();
    const hermesStartedMs = Date.now();

    hermesCmoChatV11Attempted = true;
    const chatResult = await runHermesCmoChatV11({
      contextPack: contextPackage.contextPack,
      contextPackage,
      message: request.message,
      history: continuedSession?.messages ?? [],
      request,
      contextUsed,
      missingContext,
      sessionId,
      userMessageId: messageId,
      createdAt: now,
      userIdentity,
      sessionSummary,
      sessionArtifacts,
      vaultContext: contextPackage.contextPack.vaultAgentContextPack ?? null,
    });
    hermesRequestSent = true;
    liveAttemptStartedAt = hermesStartedAt;
    liveAttemptDurationMs = Date.now() - hermesStartedMs;
    calledHermesCmo = true;

    if (chatResult.ok) {
      const mappedChat = mapHermesCmoChatV11ToChatResult(chatResult.request, chatResult.response);
      creativeWorkingState = applySuggestedCreativeStateUpdate(
        creativeWorkingState,
        extractSuggestedCreativeStateUpdate(chatResult.response),
      );
      creativeDecision = extractCreativeDecision(chatResult.response) ?? creativeDecision;
      const chatCreativeArtifacts = [
        ...mappedChat.artifactsOut,
        ...creativeAssetsFromHermesPayload({
          response: { artifacts: mappedChat.artifactsOut },
          tenantId: requestTenantId,
          workspaceId: request.workspaceId,
          appId: request.appId,
          jobId: `creative_${messageId}`,
          createdAt: now,
        }),
      ];
      turnCreativeArtifacts = chatCreativeArtifacts;
      creativeWorkingState = applyCreativeAssetStateUpdate(creativeWorkingState, chatCreativeArtifacts);

      answer = mappedChat.answer;
      status = chatResult.response.status === "completed" ? "completed" : "failed";
      assumptions = mappedChat.assumptions;
      suggestedActions = mappedChat.suggestedActions;
      isDevelopmentFallback = mappedChat.isDevelopmentFallback;
      isRuntimeFallback = mappedChat.isRuntimeFallback === true;
      runtimeStatus = mappedChat.runtimeStatus;
      runtimeMode = mappedChat.runtimeMode ?? "live";
      attemptedRuntimeMode = "live";
      runtimeLabel = mappedChat.runtimeLabel;
      runtimeError = status === "failed" ? "Hermes CMO chat v1.1 returned failed status." : "";
      runtimeErrorReason = status === "failed" ? "execution_error" : undefined;
      runtimeProvider = mappedChat.runtimeProvider;
      runtimeAgent = mappedChat.runtimeAgent;
      fallbackDurationMs = undefined;
      timeoutMs = undefined;
      hermesCmoStatus = "live";
      hermesCmoCounters = mappedChat.metadata.counters;
      hermesCmoMetadata = {
        ...mappedChat.metadata,
        ...creativeStateMetadata(creativeWorkingState, creativeDecision),
      };
      activityEvents = hermesCmoMetadata.activityEvents;
      delegationSummary = hermesCmoMetadata.delegationSummary;
      agentsUsed = hermesCmoMetadata.agentsUsed;
      surfCalls = hermesCmoMetadata.surfCalls;
      echoCalls = hermesCmoMetadata.echoCalls;
      forbiddenCounters = hermesCmoMetadata.forbiddenCounters;
      delegationsMode = mappedChat.metadata.delegationsMode;
      productRenderSource = "hermes_cmo";
      sessionArtifacts = mergeHermesCmoChatV11Artifacts(sessionArtifacts, chatCreativeArtifacts);
      sessionSummary = mergeHermesCmoChatV11SessionSummary(sessionSummary, mappedChat.suggestedSessionSummaryUpdate);
      suggestedVaultUpdates = mergeSuggestedVaultUpdates(suggestedVaultUpdates, mappedChat.suggestedVaultUpdates);
      usedHermesCmoChat = true;
    } else {
      const reason = chatResult.fallbackReason;

      console.warn("[cmo-app-chat] Hermes CMO chat v1.1 failed.", {
        appId: request.appId,
        sessionId,
        reason,
        fallbackEligible: chatResult.fallbackEligible,
        fallbackEnabled: hermesCmoRoute.fallbackEnabled,
      });

      hermesCmoStatus = "failed_then_existing_fallback";
      hermesCmoErrorReason = reason;
      delegationsMode = HERMES_CMO_PROPOSALS_ONLY;

      const creativeWorkspaceFallbackSuppressed =
        hermesCmoNativeCreativeRequested ||
        /creative_(?:ideation|session|conversation|execution|response|metadata).*rejected_by_m1_validator=true|rejected_by_m1_validator=true.*answer_basis_mode=creative_/i.test(reason);

      if (chatResult.fallbackEligible && hermesCmoRoute.fallbackEnabled && !creativeWorkspaceFallbackSuppressed) {
        const fallbackStartedMs = Date.now();
        const fallbackTrace = fallbackHermesCmoChatV11Metadata(chatResult.request?.request_id ?? `req_cmo_chat_v11_${messageId}`, reason);
        const hermesAttachmentRefs = await cmoAttachmentsForHermes(turnAttachments);
        const hermesFallbackRequest = mapCmoChatToHermesCmoRequest({
          contextPack: contextPackage.contextPack,
          contextPackage,
          message: request.message,
          history: continuedSession?.messages ?? [],
          request,
          contextUsed,
          missingContext,
          sessionId,
          userMessageId: messageId,
          createdAt: now,
          userIdentity,
          inputMaterialAttachments: hermesAttachmentRefs,
          creativeWorkingState: creativeWorkingStateForHermes,
          creativeIdeationDetected,
          creativeSessionFollowupDetected,
          activeCreativeAssetResolutionSource: activeCreativeAssetResolution.source,
        });
        const hermesFallbackResult = await runHermesCmoRuntime(hermesFallbackRequest);
        sessionLocalResearchResults = mergeSessionLocalResearchResults(
          sessionLocalResearchResults,
          sessionLocalResearchResultFromHermesResult({
            hermesResult: hermesFallbackResult,
            tenantId: requestTenantId,
            workspaceId: request.workspaceId,
            appId: request.appId,
            userId: requestUserId,
            sessionId,
            turnId: messageId,
            createdAt: now,
            userQuestion: request.message,
          }),
        );
        const counterValidation = validateHermesCmoChatCounters(hermesFallbackResult);

        if (!counterValidation.ok) {
          throw new Error(counterValidation.errorReason ?? "invalid_counters_schema");
        }

        const mappedHermesFallbackResult = sanitizeHermesCmoMappedChatResult(mapHermesCmoResponseToChatResult(hermesFallbackResult));
        creativeWorkingState = applySuggestedCreativeStateUpdate(
          creativeWorkingState,
          extractSuggestedCreativeStateUpdate(hermesFallbackResult.response),
        );
        creativeDecision = extractCreativeDecision(hermesFallbackResult.response) ?? creativeDecision;
        const fallbackCreativeArtifacts = creativeAssetsFromHermesPayload({
          response: hermesFallbackResult.response,
          tenantId: requestTenantId,
          workspaceId: request.workspaceId,
          appId: request.appId,
          jobId: `creative_${messageId}`,
          createdAt: now,
        });
        turnCreativeArtifacts = fallbackCreativeArtifacts;
        creativeWorkingState = applyCreativeAssetStateUpdate(creativeWorkingState, fallbackCreativeArtifacts);
        sessionArtifacts = mergeHermesCmoChatV11Artifacts(
          sessionArtifacts,
          fallbackCreativeArtifacts,
        );

        answer = mappedHermesFallbackResult.answer;
        status = "completed";
        assumptions = mappedHermesFallbackResult.assumptions;
        suggestedActions = mappedHermesFallbackResult.suggestedActions;
        isDevelopmentFallback = mappedHermesFallbackResult.isDevelopmentFallback;
        isRuntimeFallback = true;
        runtimeStatus = "live_failed_then_fallback";
        runtimeMode = "fallback";
        attemptedRuntimeMode = "live";
        runtimeLabel = mappedHermesFallbackResult.runtimeLabel;
        runtimeError = reason;
        runtimeErrorReason = reason === "timeout" ? "timeout" : reason === "missing_answer_content" ? "empty_answer" : "invalid_response";
        runtimeProvider = mappedHermesFallbackResult.runtimeProvider;
        runtimeAgent = mappedHermesFallbackResult.runtimeAgent;
        fallbackDurationMs = Date.now() - fallbackStartedMs;
        routeDecision = normalizeRouteDecision(hermesFallbackResult.hermesCmoRouteDecision);
        productFallbackReason = reason;
        hermesCmoStatus = "failed_then_existing_fallback";
        hermesCmoCounters = mappedHermesFallbackResult.hermesCmoCounters;
        hermesCmoMetadata = {
          ...mappedHermesFallbackResult.hermesCmoMetadata,
          ...creativeStateMetadata(creativeWorkingState, creativeDecision),
          endpoint_kind: fallbackTrace.endpoint_kind,
          runtime_kind: fallbackTrace.runtime_kind,
          requested_endpoint: fallbackTrace.requested_endpoint,
          fallback_used: true,
          fallback_reason: reason,
          fallback_from: fallbackTrace.fallback_from,
          fallback_to: fallbackTrace.fallback_to,
          side_effects: mappedHermesFallbackResult.hermesCmoMetadata.side_effects ?? fallbackTrace.side_effects,
        };
        await writeHermesCmoChatV11FallbackTrace(chatResult.request, {
          fallbackReason: reason,
          fallbackResponse: hermesFallbackResult.response,
          sideEffects: hermesCmoMetadata.side_effects,
          artifactsOutCount: hermesCmoMetadata.artifacts_out_count,
          sessionSummaryUpdatePresent: hermesCmoMetadata.session_summary_update_present,
          suggestedVaultUpdatesCount: hermesCmoMetadata.suggested_vault_updates_count,
        });
        strategyMode = hermesCmoMetadata.strategyMode;
        mainBottleneck = hermesCmoMetadata.mainBottleneck;
        decisionLabel = hermesCmoMetadata.decisionLabel;
        currentStep = hermesCmoMetadata.currentStep;
        forbiddenCounters = hermesCmoMetadata.forbiddenCounters;
        activityEvents = hermesCmoMetadata.activityEvents;
        delegationSummary = hermesCmoMetadata.delegationSummary;
        agentsUsed = hermesCmoMetadata.agentsUsed;
        surfCalls = hermesCmoMetadata.surfCalls;
        echoCalls = hermesCmoMetadata.echoCalls;
        delegationsMode = mappedHermesFallbackResult.delegationsMode;
        productRenderSource = "fallback_after_hermes_failure";
        usedHermesCmoChat = true;
      } else if (creativeWorkspaceFallbackSuppressed) {
        const conversationDiagnostics = creativeConversationRejectionDiagnostics(reason);
        answer = safeBlockedUserVisibleAnswer(true);
        status = "failed";
        isDevelopmentFallback = false;
        isRuntimeFallback = false;
        runtimeStatus = "runtime_error";
        runtimeMode = "configured_but_unreachable";
        attemptedRuntimeMode = "live";
        runtimeLabel = "Hermes CMO Creative session";
        runtimeError = "Creative response was rejected by Product M1 validation.";
        runtimeErrorReason = "invalid_response";
        runtimeProvider = "hermes";
        runtimeAgent = "creative";
        fallbackDurationMs = undefined;
        const suppressedCreativeRouteDecision = hermesCmoRoute.reason === "creative_execution" || hermesCmoRoute.reason === "creative_ideation" || hermesCmoRoute.reason === "creative_session"
          ? hermesCmoRoute.reason
          : "creative_session";
        routeDecision = suppressedCreativeRouteDecision;
        productRenderSource = "hermes_cmo";
        productFallbackReason = undefined;
        hermesCmoStatus = "interrupted";
        hermesCmoErrorReason = reason;
        const suppressedCreativeFallbackMetadata: HermesCmoChatMetadata = {
          ...failedHermesCmoChatV11Metadata(chatResult.request?.request_id ?? `req_cmo_chat_v11_${messageId}`, reason),
          ...conversationDiagnostics,
          productRenderSource: "hermes_cmo",
          selectedHermesEndpoint: "/agents/cmo/chat",
          hermesEndpointKind: "agent_chat",
          endpoint_kind: "agent_chat",
          runtime_kind: "ai_agent",
          requested_endpoint: "/agents/cmo/chat",
          fallback_used: false,
          workspace_fallback_suppressed_for_creative: true,
          route_decision: suppressedCreativeRouteDecision,
          creative_session_followup_detected: creativeSessionFollowupDetected,
          creative_working_state_present: Boolean(creativeWorkingState),
          ...(activeCreativeAssetId ? { active_creative_asset_id: activeCreativeAssetId } : {}),
          ...(creativeAssetsCount > 0 ? { creative_assets_count: creativeAssetsCount } : {}),
          rejected_by_m1_validator: true,
          rejected_field: creativeM1RejectedField(reason) ?? "creative_native_response",
          user_visible_answer_guard_triggered: true,
          user_visible_answer_guard_reason: "creative_workspace_fallback_suppressed",
          agentsUsed: ["cmo", "creative"],
        };
        hermesCmoMetadata = suppressedCreativeFallbackMetadata;
        hermesCmoCounters = suppressedCreativeFallbackMetadata.counters;
        forbiddenCounters = suppressedCreativeFallbackMetadata.forbiddenCounters;
        activityEvents = suppressedCreativeFallbackMetadata.activityEvents;
        delegationSummary = suppressedCreativeFallbackMetadata.delegationSummary;
        agentsUsed = suppressedCreativeFallbackMetadata.agentsUsed;
        surfCalls = suppressedCreativeFallbackMetadata.surfCalls;
        echoCalls = suppressedCreativeFallbackMetadata.echoCalls;
        usedHermesCmoChat = true;
      } else {
        answer = [
          "Runtime boundary error: Hermes CMO chat v1.1 did not produce a usable answer.",
          reason,
          "Fallback to /agents/cmo/execute was disabled or not eligible for this failure.",
        ].join("\n");
        status = "failed";
        isDevelopmentFallback = false;
        isRuntimeFallback = false;
        runtimeStatus = "runtime_error";
        runtimeMode = "configured_but_unreachable";
        attemptedRuntimeMode = "live";
        runtimeLabel = "Hermes CMO chat v1.1";
        runtimeError = reason;
        runtimeErrorReason = reason === "timeout" ? "timeout" : reason === "missing_answer_content" ? "empty_answer" : "invalid_response";
        runtimeProvider = "hermes";
        runtimeAgent = "cmo";
        productRenderSource = "fallback_after_hermes_failure";
        productFallbackReason = reason;
        hermesCmoMetadata = failedHermesCmoChatV11Metadata(chatResult.request?.request_id ?? `req_cmo_chat_v11_${messageId}`, reason);
        hermesCmoCounters = hermesCmoMetadata.counters;
        forbiddenCounters = hermesCmoMetadata.forbiddenCounters;
        activityEvents = hermesCmoMetadata.activityEvents;
        delegationSummary = hermesCmoMetadata.delegationSummary;
        agentsUsed = hermesCmoMetadata.agentsUsed;
        surfCalls = hermesCmoMetadata.surfCalls;
        echoCalls = hermesCmoMetadata.echoCalls;
        usedHermesCmoChat = true;
      }
    }
  } else if (hermesCmoLegacyRequested) {
    const hermesStartedAt = new Date().toISOString();
    const hermesStartedMs = Date.now();

    try {
      const hermesAttachmentRefs = await cmoAttachmentsForHermes(turnAttachments);
      const hermesRequest = mapCmoChatToHermesCmoRequest({
        contextPack: contextPackage.contextPack,
        contextPackage,
        message: request.message,
        history: continuedSession?.messages ?? [],
        request,
        contextUsed,
        missingContext,
        sessionId,
        userMessageId: messageId,
        createdAt: now,
        userIdentity,
        inputMaterialAttachments: hermesAttachmentRefs,
        creativeWorkingState: creativeWorkingStateForHermes,
        creativeIdeationDetected,
        creativeSessionFollowupDetected,
        activeCreativeAssetResolutionSource: activeCreativeAssetResolution.source,
      });
      hermesRequestSent = true;
      const hermesResult = await runHermesCmoRuntime(hermesRequest);
      sessionLocalResearchResults = mergeSessionLocalResearchResults(
        sessionLocalResearchResults,
        sessionLocalResearchResultFromHermesResult({
          hermesResult,
          tenantId: requestTenantId,
          workspaceId: request.workspaceId,
          appId: request.appId,
          userId: requestUserId,
          sessionId,
          turnId: messageId,
          createdAt: now,
          userQuestion: request.message,
        }),
      );
      const creativeContractViolation = creativeContractViolationMetadata(hermesResult);
      const creativeArtifacts = creativeContractViolation ? [] : creativeAssetsFromHermesPayload({
        response: hermesResult.response,
        tenantId: requestTenantId,
        workspaceId: request.workspaceId,
        appId: request.appId,
        jobId: `creative_${messageId}`,
        createdAt: now,
      });
      const earlyUnifiedAgentAnswer = creativeContractViolation
        ? ""
        : hermesCmoAgentUsableAnswerText(hermesResult.response);
      const earlyCompletedUnifiedCmoAgentPersistState = !creativeContractViolation
        ? completedUnifiedCmoAgentPersistStateFromHermesResult({
            result: hermesResult,
            normalizedAnswer: earlyUnifiedAgentAnswer,
            creativeArtifacts,
          })
        : undefined;
      if (earlyCompletedUnifiedCmoAgentPersistState) {
        completedUnifiedCmoAgentAnswer = earlyCompletedUnifiedCmoAgentPersistState.normalizedHermesAnswer;
        completedUnifiedCmoAgentAnswerBasisMode = earlyCompletedUnifiedCmoAgentPersistState.answerBasisMode;
        completedUnifiedCmoAgentPersistState = earlyCompletedUnifiedCmoAgentPersistState;
        answer = earlyCompletedUnifiedCmoAgentPersistState.normalizedHermesAnswer;
        status = "completed";
        isDevelopmentFallback = false;
        isRuntimeFallback = false;
        runtimeStatus = "live";
        runtimeMode = "live";
        attemptedRuntimeMode = "live";
        runtimeError = "";
        runtimeErrorReason = undefined;
        productRenderSource = "hermes_cmo";
        productFallbackReason = undefined;
        calledHermesCmo = true;
        hermesRequestSent = true;
        hermesCmoStatus = "live";
        usedHermesCmoChat = true;
      }
      const counterValidation = validateHermesCmoChatCounters(hermesResult);

      if (!counterValidation.ok && !earlyCompletedUnifiedCmoAgentPersistState) {
        throw new Error(counterValidation.errorReason ?? "invalid_counters_schema");
      }

      const mappedHermesResult = sanitizeHermesCmoMappedChatResult(mapHermesCmoResponseToChatResult(hermesResult));
      if (!creativeContractViolation) {
        creativeWorkingState = applySuggestedCreativeStateUpdate(
          creativeWorkingState,
          extractSuggestedCreativeStateUpdate(hermesResult.response),
        );
        creativeDecision = extractCreativeDecision(hermesResult.response) ?? creativeDecision;
      }
      turnCreativeArtifacts = creativeArtifacts;
      creativeWorkingState = applyCreativeAssetStateUpdate(creativeWorkingState, creativeArtifacts);
      sessionArtifacts = mergeHermesCmoChatV11Artifacts(
        sessionArtifacts,
        creativeArtifacts,
      );
      answer = creativeContractViolation ? PRODUCT_CREATIVE_CONTRACT_VIOLATION_MESSAGE : mappedHermesResult.answer;
      const unifiedCurrentTurnTextAnswer = !creativeContractViolation && hermesUnifiedCmoAgentCurrentTurnTextAnswer({
        result: hermesResult,
        normalizedAnswer: answer,
        creativeArtifacts,
      });
      const hermesCreativeExecutionResponseReceived =
        !unifiedCurrentTurnTextAnswer && hermesResponseIndicatesCreativeExecution(hermesResult, creativeArtifacts);
      const currentTurnCreativeExecutionRequested =
        !unifiedCurrentTurnTextAnswer && hermesCmoCreativeExecutionRequested;
      currentTurnCreativeLongRunningTurn =
        !unifiedCurrentTurnTextAnswer && (hermesCmoCreativeLongRunningTurn || hermesCreativeExecutionResponseReceived);
      if (currentTurnCreativeExecutionRequested || hermesCreativeExecutionResponseReceived) {
        const structuredOutput = isRecord(hermesResult.response.structured_output) ? hermesResult.response.structured_output : {};
        creativeResponseReceived = true;
        const responseRecord = isRecord(hermesResult.response) ? hermesResult.response : {};
        const responseCreativeAssetsCount = numberFromRecords([responseRecord, structuredOutput], "creative_assets_count") ?? 0;
        creativeMetadataPresent = hasCreativeExecutionMetadata(hermesResult.response) || creativeArtifacts.length > 0 || responseCreativeAssetsCount > 0;
        creativeFallbackUsed = creativeMetadataPresent ? false : undefined;
        creativeSideEffectsPresent = typeof structuredOutput.side_effects_present === "boolean" ? structuredOutput.side_effects_present : undefined;
        creativeSideEffectsAllowedForCreative = typeof structuredOutput.side_effects_allowed_for_creative === "boolean" ? structuredOutput.side_effects_allowed_for_creative : undefined;
        creativeRejectedSideEffectType = normalizeOptionalString(structuredOutput.rejected_side_effect_type);
      }
      const unifiedAnswerBasis = recordValue(hermesResult.response.answer_basis) ?? {};
      const unifiedRoute = recordValue((hermesResult.response as unknown as Record<string, unknown>).route);
      const unifiedRouteKind = stringValue(unifiedRoute?.kind);
      const mappedCompletedUnifiedCmoAgentPersistState = completedUnifiedCmoAgentPersistStateFromHermesResult({
        result: hermesResult,
        normalizedAnswer: answer,
        creativeArtifacts,
      });
      if (
        mappedCompletedUnifiedCmoAgentPersistState &&
        (unifiedCurrentTurnTextAnswer || unifiedRouteKind === "cmo_agent" || unifiedRouteKind === "creative_execution") &&
        answer.trim()
      ) {
        completedUnifiedCmoAgentAnswer = answer;
        completedUnifiedCmoAgentAnswerBasisMode = stringValue(unifiedAnswerBasis.mode, "cmo_agent");
        completedUnifiedCmoAgentPersistState = mappedCompletedUnifiedCmoAgentPersistState;
      }
      if (
        !completedUnifiedCmoAgentAnswer &&
        (currentTurnCreativeExecutionRequested || hermesCreativeExecutionResponseReceived) &&
        creativeMetadataPresent === true &&
        !creativeArtifacts.length &&
        isGenericCreativeSuccessWithoutAssetAnswer(answer)
      ) {
        answer = creativeMissingRenderableAssetWarning();
      }
      status = "completed";
      assumptions = mappedHermesResult.assumptions;
      suggestedActions = mappedHermesResult.suggestedActions;
      isDevelopmentFallback = mappedHermesResult.isDevelopmentFallback;
      isRuntimeFallback = mappedHermesResult.isRuntimeFallback;
      runtimeStatus = mappedHermesResult.runtimeStatus;
      runtimeMode = mappedHermesResult.runtimeMode;
      attemptedRuntimeMode = "live";
      runtimeLabel = mappedHermesResult.runtimeLabel;
      runtimeError = "";
      runtimeErrorReason = undefined;
      runtimeProvider = mappedHermesResult.runtimeProvider;
      runtimeAgent = mappedHermesResult.runtimeAgent;
      liveAttemptStartedAt = hermesStartedAt;
      liveAttemptDurationMs = Date.now() - hermesStartedMs;
      fallbackDurationMs = undefined;
      timeoutMs = currentTurnCreativeLongRunningTurn ? hermesResult.hermesCmoEndpointTimeoutMs : undefined;
      outerTimeoutMs = currentTurnCreativeLongRunningTurn ? hermesResult.hermesCmoEndpointTimeoutMs : undefined;
      outerTimeoutSource = currentTurnCreativeLongRunningTurn ? "creative_execute" : undefined;
      routeDecision = normalizeRouteDecision(hermesResult.hermesCmoRouteDecision);
      calledHermesCmo = true;
      hermesCmoStatus = mappedHermesResult.hermesCmoStatus;
      hermesCmoCounters = mappedHermesResult.hermesCmoCounters;
      hermesCmoMetadata = {
        ...mappedHermesResult.hermesCmoMetadata,
        ...(creativeContractViolation ?? {}),
      };
      hermesCmoMetadata = {
        ...hermesCmoMetadata,
        ...creativeStateMetadata(creativeWorkingState, creativeDecision),
      };
      strategyMode = hermesCmoMetadata.strategyMode;
      mainBottleneck = hermesCmoMetadata.mainBottleneck;
      decisionLabel = hermesCmoMetadata.decisionLabel;
      currentStep = hermesCmoMetadata.currentStep;
      activityEvents = hermesCmoMetadata.activityEvents;
      delegationSummary = hermesCmoMetadata.delegationSummary;
      agentsUsed = hermesCmoMetadata.agentsUsed;
      surfCalls = hermesCmoMetadata.surfCalls;
      echoCalls = hermesCmoMetadata.echoCalls;
      forbiddenCounters = hermesCmoMetadata.forbiddenCounters;
      delegationsMode = mappedHermesResult.delegationsMode;
      productRenderSource = "hermes_cmo";
      usedHermesCmoChat = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Hermes CMO chat runtime failed.";
      const productOutboundCreativeContextBlocked = hermesCmoNativeCreativeRequested && isProductOutboundCreativeContextBlock(reason);
      const creativeTimeout = hermesCmoCreativeLongRunningTurn && isTimedOutHermesError(reason);
      const m1RejectedField = hermesCmoNativeCreativeRequested ? creativeM1RejectedField(reason) : undefined;
      const sideEffectRejectedType = hermesCmoNativeCreativeRequested ? parseCreativeRejectedSideEffectType(reason) : undefined;
      const creativeValidationRejected = Boolean(m1RejectedField);
      const creativeIdeationValidationRejected = isCreativeIdeationM1Rejection(reason);
      const creativeSideEffectRejected = Boolean(sideEffectRejectedType);

      console.warn(
        productOutboundCreativeContextBlocked
          ? "[cmo-app-chat] Product blocked Hermes CMO Creative outbound payload; no workspace fallback used."
        : creativeTimeout
          ? "[cmo-app-chat] Hermes CMO Creative execution timed out."
          : creativeValidationRejected
            ? "[cmo-app-chat] Hermes CMO Creative metadata was rejected by M1 validation; no workspace fallback used."
            : creativeSideEffectRejected
              ? "[cmo-app-chat] Hermes CMO Creative side effects were rejected; no workspace fallback used."
            : "[cmo-app-chat] Hermes CMO chat failed; using existing CMO chat path.",
        {
        appId: request.appId,
        sessionId,
        reason,
        creativeExecutionRequested: hermesCmoCreativeExecutionRequested,
        creativeLongRunningTurn: hermesCmoCreativeLongRunningTurn,
        routeDecision: hermesCmoRoute.reason,
        activeCreativeAssetId,
        creativeAssetsCount,
        ...(m1RejectedField ? { rejected_field: m1RejectedField } : {}),
        ...(sideEffectRejectedType ? { rejected_side_effect_type: sideEffectRejectedType } : {}),
      });

      calledHermesCmo = true;
      liveAttemptStartedAt = hermesStartedAt;
      liveAttemptDurationMs = Date.now() - hermesStartedMs;

      if (completedUnifiedCmoAgentPersistState) {
        answer = completedUnifiedCmoAgentPersistState.normalizedHermesAnswer;
        status = "completed";
        assumptions = [];
        suggestedActions = [];
        isDevelopmentFallback = false;
        isRuntimeFallback = false;
        runtimeStatus = "live";
        runtimeMode = "live";
        attemptedRuntimeMode = "live";
        runtimeLabel = "Hermes CMO Agent";
        runtimeError = "";
        runtimeErrorReason = undefined;
        runtimeProvider = "hermes";
        runtimeAgent = "cmo";
        fallbackDurationMs = undefined;
        timeoutMs = undefined;
        outerTimeoutMs = undefined;
        outerTimeoutSource = undefined;
        routeDecision = "cmo_agent";
        productRenderSource = "hermes_cmo";
        productFallbackReason = undefined;
        hermesCmoStatus = "live";
        hermesCmoErrorReason = undefined;
        currentTurnCreativeLongRunningTurn = false;
        creativeExecutionRequested = undefined;
        creativeResponseReceived = undefined;
        creativeMetadataPresent = undefined;
        creativeFallbackUsed = undefined;
        hermesCmoMetadata = completedUnifiedCmoAgentMetadata(hermesCmoMetadata, completedUnifiedCmoAgentPersistState);
        hermesCmoCounters = hermesCmoMetadata.counters;
        forbiddenCounters = hermesCmoMetadata.forbiddenCounters;
        activityEvents = hermesCmoMetadata.activityEvents;
        delegationSummary = hermesCmoMetadata.delegationSummary;
        agentsUsed = hermesCmoMetadata.agentsUsed;
        surfCalls = hermesCmoMetadata.surfCalls;
        echoCalls = hermesCmoMetadata.echoCalls;
        usedHermesCmoChat = true;
      } else if (productOutboundCreativeContextBlocked) {
        answer = PRODUCT_OUTBOUND_CREATIVE_CONTEXT_BLOCKED_MESSAGE;
        status = "failed";
        assumptions = [];
        suggestedActions = [];
        isDevelopmentFallback = false;
        isRuntimeFallback = false;
        runtimeStatus = "runtime_error";
        runtimeMode = "configured_but_unreachable";
        attemptedRuntimeMode = "live";
        runtimeLabel = "Product Creative outbound guard";
        runtimeError = PRODUCT_OUTBOUND_CREATIVE_CONTEXT_BLOCKED_MESSAGE;
        runtimeErrorReason = "invalid_response";
        runtimeProvider = "product";
        runtimeAgent = "creative";
        fallbackDurationMs = undefined;
        hermesRequestSent = false;
        routeDecision = normalizeRouteDecision(hermesCmoRoute.reason);
        const creativeRouteDecision = hermesCmoRoute.reason === "creative_session" || hermesCmoRoute.reason === "creative_ideation" || hermesCmoRoute.reason === "creative_execution"
          ? hermesCmoRoute.reason
          : "creative_session";
        creativeExecutionRequested = hermesCmoCreativeExecutionRequested ? true : undefined;
        creativeFallbackUsed = false;
        hermesCmoStatus = "interrupted";
        hermesCmoErrorReason = reason;
        delegationsMode = HERMES_CMO_PROPOSALS_ONLY;
        productRenderSource = "hermes_cmo";
        productFallbackReason = undefined;
        hermesCmoMetadata = {
          ...failedHermesCmoChatV11Metadata(`req_cmo_creative_${messageId}`, reason),
          productRenderSource: "hermes_cmo",
          selectedHermesEndpoint: "/agents/cmo/execute",
          hermesEndpointKind: "execute",
          endpoint_kind: "execute",
          runtime_kind: "ai_agent",
          requested_endpoint: "/agents/cmo/execute",
          fallback_used: false,
          workspace_fallback_suppressed_for_creative: true,
          route_decision: creativeRouteDecision,
          creative_long_running_turn: hermesCmoCreativeLongRunningTurn,
          product_outbound_payload_blocked: true,
          outbound_hermes_payload_path_like_blocked: true,
          outbound_callsite_guard_version: OUTBOUND_HERMES_CALLSITE_GUARD_VERSION,
          outbound_callsite_guard_checked: true,
          outbound_callsite_guard_blocked: true,
          ...(hermesCmoCreativeExecutionRequested ? { creative_execution_requested: true } : {}),
          ...(creativeIdeationDetected ? { creative_ideation_detected: true } : {}),
          ...(creativeSessionFollowupDetected ? { creative_session_followup_detected: true, creative_working_state_present: Boolean(creativeWorkingState) } : {}),
          ...(activeCreativeAssetId ? { active_creative_asset_id: activeCreativeAssetId } : {}),
          ...(creativeAssetsCount > 0 ? { creative_assets_count: creativeAssetsCount } : {}),
          ...(activeCreativeAssetResolution.asset ? { reference_assets_count: 1 } : {}),
          artifact_transport_mode: "product_upload",
          agentsUsed: ["cmo", "creative"],
        };
        hermesCmoCounters = hermesCmoMetadata!.counters;
        forbiddenCounters = hermesCmoMetadata!.forbiddenCounters;
        activityEvents = hermesCmoMetadata!.activityEvents;
        delegationSummary = hermesCmoMetadata!.delegationSummary;
        agentsUsed = hermesCmoMetadata!.agentsUsed;
        surfCalls = hermesCmoMetadata!.surfCalls;
        echoCalls = hermesCmoMetadata!.echoCalls;
        usedHermesCmoChat = true;
      } else if (creativeTimeout) {
        const creativeTimeoutMs = getCmoHermesCreativeExecuteTimeoutMs();
        const creativeTimeoutEvent: HermesCmoActivityEventSummary = {
          eventId: `evt_${messageId}_creative_timeout`,
          type: "creative.failed",
          status: "timed_out",
          message: `Creative execution timed out after ${creativeTimeoutMs}ms before Hermes returned image metadata.`,
          userVisible: true,
          sourceAgent: "creative",
          sourceMode: "creative.generate_image",
        };

        answer = "";
        status = "failed";
        assumptions = [];
        suggestedActions = [];
        isDevelopmentFallback = false;
        isRuntimeFallback = false;
        runtimeStatus = "runtime_error";
        runtimeMode = "configured_but_unreachable";
        attemptedRuntimeMode = "live";
        runtimeLabel = "Hermes CMO Creative execution";
        runtimeError = "Creative execution timed out before Hermes returned asset metadata.";
        runtimeErrorReason = "timeout";
        runtimeProvider = "hermes";
        runtimeAgent = "creative";
        fallbackDurationMs = undefined;
        timeoutMs = creativeTimeoutMs;
        outerTimeoutMs = creativeTimeoutMs;
        outerTimeoutSource = "creative_execute";
        routeDecision = normalizeRouteDecision(hermesCmoRoute.reason) ?? "creative_execution";
        creativeExecutionRequested = hermesCmoCreativeExecutionRequested ? true : undefined;
        hermesCmoStatus = "interrupted";
        hermesCmoErrorReason = reason;
        delegationsMode = HERMES_CMO_PROPOSALS_ONLY;
        productRenderSource = "hermes_cmo";
        productFallbackReason = undefined;
        const creativeRouteDecision = hermesCmoRoute.reason === "creative_session" || hermesCmoRoute.reason === "creative_ideation" || hermesCmoRoute.reason === "creative_execution"
          ? hermesCmoRoute.reason
          : "creative_execution";
        hermesCmoMetadata = {
          ...failedHermesCmoChatV11Metadata(`req_cmo_creative_${messageId}`, reason),
          productRenderSource: "hermes_cmo",
          selectedHermesEndpoint: "/agents/cmo/execute",
          hermesEndpointKind: "execute",
          endpoint_kind: "execute",
          runtime_kind: "ai_agent",
          requested_endpoint: "/agents/cmo/execute",
          fallback_used: false,
          workspace_fallback_suppressed_for_creative: true,
          hermesEndpointTimeoutMs: creativeTimeoutMs,
          hermesEndpointTimeoutSource: "creative_execute",
          timeout_source: "creative_execute",
          outer_timeout_source: "creative_execute",
          route_decision: creativeRouteDecision,
          creative_long_running_turn: true,
          creative_timeout_ms: creativeTimeoutMs,
          ...(hermesCmoCreativeExecutionRequested ? { creative_execution_requested: true } : {}),
          ...(creativeSessionFollowupDetected ? { creative_session_followup_detected: true, creative_working_state_present: Boolean(creativeWorkingState) } : {}),
          ...(activeCreativeAssetId ? { active_creative_asset_id: activeCreativeAssetId } : {}),
          ...(creativeAssetsCount > 0 ? { creative_assets_count: creativeAssetsCount } : {}),
          ...(activeCreativeAssetResolution.asset ? { reference_assets_count: 1 } : {}),
          artifact_transport_mode: "product_upload",
          agentsUsed: ["cmo", "creative"],
          activityEventsCount: 1,
          activityEvents: [creativeTimeoutEvent],
        };
        hermesCmoCounters = hermesCmoMetadata!.counters;
        forbiddenCounters = hermesCmoMetadata!.forbiddenCounters;
        activityEvents = hermesCmoMetadata!.activityEvents;
        delegationSummary = hermesCmoMetadata!.delegationSummary;
        agentsUsed = hermesCmoMetadata!.agentsUsed;
        surfCalls = hermesCmoMetadata!.surfCalls;
        echoCalls = hermesCmoMetadata!.echoCalls;
        usedHermesCmoChat = true;
      } else if (creativeSideEffectRejected) {
        const creativeTimeoutMs = getCmoHermesCreativeExecuteTimeoutMs();

        answer = "";
        status = "failed";
        assumptions = [];
        suggestedActions = [];
        isDevelopmentFallback = false;
        isRuntimeFallback = false;
        runtimeStatus = "runtime_error";
        runtimeMode = "configured_but_unreachable";
        attemptedRuntimeMode = "live";
        runtimeLabel = "Hermes CMO Creative execution";
        runtimeError = "Creative side effects were rejected by Product M1 validation.";
        runtimeErrorReason = "invalid_response";
        runtimeProvider = "hermes";
        runtimeAgent = "creative";
        fallbackDurationMs = undefined;
        timeoutMs = creativeTimeoutMs;
        outerTimeoutMs = creativeTimeoutMs;
        outerTimeoutSource = "creative_execute";
        routeDecision = "creative_execution";
        creativeExecutionRequested = true;
        creativeResponseReceived = true;
        creativeMetadataPresent = true;
        creativeSideEffectsPresent = true;
        creativeSideEffectsAllowedForCreative = false;
        creativeRejectedSideEffectType = sideEffectRejectedType;
        creativeFallbackUsed = false;
        hermesCmoStatus = "interrupted";
        hermesCmoErrorReason = reason;
        delegationsMode = HERMES_CMO_PROPOSALS_ONLY;
        productRenderSource = "hermes_cmo";
        productFallbackReason = undefined;
        hermesCmoMetadata = {
          ...failedHermesCmoChatV11Metadata(`req_cmo_creative_${messageId}`, reason),
          productRenderSource: "hermes_cmo",
          selectedHermesEndpoint: "/agents/cmo/execute",
          hermesEndpointKind: "execute",
          endpoint_kind: "execute",
          runtime_kind: "ai_agent",
          requested_endpoint: "/agents/cmo/execute",
          fallback_used: false,
          route_decision: "creative_execution",
          creative_execution_requested: true,
          creative_response_received: true,
          creative_metadata_present: true,
          side_effects_present: true,
          side_effects_allowed_for_creative: false,
          rejected_side_effect_type: sideEffectRejectedType,
          agentsUsed: ["cmo", "creative"],
        };
        hermesCmoCounters = hermesCmoMetadata.counters;
        forbiddenCounters = hermesCmoMetadata.forbiddenCounters;
        activityEvents = hermesCmoMetadata.activityEvents;
        delegationSummary = hermesCmoMetadata.delegationSummary;
        agentsUsed = hermesCmoMetadata.agentsUsed;
        surfCalls = hermesCmoMetadata.surfCalls;
        echoCalls = hermesCmoMetadata.echoCalls;
        usedHermesCmoChat = true;
      } else if (creativeValidationRejected) {
        const creativeConversationValidationRejected = /creative_conversation_response_received=true|answer_basis_mode=creative_conversation/i.test(reason);
        const creativeSessionValidationRejected = /creative_session_response_received=true|answer_basis_mode=creative_(?:session|refinement)/i.test(reason);
        const validationLabel = creativeConversationValidationRejected ? "Creative conversation" : creativeSessionValidationRejected ? "Creative session" : creativeIdeationValidationRejected ? "Creative ideation" : "Creative execution";
        const validationRouteDecision = /creative_session_response_received=true|creative_conversation_response_received=true|answer_basis_mode=creative_(?:session|refinement|conversation)/i.test(reason)
          ? "creative_session"
          : creativeIdeationValidationRejected ? "creative_ideation" : "creative_execution";

        answer = "";
        status = "failed";
        assumptions = [];
        suggestedActions = [];
        isDevelopmentFallback = false;
        isRuntimeFallback = false;
        runtimeStatus = "runtime_error";
        runtimeMode = "configured_but_unreachable";
        attemptedRuntimeMode = "live";
        runtimeLabel = `Hermes CMO ${validationLabel}`;
        runtimeError = `${validationLabel} response was rejected by Product M1 validation.`;
        runtimeErrorReason = "invalid_response";
        runtimeProvider = "hermes";
        runtimeAgent = "creative";
        fallbackDurationMs = undefined;
        timeoutMs = getCmoHermesCreativeExecuteTimeoutMs();
        outerTimeoutMs = getCmoHermesCreativeExecuteTimeoutMs();
        outerTimeoutSource = "creative_execute";
        routeDecision = validationRouteDecision;
        creativeExecutionRequested = !creativeIdeationValidationRejected && !creativeSessionValidationRejected && !creativeConversationValidationRejected;
        creativeResponseReceived = !creativeIdeationValidationRejected && !creativeSessionValidationRejected && !creativeConversationValidationRejected;
        creativeMetadataPresent = !creativeIdeationValidationRejected && !creativeSessionValidationRejected && !creativeConversationValidationRejected;
        creativeRejectedByM1Validator = true;
        creativeRejectedField = m1RejectedField;
        creativeFallbackUsed = false;
        hermesCmoStatus = "interrupted";
        hermesCmoErrorReason = reason;
        delegationsMode = HERMES_CMO_PROPOSALS_ONLY;
        productRenderSource = "hermes_cmo";
        productFallbackReason = undefined;
        hermesCmoMetadata = {
          ...failedHermesCmoChatV11Metadata(`req_cmo_creative_${messageId}`, reason),
          productRenderSource: "hermes_cmo",
          selectedHermesEndpoint: "/agents/cmo/execute",
          hermesEndpointKind: "execute",
          endpoint_kind: "execute",
          runtime_kind: "ai_agent",
          requested_endpoint: "/agents/cmo/execute",
          fallback_used: false,
          route_decision: validationRouteDecision,
          ...(creativeIdeationValidationRejected
            ? { creative_ideation_response_received: true }
            : creativeConversationValidationRejected
              ? { creative_conversation_response_received: true }
            : creativeSessionValidationRejected
              ? { creative_session_response_received: true }
            : {
                creative_execution_requested: true,
                creative_response_received: true,
                creative_metadata_present: true,
              }),
          rejected_by_m1_validator: true,
          rejected_field: m1RejectedField,
          agentsUsed: ["cmo", "creative"],
        };
        hermesCmoCounters = hermesCmoMetadata.counters;
        forbiddenCounters = hermesCmoMetadata.forbiddenCounters;
        activityEvents = hermesCmoMetadata.activityEvents;
        delegationSummary = hermesCmoMetadata.delegationSummary;
        agentsUsed = hermesCmoMetadata.agentsUsed;
        surfCalls = hermesCmoMetadata.surfCalls;
        echoCalls = hermesCmoMetadata.echoCalls;
        usedHermesCmoChat = true;
      } else if (hermesCmoNativeCreativeRequested) {
        const creativeTimeoutMs = hermesCmoCreativeLongRunningTurn ? getCmoHermesCreativeExecuteTimeoutMs() : undefined;

        answer = "";
        status = "failed";
        assumptions = [];
        suggestedActions = [];
        isDevelopmentFallback = false;
        isRuntimeFallback = false;
        runtimeStatus = "runtime_error";
        runtimeMode = "configured_but_unreachable";
        attemptedRuntimeMode = "live";
        runtimeLabel = "Hermes CMO Creative session";
        runtimeError = "Hermes CMO Creative session did not produce a usable response.";
        runtimeErrorReason = isTimedOutHermesError(reason) ? "timeout" : "execution_error";
        runtimeProvider = "hermes";
        runtimeAgent = "creative";
        fallbackDurationMs = undefined;
        timeoutMs = creativeTimeoutMs;
        outerTimeoutMs = creativeTimeoutMs;
        outerTimeoutSource = hermesCmoCreativeLongRunningTurn ? "creative_execute" : undefined;
        routeDecision = normalizeRouteDecision(hermesCmoRoute.reason);
        const creativeRouteDecision = hermesCmoRoute.reason === "creative_session" || hermesCmoRoute.reason === "creative_ideation" || hermesCmoRoute.reason === "creative_execution"
          ? hermesCmoRoute.reason
          : "creative_execution";
        creativeExecutionRequested = hermesCmoCreativeExecutionRequested ? true : undefined;
        creativeFallbackUsed = false;
        hermesCmoStatus = "interrupted";
        hermesCmoErrorReason = reason;
        delegationsMode = HERMES_CMO_PROPOSALS_ONLY;
        productRenderSource = "hermes_cmo";
        productFallbackReason = undefined;
        hermesCmoMetadata = {
          ...failedHermesCmoChatV11Metadata(`req_cmo_creative_${messageId}`, reason),
          productRenderSource: "hermes_cmo",
          selectedHermesEndpoint: "/agents/cmo/execute",
          hermesEndpointKind: "execute",
          endpoint_kind: "execute",
          runtime_kind: "ai_agent",
          requested_endpoint: "/agents/cmo/execute",
          fallback_used: false,
          workspace_fallback_suppressed_for_creative: true,
          ...(typeof creativeTimeoutMs === "number" ? { hermesEndpointTimeoutMs: creativeTimeoutMs, creative_timeout_ms: creativeTimeoutMs } : {}),
          ...(hermesCmoCreativeLongRunningTurn ? { hermesEndpointTimeoutSource: "creative_execute", timeout_source: "creative_execute", outer_timeout_source: "creative_execute" } : {}),
          route_decision: creativeRouteDecision,
          creative_long_running_turn: hermesCmoCreativeLongRunningTurn,
          ...(hermesCmoCreativeExecutionRequested ? { creative_execution_requested: true } : {}),
          ...(creativeIdeationDetected ? { creative_ideation_detected: true } : {}),
          ...(creativeSessionFollowupDetected ? { creative_session_followup_detected: true, creative_working_state_present: Boolean(creativeWorkingState) } : {}),
          ...(activeCreativeAssetId ? { active_creative_asset_id: activeCreativeAssetId } : {}),
          ...(creativeAssetsCount > 0 ? { creative_assets_count: creativeAssetsCount } : {}),
          ...(activeCreativeAssetResolution.asset ? { reference_assets_count: 1 } : {}),
          artifact_transport_mode: "product_upload",
          agentsUsed: ["cmo", "creative"],
        };
        hermesCmoCounters = hermesCmoMetadata!.counters;
        forbiddenCounters = hermesCmoMetadata!.forbiddenCounters;
        activityEvents = hermesCmoMetadata!.activityEvents;
        delegationSummary = hermesCmoMetadata!.delegationSummary;
        agentsUsed = hermesCmoMetadata!.agentsUsed;
        surfCalls = hermesCmoMetadata!.surfCalls;
        echoCalls = hermesCmoMetadata!.echoCalls;
        usedHermesCmoChat = true;
      } else {
        hermesCmoStatus = reason.startsWith("forbidden_counter_non_zero:") || reason.startsWith("invalid_counters_schema:")
          ? "guardrail_violation_then_existing_fallback"
          : "failed_then_existing_fallback";
        hermesCmoErrorReason = reason;
        productFallbackReason = reason;
        delegationsMode = HERMES_CMO_PROPOSALS_ONLY;
      }
    }
  }

  if (!usedHermesCmoChat) {
  productRenderSource = hermesCmoChatRequested ? "fallback_after_hermes_failure" : undefined;
  productFallbackReason = hermesCmoChatRequested
    ? productFallbackReason ?? "Hermes CMO was unavailable or invalid; CMO Engine used explicit fallback."
    : request.forceFallback
      ? "Live app-chat intentionally bypassed for fallback smoke."
      : undefined;
  const routeIntent = routeIntentForMessage(request.message);
  const hasSourceReviewContext = Boolean(activeSourceReviewContext);
  const allowDirectSurfBridge = routeIntent === "surf_x" || routeIntent === "surf_trend" || routeIntent === "surf_research";
  const allowDirectEchoBridge = routeIntent === "echo_execution";
  const surfBridge = allowDirectSurfBridge ? await maybeHandleSurfBridge(request) : { handled: false };
  const echoBridge = !surfBridge.handled && allowDirectEchoBridge ? await maybeHandleEchoBridge(request) : { handled: false };
  const mixedCmoEchoRequest = !surfBridge.handled && !echoBridge.handled && routeIntent !== "cmo_review" && isMixedCmoEchoRequest(request.message);
  const mixedCmoEchoClarification = mixedCmoEchoRequest && mixedEchoNeedsClarification(request.message);
  const cmoSurfEvidence = !hasSourceReviewContext && !surfBridge.handled && !echoBridge.handled && !mixedCmoEchoRequest && routeIntent !== "cmo_review" ? await executeCmoSurfEvidence(request) : undefined;
  const cmoSurfClarification = cmoSurfEvidence?.plan.action === "need_clarification";

  try {
    if ((surfBridge.handled && surfBridge.response) || (echoBridge.handled && echoBridge.response)) {
      const bridgeResponse = surfBridge.handled && surfBridge.response ? surfBridge.response : echoBridge.response;
      if (!bridgeResponse) {
        throw new Error("Hermes bridge handled the request without a response payload");
      }
      answer = bridgeResponse.answer;
      assumptions = bridgeResponse.assumptions;
      suggestedActions = bridgeResponse.suggestedActions;
      isDevelopmentFallback = false;
      isRuntimeFallback = bridgeResponse.isRuntimeFallback === true;
      runtimeStatus = bridgeResponse.isRuntimeFallback ? "live_failed_then_fallback" : "live";
      runtimeMode = bridgeResponse.isRuntimeFallback ? "fallback" : "live";
      attemptedRuntimeMode = bridgeResponse.isRuntimeFallback ? "live" : undefined;
      runtimeLabel = surfBridge.handled ? "Hermes Surf Direct Bridge" : "Hermes Echo Execution Bridge";
      runtimeError = bridgeResponse.runtimeError ?? "";
      runtimeErrorReason = bridgeResponse.runtimeError ? "execution_error" : undefined;
      runtimeProvider = bridgeResponse.runtimeProvider;
      runtimeAgent = bridgeResponse.runtimeAgent;
      productRenderSource = hermesCmoChatRequested ? "fallback_after_hermes_failure" : "direct_bridge";
      status = "completed";
    } else {
    const fallbackContextPackage = sourceReviewContext
      ? {
          ...contextPackage,
          sourceReviewContext,
          contextPack: {
            ...contextPackage.contextPack,
            sourceReviewContext,
          },
        }
      : contextPackage;
    const runtimeResult = await runtime.runTurn({
      contextPack: fallbackContextPackage.contextPack,
      contextPackage: fallbackContextPackage,
      message: mixedCmoEchoRequest && !mixedCmoEchoClarification
        ? buildMixedCmoEchoRuntimeMessage(request.message)
        : cmoSurfEvidence && (cmoSurfEvidence.plan.action === "call_surf" || cmoSurfEvidence.plan.action === "call_surf_x")
          ? buildCmoEvidenceRuntimeMessage(request.message, cmoSurfEvidence)
          : request.message,
      history: continuedSession?.messages ?? [],
      request,
      contextUsed,
      missingContext,
      vaultAgentContextPackStatus: vaultAgentContextPackMetadata?.context_pack_status,
      runtimeContext,
    });

    answer = runtimeResult.answer;
    assumptions = runtimeResult.assumptions;
    suggestedActions = runtimeResult.suggestedActions;
    isDevelopmentFallback = runtimeResult.isDevelopmentFallback;
    isRuntimeFallback = runtimeResult.isRuntimeFallback === true;
    runtimeStatus = runtimeResult.runtimeStatus;
    runtimeMode = runtimeResult.runtimeMode;
    attemptedRuntimeMode = runtimeResult.attemptedRuntimeMode;
    runtimeLabel = runtimeResult.runtimeLabel;
    runtimeError = runtimeResult.runtimeError ?? "";
    runtimeErrorReason = runtimeResult.runtimeErrorReason;
    runtimeProvider = runtimeResult.runtimeProvider;
    runtimeAgent = runtimeResult.runtimeAgent;
    productRenderSource = hermesCmoChatRequested
      ? "fallback_after_hermes_failure"
      : runtimeResult.isRuntimeFallback
        ? "local_runtime_fallback"
        : "legacy_cmo_engine";
    liveAttemptStartedAt = runtimeResult.liveAttemptStartedAt;
    liveAttemptDurationMs = runtimeResult.liveAttemptDurationMs;
    fallbackDurationMs = runtimeResult.fallbackDurationMs;
    timeoutMs = runtimeResult.timeoutMs;
    outerTimeoutMs = runtimeResult.outerTimeoutMs;
    outerTimeoutSource = runtimeResult.outerTimeoutSource;
    routeDecision = runtimeResult.routeDecision;
    creativeExecutionRequested = runtimeResult.creativeExecutionRequested === true ? true : undefined;
    if (runtimeResult.creativeExecutionRequested === true || runtimeResult.routeDecision === "creative_execution") {
      creativeResponseReceived = runtimeResult.rawRuntimeResponse !== undefined;
      try {
        const creativeArtifacts = runtimeResult.rawRuntimeResponse === undefined
          ? []
          : creativeAssetsFromHermesPayload({
              response: runtimeResult.rawRuntimeResponse,
              tenantId: requestTenantId,
              workspaceId: request.workspaceId,
              appId: request.appId,
              jobId: `creative_${messageId}`,
              createdAt: now,
            });

        creativeMetadataPresent = runtimeResult.rawRuntimeResponse !== undefined &&
          (hasCreativeExecutionMetadata(runtimeResult.rawRuntimeResponse) || creativeArtifacts.length > 0);
        if (creativeArtifacts.length) {
          turnCreativeArtifacts = creativeArtifacts;
          creativeWorkingState = applyCreativeAssetStateUpdate(creativeWorkingState, creativeArtifacts);
          sessionArtifacts = mergeHermesCmoChatV11Artifacts(sessionArtifacts, creativeArtifacts);
        }
        if (creativeMetadataPresent) {
          calledHermesCmo = true;
          hermesRequestSent = true;
          productRenderSource = "hermes_cmo";
          productFallbackReason = undefined;
          isDevelopmentFallback = false;
          isRuntimeFallback = false;
          runtimeStatus = "live";
          runtimeMode = "live";
          runtimeError = "";
          runtimeErrorReason = undefined;
          runtimeProvider = runtimeProvider ?? "hermes";
          runtimeAgent = "creative";
          creativeFallbackUsed = false;
        }
        if (
          creativeMetadataPresent === true &&
          !creativeArtifacts.length &&
          isGenericCreativeSuccessWithoutAssetAnswer(answer)
        ) {
          answer = creativeMissingRenderableAssetWarning();
        }
      } catch (error) {
        creativeNormalizationError = error instanceof Error ? error.message : "Creative response normalization failed.";
        creativeMetadataPresent = runtimeResult.rawRuntimeResponse === undefined ? false : hasCreativeExecutionMetadata(runtimeResult.rawRuntimeResponse);
        creativeFallbackUsed = creativeMetadataPresent ? false : undefined;
        console.warn("[cmo-app-chat] Creative response normalization failed.", {
          appId: request.appId,
          sessionId,
          creative_response_received: creativeResponseReceived === true,
          creative_metadata_present: creativeMetadataPresent === true,
          normalization_error: creativeNormalizationError,
          fallback_used: creativeFallbackUsed,
        });
      }
    }
    if (cmoSurfClarification) {
      answer = [
        "## Need Clarification",
        "",
        "I can make the CMO decision, but key decision context is missing. Surf was not called yet.",
        "",
        ...((cmoSurfEvidence?.plan.clarificationQuestions ?? []).map((question) => `- ${question}`)),
      ].join("\n");
      assumptions = [];
      suggestedActions = [{ type: "clarification", label: "Provide decision-critical context before CMO calls Surf." }];
      runtimeProvider = "dashboard";
      runtimeAgent = "cmo";
      productRenderSource = hermesCmoChatRequested ? "fallback_after_hermes_failure" : "legacy_cmo_engine";
      isRuntimeFallback = false;
      runtimeError = "";
      runtimeErrorReason = undefined;
    } else if (mixedCmoEchoClarification) {
      answer = [
        "## Need Clarification",
        "",
        "I can run CMO-led strategy first and then use Echo for final copy, but this request says key goal/source/audience/context is unclear.",
        "",
        "Please provide the missing goal, source/context, target audience, or campaign direction. Echo was not called.",
      ].join("\n");
      assumptions = [];
      suggestedActions = [{ type: "clarification", label: "Provide the missing context before CMO orchestrates Echo." }];
      runtimeProvider = "dashboard";
      runtimeAgent = "cmo";
      productRenderSource = hermesCmoChatRequested ? "fallback_after_hermes_failure" : "legacy_cmo_engine";
      isRuntimeFallback = false;
      runtimeError = "";
      runtimeErrorReason = undefined;
    } else if (cmoSurfEvidence?.plan.action === "call_surf" || cmoSurfEvidence?.plan.action === "call_surf_x") {
      runtimeLabel = cmoSurfEvidence.plan.action === "call_surf_x" ? "CMO → Hermes Surf X Evidence Orchestration" : "CMO → Hermes Surf Evidence Orchestration";
      runtimeProvider = "hermes";
      runtimeAgent = cmoSurfEvidence.plan.action === "call_surf_x" ? "surf-x+cmo" : "surf+cmo";
      if (cmoSurfEvidence.failureReason) {
        isRuntimeFallback = true;
        runtimeStatus = "live_failed_then_fallback";
        runtimeMode = "fallback";
        attemptedRuntimeMode = "live";
        runtimeError = cmoSurfEvidence.failureReason;
        runtimeErrorReason = "execution_error";
      }
    } else if (mixedCmoEchoRequest) {
      const mixedEchoResult = await executeMixedCmoEcho(request, answer);
      answer = mixedEchoResult.answer;
      assumptions = mixedEchoResult.assumptions;
      suggestedActions = mixedEchoResult.suggestedActions;
      isRuntimeFallback = mixedEchoResult.isRuntimeFallback === true;
      runtimeStatus = mixedEchoResult.isRuntimeFallback ? "live_failed_then_fallback" : "live";
      runtimeMode = mixedEchoResult.isRuntimeFallback ? "fallback" : "live";
      attemptedRuntimeMode = mixedEchoResult.isRuntimeFallback ? "live" : attemptedRuntimeMode;
      runtimeLabel = "CMO → Hermes Echo Orchestration";
      runtimeError = mixedEchoResult.runtimeError ?? "";
      runtimeErrorReason = mixedEchoResult.runtimeError ? "execution_error" : runtimeErrorReason;
      runtimeProvider = mixedEchoResult.runtimeProvider;
      runtimeAgent = mixedEchoResult.runtimeAgent;
      productRenderSource = hermesCmoChatRequested ? "fallback_after_hermes_failure" : "direct_bridge";
    }
    if (request.forceFallback) {
      attemptedRuntimeMode = "live";
      runtimeError = "Live app-chat intentionally bypassed for fallback smoke.";
      runtimeErrorReason = "execution_error";
    }
    status = runtimeResult.runtimeError && !runtimeResult.isRuntimeFallback ? "failed" : "completed";
    }
  } catch (error) {
    status = "failed";
    runtimeStatus = "runtime_error";
    runtimeMode = "configured_but_unreachable";
    runtimeError = error instanceof Error ? error.message : "OpenClaw CMO runtime failed";
    productRenderSource = hermesCmoChatRequested ? "fallback_after_hermes_failure" : "local_runtime_fallback";
    productFallbackReason = productFallbackReason ?? runtimeError;
    answer = [
      "Runtime boundary error: CMO runtime registry could not produce a usable answer.",
      runtimeError,
      "No live runtime was assumed.",
    ].join("\n");
  }
  }

  turnCreativeArtifacts = turnCreativeArtifacts.filter(isProductBackedRenderableCreativeAsset);
  if (turnCreativeArtifacts.length) {
    creativeWorkingState = applyCreativeAssetStateUpdate(creativeWorkingState, turnCreativeArtifacts);
  }
  creativeWorkingState = normalizeCreativeWorkingState(creativeWorkingState);
  const finalCanonicalCreativeAssetStates = sanitizeCreativeAssetStates(turnCreativeArtifacts);
  const resolvedFinalActiveCreativeAssetId = creativeWorkingState?.active_asset_id ?? finalCanonicalCreativeAssetStates.at(-1)?.asset_id;
  if (resolvedFinalActiveCreativeAssetId && creativeWorkingState?.active_asset_id !== resolvedFinalActiveCreativeAssetId) {
    creativeWorkingState = normalizeCreativeWorkingState({
      ...(creativeWorkingState ?? { drafts: [] }),
      active_asset_id: resolvedFinalActiveCreativeAssetId,
      assets: creativeWorkingState?.assets?.length ? creativeWorkingState.assets : finalCanonicalCreativeAssetStates,
    });
  }
  const finalCreativeWorkingStatePresent = hasCreativeWorkingStateDrafts(creativeWorkingState);
  const finalActiveCreativeAssetId = creativeWorkingState?.active_asset_id ?? resolvedFinalActiveCreativeAssetId;
  const finalCreativeAssetsCount = creativeWorkingState?.assets?.length ?? 0;
  const finalCreativeSessionFromAsset = Boolean(finalActiveCreativeAssetId || finalCreativeAssetsCount > 0);
  const finalCreativeConversationResponseReceived = hermesCmoMetadata?.creative_conversation_response_received === true;
  const finalResponseCreativeAssetsCount = finalCreativeConversationResponseReceived ? 0 : finalCreativeAssetsCount;
  if (userVisibleAnswerPathLike(answer)) {
    const guardReason = "path_like_user_visible_answer";
    answer = safeBlockedUserVisibleAnswer(hermesCmoNativeCreativeRequested);
    status = "failed";
    runtimeStatus = "runtime_error";
    runtimeMode = "configured_but_unreachable";
    runtimeError = hermesCmoNativeCreativeRequested
      ? "Creative response was blocked because it contained internal artifact path text."
      : "CMO response was blocked because it contained internal artifact path text.";
    runtimeErrorReason = "invalid_response";
    isRuntimeFallback = false;
    fallbackDurationMs = undefined;
    if (hermesCmoNativeCreativeRequested) {
      productRenderSource = "hermes_cmo";
      productFallbackReason = undefined;
      creativeFallbackUsed = false;
    }
    hermesCmoMetadata = {
      ...(hermesCmoMetadata ?? failedHermesCmoChatV11Metadata(`req_cmo_guard_${messageId}`, guardReason)),
      user_visible_answer_guard_triggered: true,
      user_visible_answer_guard_reason: guardReason,
      ...(hermesCmoNativeCreativeRequested ? { fallback_used: false, workspace_fallback_suppressed_for_creative: true } : {}),
    };
  }
  const suppressNoopAssistantMessage =
    creativeAcknowledgementNoopIntent &&
    status === "completed" &&
    turnCreativeArtifacts.length === 0 &&
    !answer.trim();
  if (suppressNoopAssistantMessage) {
    answer = "";
    hermesCmoMetadata = {
      ...(hermesCmoMetadata ?? failedHermesCmoChatV11Metadata(`req_cmo_noop_${messageId}`, "creative_noop_acknowledgement")),
      creative_conversation_response_received: true,
      creative_conversation_mode: "noop",
      creative_noop_acknowledgement: true,
      assistant_response_suppressed_for_noop: true,
      creative_asset_mutation: false,
      creative_state_mutation: false,
      fallback_used: false,
    };
  }

  if (completedUnifiedCmoAgentAnswer) {
    answer = completedUnifiedCmoAgentAnswer;
    status = "completed";
    isDevelopmentFallback = false;
    isRuntimeFallback = false;
    runtimeStatus = "live";
    runtimeMode = "live";
    attemptedRuntimeMode = "live";
    runtimeError = "";
    runtimeErrorReason = undefined;
    fallbackDurationMs = undefined;
    timeoutMs = undefined;
    outerTimeoutMs = undefined;
    outerTimeoutSource = undefined;
    productRenderSource = "hermes_cmo";
    productFallbackReason = undefined;
    routeDecision = "cmo_agent";
    hermesCmoStatus = "live";
    hermesCmoErrorReason = undefined;
    currentTurnCreativeLongRunningTurn = false;
    creativeExecutionRequested = undefined;
    creativeResponseReceived = undefined;
    creativeMetadataPresent = undefined;
    hermesRequestSent = true;
    calledHermesCmo = true;
    hermesCmoMetadata = completedUnifiedCmoAgentMetadata(hermesCmoMetadata, completedUnifiedCmoAgentPersistState ?? {
      rawHermesStatus: "completed",
      rawHermesAnswer: completedUnifiedCmoAgentAnswer,
      normalizedHermesAnswer: completedUnifiedCmoAgentAnswer,
      answerBasisMode: completedUnifiedCmoAgentAnswerBasisMode ?? "cmo_agent",
    });
  }

  const decisionLayer = buildDecisionLayer({
    workspaceId: request.workspaceId,
    appId: request.appId,
    sourceId: contextPackage.sourceId,
    sessionId,
    createdAt: now,
    answer,
    runtimeAssumptions: assumptions,
    runtimeSuggestedActions: suggestedActions,
  });
  const totalDurationMs = Date.now() - requestStartedMs;
  const timingMetadata = {
    requestReceivedAt,
    ...(typeof timing.authDurationMs === "number" ? { authDurationMs: Math.max(0, Math.floor(timing.authDurationMs)) } : {}),
    sessionResolutionDurationMs,
    contextPackBuildDurationMs,
    indexedContextBuildDurationMs,
    ...(liveAttemptStartedAt ? { liveAttemptStartedAt } : {}),
    ...(typeof liveAttemptDurationMs === "number" ? { liveAttemptDurationMs } : {}),
    ...(typeof fallbackDurationMs === "number" ? { fallbackDurationMs } : {}),
    totalDurationMs,
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
    ...(typeof outerTimeoutMs === "number" ? { outerTimeoutMs, outer_timeout_ms: outerTimeoutMs } : {}),
    ...(outerTimeoutSource ? { outerTimeoutSource, outer_timeout_source: outerTimeoutSource } : {}),
    ...(routeDecision ? { routeDecision, route_decision: routeDecision } : {}),
    ...(currentTurnCreativeLongRunningTurn ? { creative_long_running_turn: true } : {}),
    ...(currentTurnCreativeLongRunningTurn ? { creative_timeout_ms: getCmoHermesCreativeExecuteTimeoutMs() } : {}),
    ...(currentTurnCreativeLongRunningTurn ? { timeout_source: "creative_execute" } : {}),
    ...(hermesCmoNativeCreativeRequested ? { workspace_fallback_suppressed_for_creative: true } : {}),
    ...(hermesCmoNativeCreativeRequested ? { fallback_used: false } : {}),
    ...(finalActiveCreativeAssetId ? { active_creative_asset_id: finalActiveCreativeAssetId, active_asset_id: finalActiveCreativeAssetId, creative_session_active_asset_id: finalActiveCreativeAssetId } : {}),
    ...(finalCreativeAssetsCount > 0 || finalCreativeConversationResponseReceived ? { creative_assets_count: finalResponseCreativeAssetsCount } : {}),
    ...(activeCreativeAssetResolution.asset ? { reference_assets_count: 1 } : {}),
    ...(hermesCmoNativeCreativeRequested ? { artifact_transport_mode: "product_upload" } : {}),
    ...(creativeExecutionRequested === true ? { creativeExecutionRequested: true, creative_execution_requested: true } : {}),
    ...(creativeResponseReceived === true ? { creativeResponseReceived: true, creative_response_received: true } : {}),
    ...(typeof creativeMetadataPresent === "boolean" ? { creativeMetadataPresent, creative_metadata_present: creativeMetadataPresent } : {}),
    ...(creativeNormalizationError ? { creativeNormalizationError, creative_normalization_error: creativeNormalizationError, normalization_error: creativeNormalizationError } : {}),
    ...(typeof creativeFallbackUsed === "boolean" ? { creativeFallbackUsed, creative_fallback_used: creativeFallbackUsed, fallback_used: creativeFallbackUsed } : {}),
    ...(creativeRejectedByM1Validator === true ? { creativeRejectedByM1Validator: true, rejected_by_m1_validator: true } : {}),
    ...(creativeRejectedField ? { creativeRejectedField, rejected_field: creativeRejectedField } : {}),
    ...(typeof creativeSideEffectsPresent === "boolean" ? { creativeSideEffectsPresent, side_effects_present: creativeSideEffectsPresent } : {}),
    ...(typeof creativeSideEffectsAllowedForCreative === "boolean"
      ? { creativeSideEffectsAllowedForCreative, side_effects_allowed_for_creative: creativeSideEffectsAllowedForCreative }
      : {}),
    ...(creativeRejectedSideEffectType ? { creativeRejectedSideEffectType, rejected_side_effect_type: creativeRejectedSideEffectType } : {}),
    contextSourceCount,
    contextCharLength,
    indexedSupplementCharLength,
  };
  if (hermesCmoMetadata && hermesCmoChatV11Attempted) {
    hermesCmoMetadata = {
      ...hermesCmoMetadata,
      suggested_vault_updates_count: suggestedVaultUpdates.length,
      approval_events_count: vaultUpdateApprovalEvents.length,
      ...(vaultUpdateApprovalEvents.at(-1)?.action ? { latest_approval_action: vaultUpdateApprovalEvents.at(-1)?.action } : {}),
      dry_run_results_count: vaultUpdateDryRunResults.length,
      ...(vaultUpdateDryRunResults.at(-1)?.status ? { latest_dry_run_status: vaultUpdateDryRunResults.at(-1)?.status } : {}),
      ...(vaultUpdateDryRunResults.at(-1)?.approval_id ? { latest_dry_run_approval_id: vaultUpdateDryRunResults.at(-1)?.approval_id } : {}),
      ...(typeof vaultUpdateDryRunResults.at(-1)?.write_allowed === "boolean" ? { latest_dry_run_write_allowed: vaultUpdateDryRunResults.at(-1)?.write_allowed } : {}),
      write_results_count: vaultUpdateWriteResults.length,
      ...(vaultUpdateWriteResults.at(-1)?.status ? { latest_write_status: vaultUpdateWriteResults.at(-1)?.status } : {}),
      ...(vaultUpdateWriteResults.at(-1)?.approval_id ? { latest_write_approval_id: vaultUpdateWriteResults.at(-1)?.approval_id } : {}),
      ...(vaultUpdateWriteResults.at(-1)?.vault_path ? { latest_vault_path: vaultUpdateWriteResults.at(-1)?.vault_path } : {}),
      vault_write_performed: false,
      endpoint_kind: hermesCmoMetadata.endpoint_kind ?? "agent_chat",
      runtime_kind: hermesCmoMetadata.runtime_kind ?? "ai_agent",
    };
  }
  if (hermesCmoMetadata) {
    hermesCmoMetadata = {
      ...hermesCmoMetadata,
      ...(creativeIdeationDetected ? { creative_ideation_detected: true } : {}),
      ...(finalCreativeWorkingStatePresent ? { active_creative_context_present: true } : {}),
      ...(activeCreativeAssetResolution.asset ? { active_creative_asset_resolved: true } : {}),
      ...(activeCreativeAssetResolution.source ? { active_creative_asset_resolution_source: activeCreativeAssetResolution.source } : {}),
      ...(finalActiveCreativeAssetId ? { active_creative_asset_id: finalActiveCreativeAssetId, active_asset_id: finalActiveCreativeAssetId, creative_session_active_asset_id: finalActiveCreativeAssetId } : {}),
      ...(finalCreativeWorkingStatePresent || finalCreativeConversationResponseReceived ? { creative_assets_count: finalResponseCreativeAssetsCount } : {}),
      ...(finalCreativeSessionFromAsset ? { creative_session_from_asset: true } : {}),
      ...(routeOverrodeToolExecuteDueToCreativeContext ? { route_overrode_tool_execute_due_to_creative_context: true } : {}),
      ...(toolExecuteSuppressedForCreativeFollowup ? { tool_execute_suppressed_for_creative_followup: true } : {}),
      ...(hermesCmoNativeCreativeRequested ? { cmo_owns_creative_decision: true } : {}),
      ...(currentTurnCreativeLongRunningTurn ? { creative_long_running_turn: true } : {}),
      ...(currentTurnCreativeLongRunningTurn ? { creative_timeout_ms: getCmoHermesCreativeExecuteTimeoutMs() } : {}),
      ...(currentTurnCreativeLongRunningTurn ? { timeout_source: "creative_execute" } : {}),
      ...(currentTurnCreativeLongRunningTurn ? { outer_timeout_source: "creative_execute" } : {}),
      ...(hermesCmoNativeCreativeRequested ? { workspace_fallback_suppressed_for_creative: true } : {}),
      ...(hermesCmoNativeCreativeRequested ? { fallback_used: false } : {}),
      ...(activeCreativeAssetResolution.asset ? { reference_assets_count: 1 } : {}),
      ...(hermesCmoNativeCreativeRequested ? { artifact_transport_mode: "product_upload" } : {}),
      ...lensReadoutMetadata({
        context: lensReadoutContext as unknown as Record<string, unknown> | null,
        warning: lensReadoutContextWarning,
      }),
    };
  }

  let session: CMOChatSession = {
    id: sessionId,
    appId: request.appId,
    appName: request.appName,
    topic: continuedSession?.topic || request.topic || request.message.slice(0, 96),
    authMode: continuedSession?.authMode ?? userIdentity.authMode,
    userId: continuedSession?.userId ?? userIdentity.userId,
    userEmail: continuedSession?.userEmail ?? userIdentity.userEmail,
    userDisplayName: continuedSession?.userDisplayName ?? userIdentity.userDisplayName,
    userSlug: continuedSession?.userSlug ?? userIdentity.userSlug,
    organizationId: continuedSession?.organizationId ?? userIdentity.organizationId,
    createdByUserId: continuedSession?.createdByUserId ?? userIdentity.createdByUserId,
    createdByEmail: continuedSession?.createdByEmail ?? userIdentity.createdByEmail,
    status,
    createdAt: continuedSession?.createdAt ?? now,
    updatedAt: now,
    contextUsed,
    missingContext,
    assumptions,
    suggestedActions,
    isDevelopmentFallback,
    isRuntimeFallback,
    runtimeStatus,
    runtimeMode,
    ...(attemptedRuntimeMode ? { attemptedRuntimeMode } : {}),
    runtimeLabel,
    ...(runtimeError ? { runtimeError } : {}),
    ...(runtimeErrorReason ? { runtimeErrorReason } : {}),
    ...(runtimeProvider ? { runtimeProvider } : {}),
    ...(runtimeAgent ? { runtimeAgent } : {}),
    ...(productRenderSource ? { productRenderSource } : {}),
    ...(productFallbackReason ? { productFallbackReason } : {}),
    ...(hermesRequestSent ? { hermesRequestSent } : {}),
    ...(calledHermesCmo ? { calledHermesCmo } : {}),
    ...(hermesCmoStatus ? { hermesCmoStatus } : {}),
    ...(hermesCmoErrorReason ? { hermesCmoErrorReason } : {}),
    ...(hermesCmoCounters ? { hermesCmoCounters } : {}),
    ...(hermesCmoMetadata ? { hermesCmoMetadata } : {}),
    ...(strategyMode ? { strategyMode } : {}),
    ...(mainBottleneck ? { mainBottleneck } : {}),
    ...(decisionLabel ? { decisionLabel } : {}),
    ...(currentStep ? { currentStep } : {}),
    ...(activityEvents ? { activityEvents } : {}),
    ...(delegationSummary ? { delegationSummary } : {}),
    ...(agentsUsed ? { agentsUsed } : {}),
    ...(typeof surfCalls === "number" ? { surfCalls } : {}),
    ...(typeof echoCalls === "number" ? { echoCalls } : {}),
    ...(forbiddenCounters ? { forbiddenCounters } : {}),
    ...(delegationsMode ? { delegationsMode } : {}),
    ...(vaultAgentContextPackMetadata ? { vaultAgentContextPack: vaultAgentContextPackMetadata } : {}),
    runtimeContext,
    ...(creativeWorkingState ? { creativeWorkingState } : {}),
    ...(creativeDecision ? { creativeDecision } : {}),
    ...(sourceReviewContext ? { sourceReviewContext } : {}),
    ...(sourceAnswerContext ? { sourceAnswerContext } : {}),
    sessionLocalSources,
    sessionLocalResearchResults,
    ...(activeSourceId ? { activeSourceId } : {}),
    ...(sessionSummary ? { sessionSummary } : {}),
    ...(turnCreativeArtifacts.length ? { creativeAssets: turnCreativeArtifacts, creative_assets: turnCreativeArtifacts } : {}),
    ...(sessionArtifacts.length ? { sessionArtifacts } : {}),
    ...(suggestedVaultUpdates.length ? { suggestedVaultUpdates } : {}),
    ...(vaultUpdateApprovalEvents.length ? { vaultUpdateApprovalEvents } : {}),
    ...(vaultUpdateDryRunResults.length ? { vaultUpdateDryRunResults } : {}),
    ...(vaultUpdateWriteResults.length ? { vaultUpdateWriteResults } : {}),
    contextDiagnostics,
    contextQualitySummary,
    graphHints,
    graphHintCount,
    graphStatus,
    indexedContextStatus,
    indexedContextSourcesCount,
    ...(indexedContextFallbackReason ? { indexedContextFallbackReason } : {}),
    ...timingMetadata,
    decisionLayer,
    messages: [
      ...(continuedSession?.messages ?? []),
      {
        id: messageId,
        role: "user",
        content: request.message,
        createdAt: now,
        ...messageUserMetadata(userIdentity),
        runtimeContext,
        ...(creativeWorkingState ? { creativeWorkingState } : {}),
        ...(creativeDecision ? { creativeDecision } : {}),
        ...(sourceReviewContext ? { sourceReviewContext } : {}),
        ...(sourceAnswerContext ? { sourceAnswerContext } : {}),
        sessionLocalResearchResults,
        ...(turnAttachments.length ? { attachments: turnAttachments } : {}),
        ...(sessionSummary ? { sessionSummary } : {}),
        ...(sessionArtifacts.length ? { sessionArtifacts } : {}),
        ...(suggestedVaultUpdates.length ? { suggestedVaultUpdates } : {}),
        ...(vaultUpdateApprovalEvents.length ? { vaultUpdateApprovalEvents } : {}),
        ...(vaultUpdateDryRunResults.length ? { vaultUpdateDryRunResults } : {}),
        ...(vaultUpdateWriteResults.length ? { vaultUpdateWriteResults } : {}),
      },
      ...(suppressNoopAssistantMessage ? [] : [{
        id: assistantId,
        role: "assistant" as const,
        content: answer,
        createdAt: now,
        ...assistantSourceMetadata(userIdentity, messageId),
        runtimeMode,
        runtimeStatus,
        ...(runtimeProvider ? { runtimeProvider } : {}),
        ...(runtimeAgent ? { runtimeAgent } : {}),
        ...(runtimeErrorReason ? { runtimeErrorReason } : {}),
        ...(productRenderSource ? { productRenderSource } : {}),
        ...(productFallbackReason ? { productFallbackReason } : {}),
        ...(hermesRequestSent ? { hermesRequestSent } : {}),
        ...(calledHermesCmo ? { calledHermesCmo } : {}),
        ...(hermesCmoStatus ? { hermesCmoStatus } : {}),
        ...(hermesCmoErrorReason ? { hermesCmoErrorReason } : {}),
        ...(hermesCmoCounters ? { hermesCmoCounters } : {}),
        ...(hermesCmoMetadata ? { hermesCmoMetadata } : {}),
        ...(strategyMode ? { strategyMode } : {}),
        ...(mainBottleneck ? { mainBottleneck } : {}),
        ...(decisionLabel ? { decisionLabel } : {}),
        ...(currentStep ? { currentStep } : {}),
        ...(activityEvents ? { activityEvents } : {}),
        ...(delegationSummary ? { delegationSummary } : {}),
        ...(agentsUsed ? { agentsUsed } : {}),
        ...(typeof surfCalls === "number" ? { surfCalls } : {}),
        ...(typeof echoCalls === "number" ? { echoCalls } : {}),
        ...(forbiddenCounters ? { forbiddenCounters } : {}),
        ...(delegationsMode ? { delegationsMode } : {}),
        ...(vaultAgentContextPackMetadata ? { vaultAgentContextPack: vaultAgentContextPackMetadata } : {}),
        runtimeContext,
        ...(creativeWorkingState ? { creativeWorkingState } : {}),
        ...(creativeDecision ? { creativeDecision } : {}),
        ...(sourceReviewContext ? { sourceReviewContext } : {}),
        ...(sourceAnswerContext ? { sourceAnswerContext } : {}),
        sessionLocalSources,
        sessionLocalResearchResults,
        ...(turnAttachments.length ? { attachments: turnAttachments } : {}),
        ...(activeSourceId ? { activeSourceId } : {}),
        ...(sessionSummary ? { sessionSummary } : {}),
        ...(turnCreativeArtifacts.length ? { creativeAssets: turnCreativeArtifacts, creative_assets: turnCreativeArtifacts } : {}),
        ...(turnCreativeArtifacts.length ? { sessionArtifacts: turnCreativeArtifacts } : {}),
        ...(suggestedVaultUpdates.length ? { suggestedVaultUpdates } : {}),
        ...(vaultUpdateApprovalEvents.length ? { vaultUpdateApprovalEvents } : {}),
        ...(vaultUpdateDryRunResults.length ? { vaultUpdateDryRunResults } : {}),
        ...(vaultUpdateWriteResults.length ? { vaultUpdateWriteResults } : {}),
        contextUsedCount: contextUsed.length,
        graphHintCount,
        indexedContextStatus,
        indexedContextSourcesCount,
        ...(indexedContextFallbackReason ? { indexedContextFallbackReason } : {}),
        ...timingMetadata,
      }]),
    ],
  };

  session = applyCompletedUnifiedCmoAgentFinalWriteInvariant({
    session,
    userMessageId: messageId,
    assistantMessageId: assistantId,
    completed: completedUnifiedCmoAgentPersistState,
  });
  logFinalSessionWriteProjection({
    session,
    userMessageId: messageId,
    assistantMessageId: assistantId,
    completed: completedUnifiedCmoAgentPersistState,
  });
  await writeJsonFile(sessionPath(sessionId), session);

  let persistedSession = session;
  const vaultAgentHandoffMode = getCmoVaultAgentHandoffMode();
  const durableSideEffectsSuppressed = hermesCmoChatV11Attempted;
  const autoCapture: AutoCaptureResult = durableSideEffectsSuppressed
    ? {
        ok: true,
        savedToVault: false,
        warnings: ["skipped_hermes_cmo_chat_v11_no_auto_save"],
        skipped: true,
        skipReason: "skipped_hermes_cmo_chat_v11_no_auto_save",
      }
    : status !== "completed"
    ? { ok: false, savedToVault: false, warnings: [], error: "Chat response failed; auto capture skipped" }
    : vaultAgentHandoffMode === "write_remote"
      ? skippedLegacyAutoCaptureForVaultAgentWriteRemote()
      : await autoCaptureTurnOnce({
          request,
          session,
          assistantMessageId: assistantId,
          sourceUserMessageId: messageId,
          userIdentity,
          answer,
          routeKind: "app-chat-response",
          runtimeSource: runtimeProvider,
          assistantFooterSourceLabel: runtimeLabel,
          runtimeLabel,
          runtimeProvider,
          runtimeAgent,
        });
  const vaultAgentHandoff = status === "completed" && !durableSideEffectsSuppressed ? await runVaultAgentDryRunHandoff({
    request,
    session,
    userIdentity,
    userMessageId: messageId,
    assistantMessageId: assistantId,
    answer,
    createdAt: now,
    activityEvents,
    delegationSummary,
    agentsUsed,
    surfCalls,
    echoCalls,
  }) : undefined;
  const vaultAgentDryRunMetadata = vaultAgentDryRunMetadataForPersistence(vaultAgentHandoff);
  if (status === "completed") {
    const finalTotalDurationMs = Date.now() - requestStartedMs;
    const rawCaptureError = rawCaptureErrorForAutoCapture(autoCapture);
    persistedSession = applyCompletedUnifiedCmoAgentFinalWriteInvariant({
      session: {
      ...session,
      totalDurationMs: finalTotalDurationMs,
      messages: session.messages.map((message) =>
        message.id === assistantId ? {
          ...message,
          totalDurationMs: finalTotalDurationMs,
          ...(vaultAgentDryRunMetadata ? { vaultAgentDryRun: vaultAgentDryRunMetadata } : {}),
        } : message,
      ),
      ...(vaultAgentDryRunMetadata ? { vaultAgentDryRun: vaultAgentDryRunMetadata } : {}),
      rawCapturePath: autoCapture.relativePath,
      rawCaptureStatus: rawCaptureStatusForAutoCapture(autoCapture),
      ...(rawCaptureError ? { rawCaptureError } : {}),
      },
      userMessageId: messageId,
      assistantMessageId: assistantId,
      completed: completedUnifiedCmoAgentPersistState,
    });
    logFinalSessionWriteProjection({
      session: persistedSession,
      userMessageId: messageId,
      assistantMessageId: assistantId,
      completed: completedUnifiedCmoAgentPersistState,
    });
    await writeJsonFile(sessionPath(sessionId), persistedSession);
  }
  const sessionIndexResult: CmoIndexResult = durableSideEffectsSuppressed
    ? { status: "skipped", table: "cmo_chat_sessions", reason: "skipped_hermes_cmo_chat_v11_no_supabase_mutation" }
    : await indexChatSession({
        session: persistedSession,
        jsonPath: sessionJsonIndexPath(sessionId),
        auditCreated: !continuedSession,
      });
  const messageIndexResults: CmoIndexResult[] = durableSideEffectsSuppressed
    ? [{ status: "skipped", table: "cmo_chat_messages", reason: "skipped_hermes_cmo_chat_v11_no_supabase_mutation" }]
    : await indexChatMessages({
        session: persistedSession,
        messages: session.messages.slice(-2),
      });
  const platformPersistenceSummary: HermesCmoPlatformPersistenceSummary = {
    sessionJsonSaved: true,
    rawCaptureSaved: autoCapture.savedToVault === true,
    ...(persistedSession.rawCaptureStatus ? { rawCaptureStatus: persistedSession.rawCaptureStatus } : {}),
    supabaseIndexingStatus: supabaseIndexingStatus([sessionIndexResult, ...messageIndexResults]),
  };

  if (calledHermesCmo && hermesCmoMetadata) {
    persistedSession = attachHermesCmoPlatformPersistence(persistedSession, assistantId, platformPersistenceSummary);
    persistedSession = applyCompletedUnifiedCmoAgentFinalWriteInvariant({
      session: persistedSession,
      userMessageId: messageId,
      assistantMessageId: assistantId,
      completed: completedUnifiedCmoAgentPersistState,
    });
    hermesCmoMetadata = {
      ...hermesCmoMetadata,
      platformPersistenceSummary,
    };
    logFinalSessionWriteProjection({
      session: persistedSession,
      userMessageId: messageId,
      assistantMessageId: assistantId,
      completed: completedUnifiedCmoAgentPersistState,
    });
    await writeJsonFile(sessionPath(sessionId), persistedSession);
  }

  const completedUnifiedCmoAgentFinalAssistant = completedUnifiedCmoAgentPersistState
    ? persistedSession.messages.find((message) => message.id === assistantId)
    : undefined;
  if (completedUnifiedCmoAgentPersistState?.normalizedHermesAnswer.trim()) {
    answer = completedUnifiedCmoAgentPersistState.normalizedHermesAnswer;
    status = "completed";
    isDevelopmentFallback = false;
    isRuntimeFallback = false;
    runtimeStatus = "live";
    runtimeMode = "live";
    attemptedRuntimeMode = "live";
    runtimeError = "";
    runtimeErrorReason = undefined;
    runtimeProvider = "hermes";
    runtimeAgent = "cmo";
    fallbackDurationMs = undefined;
    timeoutMs = undefined;
    outerTimeoutMs = undefined;
    outerTimeoutSource = undefined;
    routeDecision = "cmo_agent";
    productRenderSource = "hermes_cmo";
    productFallbackReason = undefined;
    hermesRequestSent = true;
    calledHermesCmo = true;
    hermesCmoStatus = "live";
    hermesCmoErrorReason = undefined;
    currentTurnCreativeLongRunningTurn = false;
    creativeExecutionRequested = undefined;
    creativeResponseReceived = undefined;
    creativeMetadataPresent = undefined;
    creativeFallbackUsed = undefined;
    hermesCmoMetadata = completedUnifiedCmoAgentFinalAssistant?.hermesCmoMetadata
      ?? persistedSession.hermesCmoMetadata
      ?? completedUnifiedCmoAgentMetadata(hermesCmoMetadata, completedUnifiedCmoAgentPersistState);
    hermesCmoCounters = completedUnifiedCmoAgentFinalAssistant?.hermesCmoCounters ?? persistedSession.hermesCmoCounters ?? hermesCmoCounters;
    forbiddenCounters = completedUnifiedCmoAgentFinalAssistant?.forbiddenCounters ?? persistedSession.forbiddenCounters ?? forbiddenCounters;
    activityEvents = completedUnifiedCmoAgentFinalAssistant?.activityEvents ?? persistedSession.activityEvents ?? activityEvents;
    delegationSummary = completedUnifiedCmoAgentFinalAssistant?.delegationSummary ?? persistedSession.delegationSummary ?? delegationSummary;
    agentsUsed = completedUnifiedCmoAgentFinalAssistant?.agentsUsed ?? persistedSession.agentsUsed ?? agentsUsed;
    surfCalls = completedUnifiedCmoAgentFinalAssistant?.surfCalls ?? persistedSession.surfCalls ?? surfCalls;
    echoCalls = completedUnifiedCmoAgentFinalAssistant?.echoCalls ?? persistedSession.echoCalls ?? echoCalls;
  }
  const responseTimingMetadata = completedUnifiedCmoAgentPersistState?.normalizedHermesAnswer.trim()
    ? (() => {
        const metadata = { ...timingMetadata } as Record<string, unknown>;
        for (const key of [
          "timeoutMs",
          "outerTimeoutMs",
          "outer_timeout_ms",
          "outerTimeoutSource",
          "outer_timeout_source",
          "creative_long_running_turn",
          "creative_timeout_ms",
          "timeout_source",
        ]) {
          delete metadata[key];
        }

        return {
          ...metadata,
        routeDecision: "cmo_agent" as const,
        route_decision: "cmo_agent" as const,
        fallback_used: false,
        };
      })()
    : timingMetadata;

  return {
    messageId: assistantId,
    sessionId,
    status,
    answer,
    assumptions,
    suggestedActions,
    contextUsed,
    missingContext,
    isDevelopmentFallback,
    isRuntimeFallback,
    runtimeStatus,
    runtimeMode,
    ...(attemptedRuntimeMode ? { attemptedRuntimeMode } : {}),
    runtimeLabel,
    ...(runtimeError ? { runtimeError } : {}),
    ...(runtimeErrorReason ? { runtimeErrorReason } : {}),
    ...(runtimeProvider ? { runtimeProvider } : {}),
    ...(runtimeAgent ? { runtimeAgent } : {}),
    ...(productRenderSource ? { productRenderSource } : {}),
    ...(productFallbackReason ? { productFallbackReason } : {}),
    ...(hermesRequestSent ? { hermesRequestSent } : {}),
    ...(calledHermesCmo ? { calledHermesCmo } : {}),
    ...(hermesCmoStatus ? { hermesCmoStatus } : {}),
    ...(hermesCmoErrorReason ? { hermesCmoErrorReason } : {}),
    ...(hermesCmoCounters ? { hermesCmoCounters } : {}),
    ...(hermesCmoMetadata ? { hermesCmoMetadata } : {}),
    ...(strategyMode ? { strategyMode } : {}),
    ...(mainBottleneck ? { mainBottleneck } : {}),
    ...(decisionLabel ? { decisionLabel } : {}),
    ...(currentStep ? { currentStep } : {}),
    ...(activityEvents ? { activityEvents } : {}),
    ...(delegationSummary ? { delegationSummary } : {}),
    ...(agentsUsed ? { agentsUsed } : {}),
    ...(typeof surfCalls === "number" ? { surfCalls } : {}),
    ...(typeof echoCalls === "number" ? { echoCalls } : {}),
    ...(forbiddenCounters ? { forbiddenCounters } : {}),
    ...(platformPersistenceSummary ? { platformPersistenceSummary } : {}),
    ...(delegationsMode ? { delegationsMode } : {}),
    runtimeContext,
    ...(creativeWorkingState ? { creativeWorkingState } : {}),
    ...(creativeDecision ? { creativeDecision } : {}),
    ...(sourceReviewContext ? { sourceReviewContext } : {}),
    ...(sourceAnswerContext ? { sourceAnswerContext } : {}),
    sessionLocalSources,
    sessionLocalResearchResults,
    ...(activeSourceId ? { activeSourceId } : {}),
    ...(sessionSummary ? { sessionSummary } : {}),
    ...(turnCreativeArtifacts.length ? { creativeAssets: turnCreativeArtifacts, creative_assets: turnCreativeArtifacts } : {}),
    ...(sessionArtifacts.length ? { sessionArtifacts } : {}),
    ...(suggestedVaultUpdates.length ? { suggestedVaultUpdates } : {}),
    ...(vaultUpdateApprovalEvents.length ? { vaultUpdateApprovalEvents } : {}),
    ...(vaultUpdateDryRunResults.length ? { vaultUpdateDryRunResults } : {}),
    ...(vaultUpdateWriteResults.length ? { vaultUpdateWriteResults } : {}),
    contextDiagnostics,
    contextQualitySummary,
    graphHints,
    graphHintCount,
    graphStatus,
    indexedContextStatus,
    indexedContextSourcesCount,
    ...(indexedContextFallbackReason ? { indexedContextFallbackReason } : {}),
    ...responseTimingMetadata,
    totalDurationMs: persistedSession.totalDurationMs ?? timingMetadata.totalDurationMs,
    decisionLayer,
    rawCapturePath: persistedSession.rawCapturePath,
    rawCaptureStatus: persistedSession.rawCaptureStatus,
    rawCaptureError: persistedSession.rawCaptureError,
  };
}

export async function readAppChatSessions(limit = DEFAULT_LIMIT, appId?: string): Promise<CMOChatSession[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : DEFAULT_LIMIT;

  try {
    const files = await readdir(APP_CHAT_DIR, { withFileTypes: true });
    const sessions = await Promise.all(
      files
        .filter((file) => file.isFile() && file.name.endsWith(".json"))
        .map((file) => readJsonFile(path.join(APP_CHAT_DIR, file.name)).then(normalizeSession)),
    );

    return sessions
      .filter((session): session is CMOChatSession => Boolean(session))
      .filter((session) => (appId ? session.appId === appId : true))
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
      .slice(0, safeLimit);
  } catch {
    return [];
  }
}

export async function readAppChatSession(sessionId: string): Promise<CMOChatSession | null> {
  return normalizeSession(await readJsonFile(sessionPath(sessionId)));
}

function isActiveAsyncToolRunMessage(message: CMOChatMessage | undefined, cmoRunId: string): boolean {
  return message?.role === "assistant" &&
    message.cmoRunId === cmoRunId &&
    (message.cmoRunStatus === "pending" || message.cmoRunStatus === "running");
}

function asyncToolRunStillActive(session: CMOChatSession | null, assistantId: string, cmoRunId: string): session is CMOChatSession {
  return isActiveAsyncToolRunMessage(session?.messages.find((message) => message.id === assistantId), cmoRunId);
}

function mergeAsyncToolRunFinalSession(current: CMOChatSession, finalSession: CMOChatSession, assistantId: string): CMOChatSession {
  const finalAssistant = finalSession.messages.find((message) => message.id === assistantId);

  return {
    ...current,
    ...finalSession,
    messages: finalAssistant
      ? current.messages.map((message) => message.id === assistantId ? finalAssistant : message)
      : current.messages,
  };
}

export async function stopAppChatRun(input: {
  appId: string;
  sessionId: string;
  assistantMessageId: string;
  cmoRunId?: string;
}): Promise<CMOChatSession | null> {
  const session = await readAppChatSession(input.sessionId);

  if (!session || session.appId !== input.appId) {
    return null;
  }

  const assistant = session.messages.find((message) => message.id === input.assistantMessageId);
  const activeRunMatches = assistant?.role === "assistant" &&
    (assistant.cmoRunStatus === "pending" || assistant.cmoRunStatus === "running") &&
    (!input.cmoRunId || assistant.cmoRunId === input.cmoRunId);

  if (!activeRunMatches) {
    return session;
  }

  const stoppedAt = new Date().toISOString();
  const startedAtMs = Date.parse(assistant.cmoRunStartedAt ?? assistant.createdAt);
  const durationMs = Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : undefined;
  const stoppedMessagePatch: Partial<CMOChatMessage> = {
    content: stoppedToolRunAnswer(),
    runtimeStatus: "runtime_error",
    runtimeMode: "configured_but_unreachable",
    runtimeErrorReason: "execution_error",
    runtimeProvider: "hermes",
    runtimeAgent: "cmo",
    productFallbackReason: "user_stopped_run",
    hermesCmoStatus: "interrupted",
    cmoRunStatus: "interrupted",
    cmoRunCompletedAt: stoppedAt,
    ...(typeof durationMs === "number" ? { cmoRunDurationMs: durationMs, liveAttemptDurationMs: durationMs } : {}),
  };
  const updated: CMOChatSession = {
    ...session,
    status: "failed",
    updatedAt: stoppedAt,
    runtimeStatus: "runtime_error",
    runtimeMode: "configured_but_unreachable",
    runtimeErrorReason: "execution_error",
    runtimeProvider: "hermes",
    runtimeAgent: "cmo",
    runtimeError: "CMO run stopped by user.",
    productFallbackReason: "user_stopped_run",
    hermesCmoStatus: "interrupted",
    cmoRunStatus: "interrupted",
    cmoRunCompletedAt: stoppedAt,
    ...(typeof durationMs === "number" ? { cmoRunDurationMs: durationMs, liveAttemptDurationMs: durationMs } : {}),
    messages: session.messages.map((message) => {
      if (message.id !== input.assistantMessageId) {
        return message;
      }

      const stoppedMessage = {
        ...message,
        ...stoppedMessagePatch,
      };
      delete stoppedMessage.currentStep;

      return stoppedMessage;
    }),
  };
  delete updated.currentStep;

  await writeJsonFile(sessionPath(session.id), updated);

  return updated;
}

type LocalChatCommand =
  | {
      type: "review";
      itemType: DecisionLayerReviewItemType;
      ordinal: number;
      reviewStatus: string;
      noun: string;
      completionCopy: string;
      boundaryCopy: string;
    }
  | {
      type: "pending_summary";
    };

function parsePositiveOrdinal(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const ordinal = Number.parseInt(value, 10);

  return Number.isFinite(ordinal) && ordinal > 0 ? ordinal : null;
}

function parseLocalChatCommand(message: string): LocalChatCommand | null {
  const normalized = message.toLowerCase().replace(/[?.!]+$/g, "").replace(/\s+/g, " ").trim();

  if (/^(what should i review next|what do i review next|show pending review|show pending reviews|review queue)$/.test(normalized)) {
    return { type: "pending_summary" };
  }

  const actionMatch = normalized.match(/^(?:mark|approve)\s+(?:suggested\s+)?action\s+(\d+)(?:\s+(?:as\s+)?reviewed)?$/);
  const actionOrdinal = parsePositiveOrdinal(actionMatch?.[1]);

  if (actionOrdinal) {
    return {
      type: "review",
      itemType: "suggestedAction",
      ordinal: actionOrdinal,
      reviewStatus: "reviewed",
      noun: "Suggested Action",
      completionCopy: "marked Suggested Action",
      boundaryCopy: "Nothing was pushed to Task Tracker.",
    };
  }

  const memoryMatch = normalized.match(/^(approve|defer|reject)\s+memory(?:\s+candidate)?\s+(\d+)$/);
  const memoryOrdinal = parsePositiveOrdinal(memoryMatch?.[2]);

  if (memoryMatch?.[1] && memoryOrdinal) {
    const verb = memoryMatch[1];
    const reviewStatus = verb === "approve" ? "approved_for_promotion_later" : verb === "defer" ? "deferred" : "rejected";

    return {
      type: "review",
      itemType: "memoryCandidate",
      ordinal: memoryOrdinal,
      reviewStatus,
      noun: "Memory Candidate",
      completionCopy: `${verb === "approve" ? "approved" : verb === "defer" ? "deferred" : "rejected"} Memory Candidate`,
      boundaryCopy: "Nothing was promoted to App Memory.",
    };
  }

  const taskMatch = normalized.match(/^(approve|defer|reject)\s+task(?:\s+candidate)?\s+(\d+)$/);
  const taskOrdinal = parsePositiveOrdinal(taskMatch?.[2]);

  if (taskMatch?.[1] && taskOrdinal) {
    const verb = taskMatch[1];
    const reviewStatus = verb === "approve" ? "approved_for_task_later" : verb === "defer" ? "deferred" : "rejected";

    return {
      type: "review",
      itemType: "taskCandidate",
      ordinal: taskOrdinal,
      reviewStatus,
      noun: "Task Candidate",
      completionCopy: `${verb === "approve" ? "approved" : verb === "defer" ? "deferred" : "rejected"} Task Candidate`,
      boundaryCopy: "Nothing was pushed to Task Tracker.",
    };
  }

  return null;
}

function reviewStatusValues(layer: CmoDecisionLayer): string[] {
  return [
    ...layer.decisions.map((item) => item.reviewStatus ?? "unreviewed"),
    ...layer.assumptions.map((item) => item.reviewStatus ?? "unreviewed"),
    ...layer.suggestedActions.map((item) => item.reviewStatus ?? "unreviewed"),
    ...layer.memoryCandidates.map((item) => item.reviewStatus),
    ...layer.taskCandidates.map((item) => item.reviewStatus ?? "unreviewed"),
  ];
}

function decisionLayerReviewStats(layer: CmoDecisionLayer | undefined): {
  total: number;
  reviewed: number;
  pending: number;
  deferred: number;
  approvedForLater: number;
} {
  const statuses = layer ? reviewStatusValues(layer) : [];

  return {
    total: statuses.length,
    reviewed: statuses.filter((status) => status !== "unreviewed" && status !== "review_required").length,
    pending: statuses.filter((status) => status === "unreviewed" || status === "review_required").length,
    deferred: statuses.filter((status) => status === "deferred").length,
    approvedForLater: statuses.filter((status) => status === "approved_for_promotion_later" || status === "approved_for_task_later").length,
  };
}

function reviewSummaryLine(layer: CmoDecisionLayer | undefined): string {
  const stats = decisionLayerReviewStats(layer);

  return `Current status: ${stats.reviewed}/${stats.total} reviewed, ${stats.pending} pending, ${stats.deferred} deferred, ${stats.approvedForLater} approved for later.`;
}

function localCommandItem(layer: CmoDecisionLayer, itemType: DecisionLayerReviewItemType, ordinal: number): { id: string; title: string } | null {
  if (itemType === "suggestedAction") {
    const item = layer.suggestedActions[ordinal - 1];
    return item ? { id: item.id, title: item.title } : null;
  }

  if (itemType === "memoryCandidate") {
    const item = layer.memoryCandidates[ordinal - 1];
    return item ? { id: item.id, title: item.statement } : null;
  }

  if (itemType === "taskCandidate") {
    const item = layer.taskCandidates[ordinal - 1];
    return item ? { id: item.id, title: item.title } : null;
  }

  if (itemType === "decision") {
    const item = layer.decisions[ordinal - 1];
    return item ? { id: item.id, title: item.title } : null;
  }

  const item = layer.assumptions[ordinal - 1];
  return item ? { id: item.id, title: item.statement } : null;
}

function pendingReviewLines(layer: CmoDecisionLayer | undefined): string[] {
  if (!layer) {
    return ["No Decision Layer is available for this session yet."];
  }

  const lines: string[] = [];
  const addPending = (label: string, index: number, title: string, status: string | undefined) => {
    if (status === "unreviewed" || status === "review_required" || !status) {
      lines.push(`${label} ${index}: ${title}`);
    }
  };

  layer.suggestedActions.forEach((item, index) => addPending("Suggested Action", index + 1, item.title, item.reviewStatus));
  layer.memoryCandidates.forEach((item, index) => addPending("Memory Candidate", index + 1, item.statement, item.reviewStatus));
  layer.taskCandidates.forEach((item, index) => addPending("Task Candidate", index + 1, item.title, item.reviewStatus));
  layer.decisions.forEach((item, index) => addPending("Decision", index + 1, item.title, item.reviewStatus));
  layer.assumptions.forEach((item, index) => addPending("Assumption", index + 1, item.statement, item.reviewStatus));

  return lines.length ? lines.slice(0, 5) : ["Everything extracted in this session has been reviewed or deferred."];
}

async function appendLocalCommandTurn(
  session: CMOChatSession,
  request: CMOAppChatRequest,
  answer: string,
  now: string,
  messageId: string,
  assistantId: string,
  userIdentity: CmoServerUserIdentity,
): Promise<CMOAppChatResponse> {
  const userMessage: CMOChatMessage = {
    id: messageId,
    role: "user",
    content: request.message,
    createdAt: now,
    ...messageUserMetadata(userIdentity),
  };
  const assistantMessage: CMOChatMessage = {
    id: assistantId,
    role: "assistant",
    content: answer,
    createdAt: now,
    ...assistantSourceMetadata(userIdentity, messageId),
    runtimeMode: session.runtimeMode,
    runtimeStatus: session.runtimeStatus,
    runtimeProvider: "dashboard",
    runtimeAgent: "decision-review",
    contextUsedCount: session.contextUsed.length,
    graphHintCount: session.graphHintCount ?? session.graphHints?.length ?? 0,
  };
  const withUser = appendMessage(session, userMessage);
  const updated: CMOChatSession = {
    ...appendMessage(withUser, assistantMessage),
    status: "completed",
  };

  await writeJsonFile(sessionPath(session.id), updated);
  await indexChatSession({
    session: updated,
    jsonPath: sessionJsonIndexPath(session.id),
    auditCreated: false,
  });
  await indexChatMessages({
    session: updated,
    messages: [userMessage, assistantMessage],
  });

  return {
    messageId: assistantId,
    sessionId: session.id,
    status: "completed",
    answer,
    assumptions: updated.assumptions ?? [],
    suggestedActions: updated.suggestedActions ?? [],
    contextUsed: updated.contextUsed,
    missingContext: updated.missingContext ?? [],
    isDevelopmentFallback: updated.isDevelopmentFallback === true,
    isRuntimeFallback: updated.isRuntimeFallback === true,
    runtimeStatus: updated.runtimeStatus ?? "live",
    runtimeMode: updated.runtimeMode,
    ...(updated.attemptedRuntimeMode ? { attemptedRuntimeMode: updated.attemptedRuntimeMode } : {}),
    runtimeLabel: "CMO decision review",
    runtimeProvider: "dashboard",
    runtimeAgent: "decision-review",
    contextDiagnostics: updated.contextDiagnostics,
    contextQualitySummary: updated.contextQualitySummary,
    graphHints: updated.graphHints,
    graphHintCount: updated.graphHintCount,
    graphStatus: updated.graphStatus,
    decisionLayer: updated.decisionLayer,
  };
}

async function handleLocalChatCommand(
  command: LocalChatCommand,
  request: CMOAppChatRequest,
  session: CMOChatSession,
  now: string,
  messageId: string,
  assistantId: string,
  userIdentity: CmoServerUserIdentity,
): Promise<CMOAppChatResponse> {
  if (command.type === "pending_summary") {
    const answer = [
      "Here is the next review queue for this CMO session:",
      "",
      ...pendingReviewLines(session.decisionLayer).map((line) => `- ${line}`),
      "",
      reviewSummaryLine(session.decisionLayer),
      "You can say: \"Mark action 1 reviewed\", \"Approve memory candidate 1\", or \"Defer task candidate 1\".",
      "Nothing is pushed to Task Tracker or promoted to App Memory automatically.",
    ].join("\n");

    return appendLocalCommandTurn(session, request, answer, now, messageId, assistantId, userIdentity);
  }

  const layer = session.decisionLayer;

  if (!layer) {
    return appendLocalCommandTurn(
      session,
      request,
      "I cannot review this yet because this session does not have a Decision Layer. Ask a normal CMO question first, then review the extracted outputs.",
      now,
      messageId,
      assistantId,
      userIdentity,
    );
  }

  const item = localCommandItem(layer, command.itemType, command.ordinal);

  if (!item) {
    const answer = [
      `I could not find ${command.noun} ${command.ordinal} in this session.`,
      reviewSummaryLine(layer),
      "Nothing was changed.",
    ].join("\n");

    return appendLocalCommandTurn(session, request, answer, now, messageId, assistantId, userIdentity);
  }

  const reviewedSession = await updateDecisionLayerReview({
    appId: request.appId,
    sessionId: session.id,
    itemType: command.itemType,
    itemId: item.id,
    reviewStatus: command.reviewStatus,
    reviewedBy: "cmo-chat",
  });
  const updatedSession = reviewedSession ?? session;
  const answer = [
    `Done - I ${command.completionCopy} ${command.ordinal} as ${command.reviewStatus.replace(/_/g, " ")}.`,
    reviewSummaryLine(updatedSession.decisionLayer),
    command.boundaryCopy,
  ].join(" ");

  return appendLocalCommandTurn(updatedSession, request, answer, now, messageId, assistantId, userIdentity);
}

export async function updateAppChatSessionMetadata(
  sessionId: string,
  patch: Pick<CMOChatSession, "savedToVault" | "rawCapturePath" | "rawCaptureStatus" | "rawCaptureError" | "sessionNotePath" | "relatedPriority" | "relatedPlan" | "relatedTasks">,
): Promise<CMOChatSession | null> {
  const session = await readAppChatSession(sessionId);

  if (!session) {
    return null;
  }

  const updated: CMOChatSession = {
    ...session,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await writeJsonFile(sessionPath(sessionId), updated);

  return updated;
}

export type DecisionLayerReviewItemType = "decision" | "assumption" | "suggestedAction" | "memoryCandidate" | "taskCandidate";

export interface UpdateDecisionLayerReviewInput {
  appId: string;
  sessionId: string;
  itemType: DecisionLayerReviewItemType;
  itemId: string;
  reviewStatus: string;
  reviewedBy?: string;
  reviewNote?: string;
}

function reviewNoteValue(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim().slice(0, 500) : undefined;
}

export async function updateDecisionLayerReview(input: UpdateDecisionLayerReviewInput): Promise<CMOChatSession | null> {
  const app = getAppWorkspace(input.appId);

  if (!app) {
    throw new Error(`Unknown appId: ${input.appId}`);
  }

  const session = await readAppChatSession(input.sessionId);

  if (!session) {
    return null;
  }

  if (session.appId !== app.id) {
    throw new Error("Session does not belong to the requested app.");
  }

  const layer = session.decisionLayer;

  if (!layer) {
    throw new Error("Session has no Decision Layer to review.");
  }

  if (layer.workspaceId !== app.workspaceId || layer.appId !== app.id || layer.sourceId !== app.sourceId) {
    throw new Error("Decision Layer source boundary does not match the requested app.");
  }

  const reviewedAt = new Date().toISOString();
  const reviewedBy = input.reviewedBy?.trim() || "cmo-user";
  const reviewNote = reviewNoteValue(input.reviewNote);
  let updatedLayer: CmoDecisionLayer;
  let changed = false;

  if (input.itemType === "decision") {
    const reviewStatus = normalizeDecisionReviewStatus(input.reviewStatus);

    if (!reviewStatus || reviewStatus === "unreviewed") {
      throw new Error("Invalid decision review status.");
    }

    updatedLayer = {
      ...layer,
      decisions: layer.decisions.map((item) => {
        if (item.id !== input.itemId) {
          return item;
        }

        changed = true;
        return { ...item, reviewStatus, reviewedAt, reviewedBy, reviewNote };
      }),
    };
  } else if (input.itemType === "assumption") {
    const reviewStatus = normalizeAssumptionReviewStatus(input.reviewStatus);

    if (!reviewStatus || reviewStatus === "unreviewed") {
      throw new Error("Invalid assumption review status.");
    }

    updatedLayer = {
      ...layer,
      assumptions: layer.assumptions.map((item) => {
        if (item.id !== input.itemId) {
          return item;
        }

        changed = true;
        return { ...item, reviewStatus, reviewedAt, reviewedBy, reviewNote };
      }),
    };
  } else if (input.itemType === "suggestedAction") {
    const reviewStatus = normalizeSuggestedActionReviewStatus(input.reviewStatus);

    if (reviewStatus !== "reviewed") {
      throw new Error("Invalid suggested action review status.");
    }

    updatedLayer = {
      ...layer,
      suggestedActions: layer.suggestedActions.map((item) => {
        if (item.id !== input.itemId) {
          return item;
        }

        changed = true;
        return { ...item, reviewStatus, reviewedAt, reviewedBy, reviewNote };
      }),
    };
  } else if (input.itemType === "memoryCandidate") {
    const reviewStatus = normalizeMemoryCandidateReviewStatus(input.reviewStatus);

    if (reviewStatus === "review_required") {
      throw new Error("Invalid memory candidate review status.");
    }

    updatedLayer = {
      ...layer,
      memoryCandidates: layer.memoryCandidates.map((item) => {
        if (item.id !== input.itemId) {
          return item;
        }

        changed = true;
        return { ...item, reviewStatus, reviewedAt, reviewedBy, reviewNote };
      }),
    };
  } else {
    const reviewStatus = normalizeTaskCandidateReviewStatus(input.reviewStatus);

    if (!reviewStatus || reviewStatus === "unreviewed") {
      throw new Error("Invalid task candidate review status.");
    }

    updatedLayer = {
      ...layer,
      taskCandidates: layer.taskCandidates.map((item) => {
        if (item.id !== input.itemId) {
          return item;
        }

        changed = true;
        return { ...item, reviewStatus, reviewedAt, reviewedBy, reviewNote, pushStatus: "not_pushed" };
      }),
    };
  }

  if (!changed) {
    throw new Error("Decision Layer item was not found.");
  }

  const updated: CMOChatSession = {
    ...session,
    decisionLayer: updatedLayer,
    updatedAt: reviewedAt,
  };

  await writeJsonFile(sessionPath(session.id), updated);

  return updated;
}

export interface UpdateSuggestedVaultUpdateReviewInput {
  appId: string;
  sessionId: string;
  candidateKey: string;
  action: CmoVaultUpdateReviewAction;
}

function latestAssistantMessageId(session: CMOChatSession): string {
  return [...session.messages].reverse().find((message) => message.role === "assistant")?.id ?? session.messages.at(-1)?.id ?? session.id;
}

function updateCandidateReviewStatus(
  candidates: Record<string, unknown>[] | undefined,
  candidateKey: string,
  action: CmoVaultUpdateReviewAction,
  reviewedAt: string,
): { candidates: Record<string, unknown>[]; reviewedCandidate?: Record<string, unknown>; changed: boolean } {
  let reviewedCandidate: Record<string, unknown> | undefined;
  let changed = false;
  const candidatesWithKeys = mergeSuggestedVaultUpdates(undefined, candidates);

  const updated = candidatesWithKeys.map((candidate) => {
    if (String(candidate.candidate_key) !== candidateKey) {
      return candidate;
    }

    changed = true;
    reviewedCandidate = {
      ...candidate,
      review_status: action,
      status: action,
      reviewed_by: "user_or_product",
      reviewed_at: reviewedAt,
      vault_write_performed: false,
      requires_user_or_product_approval: true,
    };

    return reviewedCandidate;
  });

  return { candidates: updated, reviewedCandidate, changed };
}

function approvalEventMetadata(events: CmoVaultUpdateApprovalEvent[]): Pick<HermesCmoChatMetadata, "approval_events_count" | "latest_approval_action" | "vault_write_performed" | "endpoint_kind" | "runtime_kind"> {
  return {
    approval_events_count: events.length,
    ...(events.at(-1)?.action ? { latest_approval_action: events.at(-1)?.action } : {}),
    vault_write_performed: false,
    endpoint_kind: "agent_chat",
    runtime_kind: "ai_agent",
  };
}

interface RunSuggestedVaultUpdateDryRunInput {
  appId: string;
  sessionId: string;
  approvalId: string;
}

interface RunSuggestedVaultUpdateWriteInput {
  appId: string;
  sessionId: string;
  approvalId: string;
}

function vaultApprovedWriteDryRunTracePath(session: CMOChatSession, approvalId: string, suffix: "request" | "response" | "error"): string {
  return path.join(
    process.cwd(),
    "data",
    "cmo-dashboard",
    "hermes-cmo-traces",
    `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeId(session.appId)}_${safeId(session.id)}_${safeId(approvalId)}_vault_approved_write_dry_run_${suffix}.json`,
  );
}

function vaultApprovedWriteTracePath(session: CMOChatSession, approvalId: string, suffix: "request" | "response" | "error"): string {
  return path.join(
    process.cwd(),
    "data",
    "cmo-dashboard",
    "hermes-cmo-traces",
    `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeId(session.appId)}_${safeId(session.id)}_${safeId(approvalId)}_vault_approved_write_${suffix}.json`,
  );
}

async function writeVaultApprovedWriteDryRunTrace(
  session: CMOChatSession,
  approvalEvent: CmoVaultUpdateApprovalEvent,
  suffix: "request" | "response" | "error",
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const filePath = vaultApprovedWriteDryRunTracePath(session, approvalEvent.approval_id, suffix);
    const traceRoot = {
      schema_version: "vault_agent.approved_write_dry_run.trace.v1",
      endpoint_kind: "agent_chat",
      runtime_kind: "ai_agent",
      source_endpoint: "/agents/cmo/chat",
      requested_endpoint: VAULT_AGENT_APPROVED_WRITE_DRY_RUN_ENDPOINT,
      app_id: session.appId,
      session_id: session.id,
      approval_id: approvalEvent.approval_id,
      source_response_id: approvalEvent.source_response_id,
      dry_run_results_count: session.vaultUpdateDryRunResults?.length ?? 0,
      latest_dry_run_approval_id: approvalEvent.approval_id,
      vault_write_performed: false,
      ...payload,
    };

    const safeTrace = normalizeSafeMetadataValue(traceRoot);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(safeTrace ?? {}, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn("[cmo-app-chat] Failed to write approved Vault dry-run trace.", {
      sessionId: session.id,
      approvalId: approvalEvent.approval_id,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function writeVaultApprovedWriteTrace(
  session: CMOChatSession,
  approvalEvent: CmoVaultUpdateApprovalEvent,
  suffix: "request" | "response" | "error",
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const filePath = vaultApprovedWriteTracePath(session, approvalEvent.approval_id, suffix);
    const traceRoot = {
      schema_version: "vault_agent.approved_write.trace.v1",
      endpoint_kind: "agent_chat",
      runtime_kind: "ai_agent",
      source_endpoint: "/agents/cmo/chat",
      requested_endpoint: VAULT_AGENT_APPROVED_WRITE_ENDPOINT,
      app_id: session.appId,
      session_id: session.id,
      approval_id: approvalEvent.approval_id,
      source_response_id: approvalEvent.source_response_id,
      write_results_count: session.vaultUpdateWriteResults?.length ?? 0,
      latest_write_approval_id: approvalEvent.approval_id,
      vault_write_performed: false,
      ...payload,
    };

    const safeTrace = normalizeSafeMetadataValue(traceRoot);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(safeTrace ?? {}, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn("[cmo-app-chat] Failed to write approved Vault write trace.", {
      sessionId: session.id,
      approvalId: approvalEvent.approval_id,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readHermesDryRunJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error("Hermes Vault Agent dry-run returned an empty response.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Hermes Vault Agent dry-run returned malformed JSON.");
  }
}

function approvedUpdateSummaryForDryRun(approvedUpdate: Record<string, unknown>): string {
  const summary = candidateString(approvedUpdate, ["summary"], 1_500);

  if (summary) {
    return summary;
  }

  const decision = candidateString(approvedUpdate, ["decision"], 1_000);
  const rationale = candidateString(approvedUpdate, ["rationale"], 1_500);

  if (decision && rationale) {
    return compactSessionSourceText(`${decision}\n\nRationale: ${rationale}`, 1_500);
  }

  return decision ||
    rationale ||
    candidateString(approvedUpdate, ["subject"], 1_500) ||
    candidateString(approvedUpdate, ["title"], 1_500) ||
    candidateString(approvedUpdate, ["name"], 1_500);
}

function dryRunApprovalEventEnvelope(approvalEvent: CmoVaultUpdateApprovalEvent): CmoVaultUpdateApprovalEvent {
  if (!approvalEvent.approved_update) {
    return approvalEvent;
  }

  const generatedSummary = approvedUpdateSummaryForDryRun(approvalEvent.approved_update);
  const title = candidateString(approvalEvent.approved_update, ["title"], 1_500);
  const subject = candidateString(approvalEvent.approved_update, ["subject"], 1_500);
  const updateType = candidateString(approvalEvent.approved_update, ["type"], 240);
  const updateKind = candidateString(approvalEvent.approved_update, ["kind"], 120);
  const dryRunApprovedUpdate = {
    ...approvalEvent.approved_update,
    ...(!updateType && updateKind ? { type: updateKind } : {}),
    ...(!updateKind && updateType ? { kind: updateType } : {}),
    ...(generatedSummary ? { summary: generatedSummary } : {}),
    ...(!subject && title ? { subject: title } : {}),
  };

  return {
    ...approvalEvent,
    approved_update: dryRunApprovedUpdate,
    reviewed_update: approvalEvent.reviewed_update === approvalEvent.approved_update
      ? dryRunApprovedUpdate
      : approvalEvent.reviewed_update,
    vault_write_performed: false,
  };
}

function dryRunRequestEnvelope(approvalEvent: CmoVaultUpdateApprovalEvent): Record<string, unknown> {
  const normalizedApprovalEvent = dryRunApprovalEventEnvelope(approvalEvent);

  return {
    ...normalizedApprovalEvent,
    vault_write_performed: false,
  };
}

async function callVaultAgentApprovedWriteDryRun(
  session: CMOChatSession,
  approvalEvent: CmoVaultUpdateApprovalEvent,
): Promise<unknown> {
  const baseUrl = getCmoHermesBaseUrl();
  const apiKey = getCmoHermesApiKey();
  const timeoutMs = getCmoHermesTimeoutMs();

  if (!baseUrl) {
    throw new Error("CMO_HERMES_BASE_URL is not configured.");
  }

  if (!apiKey) {
    throw new Error("CMO_HERMES_API_KEY is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestEnvelope = dryRunRequestEnvelope(approvalEvent);

  await writeVaultApprovedWriteDryRunTrace(session, approvalEvent, "request", {
    request: requestEnvelope,
    timeout_ms: timeoutMs,
  });

  try {
    const response = await fetch(`${baseUrl}${VAULT_AGENT_APPROVED_WRITE_DRY_RUN_ENDPOINT}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestEnvelope),
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = await readHermesDryRunJson(response);

    if (!response.ok) {
      throw new Error(`Hermes Vault Agent dry-run failed with HTTP ${response.status}.`);
    }

    await writeVaultApprovedWriteDryRunTrace(session, approvalEvent, "response", {
      http_status: response.status,
      response: payload,
    });

    return payload;
  } catch (error) {
    await writeVaultApprovedWriteDryRunTrace(session, approvalEvent, "error", {
      error: error instanceof Error ? error.message : String(error),
      vault_write_performed: false,
    });

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Hermes Vault Agent dry-run request timed out.");
    }

    throw error instanceof Error ? error : new Error("Hermes Vault Agent dry-run failed.");
  } finally {
    clearTimeout(timeout);
  }
}

function writeRequestEnvelope(
  approvalEvent: CmoVaultUpdateApprovalEvent,
  dryRunResult: CmoVaultApprovedWriteDryRunResult,
): Record<string, unknown> {
  const normalizedApprovalEvent = dryRunApprovalEventEnvelope(approvalEvent);

  return {
    ...normalizedApprovalEvent,
    idempotency_key: dryRunResult.idempotency_key,
    approval_payload_hash: dryRunResult.approval_payload_hash,
    expected_approval_payload_hash: dryRunResult.approval_payload_hash,
    dry_run: {
      schema_version: dryRunResult.schema_version,
      approval_id: dryRunResult.approval_id,
      idempotency_key: dryRunResult.idempotency_key,
      approval_payload_hash: dryRunResult.approval_payload_hash,
      dry_run: true,
      write_allowed: dryRunResult.write_allowed,
      vault_write_performed: false,
      target_preview: dryRunResult.target_preview,
      frontmatter_preview: dryRunResult.frontmatter_preview,
      body_preview: dryRunResult.body_preview,
      side_effects: dryRunResult.side_effects,
    },
    vault_write_performed: false,
  };
}

async function callVaultAgentApprovedWrite(
  session: CMOChatSession,
  approvalEvent: CmoVaultUpdateApprovalEvent,
  dryRunResult: CmoVaultApprovedWriteDryRunResult,
): Promise<unknown> {
  const baseUrl = getCmoHermesBaseUrl();
  const apiKey = getCmoHermesApiKey();
  const timeoutMs = getCmoHermesTimeoutMs();

  if (!baseUrl) {
    throw new Error("CMO_HERMES_BASE_URL is not configured.");
  }

  if (!apiKey) {
    throw new Error("CMO_HERMES_API_KEY is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestEnvelope = writeRequestEnvelope(approvalEvent, dryRunResult);

  await writeVaultApprovedWriteTrace(session, approvalEvent, "request", {
    request: requestEnvelope,
    timeout_ms: timeoutMs,
  });

  try {
    const response = await fetch(`${baseUrl}${VAULT_AGENT_APPROVED_WRITE_ENDPOINT}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestEnvelope),
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = await readHermesDryRunJson(response);

    if (!response.ok) {
      throw new Error(`Hermes Vault Agent approved-write failed with HTTP ${response.status}.`);
    }

    await writeVaultApprovedWriteTrace(session, approvalEvent, "response", {
      http_status: response.status,
      response: payload,
    });

    return payload;
  } catch (error) {
    await writeVaultApprovedWriteTrace(session, approvalEvent, "error", {
      error: error instanceof Error ? error.message : String(error),
      vault_write_performed: false,
    });

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Hermes Vault Agent approved-write request timed out.");
    }

    throw error instanceof Error ? error : new Error("Hermes Vault Agent approved-write failed.");
  } finally {
    clearTimeout(timeout);
  }
}

function dryRunConflictResult(
  existing: CmoVaultApprovedWriteDryRunResult,
  next: CmoVaultApprovedWriteDryRunResult,
  createdAt: string,
): CmoVaultApprovedWriteDryRunResult {
  const warnings = [
    ...(next.warnings ?? []),
    "approval_payload_hash changed for an existing approval_id; write is blocked until reviewed.",
  ].slice(0, 20);

  return {
    ...next,
    dry_run: true,
    write_allowed: false,
    vault_write_performed: false,
    status: "conflict",
    conflict: true,
    previous_approval_payload_hash: existing.approval_payload_hash,
    latest_approval_payload_hash: next.approval_payload_hash,
    warnings,
    created_at: createdAt,
  };
}

function writeConflictResult(
  approvalId: string,
  existingHash: string,
  latestHash: string,
  createdAt: string,
): CmoVaultApprovedWriteResult {
  return {
    schema_version: "vault_agent.approved_write_result.v1",
    approval_id: approvalId,
    idempotency_key: `conflict_${approvalId}`,
    approval_payload_hash: latestHash,
    vault_write_performed: false,
    conflict: true,
    warnings: ["approval_payload_hash changed for an existing approval_id; Vault write is blocked."],
    errors: ["approval_payload_hash_conflict"],
    created_at: createdAt,
    status: "conflict",
    previous_approval_payload_hash: existingHash,
    latest_approval_payload_hash: latestHash,
  };
}

export async function updateSuggestedVaultUpdateReview(input: UpdateSuggestedVaultUpdateReviewInput): Promise<CMOChatSession | null> {
  const app = getAppWorkspace(input.appId);

  if (!app) {
    throw new Error(`Unknown appId: ${input.appId}`);
  }

  const session = await readAppChatSession(input.sessionId);

  if (!session) {
    return null;
  }

  if (session.appId !== app.id) {
    throw new Error("Session does not belong to the requested app.");
  }

  const action = normalizeVaultUpdateApprovalAction(input.action);
  const candidateKey = input.candidateKey.trim();

  if (!action || !candidateKey) {
    throw new Error("Invalid suggested Vault update review action.");
  }

  const reviewedAt = new Date().toISOString();
  const sessionCandidateUpdate = updateCandidateReviewStatus(session.suggestedVaultUpdates, candidateKey, action, reviewedAt);
  let reviewedCandidate = sessionCandidateUpdate.reviewedCandidate;
  let changed = sessionCandidateUpdate.changed;
  let sourceResponseId = latestAssistantMessageId(session);
  let turnId = sourceResponseId;

  const messages = session.messages.map((message) => {
    const messageCandidateUpdate = updateCandidateReviewStatus(message.suggestedVaultUpdates, candidateKey, action, reviewedAt);

    if (messageCandidateUpdate.changed) {
      changed = true;
      reviewedCandidate = messageCandidateUpdate.reviewedCandidate ?? reviewedCandidate;
      sourceResponseId = message.id;
      turnId = stringValue(reviewedCandidate?.turn_id ?? reviewedCandidate?.source_turn_id, message.id);
    }

    return {
      ...message,
      ...(messageCandidateUpdate.candidates.length ? { suggestedVaultUpdates: messageCandidateUpdate.candidates } : {}),
    };
  });

  if (!changed || !reviewedCandidate) {
    throw new Error("Suggested Vault update candidate was not found.");
  }

  const reviewedUpdate = normalizeSuggestedVaultUpdateCandidate(reviewedCandidate);
  const approvalEvent: CmoVaultUpdateApprovalEvent = {
    schema_version: "cmo.vault_update_approval.v1",
    approval_id: `approval_${randomUUID()}`,
    tenant_id: app.tenantId,
    workspace_id: app.workspaceId,
    session_id: session.id,
    turn_id: turnId,
    source_endpoint: "/agents/cmo/chat",
    source_response_id: sourceResponseId,
    action,
    review_status: action,
    approved_by: "user_or_product",
    approved_at: reviewedAt,
    reviewed_update: reviewedUpdate,
    ...(action === "approved" ? { approved_update: reviewedUpdate } : {}),
    ...(action === "rejected" ? { rejected_update: reviewedUpdate } : {}),
    ...(action === "deferred" ? { deferred_update: reviewedUpdate } : {}),
    vault_write_performed: false,
  };
  const approvalEvents = [...(session.vaultUpdateApprovalEvents ?? []), approvalEvent].slice(-MAX_VAULT_UPDATE_APPROVAL_EVENTS);
  const metadataPatch = approvalEventMetadata(approvalEvents);
  const updatedSessionCandidates = sessionCandidateUpdate.changed
    ? sessionCandidateUpdate.candidates
    : mergeSuggestedVaultUpdates(session.suggestedVaultUpdates, [reviewedUpdate]);
  const messagesWithApprovalEvents = messages.map((message) =>
    message.id === sourceResponseId
      ? {
          ...message,
          vaultUpdateApprovalEvents: approvalEvents,
          ...(message.hermesCmoMetadata
            ? {
                hermesCmoMetadata: {
                  ...message.hermesCmoMetadata,
                  ...metadataPatch,
                  suggested_vault_updates_count: updatedSessionCandidates.length,
                },
              }
            : {}),
        }
      : message,
  );
  const updated: CMOChatSession = {
    ...session,
    suggestedVaultUpdates: updatedSessionCandidates,
    vaultUpdateApprovalEvents: approvalEvents,
    messages: messagesWithApprovalEvents,
    updatedAt: reviewedAt,
    ...(session.hermesCmoMetadata
      ? {
          hermesCmoMetadata: {
            ...session.hermesCmoMetadata,
            ...metadataPatch,
            suggested_vault_updates_count: updatedSessionCandidates.length,
          },
        }
      : {}),
  };

  await writeJsonFile(sessionPath(session.id), updated);

  return normalizeSession(updated);
}

export async function runSuggestedVaultUpdateDryRun(input: RunSuggestedVaultUpdateDryRunInput): Promise<CMOChatSession | null> {
  const app = getAppWorkspace(input.appId);

  if (!app) {
    throw new Error(`Unknown appId: ${input.appId}`);
  }

  const session = await readAppChatSession(input.sessionId);

  if (!session) {
    return null;
  }

  if (session.appId !== app.id) {
    throw new Error("Session does not belong to the requested app.");
  }

  const approvalId = input.approvalId.trim();
  const approvalEvent = (session.vaultUpdateApprovalEvents ?? []).find((event) => event.approval_id === approvalId);

  if (!approvalId || !approvalEvent) {
    throw new Error("Vault update approval event was not found.");
  }

  if (approvalEvent.action !== "approved" || approvalEvent.review_status !== "approved") {
    throw new Error("Only approved Vault update approval events can be dry-run previewed.");
  }

  if (!approvalEvent.approved_update) {
    throw new Error("Approved Vault update event is missing approved_update.");
  }

  const dryRunCreatedAt = new Date().toISOString();
  const currentProductPayloadHash = productApprovalPayloadHash(approvalEvent);
  const payload = await callVaultAgentApprovedWriteDryRun(session, approvalEvent);
  const normalized = normalizeVaultApprovedWriteDryRunResult(payload, approvalId, dryRunCreatedAt);

  if (!normalized) {
    throw new Error("Hermes Vault Agent dry-run response was malformed.");
  }

  const existing = (session.vaultUpdateDryRunResults ?? []).find((result) => result.approval_id === approvalId);
  const normalizedWithProductHash = { ...normalized, product_approval_payload_hash: currentProductPayloadHash };
  const result = existing && existing.approval_payload_hash !== normalizedWithProductHash.approval_payload_hash
    ? dryRunConflictResult(existing, normalizedWithProductHash, dryRunCreatedAt)
    : { ...normalizedWithProductHash, created_at: dryRunCreatedAt, vault_write_performed: false as const };
  const vaultUpdateDryRunResults = mergeVaultApprovedWriteDryRunResults(session.vaultUpdateDryRunResults, result);
  const metadataPatch = dryRunResultMetadata(vaultUpdateDryRunResults);
  const messages = session.messages.map((message) =>
    message.id === approvalEvent.source_response_id
      ? {
          ...message,
          vaultUpdateDryRunResults,
          ...(message.hermesCmoMetadata
            ? {
                hermesCmoMetadata: {
                  ...message.hermesCmoMetadata,
                  ...metadataPatch,
                },
              }
            : {}),
        }
      : message,
  );
  const updated: CMOChatSession = {
    ...session,
    vaultUpdateDryRunResults,
    messages,
    updatedAt: dryRunCreatedAt,
    ...(session.hermesCmoMetadata
      ? {
          hermesCmoMetadata: {
            ...session.hermesCmoMetadata,
            ...metadataPatch,
          },
        }
      : {}),
  };

  await writeJsonFile(sessionPath(session.id), updated);
  await writeVaultApprovedWriteDryRunTrace(updated, approvalEvent, "response", {
    dry_run_results_count: vaultUpdateDryRunResults.length,
    latest_dry_run_status: result.status,
    latest_dry_run_approval_id: result.approval_id,
    latest_dry_run_write_allowed: result.write_allowed,
    vault_write_performed: false,
    result,
  });

  return normalizeSession(updated);
}

export async function runSuggestedVaultUpdateWrite(input: RunSuggestedVaultUpdateWriteInput): Promise<CMOChatSession | null> {
  const app = getAppWorkspace(input.appId);

  if (!app) {
    throw new Error(`Unknown appId: ${input.appId}`);
  }

  const session = await readAppChatSession(input.sessionId);

  if (!session) {
    return null;
  }

  if (session.appId !== app.id) {
    throw new Error("Session does not belong to the requested app.");
  }

  const approvalId = input.approvalId.trim();
  const approvalEvent = (session.vaultUpdateApprovalEvents ?? []).find((event) => event.approval_id === approvalId);

  if (!approvalId || !approvalEvent) {
    throw new Error("Vault update approval event was not found.");
  }

  if (approvalEvent.action !== "approved" || approvalEvent.review_status !== "approved") {
    throw new Error("Only approved Vault update approval events can be written.");
  }

  if (!approvalEvent.approved_update) {
    throw new Error("Approved Vault update event is missing approved_update.");
  }

  const dryRunResult = [...(session.vaultUpdateDryRunResults ?? [])].reverse().find((result) => result.approval_id === approvalId);

  if (!dryRunResult) {
    throw new Error("Approved Vault update requires a successful dry-run before write.");
  }

  if (
    dryRunResult.dry_run !== true ||
    dryRunResult.write_allowed !== true ||
    dryRunResult.vault_write_performed !== false ||
    dryRunResult.conflict === true ||
    Boolean(dryRunResult.errors?.length)
  ) {
    throw new Error("Approved Vault update dry-run is not write-eligible.");
  }

  const currentProductPayloadHash = productApprovalPayloadHash(approvalEvent);

  if (!dryRunResult.product_approval_payload_hash || dryRunResult.product_approval_payload_hash !== currentProductPayloadHash) {
    throw new Error("Approved Vault update dry-run payload hash no longer matches the approval event.");
  }

  const existingWrite = [...(session.vaultUpdateWriteResults ?? [])].reverse().find((result) => result.approval_id === approvalId);
  const writeCreatedAt = new Date().toISOString();
  const existingWriteSucceeded =
    existingWrite?.approval_payload_hash === dryRunResult.approval_payload_hash &&
    existingWrite.conflict !== true &&
    !existingWrite.errors?.length &&
    (existingWrite.vault_write_performed === true || existingWrite.deduped === true || existingWrite.status === "completed" || existingWrite.status === "deduped");

  if (existingWriteSucceeded) {
    return session;
  }

  if (existingWrite && existingWrite.approval_payload_hash !== dryRunResult.approval_payload_hash) {
    const conflictResult = writeConflictResult(approvalId, existingWrite.approval_payload_hash, dryRunResult.approval_payload_hash, writeCreatedAt);
    const vaultUpdateWriteResults = mergeVaultApprovedWriteResults(session.vaultUpdateWriteResults, conflictResult);
    const metadataPatch = writeResultMetadata(vaultUpdateWriteResults);
    const updated: CMOChatSession = {
      ...session,
      vaultUpdateWriteResults,
      updatedAt: writeCreatedAt,
      ...(session.hermesCmoMetadata
        ? { hermesCmoMetadata: { ...session.hermesCmoMetadata, ...metadataPatch } }
        : {}),
      messages: session.messages.map((message) =>
        message.id === approvalEvent.source_response_id
          ? {
              ...message,
              vaultUpdateWriteResults,
              ...(message.hermesCmoMetadata ? { hermesCmoMetadata: { ...message.hermesCmoMetadata, ...metadataPatch } } : {}),
            }
          : message,
      ),
    };

    await writeJsonFile(sessionPath(session.id), updated);
    return normalizeSession(updated);
  }

  const payload = await callVaultAgentApprovedWrite(session, approvalEvent, dryRunResult);
  const normalized = normalizeVaultApprovedWriteResult(payload, approvalId, writeCreatedAt);

  if (!normalized) {
    throw new Error("Hermes Vault Agent approved-write response was malformed.");
  }

  const result = normalized.approval_payload_hash !== dryRunResult.approval_payload_hash
    ? writeConflictResult(approvalId, dryRunResult.approval_payload_hash, normalized.approval_payload_hash, writeCreatedAt)
    : {
        ...normalized,
        product_approval_payload_hash: currentProductPayloadHash,
        created_at: writeCreatedAt,
      };
  const vaultUpdateWriteResults = mergeVaultApprovedWriteResults(session.vaultUpdateWriteResults, result);
  const metadataPatch = writeResultMetadata(vaultUpdateWriteResults);
  const messages = session.messages.map((message) =>
    message.id === approvalEvent.source_response_id
      ? {
          ...message,
          vaultUpdateWriteResults,
          ...(message.hermesCmoMetadata
            ? {
                hermesCmoMetadata: {
                  ...message.hermesCmoMetadata,
                  ...metadataPatch,
                },
              }
            : {}),
        }
      : message,
  );
  const updated: CMOChatSession = {
    ...session,
    vaultUpdateWriteResults,
    messages,
    updatedAt: writeCreatedAt,
    ...(session.hermesCmoMetadata
      ? {
          hermesCmoMetadata: {
            ...session.hermesCmoMetadata,
            ...metadataPatch,
          },
        }
      : {}),
  };

  await writeJsonFile(sessionPath(session.id), updated);
  await writeVaultApprovedWriteTrace(updated, approvalEvent, "response", {
    write_results_count: vaultUpdateWriteResults.length,
    latest_write_status: result.status,
    latest_write_approval_id: result.approval_id,
    latest_vault_path: result.vault_path,
    vault_write_performed: result.vault_write_performed,
    side_effects: result.side_effects,
    result,
  });

  return normalizeSession(updated);
}
