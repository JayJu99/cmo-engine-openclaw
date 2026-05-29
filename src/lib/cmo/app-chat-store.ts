import { randomUUID } from "crypto";
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
  CmoAuthMode,
  CmoDecisionLabel,
  CmoRuntimeErrorReason,
  CmoRuntimeMode,
  CmoStrategyMode,
  CmoAssumptionReviewStatus,
  CmoDecisionLayer,
  CmoDecisionReviewStatus,
  CmoIndexedContextStatus,
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
  CmoMemoryCandidateReviewStatus,
  CmoSuggestedActionReviewStatus,
  CmoTaskCandidateReviewStatus,
  ContextGraphHint,
  ContextGraphHintConfidence,
  ContextGraphHintSourceType,
  ContextGraphStatus,
  VaultNoteRef,
} from "@/lib/cmo/app-workspace-types";
import { getAppWorkspace, HOLDSTATION_WORKSPACE_ID } from "@/lib/cmo/app-workspaces";
import { buildContextPack, withContextPackMessage } from "@/lib/cmo/context-pack-builder";
import { summarizeContextQuality } from "@/lib/cmo/context-quality";
import { buildDecisionLayer } from "@/lib/cmo/decision-layer";
import { CmoAdapterError } from "@/lib/cmo/errors";
import { routeIntentForMessage } from "@/lib/cmo/app-routing-intent";
import { executeMixedCmoEcho, isMixedCmoEchoRequest, mixedEchoNeedsClarification, buildMixedCmoEchoRuntimeMessage, maybeHandleEchoBridge } from "@/lib/cmo/echo-bridge";
import { buildCmoEvidenceRuntimeMessage, executeCmoSurfEvidence } from "@/lib/cmo/cmo-surf-orchestrator";
import {
  HERMES_CMO_PROPOSALS_ONLY,
  mapCmoChatToHermesCmoRequest,
  mapHermesCmoResponseToChatResult,
  validateHermesCmoChatCounters,
} from "@/lib/cmo/hermes-cmo-chat-mapper";
import { shouldUseHermesCmoChat } from "@/lib/cmo/hermes-cmo-chat-router";
import { runHermesCmoRuntime } from "@/lib/cmo/hermes-cmo-runtime";
import { maybeHandleSurfBridge } from "@/lib/cmo/surf-bridge";
import { FallbackRuntime, getRuntimeRegistry } from "@/lib/cmo/runtime";
import { indexChatMessages, indexChatSession, type CmoIndexResult } from "@/lib/cmo/supabase-indexing";
import { applyIndexedContextSupplement, buildIndexedContextSupplement } from "@/lib/cmo/indexed-context-canary";
import { legacyUserIdentity, type CmoServerUserIdentity } from "@/lib/cmo/user-metadata";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";
import { autoCaptureTurnOnce } from "@/lib/cmo/vault-auto-capture";
import { runVaultAgentDryRunHandoff } from "@/lib/cmo/vault-agent-handoff-builder";

