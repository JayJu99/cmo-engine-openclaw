import type {
  CMOAppChatResponse,
  CMOChatMessage,
  CMOContextNote,
  ContextItem,
  HermesCmoActivityEventSummary,
  HermesCmoChatMetadata,
  HermesCmoDelegationSummaryItem,
  HermesCmoForbiddenCounters,
  HermesCmoSafetyCounters,
} from "@/lib/cmo/app-workspace-types";
import type {
  HermesCmoRuntimeActivityEvent,
  HermesCmoRuntimeRequest,
  HermesCmoRuntimeResponse,
  HermesCmoRuntimeResult,
} from "@/lib/cmo/hermes-cmo-runtime";
import type { CmoRuntimeTurnInput } from "@/lib/cmo/runtime";

export const HERMES_CMO_PROPOSALS_ONLY = "proposals_only" as const;
export const HERMES_CMO_BOUNDED_DELEGATIONS = "echo_surf_bounded" as const;

export const HERMES_CMO_FORBIDDEN_ZERO_COUNTERS = [
  "vaultAgentCalls",
  "vaultWrites",
  "openclawCalls",
  "directSupabaseMutations",
] as const;

export type HermesCmoForbiddenZeroCounter = (typeof HERMES_CMO_FORBIDDEN_ZERO_COUNTERS)[number];

export interface HermesCmoChatRequestInput extends CmoRuntimeTurnInput {
  sessionId: string;
  userMessageId: string;
  createdAt: string;
  userIdentity?: {
    userId?: string;
    userEmail?: string;
    createdByEmail?: string;
  };
}

export interface HermesCmoCounterValidation {
  ok: boolean;
  counters?: HermesCmoSafetyCounters;
  errorReason?: string;
}

export interface HermesCmoMappedChatResult {
  answer: string;
  assumptions: string[];
  suggestedActions: CMOAppChatResponse["suggestedActions"];
  runtimeStatus: "live";
  runtimeMode: "live";
  runtimeLabel: string;
  runtimeProvider: "hermes";
  runtimeAgent: "cmo";
  isDevelopmentFallback: false;
  isRuntimeFallback: false;
  calledHermesCmo: true;
  hermesCmoStatus: "live";
  delegationsMode: typeof HERMES_CMO_PROPOSALS_ONLY | typeof HERMES_CMO_BOUNDED_DELEGATIONS;
  hermesCmoCounters: HermesCmoSafetyCounters;
  hermesCmoMetadata: HermesCmoChatMetadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactText(value: string, maxChars = 1200): string {
  const compact = value.replace(/\s+/g, " ").trim();

  return compact.length > maxChars ? `${compact.slice(0, maxChars - 3).trimEnd()}...` : compact;
}

function contextItemSnapshot(item: ContextItem): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    source: item.source,
    inclusionReason: item.inclusionReason,
    exists: item.exists,
    content: item.content,
    contentPreview: item.contentPreview,
    contextQuality: item.contextQuality,
    tokenEstimate: item.tokenEstimate,
    truncated: item.truncated,
    ...(typeof item.itemCount === "number" ? { itemCount: item.itemCount } : {}),
  };
}

function noteSnapshot(note: CMOContextNote): Record<string, unknown> {
  return {
    title: note.title,
    path: note.path,
    type: note.type,
    exists: note.exists,
    content: note.content,
    truncated: note.truncated,
    frontmatterStatus: note.frontmatterStatus,
    contextQuality: note.contextQuality,
    qualityReason: note.qualityReason,
  };
}

function recentSessionSummary(history: CMOChatMessage[]): string | null {
  const recent = history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-6)
    .map((message) => `${message.role}: ${compactText(message.content, 360)}`)
    .join("\n");

  return recent ? compactText(recent, 1600) : null;
}

function userId(input: HermesCmoChatRequestInput): string {
  return (
    input.userIdentity?.userId?.trim() ||
    input.userIdentity?.userEmail?.trim() ||
    input.userIdentity?.createdByEmail?.trim() ||
    "legacy_dashboard_user"
  );
}

