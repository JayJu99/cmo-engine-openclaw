export const HERMES_CMO_RUNTIME_MODE = "live" as const;

export const H5_LIVE_ADAPTER_BOUNDARY =
  "H5 Hermes CMO live adapter: call the Hermes CMO Agent endpoint only; sub-agent execution and writes remain disabled." as const;

const HERMES_CMO_AGENT_PATH = "/agents/cmo/execute" as const;

export type HermesCmoRuntimeMode = typeof HERMES_CMO_RUNTIME_MODE;
export type HermesAllowedAgent = "echo" | "surf" | "vault_agent";
export type HermesSurfMode = "surf.default" | "surf.x" | "surf.trend" | "surf.pulse";
export type HermesActivityStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type HermesActivityType =
  | "run.started"
  | "run.heartbeat"
  | "stage.started"
  | "stage.completed"
  | "context.loaded"
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
  surfCalls: 0;
  echoCalls: 0;
  vaultAgentCalls: 0;
  vaultWrites: 0;
  supabaseWrites: 0;
  sessionJsonWrites: 0;
  rawCaptureWrites: 0;
  openclawCalls: 0;
}

export interface HermesCmoRuntimeSafetyFlags {
  liveOnly: true;
  calledHermesCmoOnly: true;
  subAgentExecutionDisabled: true;
  noWrites: true;
  notWiredIntoLiveCmoChat: true;
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
    agent: "cmo";
    mode: "cmo.default";
  };
  type: HermesActivityType;
  status: HermesActivityStatus;
  user_visible: boolean;
  message: string;
  data: Record<string, unknown>;
}