const APP_CHAT_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "app-chat");
const DEFAULT_LIMIT = 20;
const CONTEXT_SIZE_WARNING_CHARS = 32_000;
const INDEXED_SUPPLEMENT_WARNING_CHARS = 4_000;

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
  const workspaceId = stringValue(body.workspaceId, registryEntry.workspaceId);

  if (workspaceId !== HOLDSTATION_WORKSPACE_ID || workspaceId !== registryEntry.workspaceId) {
    throw new CmoAdapterError(`Unsupported workspaceId: ${workspaceId}`, 400, "cmo_app_chat_unsupported_workspace");
  }

  return {
    workspaceId,
    appId,
    appName,
    sessionId: stringValue(body.sessionId) || undefined,
    message,
    topic: stringValue(body.topic),
    forceFallback: body.forceFallback === true || (isRecord(body.context) && body.context.forceFallback === true),
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
  return value === "live" || value === "failed_then_existing_fallback" || value === "guardrail_violation_then_existing_fallback"
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
  return value === "cmo" || value === "echo" || value === "surf" ? value : undefined;
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

      const targetAgent = item.targetAgent === "echo" || item.targetAgent === "surf" ? item.targetAgent : null;
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
  if (!isRecord(value) || value.runtimeMode !== "hermes_cmo" || value.runtimeStatus !== "live" || value.calledHermesCmo !== true) {
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
  const platformPersistenceSummary = normalizeHermesCmoPlatformPersistenceSummary(value.platformPersistenceSummary);

  return {
    runtimeMode: "hermes_cmo",
    runtimeStatus: "live",
    calledHermesCmo: true,
    delegationsMode: normalizeHermesCmoDelegationsMode(value.delegationsMode) ?? HERMES_CMO_PROPOSALS_ONLY,
    counters,
    forbiddenCounters,
    requestId,
    responseStatus,
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

  const mode = value.vault_handoff_mode === "dry_run" ? "dry_run" : value.vault_handoff_mode === "off" ? "off" : undefined;
  const status = value.vault_handoff_status === "skipped" ||
    value.vault_handoff_status === "dry_run_valid" ||
    value.vault_handoff_status === "dry_run_invalid" ||
    value.vault_handoff_status === "failed"
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
    vault_handoff_warnings: normalizeStringList(value.vault_handoff_warnings),
    vault_handoff_errors: normalizeStringList(value.vault_handoff_errors),
  };
}

function messageUserMetadata(identity: CmoServerUserIdentity): Pick<CMOChatMessage, "authMode" | "userId" | "userEmail"> {
  return {
    authMode: identity.authMode,
    ...(identity.userId ? { userId: identity.userId } : {}),
    ...(identity.userEmail ? { userEmail: identity.userEmail } : {}),
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

  const messages = Array.isArray(value.messages)
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
            content: stringValue(message.content),
            createdAt: stringValue(message.createdAt, new Date(0).toISOString()),
            authMode: normalizeAuthMode(message.authMode),
            userId: normalizeOptionalString(message.userId),
            userEmail: normalizeOptionalString(message.userEmail),
            sourceUserId: normalizeOptionalString(message.sourceUserId),
            sourceUserEmail: normalizeOptionalString(message.sourceUserEmail),
            sourceUserMessageId: normalizeOptionalString(message.sourceUserMessageId),
            runtimeMode: normalizeRuntimeMode(message.runtimeMode, normalizeRuntimeStatus(message.runtimeStatus, false), false),
            runtimeStatus: normalizeRuntimeStatus(message.runtimeStatus, false),
            runtimeProvider: normalizeRuntimeProvider(message.runtimeProvider),
            runtimeAgent: normalizeRuntimeProvider(message.runtimeAgent),
            runtimeErrorReason: normalizeRuntimeErrorReason(message.runtimeErrorReason),
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
            contextSourceCount: normalizeOptionalNonNegativeNumber(message.contextSourceCount),
            contextCharLength: normalizeOptionalNonNegativeNumber(message.contextCharLength),
            indexedSupplementCharLength: normalizeOptionalNonNegativeNumber(message.indexedSupplementCharLength),
            authDurationMs: normalizeOptionalNonNegativeNumber(message.authDurationMs),
            sessionResolutionDurationMs: normalizeOptionalNonNegativeNumber(message.sessionResolutionDurationMs),
            contextPackBuildDurationMs: normalizeOptionalNonNegativeNumber(message.contextPackBuildDurationMs),
            indexedContextBuildDurationMs: normalizeOptionalNonNegativeNumber(message.indexedContextBuildDurationMs),
          };
        })
        .filter((message): message is CMOChatMessage => Boolean(message))
    : [];
  const contextUsed = normalizeSelectedNotes(value.contextUsed);
  const missingContext = normalizeSelectedNotes(value.missingContext);
  const graphHints = normalizeGraphHints(value.graphHints);
  const decisionLayer = normalizeDecisionLayer(value.decisionLayer);
  const contextDiagnostics = normalizeContextDiagnostics(value.contextDiagnostics);
  const runtimeStatus = normalizeRuntimeStatus(value.runtimeStatus, value.isDevelopmentFallback === true);

  return {
    id,
    appId,
    appName,
    topic: stringValue(value.topic),
    authMode: normalizeAuthMode(value.authMode),
    userId: normalizeOptionalString(value.userId),
    userEmail: normalizeOptionalString(value.userEmail),
    organizationId: normalizeOptionalString(value.organizationId),
    createdByUserId: normalizeOptionalString(value.createdByUserId),
    createdByEmail: normalizeOptionalString(value.createdByEmail),
    messages,
    contextUsed,
    status: value.status === "running" || value.status === "failed" ? value.status : "completed",
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
    contextSourceCount: normalizeOptionalNonNegativeNumber(value.contextSourceCount),
    contextCharLength: normalizeOptionalNonNegativeNumber(value.contextCharLength),
    indexedSupplementCharLength: normalizeOptionalNonNegativeNumber(value.indexedSupplementCharLength),
    authDurationMs: normalizeOptionalNonNegativeNumber(value.authDurationMs),
    sessionResolutionDurationMs: normalizeOptionalNonNegativeNumber(value.sessionResolutionDurationMs),
    contextPackBuildDurationMs: normalizeOptionalNonNegativeNumber(value.contextPackBuildDurationMs),
    indexedContextBuildDurationMs: normalizeOptionalNonNegativeNumber(value.indexedContextBuildDurationMs),
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
  const sessionResolutionDurationMs = Date.now() - sessionResolutionStartedMs;
  const messageId = `msg_${randomUUID().slice(0, 12)}`;
  const assistantId = `msg_${randomUUID().slice(0, 12)}`;
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
  const { contextPackage, contextUsed, missingContext, contextDiagnostics, contextQualitySummary } = contextPackResult;
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
  const sessionId = continuedSession?.id ?? `session_${now.replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
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

  if (!request.forceFallback && shouldUseHermesCmoChat(request.appId)) {
    const hermesStartedAt = new Date().toISOString();
    const hermesStartedMs = Date.now();

    try {
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
      });
      const hermesResult = await runHermesCmoRuntime(hermesRequest);
      const counterValidation = validateHermesCmoChatCounters(hermesResult);

      if (!counterValidation.ok) {
        throw new Error(counterValidation.errorReason ?? "invalid_counters_schema");
      }

      const mappedHermesResult = mapHermesCmoResponseToChatResult(hermesResult);

      answer = mappedHermesResult.answer;
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
      timeoutMs = undefined;
      calledHermesCmo = true;
      hermesCmoStatus = mappedHermesResult.hermesCmoStatus;
      hermesCmoCounters = mappedHermesResult.hermesCmoCounters;
      hermesCmoMetadata = mappedHermesResult.hermesCmoMetadata;
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
      usedHermesCmoChat = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Hermes CMO chat runtime failed.";

      console.warn("[cmo-app-chat] Hermes CMO chat failed; using existing CMO chat path.", {
        appId: request.appId,
        sessionId,
        reason,
      });

      calledHermesCmo = true;
      hermesCmoStatus = reason.startsWith("forbidden_counter_non_zero:") || reason.startsWith("invalid_counters_schema:")
        ? "guardrail_violation_then_existing_fallback"
        : "failed_then_existing_fallback";
      hermesCmoErrorReason = reason;
      delegationsMode = HERMES_CMO_PROPOSALS_ONLY;
    }
  }

  if (!usedHermesCmoChat) {
  const routeIntent = routeIntentForMessage(request.message);
  const allowDirectSurfBridge = routeIntent === "surf_x" || routeIntent === "surf_trend" || routeIntent === "surf_research";
  const allowDirectEchoBridge = routeIntent === "echo_execution";
  const surfBridge = allowDirectSurfBridge ? await maybeHandleSurfBridge(request) : { handled: false };
  const echoBridge = !surfBridge.handled && allowDirectEchoBridge ? await maybeHandleEchoBridge(request) : { handled: false };
  const mixedCmoEchoRequest = !surfBridge.handled && !echoBridge.handled && routeIntent !== "cmo_review" && isMixedCmoEchoRequest(request.message);
  const mixedCmoEchoClarification = mixedCmoEchoRequest && mixedEchoNeedsClarification(request.message);
  const cmoSurfEvidence = !surfBridge.handled && !echoBridge.handled && !mixedCmoEchoRequest && routeIntent !== "cmo_review" ? await executeCmoSurfEvidence(request) : undefined;
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
      status = "completed";
    } else {
    const runtimeResult = await runtime.runTurn({
      contextPack: contextPackage.contextPack,
      contextPackage,
      message: mixedCmoEchoRequest && !mixedCmoEchoClarification
        ? buildMixedCmoEchoRuntimeMessage(request.message)
        : cmoSurfEvidence && (cmoSurfEvidence.plan.action === "call_surf" || cmoSurfEvidence.plan.action === "call_surf_x")
          ? buildCmoEvidenceRuntimeMessage(request.message, cmoSurfEvidence)
          : request.message,
      history: continuedSession?.messages ?? [],
      request,
      contextUsed,
      missingContext,
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
    liveAttemptStartedAt = runtimeResult.liveAttemptStartedAt;
    liveAttemptDurationMs = runtimeResult.liveAttemptDurationMs;
    fallbackDurationMs = runtimeResult.fallbackDurationMs;
    timeoutMs = runtimeResult.timeoutMs;
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
    answer = [
      "Runtime boundary error: CMO runtime registry could not produce a usable answer.",
      runtimeError,
      "No live runtime was assumed.",
    ].join("\n");
  }
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
    contextSourceCount,
    contextCharLength,
    indexedSupplementCharLength,
  };

  const session: CMOChatSession = {
    id: sessionId,
    appId: request.appId,
    appName: request.appName,
    topic: continuedSession?.topic || request.topic || request.message.slice(0, 96),
    authMode: continuedSession?.authMode ?? userIdentity.authMode,
    userId: continuedSession?.userId ?? userIdentity.userId,
    userEmail: continuedSession?.userEmail ?? userIdentity.userEmail,
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
      },
      {
        id: assistantId,
        role: "assistant",
        content: answer,
        createdAt: now,
        ...assistantSourceMetadata(userIdentity, messageId),
        runtimeMode,
        runtimeStatus,
        ...(runtimeProvider ? { runtimeProvider } : {}),
        ...(runtimeAgent ? { runtimeAgent } : {}),
        ...(runtimeErrorReason ? { runtimeErrorReason } : {}),
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
        contextUsedCount: contextUsed.length,
        graphHintCount,
        indexedContextStatus,
        indexedContextSourcesCount,
        ...(indexedContextFallbackReason ? { indexedContextFallbackReason } : {}),
        ...timingMetadata,
      },
    ],
  };

  await writeJsonFile(sessionPath(sessionId), session);

  let persistedSession = session;
  const autoCapture = status === "completed" ? await autoCaptureTurnOnce({
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
  }) : { ok: false, savedToVault: false, warnings: [], error: "Chat response failed; auto capture skipped" };
  const vaultAgentHandoff = status === "completed" ? runVaultAgentDryRunHandoff({
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
  const vaultAgentDryRunMetadata = vaultAgentHandoff?.mode === "dry_run" ? vaultAgentHandoff.metadata : undefined;
  if (status === "completed") {
    const finalTotalDurationMs = Date.now() - requestStartedMs;
    persistedSession = {
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
      rawCaptureStatus: autoCapture.ok ? "saved" : "failed",
      ...(autoCapture.error ? { rawCaptureError: autoCapture.error } : {}),
    };
    await writeJsonFile(sessionPath(sessionId), persistedSession);
  }
  const sessionIndexResult = await indexChatSession({
    session: persistedSession,
    jsonPath: sessionJsonIndexPath(sessionId),
    auditCreated: !continuedSession,
  });
  const messageIndexResults = await indexChatMessages({
    session: persistedSession,
    messages: session.messages.slice(-2),
  });
  const platformPersistenceSummary: HermesCmoPlatformPersistenceSummary = {
    sessionJsonSaved: true,
    rawCaptureSaved: autoCapture.ok === true,
    ...(persistedSession.rawCaptureStatus ? { rawCaptureStatus: persistedSession.rawCaptureStatus } : {}),
    supabaseIndexingStatus: supabaseIndexingStatus([sessionIndexResult, ...messageIndexResults]),
  };

  if (calledHermesCmo && hermesCmoMetadata) {
    persistedSession = attachHermesCmoPlatformPersistence(persistedSession, assistantId, platformPersistenceSummary);
    hermesCmoMetadata = {
      ...hermesCmoMetadata,
      platformPersistenceSummary,
    };
    await writeJsonFile(sessionPath(sessionId), persistedSession);
  }

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
    contextDiagnostics,
    contextQualitySummary,
    graphHints,
    graphHintCount,
    graphStatus,
    indexedContextStatus,
    indexedContextSourcesCount,
    ...(indexedContextFallbackReason ? { indexedContextFallbackReason } : {}),
    ...timingMetadata,
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

  if (!app || app.workspaceId !== HOLDSTATION_WORKSPACE_ID) {
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
