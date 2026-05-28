// H3 is dry-run contract harness only, not used by live runtime.

export const H3_DRY_RUN_BOUNDARY =
  "H3 is dry-run contract harness only, not used by live runtime." as const;

export const H3_INTAKE_CASES = [
  "strategy_only",
  "needs_clarification",
  "assumption_based_strategy",
  "needs_surf",
  "needs_echo",
  "needs_surf_then_echo",
  "needs_vault_agent",
  "mixed_workflow",
] as const;

export type H3IntakeCase = (typeof H3_INTAKE_CASES)[number];

export type HermesAllowedAgent = "echo" | "surf" | "vault_agent";

export type HermesSurfMode = "surf.default" | "surf.x" | "surf.trend" | "surf.pulse";

export type HermesDelegationMode = "echo.default" | HermesSurfMode | "vault.write";

export type HermesActivityStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

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

export interface HermesCmoRequest {
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

export interface H3Assumption {
  assumption: string;
  reason: string;
  impact: string;
}

export interface H3SimulationMarker {
  dry_run_only: true;
  live_call_performed: false;
  no_vault_write: true;
  no_runtime_mutation: true;
  note: string;
}

export interface HermesDelegationPlan {
  schema_version: "hermes.delegation.request.v1";
  delegation_id: string;
  parent_request_id: string;
  parent_session_id: string;
  target: {
    agent: HermesAllowedAgent;
    mode: HermesDelegationMode;
  };
  objective: string;
  input: {
    brief: string;
    context: unknown[];
    constraints: string[];
  };
  expected_output: Record<string, unknown>;
  simulation: H3SimulationMarker;
}

export interface H3IntakeClassification {
  case_id: H3IntakeCase;
  route: string;
  rationale: string;
  missing_inputs: string[];
  assumptions_used: H3Assumption[];
  delegation_plan: HermesDelegationPlan[];
  stages: string[];
  simulated_only: true;
}

export interface HermesActivityEvent {
  schema_version: "hermes.activity.event.v1";
  event_id: string;
  request_id: string;
  session_id: string;
  turn_id: string;
  seq: number;
  created_at: string;
  source: {
    agent: "cmo" | HermesAllowedAgent;
    mode: "cmo.default" | HermesDelegationMode;
  };
  type: HermesActivityType;
  status: HermesActivityStatus;
  user_visible: boolean;
  message: string;
  data: Record<string, unknown>;
}

export interface HermesCmoResponse {
  schema_version: "hermes.cmo.response.v1";
  request_id: string;
  session_id: string;
  turn_id: string;
  status: "completed" | "partial" | "needs_user_input" | "delegated" | "failed" | "cancelled";
  answer_basis: {
    mode: "fully_grounded" | "assumption_based" | "needs_user_input";
    missing_inputs: string[];
    assumptions_used: (string | H3Assumption)[];
    user_can_override: boolean;
    suggested_user_inputs: string[];
  };
  clarifying_question: {
    required: boolean;
    question: string | null;
    reason: string | null;
    missing_inputs: string[];
  };
  answer: {
    format: "markdown" | "plain_text" | "json";
    title: string;
    summary: string;
    decision: string;
    body: string;
  } | null;
  structured_output: Record<string, unknown> | null;
  delegations: HermesDelegationPlan[];
  artifacts: Record<string, unknown>[];
  memory_suggestions: Record<string, unknown>[];
  activity_summary: {
    events_count: number;
    final_state: string;
  };
}

export interface HermesCmoDryRunResult {
  boundary: typeof H3_DRY_RUN_BOUNDARY;
  request: HermesCmoRequest;
  classification: H3IntakeClassification;
  response: HermesCmoResponse;
  activity_events: HermesActivityEvent[];
}