export interface HermesCmoRuntimeAnswerBasis {
  mode: "fully_grounded" | "assumption_based" | "needs_user_input";
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

const allowedAgents = new Set<HermesAllowedAgent>(["echo", "surf", "vault_agent"]);
const allowedSurfModes = new Set<HermesSurfMode>(["surf.default", "surf.x", "surf.trend", "surf.pulse"]);
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
]);
const answerFormats = new Set<HermesCmoRuntimeAnswer["format"]>(["markdown", "plain_text", "json"]);
const activityTypes = new Set<HermesActivityType>([
  "run.started",
  "run.heartbeat",
  "stage.started",
  "stage.completed",
  "context.loaded",
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
const executedDelegationEventTypes = new Set<HermesActivityType>([
  "delegation.started",
  "delegation.waiting",
  "delegation.completed",
  "vault_agent.delegation.started",
  "vault_agent.delegation.completed",
  "vault_agent.delegation.failed",
]);

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

const makeSafetyCounters = (): HermesCmoRuntimeSafetyCounters => ({
  surfCalls: 0,
  echoCalls: 0,
  vaultAgentCalls: 0,
  vaultWrites: 0,
  supabaseWrites: 0,
  sessionJsonWrites: 0,
  rawCaptureWrites: 0,
  openclawCalls: 0,
});

const makeSafetyFlags = (): HermesCmoRuntimeSafetyFlags => ({
  liveOnly: true,
  calledHermesCmoOnly: true,
  subAgentExecutionDisabled: true,
  noWrites: true,
  notWiredIntoLiveCmoChat: true,
});

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

const buildHermesCmoLiveRequest = (request: HermesCmoRuntimeRequest): HermesCmoRuntimeRequest => ({
  ...request,
  constraints: {
    ...request.constraints,
    vault_agent_delegation_allowed: false,
    kanban_enabled: false,
    allowed_agents: [],
    allowed_surf_modes: [],
    h5_live_adapter: {
      live_only: true,
      call_only: "hermes_cmo_agent",
      sub_agent_execution_allowed: false,
      delegation_policy: "disabled",
      vault_writes_allowed: false,
      supabase_writes_allowed: false,
      session_json_writes_allowed: false,
      raw_capture_writes_allowed: false,
      openclaw_calls_allowed: false,
    },
  },
});

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

const validateDelegationsAreNonExecuted = (delegations: unknown): delegations is Record<string, unknown>[] => {
  if (!Array.isArray(delegations)) {
    return false;
  }

  return delegations.every((delegation) => isRecord(delegation) && isNonExecutedDelegationProposal(delegation));
};

export const validateHermesCmoRuntimeResponse = (
  response: unknown,
  request: HermesCmoRuntimeRequest,
): response is HermesCmoRuntimeResponse => {
  if (!isRecord(response)) {
    return false;
  }

  if (response.direct_vault_write === true || response.direct_memory_mutation === true) {
    return false;
  }

  const activitySummary = response.activity_summary;

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
    !validateDelegationsAreNonExecuted(response.delegations) ||
    !Array.isArray(response.artifacts) ||
    !Array.isArray(response.memory_suggestions) ||
    !response.memory_suggestions.every(isRecord) ||
    !isRecord(activitySummary) ||
    typeof activitySummary.events_count !== "number" ||
    !Number.isInteger(activitySummary.events_count) ||
    activitySummary.events_count < 0 ||
    !isNonEmptyString(activitySummary.final_state)
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
  expectedSeq: number,
): event is HermesCmoRuntimeActivityEvent => {
  if (!isRecord(event)) {
    return false;
  }

  const createdAt = event.created_at;

  return (
    event.schema_version === "hermes.activity.event.v1" &&
    isNonEmptyString(event.event_id) &&
    event.request_id === request.request_id &&
    event.session_id === request.session_id &&
    event.turn_id === request.turn_id &&
    event.seq === expectedSeq &&
    isNonEmptyString(createdAt) &&
    isRecord(event.source) &&
    event.source.agent === "cmo" &&
    event.source.mode === "cmo.default" &&
    activityTypes.has(event.type as HermesActivityType) &&
    activityStatuses.has(event.status as HermesActivityStatus) &&
    !executedDelegationEventTypes.has(event.type as HermesActivityType) &&
    typeof event.user_visible === "boolean" &&
    isNonEmptyString(event.message) &&
    isRecord(event.data)
  ) && !Number.isNaN(Date.parse(createdAt));
};

const extractLiveResponsePayload = (payload: unknown, request: HermesCmoRuntimeRequest): HermesCmoLivePayload => {
  if (!isRecord(payload)) {
    throw new Error("Hermes CMO Agent response payload was not an object.");
  }

  const responseCandidate = isRecord(payload.response) ? payload.response : payload;
  const activityEventsCandidate = Array.isArray(payload.activity_events) ? payload.activity_events : [];

  if (!validateHermesCmoRuntimeResponse(responseCandidate, request)) {
    throw new Error("Hermes CMO Agent response did not match hermes.cmo.response.v1 or violated H5 no-execution boundaries.");
  }

  if (responseCandidate.activity_summary.events_count !== activityEventsCandidate.length) {
    throw new Error("Hermes CMO Agent activity_summary.events_count did not match returned activity_events length.");
  }

  if (
    !activityEventsCandidate.every((event, index) =>
      validateHermesCmoRuntimeActivityEvent(event, request, index + 1),
    )
  ) {
    throw new Error("Hermes CMO Agent activity_events did not match hermes.activity.event.v1 or included executed delegation events.");
  }

  return {
    response: responseCandidate,
    activityEvents: activityEventsCandidate,
  };
};

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

    return parseHermesJson(response, "Hermes CMO Agent");
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
    throw new Error("Invalid hermes.cmo.request.v1 input for H5 Hermes CMO live runtime.");
  }

  const outboundRequest = buildHermesCmoLiveRequest(request);

  if (!validateHermesCmoRuntimeRequest(outboundRequest)) {
    throw new Error("H5 Hermes CMO live adapter produced an invalid outbound hermes.cmo.request.v1 envelope.");
  }

  const safetyCounters = makeSafetyCounters();
  const safetyFlags = makeSafetyFlags();
  const livePayload = await callHermesCmoAgent(outboundRequest);
  const { response, activityEvents } = extractLiveResponsePayload(livePayload, outboundRequest);

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
    safety_flags: safetyFlags,
    safety: {
      runtimeMode: HERMES_CMO_RUNTIME_MODE,
      flags: safetyFlags,
      counters: safetyCounters,
    },
  };
}
