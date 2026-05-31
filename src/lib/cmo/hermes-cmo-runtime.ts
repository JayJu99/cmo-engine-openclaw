import { getCmoHermesCmoMaxDelegations, isCmoHermesCmoOrchestrationEnabled } from "./config";
import {
  executeHermesCmoDelegations,
  executableDelegations,
  stableDelegationKey,
  type HermesCmoDelegationExecution,
  type HermesCmoDelegationExecutionResult,
  type HermesCmoForbiddenCounters,
} from "./hermes-cmo-delegation-executor";
import {
  buildCleanCmoSkillKernel,
  CMO_DECISION_LABELS,
  CMO_STRATEGIC_MODES,
  type CmoDecisionLabel,
  type CmoStrategicMode,
} from "./hermes-cmo-skill-kernel";

export const HERMES_CMO_RUNTIME_MODE = "live" as const;

export const H5_LIVE_ADAPTER_BOUNDARY =
  "M1 Hermes CMO runtime: Hermes CMO is the strategic brain; CMO Engine mechanically executes bounded Echo/Surf delegations only when enabled." as const;

const HERMES_CMO_AGENT_PATH = "/agents/cmo/execute" as const;

export type HermesCmoRuntimeMode = typeof HERMES_CMO_RUNTIME_MODE;
export type HermesAllowedAgent = "echo" | "surf" | "vault_agent";
export type HermesEchoMode = "echo.default" | "echo.source_translate";
export type HermesSurfMode = "surf.default" | "surf.x" | "surf.trend" | "surf.pulse";
export type HermesCmoClassification =
  | "native_conversation"
  | "source_acknowledgement"
  | "source_can_read"
  | "source_translate"
  | "source_transform"
  | "structured_review"
  | "external_research"
  | "needs_surf"
  | "needs_echo_retry";
export type HermesActivityStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type HermesActivityType =
  | "run.started"
  | "run.heartbeat"
  | "stage.started"
  | "stage.completed"
  | "context.loaded"
  | "cmo.intent.classified"
  | "cmo.source_context.loaded"
  | "cmo.response_style.selected"
  | "cmo.mode.selected"
  | "cmo.bottleneck.identified"
  | "cmo.decision.selected"
  | "cmo.next_step.selected"
  | "cmo.run.completed"
  | "assumption.notice"
  | "clarification.required"
  | "clarification.asked"
  | "plan.created"
  | "delegation.created"
  | "delegation.started"
  | "delegation.waiting"
  | "delegation.completed"
  | "artifact.created"
  | "memory_suggestion.created"
  | "vault_agent.delegation.created"
  | "vault_agent.delegation.started"
  | "vault_agent.delegation.completed"
  | "vault_agent.delegation.failed"
  | "run.completed"
  | "run.failed";