function displayName(input: HermesCmoChatRequestInput): string | null {
  return input.userIdentity?.userEmail?.trim() || input.userIdentity?.createdByEmail?.trim() || null;
}

export function mapCmoChatToHermesCmoRequest(input: HermesCmoChatRequestInput): HermesCmoRuntimeRequest {
  const contextItems = input.contextPackage.contextPack.items;
  const currentPriority = contextItems
    .filter((item) => item.exists && item.kind === "current_priority")
    .map(contextItemSnapshot);
  const indexedContextSupplement = contextItems
    .filter((item) => item.exists && item.kind === "indexed_context_supplement")
    .map(contextItemSnapshot);

  return {
    schema_version: "hermes.cmo.request.v1",
    request_id: `req_h6_${input.userMessageId}`,
    session_id: input.sessionId,
    turn_id: input.userMessageId,
    created_at: input.createdAt,
    workspace: {
      workspace_id: input.request.workspaceId,
      app_id: input.request.appId,
      app_name: input.request.appName,
      source_id: input.contextPackage.sourceId,
      runtime_workspace_id: input.contextPackage.runtimeWorkspaceId ?? null,
    },
    user: {
      user_id: userId(input),
      display_name: displayName(input),
    },
    intent: {
      mode: "cmo.default",
      user_message: input.message,
      explicit_command: null,
    },
    context_pack: {
      current_priority: currentPriority,
      selected_context: input.contextPackage.selectedContext.map(noteSnapshot),
      recent_session_summary: recentSessionSummary(input.history),
      indexed_context_supplement: indexedContextSupplement,
      artifacts_in: [],
      read_only_snapshot: true,
      context_quality_summary: input.contextPackage.contextQualitySummary,
      context_graph: {
        graphHints: input.contextPackage.graphHints ?? [],
        graphHintCount: input.contextPackage.graphHintCount ?? input.contextPackage.graphHints?.length ?? 0,
        graphStatus: input.contextPackage.graphStatus ?? "empty",
      },
      all_context_items: contextItems.map(contextItemSnapshot),
      missing_context: input.missingContext,
      context_used: input.contextUsed,
    },
    constraints: {
      no_direct_vault_write: true,
      no_direct_memory_mutation: true,
      vault_agent_delegation_allowed: false,
      vault_agent_requires_save_intent: true,
      kanban_enabled: false,
      demo_mode: true,
      allowed_agents: ["echo", "surf"],
      allowed_surf_modes: ["surf.default", "surf.x", "surf.trend", "surf.pulse"],
      delegations_mode: HERMES_CMO_PROPOSALS_ONLY,
      allowSubAgentExecution: false,
      allowSurfExecution: false,
      allowEchoExecution: false,
      allowVaultAgentExecution: false,
      allowVaultWrites: false,
      allowSupabaseWrites: false,
      allowSessionWrites: false,
      allowRawCaptureWrites: false,
      allowOpenClawCalls: false,
      execution_boundary: {
        sub_agent_execution_allowed: false,
        surf_execution_allowed: false,
        echo_execution_allowed: false,
        vault_agent_execution_allowed: false,
        vault_writes_allowed: false,
        supabase_writes_allowed: false,
        session_writes_allowed: false,
        raw_capture_writes_allowed: false,
        openclaw_calls_allowed: false,
      },
    },
    ui: {
      activity_stream_required: true,
      heartbeat_required: true,
      existing_cmo_chat_response_shape_required: true,
    },
  };
}

function counterNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractCounterRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  if (isRecord(value.safety_counters)) {
    return value.safety_counters;
  }

  if (isRecord(value.safety) && isRecord(value.safety.counters)) {
    return value.safety.counters;
  }

  return null;
}

function extractForbiddenCounterRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  if (isRecord(value.forbidden_counters)) {
    return value.forbidden_counters;
  }

  return extractCounterRecord(value);
}

