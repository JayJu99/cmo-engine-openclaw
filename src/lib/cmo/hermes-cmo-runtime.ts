export const HERMES_CMO_RUNTIME_MODE = "skeleton" as const;

export const H4_RUNTIME_BOUNDARY =
  "H4 Hermes CMO runtime boundary: skeleton entrypoint only; no external agent calls or writes." as const;

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
  sessionWrites: 0;
  rawCaptureWrites: 0;
  openClawCalls: 0;
}

export interface HermesCmoRuntimeSafetyFlags {
  skeletonOnly: true;
  noExternalAgentCalls: true;
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

export interface HermesCmoRuntimeResponse {
  schema_version: "hermes.cmo.response.v1";
  request_id: string;
  session_id: string;
  turn_id: string;
  status: "completed";
  answer_basis: {
    mode: "fully_grounded";
    missing_inputs: string[];
    assumptions_used: string[];
    user_can_override: boolean;
    suggested_user_inputs: string[];
  };
  clarifying_question: {
    required: false;
    question: null;
    reason: null;
    missing_inputs: string[];
  };
  answer: {
    format: "markdown";
    title: string;
    summary: string;
    decision: string;
    body: string;
  };
  structured_output: {
    runtime_mode: HermesCmoRuntimeMode;
    boundary: typeof H4_RUNTIME_BOUNDARY;
    diagnosis: string[];
    recommendations: string[];
    risks: string[];
    next_steps: string[];
    safety_counters: HermesCmoRuntimeSafetyCounters;
    safety_flags: HermesCmoRuntimeSafetyFlags;
  };
  delegations: [];
  artifacts: [];
  memory_suggestions: [];
  activity_summary: {
    events_count: number;
    final_state: "completed";
  };
}

export interface HermesCmoRuntimeResult {
  ok: true;
  boundary: typeof H4_RUNTIME_BOUNDARY;
  runtimeMode: HermesCmoRuntimeMode;
  request: HermesCmoRuntimeRequest;
  response: HermesCmoRuntimeResponse;
  activity_events: HermesCmoRuntimeActivityEvent[];
  safety_counters: HermesCmoRuntimeSafetyCounters;
  safety_flags: HermesCmoRuntimeSafetyFlags;
  safety: HermesCmoRuntimeSafety;
}

const allowedAgents = new Set<HermesAllowedAgent>(["echo", "surf", "vault_agent"]);
const allowedSurfModes = new Set<HermesSurfMode>(["surf.default", "surf.x", "surf.trend", "surf.pulse"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown) => typeof value === "string" && value.length > 0;

const isStringOrNull = (value: unknown) => typeof value === "string" || value === null;

const hasOnlyAllowedValues = <T extends string>(values: unknown, allowedValues: Set<T>) =>
  Array.isArray(values) && values.every((value): value is T => typeof value === "string" && allowedValues.has(value as T));

const makeSafetyCounters = (): HermesCmoRuntimeSafetyCounters => ({
  surfCalls: 0,
  echoCalls: 0,
  vaultAgentCalls: 0,
  vaultWrites: 0,
  supabaseWrites: 0,
  sessionWrites: 0,
  rawCaptureWrites: 0,
  openClawCalls: 0,
});

const makeSafetyFlags = (): HermesCmoRuntimeSafetyFlags => ({
  skeletonOnly: true,
  noExternalAgentCalls: true,
  noWrites: true,
  notWiredIntoLiveCmoChat: true,
});

const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, "_");

const addSeconds = (timestamp: string, seconds: number) => {
  const base = Date.parse(timestamp);
  const date = Number.isNaN(base) ? new Date(seconds * 1000) : new Date(base + seconds * 1000);

  return date.toISOString();
};

const countContextItems = (request: HermesCmoRuntimeRequest) =>
  request.context_pack.current_priority.length +
  request.context_pack.selected_context.length +
  request.context_pack.indexed_context_supplement.length +
  request.context_pack.artifacts_in.length +
  (request.context_pack.recent_session_summary ? 1 : 0);

export const validateHermesCmoRuntimeRequest = (request: unknown): request is HermesCmoRuntimeRequest => {
  if (!isRecord(request)) {
    return false;
  }

  if (
    request.schema_version !== "hermes.cmo.request.v1" ||
    !isNonEmptyString(request.request_id) ||
    !isNonEmptyString(request.session_id) ||
    !isNonEmptyString(request.turn_id) ||
    !isNonEmptyString(request.created_at)
  ) {
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

const buildActivityEvents = (
  request: HermesCmoRuntimeRequest,
  safetyCounters: HermesCmoRuntimeSafetyCounters,
  safetyFlags: HermesCmoRuntimeSafetyFlags,
): HermesCmoRuntimeActivityEvent[] => {
  const events: HermesCmoRuntimeActivityEvent[] = [];

  const addEvent = (
    type: HermesActivityType,
    status: HermesActivityStatus,
    message: string,
    data: Record<string, unknown>,
  ) => {
    const seq = events.length + 1;

    events.push({
      schema_version: "hermes.activity.event.v1",
      event_id: `evt_${safeId(request.request_id)}_${String(seq).padStart(3, "0")}`,
      request_id: request.request_id,
      session_id: request.session_id,
      turn_id: request.turn_id,
      seq,
      created_at: addSeconds(request.created_at, seq),
      source: {
        agent: "cmo",
        mode: "cmo.default",
      },
      type,
      status,
      user_visible: true,
      message,
      data,
    });
  };

  addEvent("run.started", "running", "Hermes CMO skeleton runtime accepted the request.", {
    runtime_mode: HERMES_CMO_RUNTIME_MODE,
    boundary: H4_RUNTIME_BOUNDARY,
  });
  addEvent("context.loaded", "running", "Hermes CMO skeleton runtime read the provided request envelope and context references.", {
    context_items: countContextItems(request),
    allowed_agents: request.constraints.allowed_agents,
    runtime_mode: HERMES_CMO_RUNTIME_MODE,
  });
  addEvent("stage.started", "running", "Hermes CMO skeleton runtime entered the no-op boundary stage.", {
    stage: "skeleton_boundary",
    safety_flags: safetyFlags,
  });
  addEvent("stage.completed", "completed", "Hermes CMO skeleton runtime completed without external calls or writes.", {
    stage: "skeleton_boundary",
    safety_counters: safetyCounters,
    safety_flags: safetyFlags,
  });
  addEvent("run.completed", "completed", "Hermes CMO skeleton runtime returned a schema-compatible no-op response.", {
    final_state: "completed",
    safety_counters: safetyCounters,
  });

  return events;
};

const buildResponse = (
  request: HermesCmoRuntimeRequest,
  eventsCount: number,
  safetyCounters: HermesCmoRuntimeSafetyCounters,
  safetyFlags: HermesCmoRuntimeSafetyFlags,
): HermesCmoRuntimeResponse => ({
  schema_version: "hermes.cmo.response.v1",
  request_id: request.request_id,
  session_id: request.session_id,
  turn_id: request.turn_id,
  status: "completed",
  answer_basis: {
    mode: "fully_grounded",
    missing_inputs: [],
    assumptions_used: [],
    user_can_override: true,
    suggested_user_inputs: [],
  },
  clarifying_question: {
    required: false,
    question: null,
    reason: null,
    missing_inputs: [],
  },
  answer: {
    format: "markdown",
    title: "H4 Hermes CMO runtime skeleton",
    summary: "The H4 entrypoint accepted a Hermes CMO request and returned a deterministic no-op boundary response.",
    decision: "Stay at the skeleton runtime boundary; do not call agents or mutate state.",
    body: [
      "Runtime mode: skeleton.",
      "This entrypoint is not wired into live CMO chat.",
      "No Surf, Echo, Vault Agent, OpenClaw, Vault, Supabase, session, or raw capture operation was performed.",
    ].join("\n\n"),
  },
  structured_output: {
    runtime_mode: HERMES_CMO_RUNTIME_MODE,
    boundary: H4_RUNTIME_BOUNDARY,
    diagnosis: ["H4 verifies the runtime entrypoint boundary without executing a real Hermes CMO live turn."],
    recommendations: ["Use this module as the later H5 adapter seam only after an explicit wiring phase."],
    risks: ["Treat this output as a skeleton runtime health contract, not as a strategic CMO answer."],
    next_steps: ["H5 can replace the no-op skeleton with a real Hermes CMO live adapter behind the same boundary."],
    safety_counters: safetyCounters,
    safety_flags: safetyFlags,
  },
  delegations: [],
  artifacts: [],
  memory_suggestions: [],
  activity_summary: {
    events_count: eventsCount,
    final_state: "completed",
  },
});

export function runHermesCmoRuntime(request: unknown): HermesCmoRuntimeResult {
  if (!validateHermesCmoRuntimeRequest(request)) {
    throw new Error("Invalid hermes.cmo.request.v1 input for H4 Hermes CMO runtime skeleton.");
  }

  const safetyCounters = makeSafetyCounters();
  const safetyFlags = makeSafetyFlags();
  const activityEvents = buildActivityEvents(request, safetyCounters, safetyFlags);
  const response = buildResponse(request, activityEvents.length, safetyCounters, safetyFlags);

  return {
    ok: true,
    boundary: H4_RUNTIME_BOUNDARY,
    runtimeMode: HERMES_CMO_RUNTIME_MODE,
    request,
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