export interface HermesCmoRuntimeRequest {
  schema_version: "hermes.cmo.request.v1";
  request_id: string;
  session_id: string;
  turn_id: string;
  created_at: string;
  workspace: {
    workspace_id: string;
    app_id: string;
    app_name: string;
    [key: string]: unknown;
  };
  user: {
    user_id: string;
    display_name?: string | null;
    [key: string]: unknown;
  };
  intent: {
    mode: "cmo.default";
    user_message: string;
    explicit_command?: string | null;
    [key: string]: unknown;
  };
  context_pack: {
    current_priority: unknown[];
    selected_context: unknown[];
    recent_session_summary: string | null;
    indexed_context_supplement: unknown[];
    artifacts_in: unknown[];
    [key: string]: unknown;
  };
  constraints: {
    no_direct_vault_write: true;
    no_direct_memory_mutation: true;
    vault_agent_delegation_allowed: boolean;
    vault_agent_requires_save_intent: true;
    kanban_enabled: boolean;
    demo_mode: boolean;
    allowed_agents: HermesAllowedAgent[];
    allowed_surf_modes: HermesSurfMode[];
    [key: string]: unknown;
  };
  ui: {
    activity_stream_required: boolean;
    heartbeat_required: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface HermesCmoRuntimeSafetyCounters {
  surfCalls: number;
  echoCalls: number;
  vaultAgentCalls: 0;
  vaultWrites: 0;
  directSupabaseMutations: 0;
  openclawCalls: 0;
}

export interface HermesCmoRuntimeSafetyFlags {
  liveOnly: true;
  calledHermesCmo: true;
  cmoEngineMechanicalExecutor: true;
  subAgentExecutionAllowed: boolean;
  noWrites: true;
  noOpenClawCalls: true;
}

export interface HermesCmoRuntimeSafety {
  runtimeMode: HermesCmoRuntimeMode;
  flags: HermesCmoRuntimeSafetyFlags;
  counters: HermesCmoRuntimeSafetyCounters;
}

export interface HermesCmoRuntimeActivityEvent {
  schema_version: "hermes.activity.event.v1";
  event_id: string;
  request_id: string;
  session_id: string;
  turn_id: string;
  seq: number;
  created_at: string;
  source: {
    agent: "cmo" | "echo" | "surf";
    mode: "cmo.default" | HermesEchoMode | HermesSurfMode;
  };
  type: HermesActivityType;
  status: HermesActivityStatus;
  user_visible: boolean;
  message: string;
  data: Record<string, unknown>;
}

export interface HermesCmoRuntimeAnswerBasis {
  mode:
    | "fully_grounded"
    | "assumption_based"
    | "needs_user_input"
    | "native_conversation"
    | "source_acknowledgement"
    | "source_can_read"
    | "source_translate"
    | "source_transform"
    | "structured_review"
    | "external_research";
  missing_inputs: string[];
  assumptions_used: Array<string | Record<string, unknown>>;
  user_can_override: boolean;
  suggested_user_inputs: string[];
}

export interface HermesCmoRuntimeClarifyingQuestion {
  required: boolean;
  question: string | null;
  reason: string | null;
  missing_inputs: string[];
}

export interface HermesCmoRuntimeAnswer {
  format: "markdown" | "plain_text" | "json";
  title: string;
  summary: string;
  decision: string;
  body: string;
  [key: string]: unknown;
}

export interface HermesCmoRuntimeResponse {
  schema_version: "hermes.cmo.response.v1";
  request_id: string;
  session_id: string;
  turn_id: string;
  status: "completed" | "partial" | "needs_user_input" | "delegated" | "failed" | "cancelled";
  answer_basis: HermesCmoRuntimeAnswerBasis;
  clarifying_question: HermesCmoRuntimeClarifyingQuestion;
  answer: HermesCmoRuntimeAnswer | null;
  structured_output: Record<string, unknown> | null;
  delegations: Record<string, unknown>[];
  artifacts: unknown[];
  memory_suggestions: Record<string, unknown>[];
  activity_summary: {
    events_count: number;
    final_state: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface HermesCmoRuntimeResult {
  ok: true;
  mode: HermesCmoRuntimeMode;
  boundary: typeof H5_LIVE_ADAPTER_BOUNDARY;
  runtimeMode: HermesCmoRuntimeMode;
  calledHermesCmo: true;
  hermesCmoAgentPath: typeof HERMES_CMO_AGENT_PATH;
  request: HermesCmoRuntimeRequest;
  response: HermesCmoRuntimeResponse;
  activity_events: HermesCmoRuntimeActivityEvent[];
  safety_counters: HermesCmoRuntimeSafetyCounters;
  forbidden_counters: HermesCmoForbiddenCounters;
  strategyMode?: CmoStrategicMode;
  mainBottleneck?: string;
  decisionLabel?: CmoDecisionLabel;
  currentStep?: string;
  delegationSummary: HermesCmoDelegationExecution[];
  agentsUsed: Array<"cmo" | "echo" | "surf">;
  surfCalls: number;
  echoCalls: number;
  safety_flags: HermesCmoRuntimeSafetyFlags;
  safety: HermesCmoRuntimeSafety;
}

interface HermesCmoAgentConfig {
  endpoint: string;
  apiKey: string;
}

interface HermesCmoLivePayload {
  response: HermesCmoRuntimeResponse;
  activityEvents: HermesCmoRuntimeActivityEvent[];
}

interface HermesCmoRuntimeRequestOptions {
  orchestrationEnabled: boolean;
  finalSynthesis?: boolean;
  delegationResults?: HermesCmoDelegationExecution[];
  allowNextDelegation?: boolean;
  allowEchoRetry?: boolean;
  echoRetriesUsed?: number;
}

interface HermesCmoResponseValidationOptions {
  allowExecutableDelegations: boolean;
  maxDelegations: number;
  allowEchoRetryDelegation?: boolean;
}

interface HermesCmoActivityValidationOptions {
  allowExecutableDelegationActivity: boolean;
}

const allowedAgents = new Set<HermesAllowedAgent>(["echo", "surf", "vault_agent"]);
const allowedSurfModes = new Set<HermesSurfMode>(["surf.default", "surf.x", "surf.trend", "surf.pulse"]);
const MAX_M1_ORCHESTRATION_ROUNDS = 3;
const MAX_M1_ECHO_RETRIES = 1;
const MAX_M1_FINALIZATION_ATTEMPTS = 1;
const responseStatuses = new Set<HermesCmoRuntimeResponse["status"]>([
  "completed",
  "partial",
  "needs_user_input",
  "delegated",
  "failed",
  "cancelled",
]);
const answerBasisModes = new Set<HermesCmoRuntimeAnswerBasis["mode"]>([
  "fully_grounded",
  "assumption_based",
  "needs_user_input",
  "native_conversation",
  "source_acknowledgement",
  "source_can_read",
  "source_translate",
  "source_transform",
  "structured_review",
  "external_research",
]);
const answerFormats = new Set<HermesCmoRuntimeAnswer["format"]>(["markdown", "plain_text", "json"]);
const classifications = new Set<HermesCmoClassification>([
  "native_conversation",
  "source_acknowledgement",
  "source_can_read",
  "source_translate",
  "source_transform",
  "structured_review",
  "external_research",
  "needs_surf",
  "needs_echo_retry",
]);
const activityTypes = new Set<HermesActivityType>([
  "run.started",
  "run.heartbeat",
  "stage.started",
  "stage.completed",
  "context.loaded",
  "cmo.intent.classified",
  "cmo.source_context.loaded",
  "cmo.response_style.selected",
  "cmo.mode.selected",
  "cmo.bottleneck.identified",
  "cmo.decision.selected",
  "cmo.next_step.selected",
  "cmo.run.completed",
  "assumption.notice",
  "clarification.required",
  "clarification.asked",
  "plan.created",
  "delegation.created",
  "delegation.started",
  "delegation.waiting",
  "delegation.completed",
  "artifact.created",
  "memory_suggestion.created",
  "vault_agent.delegation.created",
  "vault_agent.delegation.started",
  "vault_agent.delegation.completed",
  "vault_agent.delegation.failed",
  "run.completed",
  "run.failed",
]);
const activityStatuses = new Set<HermesActivityStatus>([
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);
const strategicModes = new Set<CmoStrategicMode>(CMO_STRATEGIC_MODES);
const decisionLabels = new Set<CmoDecisionLabel>(CMO_DECISION_LABELS);
const executableDelegationEventTypes = new Set<HermesActivityType>([
  "delegation.started",
  "delegation.waiting",
  "delegation.completed",
]);
const forbiddenDelegationEventTypes = new Set<HermesActivityType>([
  "vault_agent.delegation.created",
  "vault_agent.delegation.started",
  "vault_agent.delegation.completed",
  "vault_agent.delegation.failed",
]);
const forbiddenActivityTypePattern = /^(vault|vault_agent|kanban|openclaw|publish)(\.|$)/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const isStringOrNull = (value: unknown): value is string | null => typeof value === "string" || value === null;

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item): item is string => typeof item === "string");

const hasOnlyAllowedValues = <T extends string>(values: unknown, allowedValues: Set<T>) =>
  Array.isArray(values) &&
  values.every((value): value is T => typeof value === "string" && allowedValues.has(value as T)) &&
  new Set(values).size === values.length;

const optionalClassificationIsAllowed = (value: unknown) =>
  value === undefined || (typeof value === "string" && classifications.has(value as HermesCmoClassification));

const normalizeHermesCmoResponseCandidate = (response: Record<string, unknown>): Record<string, unknown> => {
  const answerBasis = isRecord(response.answer_basis) ? response.answer_basis : {};
  const answerBasisMode = typeof answerBasis.mode === "string" ? answerBasis.mode : undefined;
  const canNormalizeAnswerBasis = answerBasisMode !== undefined && answerBasisModes.has(answerBasisMode as HermesCmoRuntimeAnswerBasis["mode"]);
  const clarifyingQuestion = isRecord(response.clarifying_question) ? response.clarifying_question : {};

  return {
    ...response,
    ...(canNormalizeAnswerBasis
      ? {
          answer_basis: {
            ...answerBasis,
            missing_inputs: Array.isArray(answerBasis.missing_inputs) ? answerBasis.missing_inputs : [],
            assumptions_used: Array.isArray(answerBasis.assumptions_used) ? answerBasis.assumptions_used : [],
            user_can_override: typeof answerBasis.user_can_override === "boolean" ? answerBasis.user_can_override : true,
            suggested_user_inputs: Array.isArray(answerBasis.suggested_user_inputs) ? answerBasis.suggested_user_inputs : [],
          },
        }
      : {}),
    clarifying_question: {
      required: typeof clarifyingQuestion.required === "boolean" ? clarifyingQuestion.required : false,
      question: typeof clarifyingQuestion.question === "string" || clarifyingQuestion.question === null ? clarifyingQuestion.question : null,
      reason: typeof clarifyingQuestion.reason === "string" || clarifyingQuestion.reason === null ? clarifyingQuestion.reason : null,
      missing_inputs: Array.isArray(clarifyingQuestion.missing_inputs) ? clarifyingQuestion.missing_inputs : [],
    },
    structured_output: response.structured_output === undefined ? null : response.structured_output,
    delegations: response.delegations === undefined ? [] : response.delegations,
    artifacts: response.artifacts === undefined ? [] : response.artifacts,
    memory_suggestions: response.memory_suggestions === undefined ? [] : response.memory_suggestions,
  };
};

const responseValidationFailureReason = (
  response: Record<string, unknown>,
  request: HermesCmoRuntimeRequest,
  options: HermesCmoResponseValidationOptions,
): string => {
  const structuredOutput = isRecord(response.structured_output) ? response.structured_output : {};
  const activitySummary = response.activity_summary;

  if (response.direct_vault_write === true) return "direct_vault_write=true";
  if (response.direct_memory_mutation === true) return "direct_memory_mutation=true";
  if (response.direct_supabase_mutation === true) return "direct_supabase_mutation=true";
  if (response.direct_supabase_write === true) return "direct_supabase_write=true";
  if (response.openclaw_call === true) return "openclaw_call=true";
  if (response.schema_version !== "hermes.cmo.response.v1") return `schema_version=${String(response.schema_version)}`;
  if (response.request_id !== request.request_id) return `request_id_mismatch:${String(response.request_id)}`;
  if (response.session_id !== request.session_id) return `session_id_mismatch:${String(response.session_id)}`;
  if (response.turn_id !== request.turn_id) return `turn_id_mismatch:${String(response.turn_id)}`;
  if (!responseStatuses.has(response.status as HermesCmoRuntimeResponse["status"])) return `status=${String(response.status)}`;
  if (!validateAnswerBasis(response.answer_basis)) {
    const basis = isRecord(response.answer_basis) ? response.answer_basis : {};

    return `answer_basis_invalid:mode=${String(basis.mode)}`;
  }
  if (!validateClarifyingQuestion(response.clarifying_question)) return "clarifying_question_invalid";
  if (!validateHermesCmoRuntimeAnswer(response.answer)) return "answer_invalid";
  if (!(isRecord(response.structured_output) || response.structured_output === null)) return "structured_output_invalid";
  if (!validateDelegations(response.delegations, options)) return "delegations_invalid";
  if (!Array.isArray(response.artifacts)) return "artifacts_invalid";
  if (!Array.isArray(response.memory_suggestions) || !response.memory_suggestions.every(isRecord)) return "memory_suggestions_invalid";
  if (!isRecord(activitySummary)) return "activity_summary_invalid";
  if (typeof activitySummary.events_count !== "number" || !Number.isInteger(activitySummary.events_count) || activitySummary.events_count < 0) {
    return `activity_summary.events_count=${String(activitySummary.events_count)}`;
  }
  if (!isNonEmptyString(activitySummary.final_state)) return `activity_summary.final_state=${String(activitySummary.final_state)}`;
  if (!optionalClassificationIsAllowed(response.classification)) return `classification=${String(response.classification)}`;
  if (!optionalClassificationIsAllowed(structuredOutput.classification)) return `structured_output.classification=${String(structuredOutput.classification)}`;

  if (
    response.status === "needs_user_input" &&
    (response.answer !== null ||
      response.structured_output !== null ||
      isRecord(response.answer_basis) && response.answer_basis.mode !== "needs_user_input" ||
      isRecord(response.clarifying_question) && response.clarifying_question.required !== true)
  ) {
    return "needs_user_input_shape_invalid";
  }

  if (
    isRecord(response.answer_basis) &&
    response.answer_basis.mode === "assumption_based" &&
    (Array.isArray(response.answer_basis.missing_inputs) && response.answer_basis.missing_inputs.length === 0 ||
      Array.isArray(response.answer_basis.assumptions_used) && response.answer_basis.assumptions_used.length === 0)
  ) {
    return "assumption_based_requires_missing_inputs_and_assumptions";
  }

  return "unknown_response_validation_failure";
};

const activityValidationFailureReason = (
  event: unknown,
  request: HermesCmoRuntimeRequest,
  options: HermesCmoActivityValidationOptions,
): string => {
  if (!isRecord(event)) return "event_not_object";

  const source = isRecord(event.source) ? event.source : {};
  const sourceAgent = source.agent ?? event.sourceAgent;
  const sourceMode = source.mode ?? event.sourceMode;
  const eventType = event.type;
  const status = event.status;

  if (event.schema_version !== undefined && event.schema_version !== "hermes.activity.event.v1") return `schema_version=${String(event.schema_version)}`;
  if (!isNonEmptyString(event.event_id ?? event.eventId)) return "event_id_missing";
  if ((event.request_id ?? event.requestId ?? request.request_id) !== request.request_id) return `request_id_mismatch:${String(event.request_id ?? event.requestId)}`;
  if ((event.session_id ?? event.sessionId ?? request.session_id) !== request.session_id) return `session_id_mismatch:${String(event.session_id ?? event.sessionId)}`;
  if ((event.turn_id ?? event.turnId ?? request.turn_id) !== request.turn_id) return `turn_id_mismatch:${String(event.turn_id ?? event.turnId)}`;
  if (forbiddenDelegationEventTypes.has(eventType as HermesActivityType) || forbiddenActivityTypePattern.test(String(eventType))) return `forbidden_type=${String(eventType)}`;
  if (!activityTypes.has(eventType as HermesActivityType)) return `type=${String(eventType)}`;
  if (!activityStatuses.has(status as HermesActivityStatus)) return `status=${String(status)}`;
  if (sourceAgent !== "cmo" && sourceAgent !== "echo" && sourceAgent !== "surf") return `source.agent=${String(sourceAgent)}`;
  if (sourceAgent === "cmo" && sourceMode !== "cmo.default") return `source.mode=${String(sourceMode)}`;
  if (sourceAgent === "echo" && sourceMode !== "echo.default" && sourceMode !== "echo.source_translate") return `source.mode=${String(sourceMode)}`;
  if (sourceAgent === "surf" && !allowedSurfModes.has(sourceMode as HermesSurfMode)) return `source.mode=${String(sourceMode)}`;
  if ((sourceAgent === "echo" || sourceAgent === "surf") && (!options.allowExecutableDelegationActivity || !executableDelegationEventTypes.has(eventType as HermesActivityType))) {
    return `delegation_activity_not_allowed:${String(eventType)}`;
  }
  if (!options.allowExecutableDelegationActivity && executableDelegationEventTypes.has(eventType as HermesActivityType)) return `executable_activity_not_allowed:${String(eventType)}`;
  if (typeof event.user_visible !== "boolean" && typeof event.userVisible !== "boolean") return "user_visible_invalid";
  if (!isNonEmptyString(event.message)) return "message_missing";

  return "unknown_activity_validation_failure";
};

const makeSafetyCounters = (surfCalls = 0, echoCalls = 0): HermesCmoRuntimeSafetyCounters => ({
  surfCalls,
  echoCalls,
  vaultAgentCalls: 0,
  vaultWrites: 0,
  directSupabaseMutations: 0,
  openclawCalls: 0,
});

const makeForbiddenCounters = (): HermesCmoForbiddenCounters => ({
  vaultAgentCalls: 0,
  vaultWrites: 0,
  openclawCalls: 0,
  directSupabaseMutations: 0,
});

const makeEmptyDelegationResult = (): HermesCmoDelegationExecutionResult => ({
  executions: [],
  activityEvents: [],
  surfCalls: 0,
  echoCalls: 0,
  agentsUsed: [],
  forbiddenCounters: makeForbiddenCounters(),
});

const makeSafetyFlags = (subAgentExecutionAllowed: boolean): HermesCmoRuntimeSafetyFlags => ({
  liveOnly: true,
  calledHermesCmo: true,
  cmoEngineMechanicalExecutor: true,
  subAgentExecutionAllowed,
  noWrites: true,
  noOpenClawCalls: true,
});

const specialistResultArtifact = (execution: HermesCmoDelegationExecution): Record<string, unknown> => {
  const response = isRecord(execution.response) ? execution.response : {};
  const schemaVersion =
    typeof response.schema_version === "string"
      ? response.schema_version
      : execution.targetAgent === "surf"
        ? "surf.response.v1"
        : "echo.response.v1";

  return {
    type: "specialist_result",
    agent: execution.targetAgent,
    mode: execution.mode,
    schema_version: schemaVersion,
    status: execution.status,
    handoff_id: execution.delegationId,
    delegation_key: execution.delegationKey,
    result: execution.response ?? null,
    summary: execution.summary,
    ...(Array.isArray(response.outputs) ? { outputs: response.outputs } : {}),
    ...(isRecord(response.research_pack) ? { research_pack: response.research_pack } : {}),
    ...(isRecord(response.researchPack) ? { research_pack: response.researchPack } : {}),
    ...(Array.isArray(response.sources_used) ? { sources_used: response.sources_used } : {}),
    ...(isRecord(response.safety) ? { safety: response.safety } : {}),
  };
};

const envEnabled = (value: string | undefined) =>
  value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";

const hermesTimeoutMs = () => {
  const value = Number.parseInt(process.env.CMO_HERMES_TIMEOUT_MS ?? "30000", 10);

  return Number.isFinite(value) && value > 0 ? value : 30000;
};

const compactText = (value: string, max = 500) => value.replace(/\s+/g, " ").trim().slice(0, max);

const structuredErrorMessage = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  for (const key of ["error", "message", "detail", "blocker", "reason"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return value[key].trim();
    }
  }

  if (typeof value.code === "string" && value.code.trim()) {
    return value.code.trim();
  }

  return null;
};

const parseHermesJson = async (response: Response, agentLabel: string): Promise<unknown> => {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(`${agentLabel} returned an empty response body.`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${agentLabel} returned invalid JSON.`);
  }
};

const hermesHttpFailureReason = async (response: Response, agentLabel: string): Promise<string> => {
  let detail = "";

  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = (await response.json()) as unknown;
      detail = structuredErrorMessage(data) ?? compactText(JSON.stringify(data));
    } else {
      detail = compactText(await response.text());
    }
  } catch {
    detail = "";
  }

  const base = `${agentLabel} returned HTTP ${response.status}.`;
  const category =
    response.status === 502
      ? " Upstream gateway/runtime error from Hermes or its reverse proxy."
      : response.status === 404
        ? " Endpoint not found; check Hermes CMO Agent route configuration."
        : response.status === 401 || response.status === 403
          ? " Authentication/authorization failed; check Hermes API key configuration."
          : "";

  return detail ? `${base}${category} Detail: ${detail}` : `${base}${category}`;
};

const getHermesCmoAgentConfig = (): HermesCmoAgentConfig => {
  const baseUrl = process.env.CMO_HERMES_BASE_URL?.trim().replace(/\/+$/g, "") ?? "";
  const apiKey = process.env.CMO_HERMES_API_KEY?.trim() ?? "";

  if (!envEnabled(process.env.CMO_HERMES_EXECUTION_ENABLED)) {
    throw new Error("CMO_HERMES_EXECUTION_ENABLED must be true for the live-only Hermes CMO runtime.");
  }

  if (!baseUrl) {
    throw new Error("CMO_HERMES_BASE_URL is required for the live-only Hermes CMO runtime.");
  }

  if (!apiKey) {
    throw new Error("CMO_HERMES_API_KEY is required for the live-only Hermes CMO runtime.");
  }

  return {
    endpoint: `${baseUrl}${HERMES_CMO_AGENT_PATH}`,
    apiKey,
  };
};

export const validateHermesCmoRuntimeRequest = (request: unknown): request is HermesCmoRuntimeRequest => {
  if (!isRecord(request)) {
    return false;
  }

  const createdAt = request.created_at;

  if (
    request.schema_version !== "hermes.cmo.request.v1" ||
    !isNonEmptyString(request.request_id) ||
    !isNonEmptyString(request.session_id) ||
    !isNonEmptyString(request.turn_id) ||
    !isNonEmptyString(createdAt)
  ) {
    return false;
  }

  if (Number.isNaN(Date.parse(createdAt))) {
    return false;
  }

  if (!isRecord(request.workspace) || !isRecord(request.user) || !isRecord(request.intent)) {
    return false;
  }

  if (
    !isNonEmptyString(request.workspace.workspace_id) ||
    !isNonEmptyString(request.workspace.app_id) ||
    !isNonEmptyString(request.workspace.app_name) ||
    !isNonEmptyString(request.user.user_id) ||
    !isStringOrNull(request.user.display_name ?? null) ||
    request.intent.mode !== "cmo.default" ||
    !isNonEmptyString(request.intent.user_message) ||
    !isStringOrNull(request.intent.explicit_command ?? null)
  ) {
    return false;
  }

  if (!isRecord(request.context_pack)) {
    return false;
  }

  if (
    !Array.isArray(request.context_pack.current_priority) ||
    !Array.isArray(request.context_pack.selected_context) ||
    !isStringOrNull(request.context_pack.recent_session_summary) ||
    !Array.isArray(request.context_pack.indexed_context_supplement) ||
    !Array.isArray(request.context_pack.artifacts_in)
  ) {
    return false;
  }

  if (!isRecord(request.constraints) || !isRecord(request.ui)) {
    return false;
  }

  return (
    request.constraints.no_direct_vault_write === true &&
    request.constraints.no_direct_memory_mutation === true &&
    typeof request.constraints.vault_agent_delegation_allowed === "boolean" &&
    request.constraints.vault_agent_requires_save_intent === true &&
    typeof request.constraints.kanban_enabled === "boolean" &&
    typeof request.constraints.demo_mode === "boolean" &&
    hasOnlyAllowedValues(request.constraints.allowed_agents, allowedAgents) &&
    hasOnlyAllowedValues(request.constraints.allowed_surf_modes, allowedSurfModes) &&
    typeof request.ui.activity_stream_required === "boolean" &&
    typeof request.ui.heartbeat_required === "boolean"
  );
};

const buildHermesCmoLiveRequest = (
  request: HermesCmoRuntimeRequest,
  options: HermesCmoRuntimeRequestOptions,
): HermesCmoRuntimeRequest => {
  const subAgentExecutionAllowed = options.orchestrationEnabled && options.finalSynthesis !== true;
  const iterativeDelegationAllowed = options.allowNextDelegation === true && options.finalSynthesis === true;
  const echoRetryAllowed =
    options.allowEchoRetry === true && options.finalSynthesis === true && (options.echoRetriesUsed ?? 0) < MAX_M1_ECHO_RETRIES;
  const boundedDelegationAllowed = subAgentExecutionAllowed || iterativeDelegationAllowed;
  const echoExecutionAllowed = boundedDelegationAllowed || echoRetryAllowed;
  const allowedAgentsForRequest: HermesAllowedAgent[] = boundedDelegationAllowed ? ["echo", "surf"] : echoRetryAllowed ? ["echo"] : [];
  const allowedSurfModesForRequest: HermesSurfMode[] = boundedDelegationAllowed ? ["surf.default", "surf.x", "surf.trend", "surf.pulse"] : [];
  const delegationsMode = boundedDelegationAllowed ? "echo_surf_bounded" : echoRetryAllowed ? "echo_retry_bounded" : "proposals_only";
  const delegationResultsArtifact = options.delegationResults?.length
    ? {
        type: "cmo_engine_delegation_results",
        schema_version: "hermes.cmo.delegation-results.v1",
        results: options.delegationResults,
      }
    : null;
  const specialistResultArtifacts = Array.from(
    new Map((options.delegationResults?.map((result) => [result.delegationKey, specialistResultArtifact(result)] as const) ?? [])).values(),
  );
  const artifactsIn = delegationResultsArtifact
    ? [...request.context_pack.artifacts_in, ...specialistResultArtifacts, delegationResultsArtifact]
    : request.context_pack.artifacts_in;

  return {
    ...request,
    skill_kernel: buildCleanCmoSkillKernel(),
    context_pack: {
      ...request.context_pack,
      artifacts_in: artifactsIn,
    },
    constraints: {
      ...request.constraints,
      no_direct_vault_write: true,
      no_direct_memory_mutation: true,
      vault_agent_delegation_allowed: false,
      kanban_enabled: false,
      allowed_agents: allowedAgentsForRequest,
      allowed_surf_modes: allowedSurfModesForRequest,
      delegations_mode: delegationsMode,
      allowSubAgentExecution: boundedDelegationAllowed || echoRetryAllowed,
      allowSurfExecution: boundedDelegationAllowed,
      allowEchoExecution: echoExecutionAllowed,
      allowVaultAgentExecution: false,
      allowVaultWrites: false,
      allowDirectSupabaseMutations: false,
      allowSupabaseWrites: false,
      allowSessionWrites: false,
      allowRawCaptureWrites: false,
      allowOpenClawCalls: false,
      m1_clean_cmo_skill_kernel: {
        enabled: true,
        version: "m1.3",
        cmo_role: "strategic_brain_orchestrator_reviewer",
        executor_role: "mechanical_whitelisted_delegation_executor",
        max_delegations: getCmoHermesCmoMaxDelegations(),
        final_synthesis: options.finalSynthesis === true,
        echo_retry_policy: {
          enabled: true,
          max_retries: MAX_M1_ECHO_RETRIES,
          retries_used: options.echoRetriesUsed ?? 0,
          classification: "needs_echo_retry",
          retry_of: "echo",
          failure_message: "Echo output unusable; retry required.",
        },
        finalization_policy: {
          max_attempts: MAX_M1_FINALIZATION_ATTEMPTS,
          instruction:
            "Use the completed specialist results already provided. Do not request the same delegation again. Produce final user-facing answer or state that result is insufficient.",
        },
        forbidden_targets: ["vault_agent", "openclaw", "supabase", "memory", "arbitrary_tools"],
        surf_mode_policy: {
          "surf.default": "Evidence gathering, evidence gaps, source checks, and general research.",
          "surf.x": "Only explicit X/Twitter/social-signal research. Never use surf.x just because Echo will write X posts.",
          "surf.trend": "Trend or last-30-days trend research only.",
          "surf.pulse": "Pulse, snapshot, or lightweight scan research only.",
        },
        echo_policy: {
          "echo.default": "Content execution and final copy, including X posts.",
          echo_failure_guardrail: "If Echo fails, do not present Echo-produced final copy as completed.",
        },
      },
      h5_live_adapter: {
        live_only: true,
        call_only: "hermes_cmo_agent",
        sub_agent_execution_allowed: boundedDelegationAllowed || echoRetryAllowed,
        delegation_policy: boundedDelegationAllowed ? "echo_surf_only_bounded" : echoRetryAllowed ? "echo_retry_bounded" : "disabled",
        allowed_agents: allowedAgentsForRequest,
        allowed_surf_modes: allowedSurfModesForRequest,
        vault_writes_allowed: false,
        direct_supabase_mutations_allowed: false,
        openclaw_calls_allowed: false,
        platform_persistence_owner: "cmo_engine_app_chat_store",
      },
      execution_boundary: {
        sub_agent_execution_allowed: boundedDelegationAllowed || echoRetryAllowed,
        surf_execution_allowed: boundedDelegationAllowed,
        echo_execution_allowed: echoExecutionAllowed,
        vault_agent_execution_allowed: false,
        vault_writes_allowed: false,
        direct_supabase_mutations_allowed: false,
        openclaw_calls_allowed: false,
        session_persistence_owner: "cmo_engine_app_chat_store",
        raw_capture_owner: "cmo_engine_app_chat_store",
        supabase_indexing_owner: "cmo_engine_app_chat_store",
      },
    },
  };
};

const validateHermesCmoRuntimeAnswer = (answer: unknown): answer is HermesCmoRuntimeAnswer | null => {
  if (answer === null) {
    return true;
  }

  return (
    isRecord(answer) &&
    answerFormats.has(answer.format as HermesCmoRuntimeAnswer["format"]) &&
    isNonEmptyString(answer.title) &&
    typeof answer.summary === "string" &&
    typeof answer.decision === "string" &&
    typeof answer.body === "string"
  );
};

const validateAnswerBasis = (answerBasis: unknown): answerBasis is HermesCmoRuntimeAnswerBasis =>
  isRecord(answerBasis) &&
  answerBasisModes.has(answerBasis.mode as HermesCmoRuntimeAnswerBasis["mode"]) &&
  isStringList(answerBasis.missing_inputs) &&
  Array.isArray(answerBasis.assumptions_used) &&
  answerBasis.assumptions_used.every((item) => typeof item === "string" || isRecord(item)) &&
  typeof answerBasis.user_can_override === "boolean" &&
  isStringList(answerBasis.suggested_user_inputs);

const validateClarifyingQuestion = (clarifyingQuestion: unknown): clarifyingQuestion is HermesCmoRuntimeClarifyingQuestion =>
  isRecord(clarifyingQuestion) &&
  typeof clarifyingQuestion.required === "boolean" &&
  isStringOrNull(clarifyingQuestion.question) &&
  isStringOrNull(clarifyingQuestion.reason) &&
  isStringList(clarifyingQuestion.missing_inputs);

const isNonExecutedDelegationProposal = (delegation: Record<string, unknown>) => {
  const execution = isRecord(delegation.execution) ? delegation.execution : null;
  const simulation = isRecord(delegation.simulation) ? delegation.simulation : null;

  return (
    delegation.status === "proposed" ||
    delegation.status === "proposal" ||
    delegation.proposal_only === true ||
    execution?.performed === false ||
    simulation?.live_call_performed === false
  );
};

const delegationTargetAgent = (delegation: Record<string, unknown>): unknown => {
  const target = isRecord(delegation.target) ? delegation.target : {};

  return target.agent ?? delegation.targetAgent ?? delegation.target_agent ?? delegation.agent;
};

const isEchoOrSurfDelegation = (delegation: Record<string, unknown>) => {
  const agent = delegationTargetAgent(delegation);

  return agent === "echo" || agent === "surf";
};

const isEchoRetryDelegation = (delegation: Record<string, unknown>) => {
  const normalized = executableDelegations([delegation], 1);

  return normalized.length === 1 && normalized[0]?.targetAgent === "echo" && normalized[0]?.mode === "echo.default";
};

const isAllowedEchoSourceTranslationDelegation = (delegation: Record<string, unknown>) => {
  const normalized = executableDelegations([delegation], 1);

  return normalized.length === 1 && normalized[0]?.targetAgent === "echo" && normalized[0]?.mode === "echo.source_translate";
};

const validateDelegations = (
  delegations: unknown,
  options: HermesCmoResponseValidationOptions,
): delegations is Record<string, unknown>[] => {
  if (!Array.isArray(delegations)) {
    return false;
  }

  if (!delegations.every(isRecord)) {
    return false;
  }

  if (delegations.some((delegation) => !isEchoOrSurfDelegation(delegation))) {
    return false;
  }

  if (delegations.some((delegation) => Array.isArray(delegation.delegations) && delegation.delegations.length > 0)) {
    return false;
  }

  if (!options.allowExecutableDelegations) {
    if (options.allowEchoRetryDelegation && delegations.length <= 1 && delegations.every(isEchoRetryDelegation)) {
      return true;
    }

    return delegations.every(isNonExecutedDelegationProposal);
  }

  const normalizedDelegations = executableDelegations(delegations, Number.MAX_SAFE_INTEGER);

  return (
    normalizedDelegations.length === delegations.length &&
    delegations.length <= options.maxDelegations &&
    delegations.every((delegation) => {
      const normalized = executableDelegations([delegation], 1)[0];

      return normalized?.mode !== "echo.source_translate" || isAllowedEchoSourceTranslationDelegation(delegation);
    })
  );
};

export const validateHermesCmoRuntimeResponse = (
  response: unknown,
  request: HermesCmoRuntimeRequest,
  options: HermesCmoResponseValidationOptions = {
    allowExecutableDelegations: false,
    maxDelegations: 0,
  },
): response is HermesCmoRuntimeResponse => {
  if (!isRecord(response)) {
    return false;
  }

  if (
    response.direct_vault_write === true ||
    response.direct_memory_mutation === true ||
    response.direct_supabase_mutation === true ||
    response.direct_supabase_write === true ||
    response.openclaw_call === true
  ) {
    return false;
  }

  const activitySummary = response.activity_summary;
  const structuredOutput = isRecord(response.structured_output) ? response.structured_output : {};

  if (
    response.schema_version !== "hermes.cmo.response.v1" ||
    response.request_id !== request.request_id ||
    response.session_id !== request.session_id ||
    response.turn_id !== request.turn_id ||
    !responseStatuses.has(response.status as HermesCmoRuntimeResponse["status"]) ||
    !validateAnswerBasis(response.answer_basis) ||
    !validateClarifyingQuestion(response.clarifying_question) ||
    !validateHermesCmoRuntimeAnswer(response.answer) ||
    !(isRecord(response.structured_output) || response.structured_output === null) ||
    !validateDelegations(response.delegations, options) ||
    !Array.isArray(response.artifacts) ||
    !Array.isArray(response.memory_suggestions) ||
    !response.memory_suggestions.every(isRecord) ||
    !isRecord(activitySummary) ||
    typeof activitySummary.events_count !== "number" ||
    !Number.isInteger(activitySummary.events_count) ||
    activitySummary.events_count < 0 ||
    !isNonEmptyString(activitySummary.final_state) ||
    !optionalClassificationIsAllowed(response.classification) ||
    !optionalClassificationIsAllowed(structuredOutput.classification)
  ) {
    return false;
  }

  if (
    response.status === "needs_user_input" &&
    (response.answer !== null ||
      response.structured_output !== null ||
      response.answer_basis.mode !== "needs_user_input" ||
      response.clarifying_question.required !== true)
  ) {
    return false;
  }

  if (
    response.answer_basis.mode === "assumption_based" &&
    (response.answer_basis.missing_inputs.length === 0 || response.answer_basis.assumptions_used.length === 0)
  ) {
    return false;
  }

  return true;
};

const validateHermesCmoRuntimeActivityEvent = (
  event: unknown,
  request: HermesCmoRuntimeRequest,
  options: HermesCmoActivityValidationOptions,
): event is HermesCmoRuntimeActivityEvent => {
  if (!isRecord(event)) {
    return false;
  }

  const createdAt = event.created_at;
  const source = isRecord(event.source) ? event.source : null;
  const sourceAgent = source?.agent;
  const sourceMode = source?.mode;
  const eventType = event.type as HermesActivityType;
  const sourceMatches =
    (sourceAgent === "cmo" && sourceMode === "cmo.default") ||
    (sourceAgent === "echo" && (sourceMode === "echo.default" || sourceMode === "echo.source_translate")) ||
    (sourceAgent === "surf" && allowedSurfModes.has(sourceMode as HermesSurfMode));

  if (forbiddenDelegationEventTypes.has(eventType) || forbiddenActivityTypePattern.test(String(eventType))) {
    return false;
  }

  if (sourceAgent === "echo" || sourceAgent === "surf") {
    if (!options.allowExecutableDelegationActivity || !executableDelegationEventTypes.has(eventType)) {
      return false;
    }
  }

  if (!options.allowExecutableDelegationActivity && executableDelegationEventTypes.has(eventType)) {
    return false;
  }

  return (
    event.schema_version === "hermes.activity.event.v1" &&
    isNonEmptyString(event.event_id) &&
    event.request_id === request.request_id &&
    event.session_id === request.session_id &&
    event.turn_id === request.turn_id &&
    typeof event.seq === "number" &&
    Number.isInteger(event.seq) &&
    event.seq >= 1 &&
    isNonEmptyString(createdAt) &&
    sourceMatches &&
    activityTypes.has(eventType) &&
    activityStatuses.has(event.status as HermesActivityStatus) &&
    typeof event.user_visible === "boolean" &&
    isNonEmptyString(event.message) &&
    isRecord(event.data)
  ) && !Number.isNaN(Date.parse(createdAt));
};

const eventString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

const normalizedActivityEvent = (
  event: unknown,
  request: HermesCmoRuntimeRequest,
  fallbackSeq: number,
): HermesCmoRuntimeActivityEvent | null => {
  if (!isRecord(event)) {
    return null;
  }

  const source = isRecord(event.source) ? event.source : {};
  const eventId = eventString(event.event_id ?? event.eventId);
  const eventType = eventString(event.type);
  const status = eventString(event.status);
  const message = eventString(event.message);
  const createdAt = eventString(event.created_at ?? event.createdAt) ?? new Date().toISOString();
  const userVisible = event.user_visible ?? event.userVisible;
  const seq = typeof event.seq === "number" && Number.isInteger(event.seq) && event.seq >= 1 ? event.seq : fallbackSeq;
  const sourceAgent = eventString(source.agent ?? event.sourceAgent);
  const sourceMode = eventString(source.mode ?? event.sourceMode);

  if (!eventId || !eventType || !status || !message || typeof userVisible !== "boolean") {
    return null;
  }

  if (event.schema_version !== undefined && event.schema_version !== "hermes.activity.event.v1") {
    return null;
  }

  const normalized: HermesCmoRuntimeActivityEvent = {
    schema_version: "hermes.activity.event.v1",
    event_id: eventId,
    request_id: eventString(event.request_id ?? event.requestId) ?? request.request_id,
    session_id: eventString(event.session_id ?? event.sessionId) ?? request.session_id,
    turn_id: eventString(event.turn_id ?? event.turnId) ?? request.turn_id,
    seq,
    created_at: createdAt,
    source: {
      agent: sourceAgent as HermesCmoRuntimeActivityEvent["source"]["agent"],
      mode: sourceMode as HermesCmoRuntimeActivityEvent["source"]["mode"],
    },
    type: eventType as HermesActivityType,
    status: status as HermesActivityStatus,
    user_visible: userVisible,
    message,
    data: isRecord(event.data) ? event.data : {},
  };

  return normalized;
};

const extractLiveResponsePayload = (
  payload: unknown,
  request: HermesCmoRuntimeRequest,
  responseValidation: HermesCmoResponseValidationOptions,
  activityValidation: HermesCmoActivityValidationOptions,
): HermesCmoLivePayload => {
  if (!isRecord(payload)) {
    throw new Error("Hermes CMO Agent response payload was not an object.");
  }

  const rawResponseCandidate = isRecord(payload.response) ? payload.response : payload;
  const responseCandidate = normalizeHermesCmoResponseCandidate(rawResponseCandidate);
  const activityEventsCandidate = Array.isArray(payload.activity_events) ? payload.activity_events : [];
  const activityEvents = activityEventsCandidate
    .map((event, index) => normalizedActivityEvent(event, request, index + 1))
    .filter((event): event is HermesCmoRuntimeActivityEvent => Boolean(event));

  if (!validateHermesCmoRuntimeResponse(responseCandidate, request, responseValidation)) {
    throw new Error(`Hermes CMO Agent response did not match hermes.cmo.response.v1 or violated M1 execution boundaries. Rejected field: ${responseValidationFailureReason(responseCandidate, request, responseValidation)}.`);
  }

  if (responseCandidate.activity_summary.events_count !== activityEventsCandidate.length) {
    throw new Error("Hermes CMO Agent activity_summary.events_count did not match returned activity_events length.");
  }

  if (
    activityEvents.length !== activityEventsCandidate.length ||
    !activityEvents.every((event) => validateHermesCmoRuntimeActivityEvent(event, request, activityValidation))
  ) {
    const failedEvent = activityEventsCandidate.find((event, index) => {
      const normalized = normalizedActivityEvent(event, request, index + 1);

      return !normalized || !validateHermesCmoRuntimeActivityEvent(normalized, request, activityValidation);
    });

    throw new Error(`Hermes CMO Agent activity_events did not match hermes.activity.event.v1 or included forbidden delegation events. Rejected field: ${activityValidationFailureReason(failedEvent, request, activityValidation)}.`);
  }

  return {
    response: responseCandidate,
    activityEvents,
  };
};

const normalizeStrategyMode = (value: unknown): CmoStrategicMode | undefined =>
  typeof value === "string" && strategicModes.has(value.toUpperCase() as CmoStrategicMode)
    ? (value.toUpperCase() as CmoStrategicMode)
    : undefined;

const normalizeDecisionLabel = (value: unknown): CmoDecisionLabel | undefined =>
  typeof value === "string" && decisionLabels.has(value.toUpperCase() as CmoDecisionLabel)
    ? (value.toUpperCase() as CmoDecisionLabel)
    : undefined;

const firstString = (values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

const extractStrategyMode = (response: HermesCmoRuntimeResponse): CmoStrategicMode | undefined => {
  const structured = isRecord(response.structured_output) ? response.structured_output : {};
  const answer: Record<string, unknown> = isRecord(response.answer) ? response.answer : {};

  return normalizeStrategyMode(
    structured.strategyMode ?? structured.strategy_mode ?? structured.cmo_mode ?? answer.strategyMode ?? answer.strategy_mode,
  );
};

const extractMainBottleneck = (response: HermesCmoRuntimeResponse): string | undefined => {
  const structured = isRecord(response.structured_output) ? response.structured_output : {};
  const answer: Record<string, unknown> = isRecord(response.answer) ? response.answer : {};

  return firstString([
    structured.mainBottleneck,
    structured.main_bottleneck,
    structured.bottleneck,
    answer.mainBottleneck,
    answer.main_bottleneck,
    answer.bottleneck,
  ]);
};

const extractDecisionLabel = (response: HermesCmoRuntimeResponse): CmoDecisionLabel | undefined => {
  const structured = isRecord(response.structured_output) ? response.structured_output : {};
  const answer: Record<string, unknown> = isRecord(response.answer) ? response.answer : {};

  return normalizeDecisionLabel(
    structured.decisionLabel ?? structured.decision_label ?? answer.decisionLabel ?? answer.decision_label ?? response.answer?.decision,
  );
};

const extractCurrentStep = (response: HermesCmoRuntimeResponse): string | undefined => {
  const structured = isRecord(response.structured_output) ? response.structured_output : {};
  const answer: Record<string, unknown> = isRecord(response.answer) ? response.answer : {};

  return firstString([
    structured.currentStep,
    structured.current_step,
    response.currentStep,
    response.current_step,
    answer.currentStep,
    answer.current_step,
  ]);
};

const resequenceActivityEvents = (
  events: HermesCmoRuntimeActivityEvent[],
  request: HermesCmoRuntimeRequest,
): HermesCmoRuntimeActivityEvent[] =>
  events.map((event, index) => ({
    ...event,
    request_id: request.request_id,
    session_id: request.session_id,
    turn_id: request.turn_id,
    seq: index + 1,
  }));

const currentStepFrom = (
  response: HermesCmoRuntimeResponse,
  events: HermesCmoRuntimeActivityEvent[],
  delegations: HermesCmoDelegationExecution[],
): string => {
  const strategicCurrentStep = extractCurrentStep(response);

  if (strategicCurrentStep) {
    return strategicCurrentStep;
  }

  if (response.status === "needs_user_input") {
    return response.clarifying_question.question ?? "Waiting for critical context.";
  }

  const lastVisibleEvent = [...events].reverse().find((event) => event.user_visible && event.message.trim());

  if (lastVisibleEvent && !/^(cmo|hermes cmo).*(run )?completed\.?$/i.test(lastVisibleEvent.message.trim())) {
    return lastVisibleEvent.message;
  }

  if (delegations.length > 0) {
    return "CMO synthesized delegated Echo/Surf results.";
  }

  return response.activity_summary.final_state || "CMO strategy response completed.";
};

const responseWithActivitySummary = (
  response: HermesCmoRuntimeResponse,
  events: HermesCmoRuntimeActivityEvent[],
): HermesCmoRuntimeResponse => ({
  ...response,
  activity_summary: {
    ...response.activity_summary,
    events_count: events.length,
  },
});

const failedDelegation = (delegationResult: HermesCmoDelegationExecutionResult): HermesCmoDelegationExecution | null =>
  delegationResult.executions.find((execution) => execution.status !== "completed") ?? null;

const responseWithDelegationFailureGuardrail = (
  response: HermesCmoRuntimeResponse,
  delegationResult: HermesCmoDelegationExecutionResult,
): HermesCmoRuntimeResponse => {
  const failure = failedDelegation(delegationResult);

  if (!failure || !response.answer) {
    return response;
  }

  const reason = failure.failureReason ?? failure.summary;
  const label = failure.targetAgent === "echo" ? "Echo" : "Surf";
  const body = [
    `${label} did not complete, so CMO Engine is not presenting delegated work as completed.`,
    "",
    `${label} failure: ${reason}`,
    "",
    "CMO can still review the strategy boundary, but the specialist execution should be retried before treating the result as done.",
  ].join("\n");

  return {
    ...response,
    answer: {
      ...response.answer,
      title: `${label} Execution Failed`,
      summary: `CMO completed orchestration, but ${label} did not complete the delegated execution.`,
      decision: "WAIT",
      body,
    },
    structured_output: {
      ...(isRecord(response.structured_output) ? response.structured_output : {}),
      delegation_failed: true,
      delegation_failure_agent: failure.targetAgent,
      delegation_failure_reason: reason,
      ...(failure.targetAgent === "echo"
        ? {
            echo_failed: true,
            echo_failure_reason: reason,
            content_execution_status: "echo_failed_no_final_copy",
          }
        : {
            surf_failed: true,
            surf_failure_reason: reason,
            research_execution_status: "surf_failed_no_completed_research",
          }),
    },
  };
};

const responseField = (response: HermesCmoRuntimeResponse, key: string): unknown => {
  const structured = isRecord(response.structured_output) ? response.structured_output : {};

  return response[key] ?? structured[key];
};

const responseFieldAny = (response: HermesCmoRuntimeResponse, keys: string[]): unknown => {
  for (const key of keys) {
    const value = responseField(response, key);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

const needsEchoRetry = (response: HermesCmoRuntimeResponse): boolean =>
  responseFieldAny(response, ["classification"]) === "needs_echo_retry" &&
  responseFieldAny(response, ["retry_of", "retryOf"]) === "echo" &&
  typeof responseFieldAny(response, ["retry_reason", "retryReason"]) === "string" &&
  executableDelegations(response.delegations, 1).some(
    (delegation) => delegation.targetAgent === "echo" && delegation.mode === "echo.default",
  );

const echoRetryReason = (response: HermesCmoRuntimeResponse): string =>
  typeof responseFieldAny(response, ["retry_reason", "retryReason"]) === "string"
    ? (responseFieldAny(response, ["retry_reason", "retryReason"]) as string)
    : "Echo output unusable; retry required.";

const retryDelegationWithKey = (
  delegation: Record<string, unknown>,
  retryIndex: number,
  retryReason: string,
): Record<string, unknown> => ({
  ...delegation,
  id: `echo:${stableDelegationKey(delegation)}:retry:${retryIndex}`,
  delegation_id: `echo:${stableDelegationKey(delegation)}:retry:${retryIndex}`,
  retry_of: "echo",
  retry_reason: retryReason,
});

const uniqueDelegationsByKey = (delegations: Record<string, unknown>[]): Record<string, unknown>[] => {
  const seen = new Set<string>();
  const unique: Record<string, unknown>[] = [];

  for (const delegation of delegations) {
    const key = stableDelegationKey(delegation);

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(delegation);
    }
  }

  return unique;
};

const responseWithEchoRetryFailureGuardrail = (
  response: HermesCmoRuntimeResponse,
  reason: string,
): HermesCmoRuntimeResponse => ({
  ...response,
  answer: {
    format: "markdown",
    title: "Echo Retry Required",
    summary: "Echo output unusable; retry required.",
    decision: "WAIT",
    body: ["Echo output unusable; retry required.", "", `Reason: ${reason}`].join("\n"),
  },
  structured_output: {
    ...(isRecord(response.structured_output) ? response.structured_output : {}),
    echo_retry_failed: true,
    echo_retry_reason: reason,
    content_execution_status: "echo_retry_required_no_final_copy",
  },
  delegations: [],
});

const responseWithOrchestrationFailureGuardrail = (
  response: HermesCmoRuntimeResponse,
  reason: string,
): HermesCmoRuntimeResponse => ({
  ...response,
  answer: {
    format: "markdown",
    title: "Specialist Execution Required",
    summary: "Specialist execution did not complete; retry required.",
    decision: "WAIT",
    body: ["Specialist execution did not complete; retry required.", "", `Reason: ${reason}`].join("\n"),
  },
  structured_output: {
    ...(isRecord(response.structured_output) ? response.structured_output : {}),
    orchestration_failed: true,
    orchestration_failure_reason: reason,
  },
  delegations: [],
});

const completedSpecialistExecutions = (delegationResult: HermesCmoDelegationExecutionResult): HermesCmoDelegationExecution[] =>
  delegationResult.executions.filter((execution) => execution.status === "completed");

const compactUnknown = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (isRecord(value)) {
    for (const key of ["url", "link", "href", "source", "title", "summary", "copy", "label"]) {
      if (typeof value[key] === "string" && value[key].trim()) {
        return value[key].trim();
      }
    }

    return compactText(JSON.stringify(value), 220);
  }

  return null;
};

const executionFallbackLines = (execution: HermesCmoDelegationExecution): string[] => {
  const response = isRecord(execution.response) ? execution.response : {};
  const researchPack = isRecord(response.research_pack) ? response.research_pack : isRecord(response.researchPack) ? response.researchPack : {};
  const outputs = Array.isArray(response.outputs) ? response.outputs.map(compactUnknown).filter((item): item is string => Boolean(item)) : [];
  const sourceItems = response.sources_used ?? researchPack.sources_used;
  const findingItems = response.key_findings ?? researchPack.key_findings;
  const sources = Array.isArray(sourceItems) ? sourceItems.map(compactUnknown).filter((item): item is string => Boolean(item)) : [];
  const findings = Array.isArray(findingItems) ? findingItems.map(compactUnknown).filter((item): item is string => Boolean(item)) : [];
  const packSummary = typeof researchPack.summary === "string" && researchPack.summary.trim() ? researchPack.summary.trim() : null;
  const lines = [
    `- ${execution.targetAgent}/${execution.mode}: ${execution.summary}`,
    packSummary ? `  Summary: ${packSummary}` : null,
    outputs.length > 0 ? `  Outputs: ${outputs.slice(0, 3).join(" | ")}` : null,
    findings.length > 0 ? `  Findings: ${findings.slice(0, 3).join(" | ")}` : null,
    sources.length > 0 ? `  Sources: ${sources.slice(0, 5).join(" | ")}` : null,
  ];

  return lines.filter((line): line is string => Boolean(line));
};

const responseWithCompletedSpecialistFallback = (
  response: HermesCmoRuntimeResponse,
  delegationResult: HermesCmoDelegationExecutionResult,
): HermesCmoRuntimeResponse => {
  const completed = completedSpecialistExecutions(delegationResult);
  const hasEcho = completed.some((execution) => execution.targetAgent === "echo");
  const hasSurf = completed.some((execution) => execution.targetAgent === "surf");
  const body = [
    "Specialist completed; final CMO synthesis unresolved.",
    "",
    "Completed specialist result:",
    ...completed.flatMap(executionFallbackLines),
    "",
    hasSurf
      ? "CMO caveat: Surf completed evidence gathering, but final strategic synthesis did not fully resolve. Treat the result as completed specialist input, not a final strategy claim."
      : null,
    hasEcho
      ? "CMO caveat: Echo completed content execution, but final CMO synthesis did not fully resolve. Treat the output as Echo-produced, not CMO replacement copy."
      : null,
  ].filter((line): line is string => Boolean(line)).join("\n");

  return {
    ...response,
    answer: {
      format: "markdown",
      title: "Specialist Completed",
      summary: "Specialist completed; final CMO synthesis unresolved.",
      decision: "WAIT",
      body,
    },
    structured_output: {
      ...(isRecord(response.structured_output) ? response.structured_output : {}),
      final_synthesis_unresolved: true,
      completed_specialist_fallback: true,
    },
    delegations: [],
  };
};

const mergeDelegationResults = (
  left: HermesCmoDelegationExecutionResult,
  right: HermesCmoDelegationExecutionResult,
): HermesCmoDelegationExecutionResult => {
  const executionsByKey = new Map<string, HermesCmoDelegationExecution>();

  for (const execution of [...left.executions, ...right.executions]) {
    executionsByKey.set(execution.delegationKey, execution);
  }

  const executions = Array.from(executionsByKey.values());

  return {
    executions,
    activityEvents: [...left.activityEvents, ...right.activityEvents],
    surfCalls: executions.filter((execution) => execution.targetAgent === "surf").length,
    echoCalls: executions.filter((execution) => execution.targetAgent === "echo").length,
    agentsUsed: Array.from(new Set(executions.map((execution) => execution.targetAgent))),
    forbiddenCounters: makeForbiddenCounters(),
  };
};

const agentsUsedFrom = (delegationResult: HermesCmoDelegationExecutionResult): Array<"cmo" | "echo" | "surf"> =>
  Array.from(new Set<"cmo" | "echo" | "surf">(["cmo", ...delegationResult.agentsUsed]));

const callHermesCmoAgent = async (request: HermesCmoRuntimeRequest): Promise<unknown> => {
  const config = getHermesCmoAgentConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), hermesTimeoutMs());

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(request),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await hermesHttpFailureReason(response, "Hermes CMO Agent"));
    }

    const payload = await parseHermesJson(response, "Hermes CMO Agent");

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Hermes CMO Agent request timed out.");
    }

    throw error instanceof Error ? error : new Error("Hermes CMO Agent request failed.");
  } finally {
    clearTimeout(timeout);
  }
};

export async function runHermesCmoRuntime(request: unknown): Promise<HermesCmoRuntimeResult> {
  if (!validateHermesCmoRuntimeRequest(request)) {
    throw new Error("Invalid hermes.cmo.request.v1 input for M1 Hermes CMO runtime.");
  }

  const orchestrationEnabled = isCmoHermesCmoOrchestrationEnabled();
  const maxDelegations = getCmoHermesCmoMaxDelegations();
  const outboundRequest = buildHermesCmoLiveRequest(request, {
    orchestrationEnabled,
  });

  if (!validateHermesCmoRuntimeRequest(outboundRequest)) {
    throw new Error("M1 Hermes CMO runtime produced an invalid outbound hermes.cmo.request.v1 envelope.");
  }

  const safetyFlags = makeSafetyFlags(orchestrationEnabled);
  const livePayload = await callHermesCmoAgent(outboundRequest);
  const firstResult = extractLiveResponsePayload(
    livePayload,
    outboundRequest,
    {
      allowExecutableDelegations: orchestrationEnabled,
      maxDelegations,
    },
    {
      allowExecutableDelegationActivity: orchestrationEnabled,
    },
  );
  let response = firstResult.response;
  let activityEvents: HermesCmoRuntimeActivityEvent[] = firstResult.activityEvents;
  let delegationResult = makeEmptyDelegationResult();
  let echoRetriesUsed = 0;
  let echoRetryFailureReason: string | null = null;
  let orchestrationFailureReason: string | null = null;
  let finalizationAttempts = 0;
  const executedDelegationKeys = new Set<string>();

  const runSynthesis = async (allowNextDelegation: boolean): Promise<HermesCmoLivePayload> => {
    const echoRetryAvailable =
      allowNextDelegation && echoRetriesUsed < MAX_M1_ECHO_RETRIES && delegationResult.executions.some((execution) => execution.targetAgent === "echo");
    const synthesisRequest = buildHermesCmoLiveRequest(outboundRequest, {
      orchestrationEnabled: false,
      finalSynthesis: true,
      allowNextDelegation,
      allowEchoRetry: echoRetryAvailable,
      echoRetriesUsed,
      delegationResults: delegationResult.executions,
    });

    if (!validateHermesCmoRuntimeRequest(synthesisRequest)) {
      throw new Error("M1 Hermes CMO runtime produced an invalid synthesis hermes.cmo.request.v1 envelope.");
    }

    const synthesisPayload = await callHermesCmoAgent(synthesisRequest);
    return extractLiveResponsePayload(
      synthesisPayload,
      synthesisRequest,
      {
        allowExecutableDelegations: true,
        allowEchoRetryDelegation: true,
        maxDelegations,
      },
      {
        allowExecutableDelegationActivity: false,
      },
    );
  };

  if (orchestrationEnabled) {
    let orchestrationRounds = 0;

    while (response.status !== "needs_user_input") {
      const retryPending = needsEchoRetry(response);
      const retryReason = retryPending ? echoRetryReason(response) : "";
      const candidateDelegations = uniqueDelegationsByKey(retryPending
        ? response.delegations
            .filter((delegation) =>
              executableDelegations([delegation], 1).some(
                (normalized) => normalized.targetAgent === "echo" && normalized.mode === "echo.default",
              ),
            )
            .map((delegation) => retryDelegationWithKey(delegation, echoRetriesUsed + 1, retryReason))
        : response.delegations.filter((delegation) => !executedDelegationKeys.has(stableDelegationKey(delegation))));
      const executable = executableDelegations(candidateDelegations, retryPending ? 1 : maxDelegations);

      if (retryPending && echoRetriesUsed >= MAX_M1_ECHO_RETRIES) {
        echoRetryFailureReason = echoRetryReason(response);
        break;
      }

      if (executable.length === 0) {
        if (response.status === "delegated") {
          const hasCompletedSpecialist = completedSpecialistExecutions(delegationResult).length > 0;

          if (hasCompletedSpecialist && finalizationAttempts < MAX_M1_FINALIZATION_ATTEMPTS) {
            finalizationAttempts += 1;
            const finalizationResult = await runSynthesis(false);
            response = finalizationResult.response;
            activityEvents = [...activityEvents, ...finalizationResult.activityEvents];
            continue;
          }

          orchestrationFailureReason = hasCompletedSpecialist
            ? "Specialist completed; final CMO synthesis unresolved."
            : "Specialist execution did not complete; retry required.";
        }
        break;
      }

      if (orchestrationRounds >= MAX_M1_ORCHESTRATION_ROUNDS) {
        orchestrationFailureReason = "Specialist execution did not complete; retry required.";
        break;
      }

      const roundResult = await executeHermesCmoDelegations({
        parentRequestId: outboundRequest.request_id,
        sessionId: outboundRequest.session_id,
        turnId: outboundRequest.turn_id,
        workspaceSlug: outboundRequest.workspace.app_id,
        userMessage: outboundRequest.intent.user_message,
        delegations: candidateDelegations,
        maxDelegations: retryPending ? 1 : maxDelegations,
      });
      orchestrationRounds += 1;

      if (retryPending) {
        echoRetriesUsed += 1;
      }

      delegationResult = mergeDelegationResults(delegationResult, roundResult);
      for (const execution of roundResult.executions) {
        if (execution.status === "completed") {
          executedDelegationKeys.add(execution.delegationKey);
        }
      }
      activityEvents = [...activityEvents, ...roundResult.activityEvents];

      const failedExecution = roundResult.executions.find((execution) => execution.status !== "completed");
      if (retryPending && failedExecution) {
        echoRetryFailureReason = failedExecution.failureReason ?? failedExecution.summary ?? echoRetryReason(response);
      }

      const allowNextDelegation = orchestrationRounds < MAX_M1_ORCHESTRATION_ROUNDS && !failedExecution;
      const synthesisResult = await runSynthesis(allowNextDelegation);
      response = synthesisResult.response;
      activityEvents = [...activityEvents, ...synthesisResult.activityEvents];

      if (failedExecution) {
        break;
      }
    }
  }

  activityEvents = resequenceActivityEvents(activityEvents, outboundRequest);
  response = responseWithActivitySummary(response, activityEvents);
  response = responseWithDelegationFailureGuardrail(response, delegationResult);
  if (echoRetryFailureReason || needsEchoRetry(response)) {
    response = responseWithEchoRetryFailureGuardrail(response, echoRetryFailureReason ?? echoRetryReason(response));
  } else if (
    orchestrationFailureReason === "Specialist completed; final CMO synthesis unresolved." ||
    (orchestrationEnabled &&
      completedSpecialistExecutions(delegationResult).length > 0 &&
      (response.status === "delegated" ||
        executableDelegations(
          response.delegations.filter((delegation) => !executedDelegationKeys.has(stableDelegationKey(delegation))),
          maxDelegations,
        ).length > 0))
  ) {
    response = responseWithCompletedSpecialistFallback(response, delegationResult);
  } else if (
    orchestrationFailureReason ||
    (orchestrationEnabled &&
      (response.status === "delegated" ||
        executableDelegations(
          response.delegations.filter((delegation) => !executedDelegationKeys.has(stableDelegationKey(delegation))),
          maxDelegations,
        ).length > 0))
  ) {
    response = responseWithOrchestrationFailureGuardrail(
      response,
      orchestrationFailureReason ?? "Specialist execution did not complete; retry required.",
    );
  }
  const safetyCounters = makeSafetyCounters(delegationResult.surfCalls, delegationResult.echoCalls);
  const forbiddenCounters = delegationResult.forbiddenCounters;

  return {
    ok: true,
    mode: HERMES_CMO_RUNTIME_MODE,
    boundary: H5_LIVE_ADAPTER_BOUNDARY,
    runtimeMode: HERMES_CMO_RUNTIME_MODE,
    calledHermesCmo: true,
    hermesCmoAgentPath: HERMES_CMO_AGENT_PATH,
    request: outboundRequest,
    response,
    activity_events: activityEvents,
    safety_counters: safetyCounters,
    forbidden_counters: forbiddenCounters,
    strategyMode: extractStrategyMode(response),
    mainBottleneck: extractMainBottleneck(response),
    decisionLabel: extractDecisionLabel(response),
    currentStep: currentStepFrom(response, activityEvents, delegationResult.executions),
    delegationSummary: delegationResult.executions,
    agentsUsed: agentsUsedFrom(delegationResult),
    surfCalls: delegationResult.surfCalls,
    echoCalls: delegationResult.echoCalls,
    safety_flags: safetyFlags,
    safety: {
      runtimeMode: HERMES_CMO_RUNTIME_MODE,
      flags: safetyFlags,
      counters: safetyCounters,
    },
  };
}