function extractForbiddenCounters(result: unknown): HermesCmoForbiddenCounters | null {
  const rawCounters = extractForbiddenCounterRecord(result);

  if (!rawCounters) {
    return null;
  }

  const directSupabaseMutations = counterNumber(rawCounters.directSupabaseMutations ?? rawCounters.supabaseWrites);
  const vaultAgentCalls = rawCounters.vaultAgentCalls === undefined ? 0 : counterNumber(rawCounters.vaultAgentCalls);
  const vaultWrites = counterNumber(rawCounters.vaultWrites);
  const openclawCalls = counterNumber(rawCounters.openclawCalls);

  if (vaultAgentCalls === null || vaultWrites === null || openclawCalls === null || directSupabaseMutations === null) {
    return null;
  }

  return {
    vaultAgentCalls,
    vaultWrites,
    openclawCalls,
    directSupabaseMutations,
  };
}

export function validateHermesCmoChatCounters(result: unknown): HermesCmoCounterValidation {
  const rawCounters = extractCounterRecord(result);
  const forbiddenCounters = extractForbiddenCounters(result);

  if (!rawCounters || !forbiddenCounters) {
    return { ok: false, errorReason: "invalid_counters_schema:missing_safety_counters" };
  }

  for (const key of HERMES_CMO_FORBIDDEN_ZERO_COUNTERS) {
    const value = forbiddenCounters[key];

    if (value !== 0) {
      return { ok: false, errorReason: `forbidden_counter_non_zero:${key}=${value}` };
    }
  }

  const surfCalls = counterNumber(rawCounters.surfCalls);
  const echoCalls = counterNumber(rawCounters.echoCalls);
  const vaultAgentCalls = counterNumber(rawCounters.vaultAgentCalls);

  if (surfCalls === null || echoCalls === null || vaultAgentCalls === null) {
    return { ok: false, errorReason: "invalid_counters_schema:execution_counters" };
  }

  return {
    ok: true,
    counters: {
      surfCalls,
      echoCalls,
      vaultAgentCalls,
      vaultWrites: forbiddenCounters.vaultWrites,
      directSupabaseMutations: forbiddenCounters.directSupabaseMutations,
      openclawCalls: forbiddenCounters.openclawCalls,
    },
  };
}

function assumptionText(value: string | Record<string, unknown>): string {
  if (typeof value === "string") {
    return value;
  }

  const assumption = typeof value.assumption === "string" ? value.assumption : "";
  const reason = typeof value.reason === "string" ? value.reason : "";
  const impact = typeof value.impact === "string" ? value.impact : "";

  return [assumption, reason ? `Reason: ${reason}` : "", impact ? `Impact: ${impact}` : ""]
    .filter(Boolean)
    .join(" ");
}

function answerFromHermes(response: HermesCmoRuntimeResponse): string {
  if (!response.answer) {
    const question = response.clarifying_question.question ?? "Please provide the missing context before CMO continues.";

    return ["## Need Clarification", "", question].join("\n");
  }

  const answer = response.answer;
  const body = answer.body.trim();

  if (body.startsWith("#")) {
    return body;
  }

  return [
    answer.title ? `## ${answer.title}` : "",
    answer.summary,
    answer.decision ? `Decision: ${answer.decision}` : "",
    body,
  ].filter(Boolean).join("\n\n");
}

function labelFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of ["label", "title", "action", "step", "recommendation", "summary", "objective"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return value[key].trim();
    }
  }

  return null;
}

function suggestedActionsFromHermes(response: HermesCmoRuntimeResponse): CMOAppChatResponse["suggestedActions"] {
  const structured = isRecord(response.structured_output) ? response.structured_output : {};
  const nextSteps = Array.isArray(structured.next_steps) ? structured.next_steps : [];
  const recommendations = Array.isArray(structured.recommendations) ? structured.recommendations : [];
  const actionLabels = [...nextSteps, ...recommendations].map(labelFromUnknown).filter((label): label is string => Boolean(label));
  const delegationLabels = response.delegations
    .map((delegation) => {
      const target = isRecord(delegation.target) && typeof delegation.target.agent === "string" ? delegation.target.agent : "specialist";
      const objective = typeof delegation.objective === "string" ? delegation.objective : "proposed delegation";

      return `Review proposed ${target} delegation: ${objective}`;
    });
  const memorySuggestionLabels = response.memory_suggestions
    .map((suggestion) => labelFromUnknown(suggestion) ?? "Review Hermes CMO memory suggestion");

  const actions = [...actionLabels, ...delegationLabels, ...memorySuggestionLabels]
    .slice(0, 5)
    .map((label, index) => ({
      type: index < actionLabels.length ? "hermes_cmo_next_step" : "hermes_cmo_proposal",
      label,
    }));

  return actions.length
    ? actions
    : [
        {
          type: "capture_to_raw_vault",
          label: "Capture this session",
        },
      ];
}

