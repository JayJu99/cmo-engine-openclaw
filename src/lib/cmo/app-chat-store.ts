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
  CmoRuntimeErrorReason,
  CmoRuntimeMode,
  CmoAssumptionReviewStatus,
  CmoDecisionLayer,
  CmoDecisionReviewStatus,
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
import { FallbackRuntime, getRuntimeRegistry } from "@/lib/cmo/runtime";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

const APP_CHAT_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "app-chat");
const DEFAULT_LIMIT = 20;

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
            runtimeMode: normalizeRuntimeMode(message.runtimeMode, normalizeRuntimeStatus(message.runtimeStatus, false), false),
            runtimeStatus: normalizeRuntimeStatus(message.runtimeStatus, false),
            runtimeProvider: normalizeRuntimeProvider(message.runtimeProvider),
            runtimeAgent: normalizeRuntimeProvider(message.runtimeAgent),
            runtimeErrorReason: normalizeRuntimeErrorReason(message.runtimeErrorReason),
            contextUsedCount: typeof message.contextUsedCount === "number" && Number.isFinite(message.contextUsedCount) ? Math.max(0, Math.floor(message.contextUsedCount)) : undefined,
            graphHintCount: typeof message.graphHintCount === "number" && Number.isFinite(message.graphHintCount) ? Math.max(0, Math.floor(message.graphHintCount)) : undefined,
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
    missingContext,
    contextDiagnostics,
    contextQualitySummary: normalizeContextQualitySummary(value.contextQualitySummary ?? contextDiagnostics, [...contextUsed, ...missingContext]),
    graphHints,
    graphHintCount: typeof value.graphHintCount === "number" && Number.isFinite(value.graphHintCount) ? Math.max(0, Math.floor(value.graphHintCount)) : graphHints.length,
    graphStatus: normalizeGraphStatus(value.graphStatus),
    decisionLayer,
    assumptions: normalizeStringList(value.assumptions),
    suggestedActions: normalizeSuggestedActions(value.suggestedActions),
    savedToVault: value.savedToVault === true,
    rawCapturePath: normalizeOptionalString(value.rawCapturePath),
    sessionNotePath: normalizeOptionalString(value.sessionNotePath),
    relatedPriority: normalizeOptionalString(value.relatedPriority),
    relatedPlan: normalizeOptionalString(value.relatedPlan),
    relatedTasks: normalizeStringList(value.relatedTasks),
  };
}

export async function createAppChatSession(body: unknown): Promise<CMOAppChatResponse> {
  const request = normalizeAppChatRequest(body);
  const now = new Date().toISOString();
  const existingSession = request.sessionId ? await readAppChatSession(request.sessionId) : null;
  const continuedSession = existingSession?.appId === request.appId ? existingSession : null;
  const messageId = `msg_${randomUUID().slice(0, 12)}`;
  const assistantId = `msg_${randomUUID().slice(0, 12)}`;
  const localCommand = continuedSession ? parseLocalChatCommand(request.message) : null;

  if (localCommand && continuedSession) {
    return handleLocalChatCommand(localCommand, request, continuedSession, now, messageId, assistantId);
  }

  const runtime = request.forceFallback
    ? new FallbackRuntime({
        status: "live_failed_then_fallback",
        mode: "fallback",
        label: "CMO smoke fallback",
        reason: "Live app-chat intentionally bypassed for fallback smoke.",
      })
    : await getRuntimeRegistry().selectRuntime();
  const contextPackResult = withContextPackMessage(
    await buildContextPack({
      workspaceId: request.workspaceId,
      appId: request.appId,
      runtimeMode: runtime.mode,
    }),
    request.message,
  );
  const { contextPackage, contextUsed, missingContext, contextDiagnostics, contextQualitySummary } = contextPackResult;
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

  try {
    const runtimeResult = await runtime.runTurn({
      contextPack: contextPackage.contextPack,
      contextPackage,
      message: request.message,
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
    if (request.forceFallback) {
      attemptedRuntimeMode = "live";
      runtimeError = "Live app-chat intentionally bypassed for fallback smoke.";
      runtimeErrorReason = "execution_error";
    }
    status = runtimeResult.runtimeError && !runtimeResult.isRuntimeFallback ? "failed" : "completed";
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

  const session: CMOChatSession = {
    id: sessionId,
    appId: request.appId,
    appName: request.appName,
    topic: continuedSession?.topic || request.topic || request.message.slice(0, 96),
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
    contextDiagnostics,
    contextQualitySummary,
    graphHints,
    graphHintCount,
    graphStatus,
    decisionLayer,
    messages: [
      ...(continuedSession?.messages ?? []),
      {
        id: messageId,
        role: "user",
        content: request.message,
        createdAt: now,
      },
      {
        id: assistantId,
        role: "assistant",
        content: answer,
        createdAt: now,
        runtimeMode,
        runtimeStatus,
        ...(runtimeProvider ? { runtimeProvider } : {}),
        ...(runtimeAgent ? { runtimeAgent } : {}),
        ...(runtimeErrorReason ? { runtimeErrorReason } : {}),
        contextUsedCount: contextUsed.length,
        graphHintCount,
      },
    ],
  };

  await writeJsonFile(sessionPath(sessionId), session);

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
    contextDiagnostics,
    contextQualitySummary,
    graphHints,
    graphHintCount,
    graphStatus,
    decisionLayer,
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
): Promise<CMOAppChatResponse> {
  const userMessage: CMOChatMessage = {
    id: messageId,
    role: "user",
    content: request.message,
    createdAt: now,
  };
  const assistantMessage: CMOChatMessage = {
    id: assistantId,
    role: "assistant",
    content: answer,
    createdAt: now,
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

    return appendLocalCommandTurn(session, request, answer, now, messageId, assistantId);
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
    );
  }

  const item = localCommandItem(layer, command.itemType, command.ordinal);

  if (!item) {
    const answer = [
      `I could not find ${command.noun} ${command.ordinal} in this session.`,
      reviewSummaryLine(layer),
      "Nothing was changed.",
    ].join("\n");

    return appendLocalCommandTurn(session, request, answer, now, messageId, assistantId);
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

  return appendLocalCommandTurn(updatedSession, request, answer, now, messageId, assistantId);
}

export async function updateAppChatSessionMetadata(
  sessionId: string,
  patch: Pick<CMOChatSession, "savedToVault" | "rawCapturePath" | "sessionNotePath" | "relatedPriority" | "relatedPlan" | "relatedTasks">,
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