function delegationSummaryFromHermes(result: HermesCmoRuntimeResult): HermesCmoDelegationSummaryItem[] {
  return result.delegationSummary.map((delegation) => ({
    delegationId: delegation.delegationId,
    targetAgent: delegation.targetAgent,
    mode: delegation.mode,
    objective: delegation.objective,
    status: delegation.status,
    summary: delegation.summary,
    ...(delegation.failureReason ? { failureReason: delegation.failureReason } : {}),
  }));
}

function activityEventsFromHermes(result: HermesCmoRuntimeResult): HermesCmoActivityEventSummary[] {
  return result.activity_events.map((event: HermesCmoRuntimeActivityEvent) => ({
    eventId: event.event_id,
    type: event.type,
    status: event.status,
    message: event.message,
    userVisible: event.user_visible,
    sourceAgent: event.source.agent,
    sourceMode: event.source.mode,
  }));
}

function metadataFromHermes(
  result: HermesCmoRuntimeResult,
  counters: HermesCmoSafetyCounters,
  forbiddenCounters: HermesCmoForbiddenCounters,
): HermesCmoChatMetadata {
  const delegationSummary = delegationSummaryFromHermes(result);
  const activityEvents = activityEventsFromHermes(result);

  return {
    runtimeMode: "hermes_cmo",
    runtimeStatus: "live",
    calledHermesCmo: true,
    delegationsMode: delegationSummary.length > 0 ? HERMES_CMO_BOUNDED_DELEGATIONS : HERMES_CMO_PROPOSALS_ONLY,
    counters,
    forbiddenCounters,
    requestId: result.response.request_id,
    responseStatus: result.response.status,
    ...(result.strategyMode ? { strategyMode: result.strategyMode } : {}),
    ...(result.mainBottleneck ? { mainBottleneck: result.mainBottleneck } : {}),
    ...(result.decisionLabel ? { decisionLabel: result.decisionLabel } : {}),
    ...(result.currentStep ? { currentStep: result.currentStep } : {}),
    activityEventsCount: result.activity_events.length,
    activityEvents,
    delegationSummary,
    agentsUsed: result.agentsUsed,
    surfCalls: result.surfCalls,
    echoCalls: result.echoCalls,
  };
}

export function mapHermesCmoResponseToChatResult(result: HermesCmoRuntimeResult): HermesCmoMappedChatResult {
  const validation = validateHermesCmoChatCounters(result);

  if (!validation.ok || !validation.counters) {
    throw new Error(validation.errorReason ?? "invalid_counters_schema");
  }

  const forbiddenCounters = extractForbiddenCounters(result);

  if (!forbiddenCounters) {
    throw new Error("invalid_counters_schema:missing_forbidden_counters");
  }

  const delegationSummary = delegationSummaryFromHermes(result);

  return {
    answer: answerFromHermes(result.response),
    assumptions: result.response.answer_basis.assumptions_used.map(assumptionText),
    suggestedActions: suggestedActionsFromHermes(result.response),
    runtimeStatus: "live",
    runtimeMode: "live",
    runtimeLabel: "Hermes CMO live runtime",
    runtimeProvider: "hermes",
    runtimeAgent: "cmo",
    isDevelopmentFallback: false,
    isRuntimeFallback: false,
    calledHermesCmo: true,
    hermesCmoStatus: "live",
    delegationsMode: delegationSummary.length > 0 ? HERMES_CMO_BOUNDED_DELEGATIONS : HERMES_CMO_PROPOSALS_ONLY,
    hermesCmoCounters: validation.counters,
    hermesCmoMetadata: metadataFromHermes(result, validation.counters, forbiddenCounters),
  };
}
