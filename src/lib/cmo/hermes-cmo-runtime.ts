import { mkdir, writeFile } from "fs/promises";
import path from "path";

import {
  getCmoHermesCmoMaxDelegations,
  getCmoHermesCmoToolEndpoint,
  getCmoHermesCmoToolChatCanaryApps,
  getCmoHermesCmoToolTimeoutMs,
  getCmoHermesCreativeCallMode,
  getCmoHermesCreativeExecuteTimeoutMs,
  getCmoHermesCreativeProfile,
  isCmoHermesCmoOrchestrationEnabled,
  isCmoHermesCmoToolChatEnabled,
  isCmoHermesCmoToolExecuteEnabled,
  isCmoHermesCreativeEnabled,
} from "./config";
import { CMO_CREATIVE_LIFECYCLE_STATES, hasCreativeExecutionMetadata, redactSensitiveText, redactedLocalArtifactPath } from "./creative-agent";
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
const HERMES_CMO_TOOL_AGENT_DEFAULT_PATH = "/agents/cmo/tool-execute" as const;
const CMO_DEFAULT_PUBLIC_APP_URL = "https://cmo.jayju.cloud" as const;
const CMO_CREATIVE_ARTIFACT_MAX_BYTES = 50 * 1024 * 1024;
const CMO_CREATIVE_ARTIFACT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/webm",
] as const;

export type HermesCmoRuntimeMode = typeof HERMES_CMO_RUNTIME_MODE;
export type HermesAllowedAgent = "echo" | "surf" | "vault_agent" | "creative";
export type HermesEchoMode = "echo.default" | "echo.source_translate";
export type HermesSurfMode = "surf.default" | "surf.x" | "surf.trend" | "surf.pulse";
export type HermesCreativeMode = "creative" | "creative.default" | "creative.generate_image" | "creative.generate_video" | "creative.image_generation" | "creative_execution";
export type HermesCmoClassification =
  | "native_conversation"
  | "source_acknowledgement"
  | "source_can_read"
  | "source_answer"
  | "source_translate"
  | "source_transform"
  | "structured_review"
  | "strategy_only"
  | "external_research"
  | "research_followup"
  | "save_to_vault"
  | "clarify"
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
  | "cmo.context.loaded"
  | "cmo.answer.grounded"
  | "cmo.durable_action.proposed"
  | "cmo.tool_read.started"
  | "cmo.tool_read.completed"
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
  | "creative.started"
  | "creative.generating"
  | "creative.asset_ready"
  | "creative.partial"
  | "creative.blocked"
  | "creative.failed"
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
  messages?: Array<{
    role: "user" | "assistant";
    content: string;
    message_id?: string;
    created_at?: string;
  }>;
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
  route_decision?: HermesCmoRouteDecision;
  artifact_transport?: {
    mode: "product_upload";
    upload_endpoint: string;
    workspace_id: string;
    app_id: string;
    request_id: string;
    accepted_mime_types: string[];
    max_bytes: number;
  };
  creative_working_state?: unknown;
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
    agent: "cmo" | "echo" | "surf" | "creative";
    mode: "cmo.default" | "cmo.tool_capable" | HermesEchoMode | HermesSurfMode | HermesCreativeMode;
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
    | "source_answer"
    | "source_translate"
    | "source_transform"
    | "structured_review"
    | "external_research"
    | "session_research_artifact"
    | "live_external_research"
    | "session_source_artifact"
    | "insufficient_context"
    | "clarification"
    | "creative_ideation"
    | "creative_session"
    | "creative_refinement"
    | "save_to_vault"
    | "tool_read"
    | "attachment_read";
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
  hermesCmoAgentPath: string;
  hermesCmoEndpointKind: "execute" | "tool_execute";
  hermesCmoEndpointTimeoutMs: number;
  hermesCmoEndpointTimeoutSource: HermesCmoTimeoutSource;
  hermesCmoRouteDecision: HermesCmoRouteDecision;
  hermesCmoToolEndpointEnabled: boolean;
  sideEffects?: false | Record<string, false>;
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
  agentsUsed: Array<"cmo" | "echo" | "surf" | "creative">;
  surfCalls: number;
  echoCalls: number;
  safety_flags: HermesCmoRuntimeSafetyFlags;
  safety: HermesCmoRuntimeSafety;
}

interface HermesCmoAgentConfig {
  endpoint: string;
  apiKey: string;
  endpointPath: string;
  endpointKind: "execute" | "tool_execute";
  timeoutMs: number;
  timeoutSource: HermesCmoTimeoutSource;
  routeDecision: HermesCmoRouteDecision;
  toolEndpointEnabled: boolean;
}

interface HermesCmoRuntimeOptions {
  toolTimeoutMs?: number;
}

type HermesCmoTimeoutSource = "default_execute" | "creative_execute" | "tool_endpoint" | "tool_timeout_override";
type HermesCmoRouteDecision = "execute" | "creative_execution" | "creative_ideation" | "creative_session" | "tool_execute";

interface HermesCmoLivePayload {
  response: HermesCmoRuntimeResponse;
  activityEvents: HermesCmoRuntimeActivityEvent[];
  sideEffects?: false | Record<string, false>;
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
  allowToolCapableCmoSource?: boolean;
}

const allowedAgents = new Set<HermesAllowedAgent>(["echo", "surf", "vault_agent", "creative"]);
const allowedSurfModes = new Set<HermesSurfMode>(["surf.default", "surf.x", "surf.trend", "surf.pulse"]);
const allowedCreativeModes = new Set<HermesCreativeMode>(["creative", "creative.default", "creative.generate_image", "creative.generate_video", "creative.image_generation"]);
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
  "source_answer",
  "source_translate",
  "source_transform",
  "structured_review",
  "external_research",
  "session_research_artifact",
  "live_external_research",
  "session_source_artifact",
  "insufficient_context",
  "clarification",
  "save_to_vault",
  "attachment_read",
]);
const answerFormats = new Set<HermesCmoRuntimeAnswer["format"]>(["markdown", "plain_text", "json"]);
const simpleAnswerModes = new Set<HermesCmoRuntimeAnswerBasis["mode"]>([
  "native_conversation",
  "source_acknowledgement",
  "source_can_read",
  "source_answer",
  "source_translate",
  "source_transform",
  "save_to_vault",
  "tool_read",
  "attachment_read",
  "session_research_artifact",
  "live_external_research",
  "session_source_artifact",
  "insufficient_context",
  "clarification",
  "creative_ideation",
  "creative_session",
  "creative_refinement",
]);
const classifications = new Set<HermesCmoClassification>([
  "native_conversation",
  "source_acknowledgement",
  "source_can_read",
  "source_answer",
  "source_translate",
  "source_transform",
  "structured_review",
  "strategy_only",
  "external_research",
  "research_followup",
  "save_to_vault",
  "clarify",
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
  "cmo.context.loaded",
  "cmo.answer.grounded",
  "cmo.durable_action.proposed",
  "cmo.tool_read.started",
  "cmo.tool_read.completed",
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
  ...CMO_CREATIVE_LIFECYCLE_STATES,
  "run.completed",
  "run.failed",
]);
const creativeLifecycleActivityTypes = new Set<HermesActivityType>(CMO_CREATIVE_LIFECYCLE_STATES);
const safeCreativeIdeationRawActivityTypes = new Set<string>([
  "creative.ideation.draft_proposed",
  "creative.ideation.draft_updated",
  "creative.ideation.draft_refined",
  "creative.ideation.clarification_requested",
  "creative.ideation.cancelled",
  "creative.ideation.no_action",
  "creative.session.presented",
  "creative.session.refined",
  "creative.session.clarification_requested",
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
const responseStyles = new Set([
  "native_conversation",
  "source_acknowledgement",
  "source_can_read",
  "source_answer",
  "source_translate",
  "source_transform",
  "structured_review",
  "external_research",
  "research_followup",
  "save_to_vault",
  "clarify",
]);
const toolPolicies = new Set(["none", "echo", "surf", "vault_agent"]);
const m44aSafeMetadataActivityTypes = new Set<HermesActivityType>([
  "cmo.context.loaded",
  "cmo.answer.grounded",
  "cmo.durable_action.proposed",
  "cmo.tool_read.started",
  "cmo.tool_read.completed",
]);
const m44bActivityDataKeysByType: Partial<Record<HermesActivityType, Set<string>>> = {
  "cmo.context.loaded": new Set([
    "active_source_count",
    "context_item_count",
    "context_pack_present",
    "has_source_answer_context",
    "no_auto_promote",
    "saved_to_vault",
    "source_answerable",
    "source_count",
    "session_id",
    "tool_policy_present",
    "truth_status",
    "workspace_id",
  ]),
  "cmo.answer.grounded": new Set([
    "answer_basis_mode",
    "classification",
    "delegations_count",
    "grounded",
    "no_auto_promote",
    "safe_metadata_only",
    "saved_to_vault",
    "source_answerable",
    "source_count",
    "truth_status",
    "used_live_tool_read",
  ]),
  "cmo.tool_read.started": new Set([
    "read_only",
    "request_id",
    "session_id",
    "source_id",
    "source_type",
    "status",
    "success",
    "tool_category",
    "tool_family",
    "tool_name",
    "tool_policy",
    "url_present",
    "workspace_id",
  ]),
  "cmo.tool_read.completed": new Set([
    "bytes_read",
    "canonical_url_present",
    "content_type",
    "error_code",
    "http_status",
    "read_only",
    "request_id",
    "session_id",
    "source_id",
    "source_type",
    "status",
    "success",
    "tool_category",
    "tool_family",
    "tool_name",
    "tool_policy",
    "url_present",
    "workspace_id",
  ]),
  "cmo.durable_action.proposed": new Set([
    "action_type",
    "delegation_id",
    "direct_write_performed",
    "no_auto_promote",
    "plan_only",
    "safe_metadata_only",
    "saved_to_vault",
    "session_id",
    "target",
    "workspace_id",
  ]),
};
const m44aUnsafeActivityDataKeyPattern =
  /^(api_key|artifacts_in|authorization|body|content|context_pack|cookie|cookies|credential|credentials|env|file_body|file_content|file_contents|full_content|full_source|full_text|headers|html|markdown|password|private_key|raw|raw_.*|relevant_snippets|secret|secrets|source_text.*|text|token|tool_args|tool_result|vault_write_path)$/i;
const m44aUnsafeActivityDataTextPattern =
  /(Bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{12,}|AKIA[0-9A-Z]{12,}|BEGIN (?:RSA |OPENSSH |EC |PRIVATE )?PRIVATE KEY|api[_-]?key\s*[:=]|password\s*[:=]|\.codex[\\/].*auth\.json|auth\.json)/i;
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

const optionalClassificationIsAllowed = (value: unknown, options: { allowCreativeNative?: boolean } = {}) =>
  value === undefined ||
  (typeof value === "string" && classifications.has(value as HermesCmoClassification)) ||
  options.allowCreativeNative === true && (value === "creative_ideation" || value === "creative_session" || value === "creative_refinement");

const optionalResponseStyleIsAllowed = (value: unknown) =>
  value === undefined || (typeof value === "string" && responseStyles.has(value));

const optionalToolPolicyIsAllowed = (value: unknown) =>
  value === undefined || (typeof value === "string" && toolPolicies.has(value));

const isResearchFollowupValue = (value: unknown): boolean => value === "research_followup";

const responseUsesResearchFollowupClassificationOrStyle = (response: Record<string, unknown>): boolean => {
  const structuredOutput = isRecord(response.structured_output) ? response.structured_output : {};

  return (
    isResearchFollowupValue(response.classification) ||
    isResearchFollowupValue(structuredOutput.classification) ||
    isResearchFollowupValue(response.response_style) ||
    isResearchFollowupValue(structuredOutput.response_style)
  );
};

const validateContextResolution = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return true;
  }

  if (!isRecord(value) || value.schema_version !== "cmo.context_resolution.v1") {
    return false;
  }

  const status = value.status;
  const semanticIntent = isRecord(value.semantic_intent) ? value.semantic_intent : null;

  return (
    (status === undefined || typeof status === "string") &&
    (semanticIntent === null ||
      ((semanticIntent.primary === undefined || typeof semanticIntent.primary === "string") &&
        (semanticIntent.subtype === undefined || typeof semanticIntent.subtype === "string") &&
        (semanticIntent.requires_surf === undefined || typeof semanticIntent.requires_surf === "boolean")))
  );
};

type M44aActivityDataRejectionReason =
  | "unknown_key"
  | "oversized_string"
  | "unbounded_array"
  | "unsafe_key_name"
  | "raw_content_like_value"
  | "secret_like_value"
  | "nested_object_not_allowed";

interface M44aActivityDataDiagnostic {
  ok: boolean;
  keyPath?: string;
  valueType?: string;
  reason?: M44aActivityDataRejectionReason;
}

const valueTypeLabel = (value: unknown): string => {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";

  return typeof value;
};

const safeDiagnosticKey = (keyPath: string): string => keyPath.replace(/[^a-zA-Z0-9_.[\]-]/g, "_").slice(0, 160);

const m44aSafeScalarActivityValue = (value: unknown): boolean => {
  if (value === null || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "string") {
    return false;
  }

  return value.length <= 300 && !m44aUnsafeActivityDataTextPattern.test(value);
};

const m44aActivityDataDiagnostic = (
  value: unknown,
  allowedKeys: Set<string>,
  path = "data",
  depth = 0,
): M44aActivityDataDiagnostic => {
  if (!isRecord(value) || depth > 2) {
    return {
      ok: false,
      keyPath: path,
      valueType: valueTypeLabel(value),
      reason: "nested_object_not_allowed",
    };
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;

    if (m44aUnsafeActivityDataKeyPattern.test(key)) {
      return {
        ok: false,
        keyPath,
        valueType: valueTypeLabel(nestedValue),
        reason: "unsafe_key_name",
      };
    }

    if (!allowedKeys.has(key)) {
      return {
        ok: false,
        keyPath,
        valueType: valueTypeLabel(nestedValue),
        reason: "unknown_key",
      };
    }

    if (key === "direct_write_performed" && nestedValue !== false) {
      return {
        ok: false,
        keyPath,
        valueType: valueTypeLabel(nestedValue),
        reason: "raw_content_like_value",
      };
    }

    if (Array.isArray(nestedValue)) {
      return {
        ok: false,
        keyPath,
        valueType: "array",
        reason: "unbounded_array",
      };
    }

    if (!m44aSafeScalarActivityValue(nestedValue)) {
      const reason =
        typeof nestedValue === "string" && nestedValue.length > 300
          ? "oversized_string"
          : typeof nestedValue === "string" && m44aUnsafeActivityDataTextPattern.test(nestedValue)
            ? "secret_like_value"
            : isRecord(nestedValue)
              ? "nested_object_not_allowed"
              : "raw_content_like_value";

      return {
        ok: false,
        keyPath,
        valueType: valueTypeLabel(nestedValue),
        reason,
      };
    }
  }

  return { ok: true };
};

const m44aActivityEventDataDiagnostic = (eventType: HermesActivityType, data: unknown): M44aActivityDataDiagnostic =>
  !m44aSafeMetadataActivityTypes.has(eventType)
    ? { ok: true }
    : m44aActivityDataDiagnostic(data, m44bActivityDataKeysByType[eventType] ?? new Set());

const m44aActivityEventDataIsSafe = (eventType: HermesActivityType, data: unknown): boolean =>
  m44aActivityEventDataDiagnostic(eventType, data).ok;

const m44aActivityEventDataRejection = (eventType: HermesActivityType, data: unknown): string | null => {
  const diagnostic = m44aActivityEventDataDiagnostic(eventType, data);

  if (diagnostic.ok) {
    return null;
  }

  return `data_unsafe:${String(eventType)} key=${safeDiagnosticKey(diagnostic.keyPath ?? "data")} type=${diagnostic.valueType ?? "unknown"} reason=${diagnostic.reason ?? "unknown_key"}`;
};

const HERMES_ORIGINAL_SCHEMA_VERSION = "__hermes_original_schema_version";
const HERMES_ORIGINAL_MODE = "__hermes_original_mode";

interface HermesCmoResponseNormalizeOptions {
  activityEventsCandidate?: unknown[];
}

interface HermesCmoAnswerBasisModeOptions {
  allowToolRead?: boolean;
  allowCreativeIdeation?: boolean;
}

const isToolCapableResponseCandidate = (response: Record<string, unknown>): boolean =>
  (response[HERMES_ORIGINAL_SCHEMA_VERSION] ?? response.schema_version) === "hermes.cmo.tool_response.v1" &&
  (response[HERMES_ORIGINAL_MODE] ?? response.mode) === "cmo.tool_capable";

const answerBasisModeIsAllowed = (
  mode: unknown,
  options: HermesCmoAnswerBasisModeOptions | boolean = {},
): mode is HermesCmoRuntimeAnswerBasis["mode"] => {
  const allowToolRead = typeof options === "boolean" ? options : options.allowToolRead === true;
  const allowCreativeIdeation = typeof options === "boolean" ? false : options.allowCreativeIdeation === true;

  return (
    answerBasisModes.has(mode as HermesCmoRuntimeAnswerBasis["mode"]) ||
    allowToolRead && mode === "tool_read" ||
    allowCreativeIdeation && (mode === "creative_ideation" || mode === "creative_session" || mode === "creative_refinement")
  );
};

const answerTextFromKnownSimpleShape = (answer: unknown): string | null => {
  if (!isRecord(answer)) {
    return null;
  }

  for (const key of ["body", "text"]) {
    const value = answer[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
};

const answerModeFromResponse = (
  response: Record<string, unknown>,
  answerBasis: Record<string, unknown>,
  options: HermesCmoAnswerBasisModeOptions | boolean = {},
): HermesCmoRuntimeAnswerBasis["mode"] | null => {
  const structuredOutput = isRecord(response.structured_output) ? response.structured_output : {};
  const candidates = [response.classification, structuredOutput.classification, answerBasis.mode];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && answerBasisModeIsAllowed(candidate, options)) {
      return candidate as HermesCmoRuntimeAnswerBasis["mode"];
    }
  }

  return null;
};

const normalizeHermesCmoRuntimeAnswer = (
  answer: unknown,
  mode: HermesCmoRuntimeAnswerBasis["mode"] | null,
): unknown => {
  if (answer === null || !mode || !simpleAnswerModes.has(mode) || validateHermesCmoRuntimeAnswer(answer)) {
    return answer;
  }

  const body = answerTextFromKnownSimpleShape(answer);

  if (!body) {
    return answer;
  }

  return {
    ...(isRecord(answer) ? answer : {}),
    format: isRecord(answer) && answerFormats.has(answer.format as HermesCmoRuntimeAnswer["format"]) ? answer.format : "markdown",
    title: isRecord(answer) && isNonEmptyString(answer.title) ? answer.title : "Native conversation",
    summary: isRecord(answer) && typeof answer.summary === "string" ? answer.summary : "",
    decision: isRecord(answer) && typeof answer.decision === "string" ? answer.decision : "",
    body,
  };
};

const toolReadActivityCount = (events: unknown[]): number =>
  events.filter((event) => isRecord(event) && (event.type === "cmo.tool_read.started" || event.type === "cmo.tool_read.completed")).length;

const normalizeToolResponseActivitySummary = (
  response: Record<string, unknown>,
  activityEventsCandidate: unknown[] | undefined,
): unknown => {
  if (isRecord(response.activity_summary)) {
    return response.activity_summary;
  }

  if (!isToolCapableResponseCandidate(response) || !Array.isArray(activityEventsCandidate) || activityEventsCandidate.length === 0) {
    return response.activity_summary;
  }

  const toolTraceSummary = isRecord(response.tool_trace_summary) ? response.tool_trace_summary : {};

  return {
    events_count: activityEventsCandidate.length,
    final_state: response.status === "completed" ? "completed" : String(response.status ?? "completed"),
    derived_from_activity_events: true,
    tool_reads_count:
      typeof toolTraceSummary.tool_reads_count === "number"
        ? toolTraceSummary.tool_reads_count
        : typeof toolTraceSummary.tool_read_count === "number"
          ? toolTraceSummary.tool_read_count
          : toolReadActivityCount(activityEventsCandidate),
    side_effects_safe: true,
  };
};

const normalizeHermesCmoResponseCandidate = (
  response: Record<string, unknown>,
  options: HermesCmoResponseNormalizeOptions = {},
): Record<string, unknown> => {
  const originalSchemaVersion = response[HERMES_ORIGINAL_SCHEMA_VERSION] ?? response.schema_version;
  const originalMode = response[HERMES_ORIGINAL_MODE] ?? response.mode;
  const toolCapableResponse = originalSchemaVersion === "hermes.cmo.tool_response.v1" && originalMode === "cmo.tool_capable";
  const schemaVersion = originalSchemaVersion === "hermes.cmo.tool_response.v1" ? "hermes.cmo.response.v1" : originalSchemaVersion;
  const answerBasis = isRecord(response.answer_basis) ? response.answer_basis : {};
  const answerBasisMode = typeof answerBasis.mode === "string" ? answerBasis.mode : undefined;
  const canNormalizeAnswerBasis = answerBasisMode !== undefined &&
    answerBasisModeIsAllowed(answerBasisMode, { allowToolRead: toolCapableResponse, allowCreativeIdeation: true });
  const clarifyingQuestion = isRecord(response.clarifying_question) ? response.clarifying_question : {};
  const answerMode = answerModeFromResponse(response, answerBasis, { allowToolRead: toolCapableResponse, allowCreativeIdeation: true });

  return {
    ...response,
    schema_version: schemaVersion,
    [HERMES_ORIGINAL_SCHEMA_VERSION]: originalSchemaVersion,
    [HERMES_ORIGINAL_MODE]: originalMode,
    answer: normalizeHermesCmoRuntimeAnswer(response.answer, answerMode),
    activity_summary: normalizeToolResponseActivitySummary(response, options.activityEventsCandidate),
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

const safeSideEffects = (value: unknown): false | Record<string, false> | null => {
  if (value === undefined || value === false) {
    return false;
  }

  if (!isRecord(value)) {
    return null;
  }

  const entries = Object.entries(value);

  if (entries.length === 0 || entries.every(([, item]) => item === false)) {
    return Object.fromEntries(entries) as Record<string, false>;
  }

  return null;
};

interface HermesCmoSideEffectsValidation {
  sideEffects: false | Record<string, false> | null;
  present: boolean;
  allowedForCreative?: boolean;
  rejectedType?: string;
}

const creativeSafeSideEffectTypes = new Set([
  "executed_creative",
  "image_generation",
  "video_generation",
  "media_generation",
  "generated_media_metadata",
  "creative_asset_metadata",
  "asset_metadata",
  "local_artifact_created",
  "local_artifact_metadata",
  "artifact_created",
  "artifact_metadata",
  "image_file_created",
  "video_file_created",
  "generation_completed",
]);

const unsafeSideEffectPattern =
  /\b(publish|published|post|posted|schedule|scheduled|credential|secret|token|cookie|vault|gbrain|knowledge_promotion|database|db_|supabase|sql|mutation|write|insert|update|delete|filesystem|fs_|file_write|arbitrary|connector|oauth)\b/i;

const localArtifactPathLike = (value: unknown): boolean =>
  typeof value === "string" && /^(?:file:|[A-Za-z]:[\\/]|\/(?:tmp|var|private\/tmp|Users\/[^/]+\/Library\/Caches|home\/[^/]+\/tmp)\b)/i.test(value.trim());

const creativeSideEffectType = (key: string, value: unknown): string => {
  if (isRecord(value) && typeof value.type === "string" && value.type.trim()) {
    return value.type.trim();
  }

  return key;
};

const creativeSideEffectEntryIsSafe = (key: string, value: unknown): { ok: true } | { ok: false; rejectedType: string } => {
  if (value === false || value === undefined || value === null) {
    return { ok: true };
  }

  const type = creativeSideEffectType(key, value);
  const normalizedType = type.replace(/[^a-z0-9_]+/gi, "_").toLowerCase();

  if (!creativeSafeSideEffectTypes.has(normalizedType) || unsafeSideEffectPattern.test(key) || unsafeSideEffectPattern.test(type)) {
    return { ok: false, rejectedType: normalizedType || key };
  }

  if (value === true) {
    return { ok: true };
  }

  if (typeof value === "string" || typeof value === "number") {
    return { ok: true };
  }

  if (!isRecord(value)) {
    return { ok: false, rejectedType: normalizedType };
  }

  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    if (unsafeSideEffectPattern.test(nestedKey) && nestedKey !== "local_path" && nestedKey !== "artifact_path") {
      return { ok: false, rejectedType: `${normalizedType}.${nestedKey}` };
    }

    if ((nestedKey === "path" || nestedKey === "local_path" || nestedKey === "artifact_path") && nestedValue !== undefined && !localArtifactPathLike(nestedValue)) {
      return { ok: false, rejectedType: `${normalizedType}.${nestedKey}` };
    }

    if (
      nestedKey !== "type" &&
      nestedKey !== "status" &&
      nestedKey !== "provider" &&
      nestedKey !== "mime_type" &&
      nestedKey !== "asset_type" &&
      nestedKey !== "path" &&
      nestedKey !== "local_path" &&
      nestedKey !== "artifact_path" &&
      nestedKey !== "bytes" &&
      nestedKey !== "sha256" &&
      nestedKey !== "width" &&
      nestedKey !== "height" &&
      nestedKey !== "model" &&
      nestedKey !== "operation"
    ) {
      return { ok: false, rejectedType: `${normalizedType}.${nestedKey}` };
    }
  }

  return { ok: true };
};

const safeCreativeSideEffects = (value: unknown): HermesCmoSideEffectsValidation => {
  if (value === undefined || value === false) {
    return { sideEffects: false, present: value !== undefined, allowedForCreative: value !== undefined };
  }

  if (!isRecord(value)) {
    return { sideEffects: null, present: true, allowedForCreative: false, rejectedType: "side_effects_not_object" };
  }

  const entries = Object.entries(value);

  if (entries.length === 0 || entries.every(([, item]) => item === false || item === null || item === undefined)) {
    return { sideEffects: Object.fromEntries(entries.map(([key]) => [key, false])) as Record<string, false>, present: true, allowedForCreative: true };
  }

  for (const [key, item] of entries) {
    const validation = creativeSideEffectEntryIsSafe(key, item);

    if (!validation.ok) {
      return { sideEffects: null, present: true, allowedForCreative: false, rejectedType: validation.rejectedType };
    }
  }

  return {
    sideEffects: {
      creative_generation: false,
      executed_creative: false,
      local_artifact_created: false,
      creative_asset_metadata: false,
      publishing: false,
      vault_write: false,
      supabase_mutation: false,
      credential_write: false,
      arbitrary_filesystem_write: false,
    },
    present: true,
    allowedForCreative: true,
  };
};

const hasTruthyExecutedCreativeSideEffect = (value: unknown): boolean =>
  isRecord(value) && value.executed_creative === true;

const hasCompleteExecutedCreativeMetadata = (value: unknown): boolean => {
  const summary = creativeTraceSummary(value);

  return (
    summary.routed_to_creative === true &&
    (summary.image_path_present === true ||
      summary.preview_url_present === true ||
      summary.storage_path_present === true ||
      (typeof summary.image_count === "number" && summary.image_count > 0)) &&
    typeof summary.bytes === "number" &&
    summary.sha256_present === true &&
    typeof summary.model === "string" &&
    typeof summary.operation === "string"
  );
};

const sideEffectsFromPayload = (
  payload: Record<string, unknown>,
  response: Record<string, unknown>,
  request: HermesCmoRuntimeRequest,
  creativeMetadataPresent: boolean,
): HermesCmoSideEffectsValidation => {
  const rawSideEffects = payload.side_effects ?? response.side_effects;
  const explicitCreativeExecutionWithMetadata = requestIsCreativeExecution(request) && creativeMetadataPresent;
  const creativeExecutionScopeWithMetadata = requestMayLeadToCreativeExecution(request) && creativeMetadataPresent;

  if (
    requestMayLeadToCreativeExecution(request) &&
    hasTruthyExecutedCreativeSideEffect(rawSideEffects) &&
    !hasCompleteExecutedCreativeMetadata(payload) &&
    !hasCompleteExecutedCreativeMetadata(response)
  ) {
    return { sideEffects: null, present: true, allowedForCreative: false, rejectedType: "executed_creative" };
  }

  const generic = safeSideEffects(rawSideEffects);

  if (generic !== null) {
    return {
      sideEffects: generic,
      present: rawSideEffects !== undefined,
      ...(creativeExecutionScopeWithMetadata && rawSideEffects !== undefined ? { allowedForCreative: true } : {}),
    };
  }

  if (explicitCreativeExecutionWithMetadata || creativeExecutionScopeWithMetadata) {
    return safeCreativeSideEffects(rawSideEffects);
  }

  return { sideEffects: null, present: rawSideEffects !== undefined };
};

const safeToolTraceSummaryDiagnostic = (value: unknown): M44aActivityDataDiagnostic => {
  if (value === undefined || value === null) {
    return { ok: true };
  }

  if (!isRecord(value)) {
    return {
      ok: false,
      keyPath: "tool_trace_summary",
      valueType: valueTypeLabel(value),
      reason: "nested_object_not_allowed",
    };
  }

  for (const [key, item] of Object.entries(value)) {
    const keyPath = `tool_trace_summary.${key}`;

    if (m44aUnsafeActivityDataKeyPattern.test(key)) {
      return {
        ok: false,
        keyPath,
        valueType: valueTypeLabel(item),
        reason: "unsafe_key_name",
      };
    }

    if (Array.isArray(item)) {
      if (item.length > 20 || !item.every((entry) => typeof entry === "string" && entry.length <= 120 && !m44aUnsafeActivityDataTextPattern.test(entry))) {
        return {
          ok: false,
          keyPath,
          valueType: "array",
          reason: "unbounded_array",
        };
      }

      continue;
    }

    if (!m44aSafeScalarActivityValue(item)) {
      return {
        ok: false,
        keyPath,
        valueType: valueTypeLabel(item),
        reason: isRecord(item) ? "nested_object_not_allowed" : "raw_content_like_value",
      };
    }
  }

  return { ok: true };
};

const safeToolTraceSummaryRejection = (value: unknown): string | null => {
  const diagnostic = safeToolTraceSummaryDiagnostic(value);

  if (diagnostic.ok) {
    return null;
  }

  return `unsafe_tool_trace_summary key=${safeDiagnosticKey(diagnostic.keyPath ?? "tool_trace_summary")} type=${diagnostic.valueType ?? "unknown"} reason=${diagnostic.reason ?? "unknown_key"}`;
};

const activitySummaryFailureReason = (activitySummary: unknown, response: Record<string, unknown>): string | null => {
  if (!isRecord(activitySummary)) {
    return isToolCapableResponseCandidate(response)
      ? "activity_summary_invalid:missing_activity_events"
      : "activity_summary_invalid:legacy_summary_required";
  }

  if (typeof activitySummary.events_count !== "number" || !Number.isInteger(activitySummary.events_count) || activitySummary.events_count < 0) {
    return `activity_summary_invalid:events_count=${String(activitySummary.events_count)}`;
  }

  if (!isNonEmptyString(activitySummary.final_state)) {
    return `activity_summary_invalid:final_state=${String(activitySummary.final_state)}`;
  }

  return null;
};

const responseValidationFailureReason = (
  response: Record<string, unknown>,
  request: HermesCmoRuntimeRequest,
  options: HermesCmoResponseValidationOptions,
): string => {
  response = normalizeHermesCmoResponseCandidate(response);
  const structuredOutput = isRecord(response.structured_output) ? response.structured_output : {};
  const activitySummary = response.activity_summary;
  const activitySummaryFailure = activitySummaryFailureReason(activitySummary, response);
  const toolTraceSummaryRejection = safeToolTraceSummaryRejection(response.tool_trace_summary);
  const allowCreativeIdeationAnswerBasis = requestAllowsCreativeIdeationAnswerBasis(request);
  const creativeNativeValidationOptions = { allowCreativeNative: allowCreativeIdeationAnswerBasis };

  if (response.direct_vault_write === true) return "direct_vault_write=true";
  if (response.direct_memory_mutation === true) return "direct_memory_mutation=true";
  if (response.direct_supabase_mutation === true) return "direct_supabase_mutation=true";
  if (response.direct_supabase_write === true) return "direct_supabase_write=true";
  if (response.gbrain_mutation === true) return "gbrain_mutation=true";
  if (response.knowledge_promotion_performed === true) return "knowledge_promotion_performed=true";
  if (response.auto_promote === true) return "auto_promote=true";
  if (response.direct_session_write === true) return "direct_session_write=true";
  if (response.direct_raw_capture_write === true) return "direct_raw_capture_write=true";
  if (response.openclaw_call === true) return "openclaw_call=true";
  if (response.schema_version !== "hermes.cmo.response.v1") return `schema_version=${String(response.schema_version)}`;
  if (response.request_id !== request.request_id) return `request_id_mismatch:${String(response.request_id)}`;
  if (response.session_id !== request.session_id) return `session_id_mismatch:${String(response.session_id)}`;
  if (response.turn_id !== request.turn_id) return `turn_id_mismatch:${String(response.turn_id)}`;
  if (!responseStatuses.has(response.status as HermesCmoRuntimeResponse["status"])) return `status=${String(response.status)}`;
  if (!validateAnswerBasis(response.answer_basis, { allowToolRead: isToolCapableResponseCandidate(response), allowCreativeIdeation: allowCreativeIdeationAnswerBasis })) {
    const basis = isRecord(response.answer_basis) ? response.answer_basis : {};

    return `answer_basis_invalid:mode=${String(basis.mode)}`;
  }
  if (!validateContextResolution(response.context_resolution)) return "context_resolution_invalid";
  if (!validateClarifyingQuestion(response.clarifying_question)) return "clarifying_question_invalid";
  if (!validateHermesCmoRuntimeAnswer(response.answer)) return "answer_invalid";
  if (!(isRecord(response.structured_output) || response.structured_output === null)) return "structured_output_invalid";
  if (!validateDelegations(response.delegations, options)) return "delegations_invalid";
  if (!Array.isArray(response.artifacts)) return "artifacts_invalid";
  if (!Array.isArray(response.memory_suggestions) || !response.memory_suggestions.every(isRecord)) return "memory_suggestions_invalid";
  if (activitySummaryFailure) return activitySummaryFailure;
  if (toolTraceSummaryRejection) return `activity_summary_invalid:${toolTraceSummaryRejection}`;
  if (!optionalClassificationIsAllowed(response.classification, creativeNativeValidationOptions)) return `classification=${String(response.classification)}`;
  if (!optionalClassificationIsAllowed(structuredOutput.classification, creativeNativeValidationOptions)) return `structured_output.classification=${String(structuredOutput.classification)}`;
  if (!optionalResponseStyleIsAllowed(response.response_style)) return `response_style=${String(response.response_style)}`;
  if (!optionalResponseStyleIsAllowed(structuredOutput.response_style)) return `structured_output.response_style=${String(structuredOutput.response_style)}`;
  if (responseUsesResearchFollowupClassificationOrStyle(response) && !requestHasResearchFollowupContext(request)) return "research_followup_context_missing";
  if (!optionalToolPolicyIsAllowed(response.tool_policy)) return `tool_policy=${String(response.tool_policy)}`;
  if (!optionalToolPolicyIsAllowed(structuredOutput.tool_policy)) return `structured_output.tool_policy=${String(structuredOutput.tool_policy)}`;

  if (
    response.status === "needs_user_input" &&
    (response.answer !== null ||
      response.structured_output !== null ||
      isRecord(response.answer_basis) && response.answer_basis.mode !== "needs_user_input" && response.answer_basis.mode !== "clarification" ||
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

const creativeResponseStatuses = new Set(["success", "completed", "partial", "blocked", "failed", "timeout"]);

const creativeStatusToHermesStatus = (value: unknown): HermesCmoRuntimeResponse["status"] => {
  switch (value) {
    case "partial":
      return "partial";
    case "blocked":
    case "failed":
    case "timeout":
      return "failed";
    case "success":
    case "completed":
    default:
      return "completed";
  }
};

const creativeResponseHasExecutionMetadata = (value: unknown): boolean => {
  if (hasCreativeExecutionMetadata(value)) {
    return true;
  }

  const summary = creativeTraceSummary(value);

  return summary.routed_to_creative === true || summary.image_metadata_present === true;
};

const normalizeCreativeExecutionResponseCandidate = (
  response: Record<string, unknown>,
  request: HermesCmoRuntimeRequest,
  activityEventsCandidate: unknown[],
): Record<string, unknown> => {
  const status = typeof response.status === "string" ? response.status : "completed";
  const summary = creativeTraceSummary(response);
  const responseWithStatus = {
    ...response,
    status,
    routed_to_creative: summary.routed_to_creative === true ? true : response.routed_to_creative,
    transport_status: summary.product_artifact_status,
  };
  const answerCandidate = isRecord(response.answer) ? response.answer : {};
  const preservedAnswerBody =
    typeof answerCandidate.body === "string"
      ? answerCandidate.body
      : typeof response.body === "string"
        ? response.body
        : typeof response.visual_summary === "string"
          ? response.visual_summary
          : typeof response.notes === "string"
            ? response.notes
            : "";
  const preservedAnswerSummary =
    typeof answerCandidate.summary === "string"
      ? answerCandidate.summary
      : typeof response.visual_summary === "string"
        ? response.visual_summary
        : typeof response.notes === "string"
          ? response.notes
          : "";

  return {
    ...response,
    schema_version: "hermes.cmo.response.v1",
    request_id: request.request_id,
    session_id: request.session_id,
    turn_id: request.turn_id,
    status: creativeStatusToHermesStatus(status),
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
      title: typeof answerCandidate.title === "string" && answerCandidate.title.trim() ? answerCandidate.title : "Creative Asset",
      summary: preservedAnswerSummary,
      decision: typeof answerCandidate.decision === "string" ? answerCandidate.decision : "",
      body: preservedAnswerBody,
    },
    structured_output: {
      ...(isRecord(response.structured_output) ? response.structured_output : {}),
      creative_response: responseWithStatus,
      creative_response_received: true,
      creative_metadata_present: true,
      rejected_by_m1_validator: false,
      fallback_used: false,
      product_artifact_status: summary.product_artifact_status,
    },
    delegations: Array.isArray(response.delegations) ? response.delegations : [],
    artifacts: Array.isArray(response.creative_assets)
      ? response.creative_assets
      : Array.isArray(response.artifacts)
      ? response.artifacts
      : [{
          schema_version: "cmo.creative_response.v1",
          type: "creative_response",
          ...responseWithStatus,
        }],
    memory_suggestions: Array.isArray(response.memory_suggestions) ? response.memory_suggestions : [],
    activity_summary: {
      ...(isRecord(response.activity_summary) ? response.activity_summary : {}),
      events_count: activityEventsCandidate.length,
      final_state: creativeStatusToHermesStatus(status),
      creative_response_received: true,
      creative_metadata_present: true,
      rejected_by_m1_validator: false,
      fallback_used: false,
    },
  };
};

const maybeNormalizeCreativeExecutionResponseCandidate = (
  response: Record<string, unknown>,
  request: HermesCmoRuntimeRequest,
  activityEventsCandidate: unknown[],
): Record<string, unknown> => {
  if (!requestMayLeadToCreativeExecution(request)) {
    return response;
  }

  const status = typeof response.status === "string" ? response.status : "completed";

  if (!creativeResponseStatuses.has(status) || !creativeResponseHasExecutionMetadata(response)) {
    return response;
  }

  return normalizeCreativeExecutionResponseCandidate(response, request, activityEventsCandidate);
};

const sourceModeIsCreativeExecution = (
  sourceMode: unknown,
  eventType: unknown,
  request: HermesCmoRuntimeRequest,
): boolean =>
  sourceMode === "creative_execution" &&
    requestMayLeadToCreativeExecution(request) &&
  creativeLifecycleActivityTypes.has(eventType as HermesActivityType);

const activityEventTypeIsAllowed = (eventType: unknown): eventType is HermesActivityType =>
  activityTypes.has(eventType as HermesActivityType);

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
  if (!activityEventTypeIsAllowed(eventType)) return `type=${String(eventType)}`;
  if (!activityStatuses.has(status as HermesActivityStatus)) return `status=${String(status)}`;
  if (sourceAgent !== "cmo" && sourceAgent !== "echo" && sourceAgent !== "surf" && sourceAgent !== "creative") return `source_invalid:agent=${String(sourceAgent)}`;
  if (
    sourceAgent === "cmo" &&
    sourceMode !== "cmo.default" &&
    !(options.allowToolCapableCmoSource === true && sourceMode === "cmo.tool_capable") &&
    !sourceModeIsCreativeExecution(sourceMode, eventType, request)
  ) {
    return `source_invalid:mode=${String(sourceMode)}`;
  }
  if (sourceAgent === "echo" && sourceMode !== "echo.default" && sourceMode !== "echo.source_translate") return `source_invalid:mode=${String(sourceMode)}`;
  if (sourceAgent === "surf" && !allowedSurfModes.has(sourceMode as HermesSurfMode)) return `source_invalid:mode=${String(sourceMode)}`;
  if (
    sourceAgent === "creative" &&
    !allowedCreativeModes.has(sourceMode as HermesCreativeMode) &&
    !sourceModeIsCreativeExecution(sourceMode, eventType, request)
  ) {
    return `source_invalid:mode=${String(sourceMode)}`;
  }
  if (!isRecord(event.data)) return "data_invalid";
  const dataRejection = m44aActivityEventDataRejection(eventType as HermesActivityType, event.data);
  if (dataRejection) return dataRejection;
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

const appIsConfiguredCanary = (appId: string, canaryApps: string[]): boolean => {
  const normalizedAppId = appId.trim().toLowerCase();
  const normalizedCanaryApps = canaryApps.map((value) => value.trim().toLowerCase());

  return Boolean(normalizedAppId) && (normalizedCanaryApps.includes("*") || normalizedCanaryApps.includes(normalizedAppId));
};

const hermesTimeoutMs = () => {
  const value = Number.parseInt(process.env.CMO_HERMES_TIMEOUT_MS ?? "240000", 10);

  return Number.isFinite(value) && value > 0 ? value : 240000;
};

const endpointPathFromConfig = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed) {
    return HERMES_CMO_TOOL_AGENT_DEFAULT_PATH;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);

    return `${url.pathname}${url.search}`;
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const endpointUrl = (baseUrl: string, pathOrUrl: string): string =>
  /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${baseUrl}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;

const sourceSeekingTextPattern =
  /(https?:\/\/|www\.|\b(read|open|fetch|load|summari[sz]e|summary|translate|review|audit|analy[sz]e|source|link|url|docs?|document|faq)\b|\b(t[oó]m\s*t[aắ]t|d[iị]ch|[đd]ọc|link|ngu[oồ]n|t[aà]i\s*li[eệ]u)\b)/i;

const externalResearchTextPattern =
  /\b(competitor|competitors|market\s+landscape|current\s+market|market\s+scan|trend|trends|current|live|today|compare\s+alternatives?|alternatives?|x\/twitter|twitter|social\s+signals?|social\s+listening)\b|(?:th\u1ecb\s*tr\u01b0\u1eddng|\u0111\u1ed1i\s*th\u1ee7|b\u00ean\s*n\u00e0o\s*gi\u1ed1ng|gi\u1ed1ng\s*m\u00ecnh|h\u00f4m\s*nay|xu\s*h\u01b0\u1edbng|t\u00ecm\s*th\u00eam|th\u00eam\s*\d+\s*b\u00ean|b\u00ean\s*kh\u00e1c\s*n\u1eefa)/i;

const researchFollowupTextPattern =
  /\b(rank|ranking|compare|comparison|table|score|scorecard|criteria)\b|(?:l\u1eadp\s*b\u1ea3ng|so\s*s\u00e1nh|trong\s*5\s*b\u00ean\s*\u0111\u00f3|b\u00ean\s*n\u00e0o\s*gi\u1ed1ng\s*nh\u1ea5t|x\u1ebfp\s*h\u1ea1ng|theo\s*ti\u00eau\s*ch\u00ed|so\s*v\u1edbi\s*hold\s*pay|gi\u1ed1ng\s*hold\s*pay\s*nh\u1ea5t)/i;

const stripAcknowledgementPrefix = (value: string): string =>
  value
    .replace(/^\s*(?:ok(?:ay)?|r\u1ed3i|\u1eeb|uh|thanks?|thank you|c\u1ea3m \u01a1n|cam on|r\u00f5 r\u1ed3i|ro roi)[,.\s:;-]+/i, "")
    .trim();

const recordString = (record: Record<string, unknown>, key: string): string | null =>
  typeof record[key] === "string" && record[key].trim() ? record[key].trim() : null;

const sourceArtifactRecords = (request: HermesCmoRuntimeRequest): Record<string, unknown>[] => {
  const artifacts = Array.isArray(request.context_pack.artifacts_in) ? request.context_pack.artifacts_in : [];
  const sourceAnswerContext = isRecord(request.context_pack.source_answer_context) ? request.context_pack.source_answer_context : null;
  const sourceReviewContext = isRecord(request.context_pack.source_review_context) ? request.context_pack.source_review_context : null;
  const sourceReviewSource = isRecord(sourceReviewContext?.source) ? sourceReviewContext.source : null;

  return [
    ...artifacts.filter(isRecord),
    ...(sourceAnswerContext ? [sourceAnswerContext] : []),
    ...(sourceReviewSource ? [sourceReviewSource] : []),
  ];
};

const sourceHasUrl = (record: Record<string, unknown>): boolean =>
  Boolean(recordString(record, "original_url") || recordString(record, "canonical_url") || recordString(record, "url"));

const sourceIdFromRecord = (record: Record<string, unknown>): string | null =>
  recordString(record, "source_id") ?? recordString(record, "id");

const activeSourceIdForToolEndpoint = (request: HermesCmoRuntimeRequest): string | null =>
  typeof request.context_pack.active_source_id === "string" && request.context_pack.active_source_id.trim()
    ? request.context_pack.active_source_id.trim()
    : sourceArtifactRecords(request).map(sourceIdFromRecord).find(Boolean) ?? null;

const sourceUrlForToolEndpoint = (request: HermesCmoRuntimeRequest): { originalUrl: string | null; canonicalUrl: string | null } => {
  const sourceAcquisition = isRecord(request.source_acquisition) ? request.source_acquisition : null;
  const records = sourceArtifactRecords(request);
  const originalUrl =
    (sourceAcquisition ? recordString(sourceAcquisition, "original_url") ?? recordString(sourceAcquisition, "url") : null) ??
    records.map((record) => recordString(record, "original_url") ?? recordString(record, "url")).find(Boolean) ??
    null;
  const canonicalUrl =
    (sourceAcquisition ? recordString(sourceAcquisition, "canonical_url") : null) ??
    records.map((record) => recordString(record, "canonical_url")).find(Boolean) ??
    originalUrl;

  return { originalUrl, canonicalUrl };
};

const requestHasSourceUrl = (request: HermesCmoRuntimeRequest): boolean =>
  sourceArtifactRecords(request).some(sourceHasUrl) ||
  (isRecord(request.source_acquisition) && (typeof request.source_acquisition.original_url === "string" || typeof request.source_acquisition.canonical_url === "string"));

const researchArtifactRecords = (request: HermesCmoRuntimeRequest): Record<string, unknown>[] =>
  (Array.isArray(request.context_pack.artifacts_in) ? request.context_pack.artifacts_in : [])
    .filter(isRecord)
    .filter((artifact) => artifact.type === "session_local_research_result" && artifact.schema_version === "cmo.session_local_research_result.v1");

const requestHasSessionResearchArtifact = (request: HermesCmoRuntimeRequest): boolean =>
  researchArtifactRecords(request).length > 0;

const requestHasResearchFollowupContext = (request: HermesCmoRuntimeRequest): boolean =>
  requestHasSessionResearchArtifact(request) || isRecord(request.context_pack.research_context);

const requestIsResearchFollowup = (request: HermesCmoRuntimeRequest): boolean =>
  researchFollowupTextPattern.test(stripAcknowledgementPrefix(request.intent.user_message));

const requestIsResearchFollowupUsingPriorResult = (request: HermesCmoRuntimeRequest): boolean =>
  requestIsResearchFollowup(request) &&
  (requestHasSessionResearchArtifact(request) ||
    /(?:trong\s*5\s*b\u00ean\s*\u0111\u00f3|5\s*b\u00ean|b\u00ean\s*\u0111\u00f3|l\u1eadp\s*b\u1ea3ng|x\u1ebfp\s*h\u1ea1ng|theo\s*ti\u00eau\s*ch\u00ed|so\s*v\u1edbi\s*hold\s*pay)/i.test(
      stripAcknowledgementPrefix(request.intent.user_message),
    ));

const requestIsExternalResearch = (request: HermesCmoRuntimeRequest): boolean =>
  externalResearchTextPattern.test(stripAcknowledgementPrefix(request.intent.user_message)) ||
  requestIsResearchFollowup(request);

const requestIsSourceBackedOrSeeking = (request: HermesCmoRuntimeRequest): boolean => {
  const sourceAcquisition = isRecord(request.source_acquisition) ? request.source_acquisition : {};
  const sourceAnswerContext = isRecord(request.context_pack.source_answer_context) ? request.context_pack.source_answer_context : {};
  const readDepth = recordString(sourceAcquisition, "read_depth") ?? recordString(sourceAnswerContext, "read_depth");
  const cacheRole = recordString(sourceAcquisition, "cache_role") ?? recordString(sourceAnswerContext, "cache_role");
  const extractionCoverage = recordString(sourceAcquisition, "extraction_coverage") ?? recordString(sourceAnswerContext, "extraction_coverage");
  const queryType = recordString(sourceAnswerContext, "query_type");
  const action = recordString(sourceAnswerContext, "action");
  const hasUrl = requestHasSourceUrl(request);

  return (
    sourceSeekingTextPattern.test(request.intent.user_message) ||
    sourceAcquisition.tool_read_recommended === true ||
    sourceAnswerContext.tool_read_recommended === true ||
    cacheRole === "fallback_only" ||
    cacheRole === "context_hint" ||
    Boolean(hasUrl && (readDepth === "partial" || readDepth === "snippet" || extractionCoverage === "static_html")) ||
    Boolean(hasUrl && (queryType === "summarize" || queryType === "translate" || queryType === "specific_question" || queryType === "review" || queryType === "can_read")) ||
    Boolean(hasUrl && (action === "summarize" || action === "translate" || action === "answer_question" || action === "review" || action === "can_read"))
  );
};

const requestIsCreativeExecution = (request: HermesCmoRuntimeRequest): boolean => {
  const input = isRecord(request.input) ? request.input : {};
  const creativeIntent = isRecord(input.creative_execution_intent) ? input.creative_execution_intent : {};
  const toolPolicy = isRecord(request.tool_policy) ? request.tool_policy : {};

  return (
    request.intent.explicit_command === "creative.generate_image" ||
    request.intent.explicit_command === "creative.generate_video" ||
    request.intent.explicit_command === "creative.image_generation" ||
    request.intent.explicit_command === "creative" ||
    creativeIntent.requested === true ||
    request.constraints.creative_execution_requested === true ||
    toolPolicy.creative_execution_requested === true
  );
};

const requestHasCreativeWorkingState = (request: HermesCmoRuntimeRequest): boolean => {
  const state = isRecord(request.creative_working_state)
    ? request.creative_working_state
    : isRecord(request.input) && isRecord(request.input.creative_working_state)
      ? request.input.creative_working_state
      : isRecord(request.context_pack.creative_working_state)
        ? request.context_pack.creative_working_state
        : null;

  if (!state) {
    return false;
  }

  return Array.isArray(state.drafts) && state.drafts.length > 0 || typeof state.active_draft_id === "string";
};

const requestIsCreativeIdeation = (request: HermesCmoRuntimeRequest): boolean => {
  const input = isRecord(request.input) ? request.input : {};
  const creativeIdeationIntent = isRecord(input.creative_ideation_intent) ? input.creative_ideation_intent : {};
  const toolPolicy = isRecord(request.tool_policy) ? request.tool_policy : {};

  return (
    request.creative_ideation_detected === true ||
    request.intent.creative_ideation_detected === true ||
    request.context_pack.creative_ideation_detected === true ||
    creativeIdeationIntent.requested === true ||
    request.constraints.creative_ideation_detected === true ||
    toolPolicy.creative_ideation_detected === true
  );
};

const requestMayLeadToCreativeExecution = (request: HermesCmoRuntimeRequest): boolean =>
  requestIsCreativeExecution(request) || requestIsCreativeIdeation(request) || requestHasCreativeWorkingState(request);

const requestRouteDecision = (request: HermesCmoRuntimeRequest): unknown => {
  const input = isRecord(request.input) ? request.input : {};

  return request.route_decision ?? request.constraints.route_decision ?? request.context_pack.route_decision ?? input.route_decision;
};

const requestCreativeFlagIsTrue = (request: HermesCmoRuntimeRequest, key: string): boolean => {
  const input = isRecord(request.input) ? request.input : {};
  const toolPolicy = isRecord(request.tool_policy) ? request.tool_policy : {};
  const executionBoundary = nestedRecord(request.constraints, "execution_boundary");
  const h5LiveAdapter = nestedRecord(request.constraints, "h5_live_adapter");
  const creativePolicy = nestedRecord(nestedRecord(request.constraints, "m1_clean_cmo_skill_kernel"), "creative_policy");

  return (
    request[key] === true ||
    request.intent[key] === true ||
    input[key] === true ||
    request.context_pack[key] === true ||
    request.constraints[key] === true ||
    toolPolicy[key] === true ||
    executionBoundary[key] === true ||
    h5LiveAdapter[key] === true ||
    creativePolicy[key] === true ||
    key === "cmo_owns_creative_decision" && creativePolicy.cmo_owns_decision === true
  );
};

const requestAllowsCreativeIdeationAnswerBasis = (request: HermesCmoRuntimeRequest): boolean => {
  const routeDecision = requestRouteDecision(request);

  return (
    (
      routeDecision === "creative_ideation" && requestCreativeFlagIsTrue(request, "creative_ideation_detected") ||
      routeDecision === "creative_session" && (requestCreativeFlagIsTrue(request, "creative_working_state_present") || requestHasCreativeWorkingState(request))
    ) &&
    requestCreativeFlagIsTrue(request, "cmo_owns_creative_decision")
  );
};

const creativeExecutionModeFromRequest = (request: HermesCmoRuntimeRequest): "creative.generate_image" | "creative.generate_video" => {
  const input = isRecord(request.input) ? request.input : {};
  const creativeIntent = isRecord(input.creative_execution_intent) ? input.creative_execution_intent : {};
  const toolPolicy = isRecord(request.tool_policy) ? request.tool_policy : {};
  const mode = request.intent.explicit_command ?? creativeIntent.mode ?? request.constraints.creative_execution_mode ?? toolPolicy.creative_execution_mode;

  return mode === "creative.generate_video" ? "creative.generate_video" : "creative.generate_image";
};

const productPublicOrigin = (): string =>
  (process.env.CMO_PUBLIC_APP_URL?.trim() || CMO_DEFAULT_PUBLIC_APP_URL).replace(/\/+$/g, "");

const creativeArtifactTransportForRequest = (request: HermesCmoRuntimeRequest): HermesCmoRuntimeRequest["artifact_transport"] => {
  const appId = request.workspace.app_id;

  return {
    mode: "product_upload",
    upload_endpoint: `${productPublicOrigin()}/api/cmo/apps/${encodeURIComponent(appId)}/creative/artifact-ingest`,
    workspace_id: request.workspace.workspace_id,
    app_id: appId,
    request_id: request.request_id,
    accepted_mime_types: [...CMO_CREATIVE_ARTIFACT_MIME_TYPES],
    max_bytes: CMO_CREATIVE_ARTIFACT_MAX_BYTES,
  };
};

const positiveTimeoutOverride = (value: unknown): number | undefined => {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
};

const selectedHermesCmoConfig = (request: HermesCmoRuntimeRequest, options: HermesCmoRuntimeOptions = {}): HermesCmoAgentConfig => {
  const baseUrl = process.env.CMO_HERMES_BASE_URL?.trim().replace(/\/+$/g, "") ?? "";
  const apiKey = process.env.CMO_HERMES_API_KEY?.trim() ?? "";
  const toolEndpointEnabled = isCmoHermesCmoToolExecuteEnabled();
  const toolChatCanaryEnabled = isCmoHermesCmoToolChatEnabled() &&
    appIsConfiguredCanary(request.workspace.app_id, getCmoHermesCmoToolChatCanaryApps());
  const externalResearch = requestIsExternalResearch(request);
  const explicitCreativeExecution = requestIsCreativeExecution(request);
  const creativeIdeation = requestIsCreativeIdeation(request);
  const creativeSession = !explicitCreativeExecution && !creativeIdeation && requestHasCreativeWorkingState(request);
  const creativeExecution = explicitCreativeExecution || creativeIdeation || creativeSession;
  const useToolEndpoint = !creativeExecution && (toolChatCanaryEnabled || (toolEndpointEnabled && (externalResearch || requestIsSourceBackedOrSeeking(request))));
  const configuredToolEndpoint = getCmoHermesCmoToolEndpoint();
  const endpointPath = useToolEndpoint ? endpointPathFromConfig(configuredToolEndpoint) : HERMES_CMO_AGENT_PATH;
  const toolTimeoutOverride = positiveTimeoutOverride(options.toolTimeoutMs);
  const timeoutMs = useToolEndpoint
    ? toolTimeoutOverride ?? getCmoHermesCmoToolTimeoutMs()
    : creativeExecution
      ? getCmoHermesCreativeExecuteTimeoutMs()
      : hermesTimeoutMs();
  const timeoutSource: HermesCmoTimeoutSource = useToolEndpoint
    ? toolTimeoutOverride !== undefined
      ? "tool_timeout_override"
      : "tool_endpoint"
    : creativeExecution
      ? "creative_execute"
      : "default_execute";
  const routeDecision: HermesCmoRouteDecision = useToolEndpoint
    ? "tool_execute"
    : explicitCreativeExecution
      ? "creative_execution"
      : creativeIdeation
        ? "creative_ideation"
        : creativeSession
          ? "creative_session"
          : "execute";

  if (!envEnabled(process.env.CMO_HERMES_EXECUTION_ENABLED)) {
    throw new Error("CMO_HERMES_EXECUTION_ENABLED must be true for the live-only Hermes CMO runtime.");
  }

  if (!baseUrl && !/^https?:\/\//i.test(configuredToolEndpoint)) {
    throw new Error("CMO_HERMES_BASE_URL is required for the live-only Hermes CMO runtime.");
  }

  if (!apiKey) {
    throw new Error("CMO_HERMES_API_KEY is required for the live-only Hermes CMO runtime.");
  }

  return {
    endpoint: endpointUrl(baseUrl, useToolEndpoint ? configuredToolEndpoint : HERMES_CMO_AGENT_PATH),
    endpointPath,
    endpointKind: useToolEndpoint ? "tool_execute" : "execute",
    apiKey,
    timeoutMs,
    timeoutSource,
    routeDecision,
    toolEndpointEnabled: toolEndpointEnabled || toolChatCanaryEnabled,
  };
};

const withHermesCmoRouteDecision = (
  request: HermesCmoRuntimeRequest,
  routeDecision: HermesCmoRouteDecision,
): HermesCmoRuntimeRequest => ({
  ...request,
  route_decision: routeDecision,
  input: {
    ...(isRecord(request.input) ? request.input : {}),
    route_decision: routeDecision,
  },
  context_pack: {
    ...request.context_pack,
    route_decision: routeDecision,
  },
  constraints: {
    ...request.constraints,
    route_decision: routeDecision,
  },
});

const omitSourceCacheText = (record: Record<string, unknown>): Record<string, unknown> => {
  const rest = { ...record };

  for (const key of [
    "source_text_cache",
    "source_text_excerpt",
    "source_text",
    "extracted_summary",
    "relevant_snippets",
    "body",
    "content",
    "html",
    "markdown",
    "file_body",
    "file_content",
  ]) {
    delete rest[key];
  }

  return rest;
};

const toolEndpointArtifact = (artifact: unknown): unknown => {
  if (!isRecord(artifact)) {
    return artifact;
  }

  if (artifact.type === "session_local_source" || artifact.type === "source_answer_context") {
    return {
      ...omitSourceCacheText(artifact),
      ...(artifact.type === "source_answer_context" && artifact.cache_role !== "high_quality_evidence"
        ? {
            answerable: false,
            relevant_snippets: [],
            tool_read_recommended: true,
          }
        : {}),
    };
  }

  return artifact;
};

const toolEndpointSourceAnswerContext = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }

  const sanitized = omitSourceCacheText(value);

  return value.cache_role === "high_quality_evidence" && value.tool_read_recommended !== true
    ? sanitized
    : {
        ...sanitized,
        answerable: false,
        relevant_snippets: [],
        tool_read_recommended: true,
      };
};

const toolEndpointSourceReviewContext = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }

  const extraction = isRecord(value.extraction) ? omitSourceCacheText(value.extraction) : value.extraction;

  return {
    ...value,
    extraction,
  };
};

const toolEndpointArtifactWithSourceUrl = (
  artifact: unknown,
  sourceUrl: { originalUrl: string | null; canonicalUrl: string | null },
): unknown => {
  const sanitized = toolEndpointArtifact(artifact);

  if (!isRecord(sanitized) || !sourceIdFromRecord(sanitized)) {
    return sanitized;
  }

  return {
    ...sanitized,
    ...(sourceUrl.originalUrl && !recordString(sanitized, "original_url") ? { original_url: sourceUrl.originalUrl } : {}),
    ...(sourceUrl.canonicalUrl && !recordString(sanitized, "canonical_url") ? { canonical_url: sourceUrl.canonicalUrl } : {}),
  };
};

const toolPolicyForToolEndpoint = (request: HermesCmoRuntimeRequest): Record<string, unknown> =>
  isRecord(request.tool_policy)
    ? request.tool_policy
    : {
        schema_version: "cmo.hermes.tool_policy.v1",
        role: "product_shell_context_provider",
        allowed_agents: request.constraints.allowed_agents,
        allowed_surf_modes: request.constraints.allowed_surf_modes,
        delegations_mode: request.constraints.delegations_mode,
        read_web_allowed: true,
        read_browser_allowed: true,
        read_file_allowed: true,
        terminal_read_only_allowed: true,
        durable_writes_require_confirmation: true,
        allowed_toolsets: ["web", "browser", "file", "terminal_read_only"],
        disabled_toolsets: ["messaging", "cronjob", "kanban"],
        durable_writes: {
          session_log_owned_by_cmo_engine: true,
          vault_writes_require_explicit_save_flow: true,
          source_ingestion_requires_inputs_priorities_or_explicit_save: true,
          no_auto_save_13_sources: true,
          no_auto_promote_12_knowledge: true,
          no_gbrain_mutation: true,
        },
      };

const toolEndpointRequest = (request: HermesCmoRuntimeRequest): HermesCmoRuntimeRequest => {
  const userMessage = request.intent.user_message;
  const activeSourceId = activeSourceIdForToolEndpoint(request);
  const sourceUrl = sourceUrlForToolEndpoint(request);
  const toolPolicy = toolPolicyForToolEndpoint(request);
  const sourceAcquisition = isRecord(request.source_acquisition)
    ? {
        ...request.source_acquisition,
        ...(activeSourceId ? { active_source_id: activeSourceId } : {}),
        ...(sourceUrl.originalUrl && !recordString(request.source_acquisition, "original_url") ? { original_url: sourceUrl.originalUrl } : {}),
        ...(sourceUrl.canonicalUrl && !recordString(request.source_acquisition, "canonical_url") ? { canonical_url: sourceUrl.canonicalUrl } : {}),
        tool_read_recommended: true,
        endpoint_role: "tool_capable_source_reader",
      }
    : sourceUrl.originalUrl || sourceUrl.canonicalUrl
      ? {
          ...(activeSourceId ? { active_source_id: activeSourceId } : {}),
          ...(sourceUrl.originalUrl ? { original_url: sourceUrl.originalUrl } : {}),
          ...(sourceUrl.canonicalUrl ? { canonical_url: sourceUrl.canonicalUrl } : {}),
          tool_read_recommended: true,
          endpoint_role: "tool_capable_source_reader",
        }
      : request.source_acquisition;

  return {
    ...request,
    user_message: userMessage,
    message: userMessage,
    input: {
      ...(isRecord(request.input) ? request.input : {}),
      user_message: userMessage,
      message: userMessage,
    },
    tool_policy: toolPolicy,
    ...(activeSourceId ? { active_source_id: activeSourceId } : {}),
    context_pack: {
      ...request.context_pack,
      ...(activeSourceId ? { active_source_id: activeSourceId } : {}),
      artifacts_in: request.context_pack.artifacts_in.map((artifact) => toolEndpointArtifactWithSourceUrl(artifact, sourceUrl)),
      ...(request.context_pack.source_answer_context
        ? { source_answer_context: toolEndpointSourceAnswerContext(request.context_pack.source_answer_context) }
        : {}),
      ...(request.context_pack.source_review_context
        ? { source_review_context: toolEndpointSourceReviewContext(request.context_pack.source_review_context) }
        : {}),
    },
    ...(sourceAcquisition ? { source_acquisition: sourceAcquisition } : {}),
    constraints: {
      ...request.constraints,
      allowCmoReadTools: true,
      allowWebReadTools: true,
      allowBrowserReadTools: true,
      m1_clean_cmo_skill_kernel: isRecord(request.constraints.m1_clean_cmo_skill_kernel)
        ? {
            ...request.constraints.m1_clean_cmo_skill_kernel,
            cmo_role: "tool_capable_source_gathering_reasoning_agent",
            forbidden_targets: ["vault_agent", "openclaw", "supabase", "memory", "arbitrary_mutation_tools"],
            tool_endpoint_final_answer_owner: "hermes_cmo",
          }
        : request.constraints.m1_clean_cmo_skill_kernel,
      h5_live_adapter: isRecord(request.constraints.h5_live_adapter)
        ? {
            ...request.constraints.h5_live_adapter,
            call_only: "hermes_cmo_tool_capable_agent",
            cmo_read_tools_allowed: true,
            tool_read_side_effects_allowed: false,
          }
        : request.constraints.h5_live_adapter,
      execution_boundary: isRecord(request.constraints.execution_boundary)
        ? {
            ...request.constraints.execution_boundary,
            cmo_read_tools_allowed: true,
            web_read_allowed: true,
            browser_read_allowed: true,
            durable_side_effects_allowed: false,
          }
        : request.constraints.execution_boundary,
    },
    tool_endpoint: {
      enabled: true,
      endpoint_role: "hermes_cmo_tool_capable_source_reader",
      cache_is_hint_not_primary_evidence: true,
      durable_side_effects_allowed: false,
    },
  };
};

const traceEnabled = () =>
  process.env.CMO_HERMES_CMO_TRACE_ENABLED === "true" || Boolean(process.env.CMO_HERMES_CMO_TRACE_DIR?.trim());

const traceDirectory = () =>
  path.resolve(process.env.CMO_HERMES_CMO_TRACE_DIR?.trim() || path.join(process.cwd(), "data", "cmo-dashboard", "hermes-cmo-traces"));

const safeTraceId = (value: string) => value.replace(/[^a-z0-9_.-]+/gi, "_").slice(0, 96) || "unknown";

const traceString = (value: string, max = 1200) => {
  const compact = value.replace(/\s+/g, " ").trim();
  const redactedLocalPath = redactedLocalArtifactPath(compact);
  const redacted = redactSensitiveText(redactedLocalPath ?? compact, Math.max(max, 1200));

  return redacted.length > max ? `${redacted.slice(0, max - 3).trimEnd()}...` : redacted;
};

const traceValue = (value: unknown, depth = 0): unknown => {
  if (typeof value === "string") {
    return traceString(value);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item) => traceValue(item, depth + 1));
  }

  if (depth >= 5 || !isRecord(value)) {
    return "[object_redacted]";
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (/api[_-]?key|authorization|token|secret|password/i.test(key)) {
        return [key, "[redacted]"];
      }

      return [key, traceValue(item, depth + 1)];
    }),
  );
};

const hermesTracePath = (request: HermesCmoRuntimeRequest, suffix: string) =>
  path.join(
    traceDirectory(),
    `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeTraceId(request.workspace.app_id)}_${safeTraceId(request.session_id)}_${safeTraceId(request.turn_id)}_${suffix}.json`,
  );

const writeHermesTrace = async (
  request: HermesCmoRuntimeRequest,
  suffix: string,
  payload: Record<string, unknown>,
) => {
  if (!traceEnabled()) {
    return;
  }

  try {
    const filePath = hermesTracePath(request, suffix);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(traceValue(payload), null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn("[hermes-cmo-runtime] Failed to write safe Hermes CMO trace.", {
      requestId: request.request_id,
      sessionId: request.session_id,
      turnId: request.turn_id,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
};

const nestedRecord = (record: Record<string, unknown>, key: string): Record<string, unknown> =>
  isRecord(record[key]) ? record[key] : {};

const firstDefined = (values: unknown[]): unknown => values.find((value) => value !== undefined && value !== null);

const pathKind = (value: unknown): "local_artifact_path" | "browser_url" | "relative_or_storage_path" | null => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();

  if (redactedLocalArtifactPath(trimmed)?.startsWith("[hermes_local_artifact_path_redacted]")) {
    return "local_artifact_path";
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? "browser_url" : "relative_or_storage_path";
  } catch {
    return "relative_or_storage_path";
  }
};

const creativeTraceSummary = (payload: unknown): Record<string, unknown> => {
  const root = isRecord(payload) ? payload : {};
  const response = isRecord(root.response) ? root.response : root;
  const structuredOutput = nestedRecord(response, "structured_output");
  const structuredCreativeResponse = nestedRecord(structuredOutput, "creative_response");
  const structuredCreative = nestedRecord(structuredOutput, "creative");
  const answer = nestedRecord(response, "answer");
  const artifacts = Array.isArray(response.artifacts)
    ? response.artifacts
    : Array.isArray(root.artifacts)
      ? root.artifacts
      : [];
  const creativeAssets = Array.isArray(response.creative_assets)
    ? response.creative_assets
    : Array.isArray(root.creative_assets)
      ? root.creative_assets
      : [];
  const firstArtifact = artifacts.find(isRecord) as Record<string, unknown> | undefined;
  const firstCreativeAsset = creativeAssets.find(isRecord) as Record<string, unknown> | undefined;
  const candidates = [response, structuredOutput, structuredCreativeResponse, structuredCreative, answer, firstArtifact, firstCreativeAsset].filter(isRecord);
  const firstCandidateValue = (keys: string[]) => {
    for (const candidate of candidates) {
      for (const key of keys) {
        if (candidate[key] !== undefined && candidate[key] !== null) {
          return candidate[key];
        }
      }
    }

    return undefined;
  };
  const images = candidates
    .flatMap((candidate) => [
      ...(Array.isArray(candidate.images) ? candidate.images.filter(isRecord) : []),
      ...(Array.isArray(candidate.creative_assets) ? candidate.creative_assets.filter(isRecord) : []),
    ])
    .filter(isRecord);
  const firstImage = images[0];
  const imagePath = firstDefined([
    firstCandidateValue(["image_path", "path"]),
    firstImage?.image_path,
    firstImage?.path,
  ]);
  const previewValue = firstDefined([
    firstCandidateValue(["render_url", "preview_url", "signed_url", "url"]),
    firstImage?.render_url,
    firstImage?.preview_url,
    firstImage?.signed_url,
    firstImage?.url,
  ]);
  const storagePath = firstDefined([
    firstCandidateValue(["storage_path", "storagePath"]),
    firstImage?.storage_path,
    firstImage?.storagePath,
  ]);
  const sha256 = firstDefined([firstCandidateValue(["sha256"]), firstImage?.sha256]);
  const bytes = firstDefined([firstCandidateValue(["bytes"]), firstImage?.bytes]);
  const width = firstDefined([firstCandidateValue(["width"]), firstImage?.width]);
  const height = firstDefined([firstCandidateValue(["height"]), firstImage?.height]);
  const model = firstDefined([firstCandidateValue(["model"]), firstImage?.model]);
  const operation = firstDefined([firstCandidateValue(["operation"]), firstImage?.operation]);
  const routedToCreative = firstCandidateValue(["routed_to_creative", "routedToCreative"]);
  const transportStatus = firstCandidateValue(["transport_status", "transportStatus"]) ?? firstImage?.transport_status;
  const imagePathKind = pathKind(imagePath);
  const previewKind = pathKind(previewValue);

  return {
    routed_to_creative: routedToCreative === true ? true : routedToCreative === false ? false : undefined,
    image_metadata_present: Boolean(imagePath || previewValue || storagePath || sha256 || bytes),
    image_count: images.length || (imagePath || previewValue || storagePath || sha256 ? 1 : 0),
    image_path_present: Boolean(imagePath),
    image_path_kind: imagePathKind,
    preview_url_present: Boolean(previewValue),
    preview_url_kind: previewKind,
    storage_path_present: Boolean(storagePath),
    sha256_present: typeof sha256 === "string" && /^[a-f0-9]{64}$/i.test(sha256),
    bytes: typeof bytes === "number" && Number.isFinite(bytes) ? bytes : undefined,
    width: typeof width === "number" && Number.isFinite(width) ? width : undefined,
    height: typeof height === "number" && Number.isFinite(height) ? height : undefined,
    model: typeof model === "string" && model.trim() ? traceString(model, 160) : undefined,
    operation: typeof operation === "string" && operation.trim() ? traceString(operation, 220) : undefined,
    product_artifact_status:
      transportStatus === "uploaded"
        ? "uploaded"
        : transportStatus === "artifact_transport_failed"
          ? "artifact_transport_failed"
          : imagePathKind === "local_artifact_path" && !previewValue && !storagePath
        ? "artifact_transport_missing"
        : imagePath || previewValue || storagePath || sha256
          ? "available_or_metadata_only"
          : "not_detected",
  };
};

const creativeRequestTraceSummary = (request: HermesCmoRuntimeRequest, config: HermesCmoAgentConfig): Record<string, unknown> => {
  const constraints: Record<string, unknown> = request.constraints;
  const executionBoundary = nestedRecord(constraints, "execution_boundary");
  const h5LiveAdapter = nestedRecord(constraints, "h5_live_adapter");
  const creativePolicy = nestedRecord(nestedRecord(constraints, "m1_clean_cmo_skill_kernel"), "creative_policy");
  const allowedAgents = Array.isArray(constraints.allowed_agents) ? constraints.allowed_agents : [];
  const artifactTransport: Record<string, unknown> = isRecord(request.artifact_transport) ? request.artifact_transport : {};

  return {
    endpoint_path: config.endpointPath,
    endpoint_kind: config.endpointKind,
    route_decision: config.routeDecision,
    timeout_ms: config.timeoutMs,
    timeout_source: config.timeoutSource,
    tool_endpoint_enabled: config.toolEndpointEnabled,
    creative_agent_allowed: allowedAgents.includes("creative"),
    product_requested_execution:
      constraints.creative_execution_requested === true ||
      executionBoundary.creative_execution_requested === true ||
      creativePolicy.execution_requested === true,
    product_requested_brief_only:
      constraints.creative_execution_requested !== true &&
      executionBoundary.creative_execution_requested !== true &&
      creativePolicy.execution_requested !== true,
    allow_sub_agent_execution: constraints.allowSubAgentExecution === true,
    creative_execution_requested: constraints.creative_execution_requested === true,
    creative_ideation_detected: constraints.creative_ideation_detected === true,
    creative_working_state_present: constraints.creative_working_state_present === true,
    creative_session_followup_detected: constraints.creative_session_followup_detected === true,
    creative_session_active_draft_id: constraints.creative_active_draft_id,
    creative_session_drafts_count: constraints.creative_drafts_count,
    creative_side_effects_allowed: constraints.creative_side_effects_allowed === true || creativePolicy.side_effects_allowed === true,
    requires_user_confirmation_before_creative_execute: constraints.requires_user_confirmation_before_creative_execute === true,
    creative_execution_may_be_requested_by_cmo: constraints.creative_execution_may_be_requested_by_cmo === true,
    cmo_owns_creative_decision: constraints.cmo_owns_creative_decision === true,
    creative_call_mode: constraints.creative_call_mode ?? h5LiveAdapter.creative_call_mode ?? creativePolicy.call_mode,
    creative_profile: constraints.creative_profile ?? h5LiveAdapter.creative_profile ?? creativePolicy.profile,
    delegations_mode: constraints.delegations_mode,
    product_artifact_ingest_required: executionBoundary.creative_artifact_ingest_required_for_preview === true,
    artifact_transport_mode: artifactTransport["mode"],
    artifact_transport_upload_endpoint_present: typeof artifactTransport["upload_endpoint"] === "string" && artifactTransport["upload_endpoint"].startsWith("https://"),
  };
};

const responseHasCreativeStateUpdate = (response: Record<string, unknown>, structuredOutput: Record<string, unknown>): boolean =>
  response.suggested_creative_state_update !== undefined ||
  structuredOutput.suggested_creative_state_update !== undefined ||
  response.drafts_upsert !== undefined ||
  structuredOutput.drafts_upsert !== undefined;

const responseHasCreativeDecision = (response: Record<string, unknown>, structuredOutput: Record<string, unknown>): boolean =>
  response.creative_decision !== undefined || structuredOutput.creative_decision !== undefined;

const activityEventTypesFrom = (events: unknown[]): string[] =>
  events.map((event) => isRecord(event) && typeof event.type === "string" ? event.type : "").filter(Boolean);

const creativeIdeationDecisionActions = new Set([
  "propose_draft",
  "present_draft",
  "show_draft",
  "refine_draft",
  "execute",
  "ask_clarification",
  "blocked",
  "cancel",
  "none",
]);

const creativeNativeAnswerBasisModes = new Set(["creative_ideation", "creative_session", "creative_refinement"]);

interface HermesCreativeIdeationCanonicalization {
  response: Record<string, unknown>;
  activityEventsCandidate: unknown[];
  canonicalized: boolean;
  rawActivityEventTypes: string[];
  rejectedActivityEventType?: string;
}

const creativeDecisionFromResponse = (
  response: Record<string, unknown>,
  structuredOutput: Record<string, unknown>,
): Record<string, unknown> | null => {
  if (isRecord(response.creative_decision)) {
    return response.creative_decision;
  }

  if (isRecord(structuredOutput.creative_decision)) {
    return structuredOutput.creative_decision;
  }

  return null;
};

const creativeIdeationEventToProductEvent = (
  event: Record<string, unknown>,
  request: HermesCmoRuntimeRequest,
  fallbackSeq: number,
): Record<string, unknown> => {
  const rawType = typeof event.type === "string" ? event.type : "creative.ideation.unknown";
  const eventId = eventString(event.event_id ?? event.eventId) ?? `${request.turn_id}_creative_ideation_${fallbackSeq}`;
  const status = activityStatuses.has(event.status as HermesActivityStatus) ? event.status : "completed";
  const message = eventString(event.message) ?? "Creative draft state updated.";
  const createdAt = eventString(event.created_at ?? event.createdAt) ?? new Date().toISOString();
  const userVisible = typeof event.user_visible === "boolean"
    ? event.user_visible
    : typeof event.userVisible === "boolean"
      ? event.userVisible
      : true;

  return {
    schema_version: "hermes.activity.event.v1",
    event_id: eventId,
    request_id: eventString(event.request_id ?? event.requestId) ?? request.request_id,
    session_id: eventString(event.session_id ?? event.sessionId) ?? request.session_id,
    turn_id: eventString(event.turn_id ?? event.turnId) ?? request.turn_id,
    seq: typeof event.seq === "number" && Number.isInteger(event.seq) && event.seq >= 1 ? event.seq : fallbackSeq,
    created_at: createdAt,
    source: {
      agent: "cmo",
      mode: "cmo.default",
    },
    type: "cmo.durable_action.proposed",
    status,
    user_visible: userVisible,
    message,
    data: {
      action_type: "creative_ideation",
      target: "creative_draft",
      plan_only: true,
      direct_write_performed: false,
      safe_metadata_only: true,
      no_auto_promote: true,
      saved_to_vault: false,
      workspace_id: request.workspace.workspace_id,
      session_id: request.session_id,
      delegation_id: eventId,
    },
    raw_activity_event_type: rawType,
  };
};

const normalizeHermesCreativeIdeationResponse = (
  response: Record<string, unknown>,
  request: HermesCmoRuntimeRequest,
  activityEventsCandidate: unknown[],
): HermesCreativeIdeationCanonicalization => {
  const rawActivityEventTypes = activityEventTypesFrom(activityEventsCandidate);
  const structuredOutput = isRecord(response.structured_output) ? response.structured_output : {};
  const answerBasis = isRecord(response.answer_basis) ? response.answer_basis : {};
  const creativeStateUpdatePresent = responseHasCreativeStateUpdate(response, structuredOutput);
  const creativeDecision = creativeDecisionFromResponse(response, structuredOutput);
  const creativeDecisionPresent = creativeDecision !== null;
  const action = typeof creativeDecision?.action === "string" ? creativeDecision.action : undefined;
  const rejectedCreativeIdeationEvent = rawActivityEventTypes.find(
    (eventType) => eventType.startsWith("creative.ideation.") && !safeCreativeIdeationRawActivityTypes.has(eventType),
  );
  const diagnostics = {
    creative_ideation_response_received: answerBasis.mode === "creative_ideation",
    creative_session_response_received: answerBasis.mode === "creative_session" || answerBasis.mode === "creative_refinement",
    creative_state_update_present: creativeStateUpdatePresent,
    creative_decision_present: creativeDecisionPresent,
    raw_activity_event_types: rawActivityEventTypes,
    answer_basis_mode: answerBasis.mode,
    fallback_used: false,
  };

  if (
    !requestAllowsCreativeIdeationAnswerBasis(request) ||
    !creativeNativeAnswerBasisModes.has(String(answerBasis.mode)) ||
    (!creativeDecisionPresent && !creativeStateUpdatePresent) ||
    creativeDecisionPresent && !creativeIdeationDecisionActions.has(String(action)) ||
    rejectedCreativeIdeationEvent
  ) {
    return {
      response,
      activityEventsCandidate,
      canonicalized: false,
      rawActivityEventTypes,
      ...(rejectedCreativeIdeationEvent ? { rejectedActivityEventType: rejectedCreativeIdeationEvent } : {}),
    };
  }

  const canonicalActivityEvents = activityEventsCandidate.map((event, index) => {
    if (!isRecord(event) || typeof event.type !== "string" || !safeCreativeIdeationRawActivityTypes.has(event.type)) {
      return event;
    }

    return creativeIdeationEventToProductEvent(event, request, index + 1);
  });

  return {
    response: {
      ...response,
      response_status: typeof response.response_status === "string" ? response.response_status : response.status ?? "completed",
      structured_output: {
        ...structuredOutput,
        ...diagnostics,
        creative_ideation_canonicalized: true,
        creative_session_canonicalized: answerBasis.mode === "creative_session" || answerBasis.mode === "creative_refinement",
        activity_event_types: activityEventTypesFrom(canonicalActivityEvents),
        activity_events_allowed_for_creative_ideation: true,
        rejected_activity_event_type: undefined,
        rejected_by_m1_validator: false,
      },
      activity_summary: {
        ...(isRecord(response.activity_summary) ? response.activity_summary : {}),
        events_count: canonicalActivityEvents.length,
        final_state: typeof response.status === "string" ? response.status : "completed",
        ...diagnostics,
        creative_ideation_canonicalized: true,
        creative_session_canonicalized: answerBasis.mode === "creative_session" || answerBasis.mode === "creative_refinement",
        activity_event_types: activityEventTypesFrom(canonicalActivityEvents),
        activity_events_allowed_for_creative_ideation: true,
        rejected_activity_event_type: undefined,
        rejected_by_m1_validator: false,
      },
    },
    activityEventsCandidate: canonicalActivityEvents,
    canonicalized: true,
    rawActivityEventTypes,
  };
};

const responseTraceSummary = (payload: unknown): Record<string, unknown> => {
  const root = isRecord(payload) ? payload : {};
  const response = isRecord(root.response) ? root.response : root;
  const structuredOutput = isRecord(response.structured_output) ? response.structured_output : {};
  const answerBasis = isRecord(response.answer_basis) ? response.answer_basis : {};
  const answer = response.answer;
  const answerRecord = isRecord(answer) ? answer : {};
  const responseSafety = isRecord(response.safety) ? response.safety : {};
  const rootSafety = isRecord(root.safety) ? root.safety : {};
  const answerPreview =
    typeof answerRecord.body === "string"
      ? answerRecord.body
      : typeof answerRecord.text === "string"
        ? answerRecord.text
        : undefined;

  return {
    http_payload_shape: isRecord(root.response) ? "wrapped_response" : "response",
    top_level_response_keys: Object.keys(response).sort(),
    answer_keys: Object.keys(answerRecord).sort(),
    answer_shape: answer === null ? "null" : Array.isArray(answer) ? "array" : typeof answer,
    answer_basis_keys: Object.keys(answerBasis).sort(),
    schema_version: response.schema_version,
    status: response.status,
    classification: response.classification ?? structuredOutput.classification,
    answer_basis_mode: answerBasis.mode,
    creative_ideation_response_received: answerBasis.mode === "creative_ideation" ? true : undefined,
    creative_state_update_present: responseHasCreativeStateUpdate(response, structuredOutput),
    creative_decision_present: responseHasCreativeDecision(response, structuredOutput),
    delegations: Array.isArray(response.delegations)
      ? response.delegations.map((delegation) => {
          const record = isRecord(delegation) ? delegation : {};
          const target = isRecord(record.target) ? record.target : {};

          return {
            id: record.id ?? record.delegation_id ?? record.handoff_id,
            target_agent: target.agent ?? record.targetAgent ?? record.target_agent ?? record.agent,
            mode: target.mode ?? record.mode,
            status: record.status,
            objective: record.objective,
          };
        })
      : response.delegations,
    activity_event_types: Array.isArray(root.activity_events)
      ? root.activity_events.map((event) => isRecord(event) ? event.type : undefined)
      : [],
    safety_counters: response.safety_counters ?? root.safety_counters ?? responseSafety.counters ?? rootSafety.counters,
    forbidden_counters: response.forbidden_counters ?? root.forbidden_counters,
    side_effects: root.side_effects ?? response.side_effects,
    mutation_flags: {
      direct_vault_write: response.direct_vault_write,
      direct_memory_mutation: response.direct_memory_mutation,
      direct_supabase_mutation: response.direct_supabase_mutation,
      direct_supabase_write: response.direct_supabase_write,
      openclaw_call: response.openclaw_call,
      gbrain_mutation: response.gbrain_mutation,
    },
    creative_trace: creativeTraceSummary(payload),
    answer_body_preview: typeof answerPreview === "string" ? traceString(answerPreview, 1000) : undefined,
  };
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
  const userMessage = request.intent.user_message;
  const subAgentExecutionAllowed = options.orchestrationEnabled && options.finalSynthesis !== true;
  const iterativeDelegationAllowed = options.allowNextDelegation === true && options.finalSynthesis === true;
  const echoRetryAllowed =
    options.allowEchoRetry === true && options.finalSynthesis === true && (options.echoRetriesUsed ?? 0) < MAX_M1_ECHO_RETRIES;
  const boundedDelegationAllowed = subAgentExecutionAllowed || iterativeDelegationAllowed;
  const echoExecutionAllowed = boundedDelegationAllowed || echoRetryAllowed;
  const creativeViaCmoAllowed = isCmoHermesCreativeEnabled() && getCmoHermesCreativeCallMode() === "via_cmo";
  const creativeExecutionRequested = requestIsCreativeExecution(request) && creativeViaCmoAllowed;
  const creativeIdeationDetected = requestIsCreativeIdeation(request);
  const creativeWorkingStatePresent = requestHasCreativeWorkingState(request);
  const creativeNativeSession = creativeIdeationDetected || creativeWorkingStatePresent;
  const creativeSideEffectsAllowed = creativeNativeSession || creativeExecutionRequested;
  const creativeTurnMayExecute = creativeSideEffectsAllowed && creativeViaCmoAllowed;
  const creativeExecutionMode = creativeExecutionModeFromRequest(request);
  const creativeAgentAllowed = creativeViaCmoAllowed && creativeTurnMayExecute;
  const specialistExecutionAllowed = boundedDelegationAllowed || echoRetryAllowed || creativeTurnMayExecute;
  const allowedAgentsForRequest: HermesAllowedAgent[] = [
    ...(boundedDelegationAllowed ? ["echo", "surf"] as const : echoRetryAllowed ? ["echo"] as const : []),
    ...(creativeAgentAllowed ? ["creative"] as const : []),
  ];
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
    ...(creativeAgentAllowed ? { artifact_transport: creativeArtifactTransportForRequest(request) } : {}),
    user_message: userMessage,
    message: userMessage,
    input: {
      ...(isRecord(request.input) ? request.input : {}),
      user_message: userMessage,
      message: userMessage,
    },
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
      allowSubAgentExecution: specialistExecutionAllowed,
      allowSurfExecution: boundedDelegationAllowed,
      allowEchoExecution: echoExecutionAllowed,
      ...(creativeExecutionRequested ? { allowCreativeExecution: true } : {}),
      creative_execution_requested: creativeExecutionRequested,
      creative_ideation_detected: creativeIdeationDetected,
      creative_working_state_present: creativeWorkingStatePresent,
      creative_execution_may_be_requested_by_cmo: creativeTurnMayExecute,
      creative_side_effects_allowed: creativeSideEffectsAllowed,
      requires_user_confirmation_before_creative_execute: creativeNativeSession,
      cmo_owns_creative_decision: creativeIdeationDetected || creativeWorkingStatePresent || creativeExecutionRequested,
      creative_execution_mode: creativeExecutionRequested ? creativeExecutionMode : null,
      creative_direct_prompt_sufficient: creativeExecutionRequested,
      creative_accepted_context_required: creativeExecutionRequested ? false : null,
      creative_missing_accepted_context_blocks_execution: creativeExecutionRequested ? false : null,
      creative_call_mode: creativeAgentAllowed ? getCmoHermesCreativeCallMode() : "disabled",
      creative_profile: creativeAgentAllowed ? getCmoHermesCreativeProfile() : null,
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
        creative_policy: {
          enabled: creativeAgentAllowed,
          execution_requested: creativeExecutionRequested,
          ideation_detected: creativeIdeationDetected,
          working_state_present: creativeWorkingStatePresent,
          execution_may_be_requested_by_cmo: creativeTurnMayExecute,
          side_effects_allowed: creativeSideEffectsAllowed,
          requires_user_confirmation_before_execute: creativeNativeSession,
          cmo_owns_decision: true,
          execution_mode: creativeExecutionRequested ? creativeExecutionMode : null,
          direct_user_prompt_is_sufficient_execution_input: creativeExecutionRequested,
          accepted_project_context_required: creativeExecutionRequested ? false : null,
          accepted_workspace_context_required: creativeExecutionRequested ? false : null,
          missing_accepted_context_blocks_execution: creativeExecutionRequested ? false : null,
          factual_claim_guardrails: [
            "Do not invent unsupported product mechanics, rewards, APY, WLD, eligibility, or roadmap claims.",
            "Use the user-supplied visual direction as the brief when accepted workspace context is missing.",
            "If product facts are missing, produce generic brand-safe visual direction instead of blocking execution.",
          ],
          profile: creativeAgentAllowed ? getCmoHermesCreativeProfile() : null,
          call_mode: creativeAgentAllowed ? "via_cmo" : "disabled",
          role: "visual_execution_specialist",
          no_auto_publish: true,
          requires_product_artifact_ingestion_for_preview: creativeAgentAllowed,
        },
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
        sub_agent_execution_allowed: specialistExecutionAllowed,
        delegation_policy: boundedDelegationAllowed ? "echo_surf_only_bounded" : echoRetryAllowed ? "echo_retry_bounded" : "disabled",
        allowed_agents: allowedAgentsForRequest,
        allowed_surf_modes: allowedSurfModesForRequest,
        creative_profile: creativeAgentAllowed ? getCmoHermesCreativeProfile() : null,
        creative_call_mode: creativeAgentAllowed ? "via_cmo" : "disabled",
        creative_execution_requested: creativeExecutionRequested,
        creative_ideation_detected: creativeIdeationDetected,
        creative_working_state_present: creativeWorkingStatePresent,
        creative_execution_may_be_requested_by_cmo: creativeTurnMayExecute,
        creative_side_effects_allowed: creativeSideEffectsAllowed,
        requires_user_confirmation_before_creative_execute: creativeNativeSession,
        cmo_owns_creative_decision: creativeIdeationDetected || creativeWorkingStatePresent || creativeExecutionRequested,
        vault_writes_allowed: false,
        direct_supabase_mutations_allowed: false,
        openclaw_calls_allowed: false,
        platform_persistence_owner: "cmo_engine_app_chat_store",
      },
      execution_boundary: {
        sub_agent_execution_allowed: specialistExecutionAllowed,
        surf_execution_allowed: boundedDelegationAllowed,
        echo_execution_allowed: echoExecutionAllowed,
        ...(creativeExecutionRequested ? { creative_execution_allowed: true } : {}),
        creative_execution_requested: creativeExecutionRequested,
        creative_ideation_detected: creativeIdeationDetected,
        creative_working_state_present: creativeWorkingStatePresent,
        creative_execution_may_be_requested_by_cmo: creativeTurnMayExecute,
        creative_side_effects_allowed: creativeSideEffectsAllowed,
        requires_user_confirmation_before_creative_execute: creativeNativeSession,
        cmo_owns_creative_decision: creativeIdeationDetected || creativeWorkingStatePresent || creativeExecutionRequested,
        creative_artifact_ingest_required_for_preview: creativeAgentAllowed,
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

const validateAnswerBasis = (
  answerBasis: unknown,
  options: HermesCmoAnswerBasisModeOptions = {},
): answerBasis is HermesCmoRuntimeAnswerBasis =>
  isRecord(answerBasis) &&
  answerBasisModeIsAllowed(answerBasis.mode, options) &&
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

const isCreativeDelegation = (delegation: Record<string, unknown>) =>
  delegationTargetAgent(delegation) === "creative";

const isAllowedDelegationAgent = (delegation: Record<string, unknown>) =>
  isEchoOrSurfDelegation(delegation) || isCreativeDelegation(delegation);

const isCreativeDelegationResultOrProposal = (delegation: Record<string, unknown>) =>
  isCreativeDelegation(delegation) &&
  (
    isNonExecutedDelegationProposal(delegation) ||
    delegation.status === "completed" ||
    delegation.status === "asset_ready" ||
    delegation.status === "creative.asset_ready" ||
    delegation.status === "partial" ||
    delegation.status === "blocked" ||
    delegation.status === "failed"
  );

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

  if (delegations.some((delegation) => !isAllowedDelegationAgent(delegation))) {
    return false;
  }

  if (delegations.some((delegation) => Array.isArray(delegation.delegations) && delegation.delegations.length > 0)) {
    return false;
  }

  if (!options.allowExecutableDelegations) {
    if (options.allowEchoRetryDelegation && delegations.length <= 1 && delegations.every(isEchoRetryDelegation)) {
      return true;
    }

    return delegations.every((delegation) => isNonExecutedDelegationProposal(delegation) || isCreativeDelegationResultOrProposal(delegation));
  }

  const executableEchoSurfDelegations = delegations.filter(isEchoOrSurfDelegation);
  const creativeDelegations = delegations.filter(isCreativeDelegation);
  const normalizedDelegations = executableDelegations(executableEchoSurfDelegations, Number.MAX_SAFE_INTEGER);

  return (
    normalizedDelegations.length === executableEchoSurfDelegations.length &&
    executableEchoSurfDelegations.length <= options.maxDelegations &&
    creativeDelegations.every(isCreativeDelegationResultOrProposal) &&
    executableEchoSurfDelegations.every((delegation) => {
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

  const responseCandidate = normalizeHermesCmoResponseCandidate(response);

  if (
    responseCandidate.direct_vault_write === true ||
    responseCandidate.direct_memory_mutation === true ||
    responseCandidate.direct_supabase_mutation === true ||
    responseCandidate.direct_supabase_write === true ||
    responseCandidate.gbrain_mutation === true ||
    responseCandidate.knowledge_promotion_performed === true ||
    responseCandidate.auto_promote === true ||
    responseCandidate.direct_session_write === true ||
    responseCandidate.direct_raw_capture_write === true ||
    responseCandidate.openclaw_call === true
  ) {
    return false;
  }

  const activitySummary = responseCandidate.activity_summary;
  const structuredOutput = isRecord(responseCandidate.structured_output) ? responseCandidate.structured_output : {};
  const answerBasis = responseCandidate.answer_basis;
  const clarifyingQuestion = responseCandidate.clarifying_question;
  const activitySummaryFailure = activitySummaryFailureReason(activitySummary, responseCandidate);
  const allowCreativeIdeationAnswerBasis = requestAllowsCreativeIdeationAnswerBasis(request);
  const creativeNativeValidationOptions = { allowCreativeNative: allowCreativeIdeationAnswerBasis };

  if (
    responseCandidate.schema_version !== "hermes.cmo.response.v1" ||
    responseCandidate.request_id !== request.request_id ||
    responseCandidate.session_id !== request.session_id ||
    responseCandidate.turn_id !== request.turn_id ||
    !responseStatuses.has(responseCandidate.status as HermesCmoRuntimeResponse["status"]) ||
    !validateAnswerBasis(answerBasis, { allowToolRead: isToolCapableResponseCandidate(responseCandidate), allowCreativeIdeation: allowCreativeIdeationAnswerBasis }) ||
    !validateContextResolution(responseCandidate.context_resolution) ||
    !validateClarifyingQuestion(clarifyingQuestion) ||
    !validateHermesCmoRuntimeAnswer(responseCandidate.answer) ||
    !(isRecord(responseCandidate.structured_output) || responseCandidate.structured_output === null) ||
    !validateDelegations(responseCandidate.delegations, options) ||
    !Array.isArray(responseCandidate.artifacts) ||
    !Array.isArray(responseCandidate.memory_suggestions) ||
    !responseCandidate.memory_suggestions.every(isRecord) ||
    Boolean(activitySummaryFailure) ||
    Boolean(safeToolTraceSummaryRejection(responseCandidate.tool_trace_summary)) ||
    !optionalClassificationIsAllowed(responseCandidate.classification, creativeNativeValidationOptions) ||
    !optionalClassificationIsAllowed(structuredOutput.classification, creativeNativeValidationOptions) ||
    !optionalResponseStyleIsAllowed(responseCandidate.response_style) ||
    !optionalResponseStyleIsAllowed(structuredOutput.response_style) ||
    responseUsesResearchFollowupClassificationOrStyle(responseCandidate) && !requestHasResearchFollowupContext(request) ||
    !optionalToolPolicyIsAllowed(responseCandidate.tool_policy) ||
    !optionalToolPolicyIsAllowed(structuredOutput.tool_policy)
  ) {
    return false;
  }

  if (
    responseCandidate.status === "needs_user_input" &&
    (responseCandidate.answer !== null ||
      responseCandidate.structured_output !== null ||
      answerBasis.mode !== "needs_user_input" && answerBasis.mode !== "clarification" ||
      clarifyingQuestion.required !== true)
  ) {
    return false;
  }

  if (
    answerBasis.mode === "assumption_based" &&
    (answerBasis.missing_inputs.length === 0 || answerBasis.assumptions_used.length === 0)
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
  const creativeExecutionSourceMode = sourceModeIsCreativeExecution(sourceMode, eventType, request);
  const sourceMatches =
    (sourceAgent === "cmo" && (sourceMode === "cmo.default" || options.allowToolCapableCmoSource === true && sourceMode === "cmo.tool_capable" || creativeExecutionSourceMode)) ||
    (sourceAgent === "echo" && (sourceMode === "echo.default" || sourceMode === "echo.source_translate")) ||
    (sourceAgent === "surf" && allowedSurfModes.has(sourceMode as HermesSurfMode)) ||
    (sourceAgent === "creative" && (allowedCreativeModes.has(sourceMode as HermesCreativeMode) || creativeExecutionSourceMode));

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
    activityEventTypeIsAllowed(eventType) &&
    activityStatuses.has(event.status as HermesActivityStatus) &&
    typeof event.user_visible === "boolean" &&
    isNonEmptyString(event.message) &&
    isRecord(event.data) &&
    m44aActivityEventDataIsSafe(eventType, event.data)
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
  const activityEventsCandidate = Array.isArray(payload.activity_events) ? payload.activity_events : [];
  const creativeMetadataPresent = requestMayLeadToCreativeExecution(request) && creativeResponseHasExecutionMetadata(rawResponseCandidate);
  const sideEffectsValidation = sideEffectsFromPayload(payload, rawResponseCandidate, request, creativeMetadataPresent);
  const sideEffects = sideEffectsValidation.sideEffects;
  let effectiveActivityEventsCandidate = activityEventsCandidate;
  let rawValidationCandidate = maybeNormalizeCreativeExecutionResponseCandidate(rawResponseCandidate, request, effectiveActivityEventsCandidate);
  const creativeIdeationCanonicalization = normalizeHermesCreativeIdeationResponse(
    rawValidationCandidate,
    request,
    effectiveActivityEventsCandidate,
  );
  rawValidationCandidate = creativeIdeationCanonicalization.response;
  effectiveActivityEventsCandidate = creativeIdeationCanonicalization.activityEventsCandidate;
  let responseCandidate = normalizeHermesCmoResponseCandidate(rawValidationCandidate, { activityEventsCandidate: effectiveActivityEventsCandidate });
  if (requestMayLeadToCreativeExecution(request) && (sideEffectsValidation.present || sideEffectsValidation.rejectedType)) {
    responseCandidate = {
      ...responseCandidate,
      structured_output: {
        ...(isRecord(responseCandidate.structured_output) ? responseCandidate.structured_output : {}),
        side_effects_present: sideEffectsValidation.present,
        side_effects_allowed_for_creative: sideEffectsValidation.allowedForCreative === true,
        ...(sideEffectsValidation.rejectedType ? { rejected_side_effect_type: sideEffectsValidation.rejectedType } : {}),
      },
      activity_summary: {
        ...(isRecord(responseCandidate.activity_summary) ? responseCandidate.activity_summary : {}),
        side_effects_present: sideEffectsValidation.present,
        side_effects_allowed_for_creative: sideEffectsValidation.allowedForCreative === true,
        ...(sideEffectsValidation.rejectedType ? { rejected_side_effect_type: sideEffectsValidation.rejectedType } : {}),
      },
    };
  }
  const responseStructuredOutput = isRecord(responseCandidate.structured_output) ? responseCandidate.structured_output : {};
  const responseAnswerBasis = isRecord(responseCandidate.answer_basis) ? responseCandidate.answer_basis : {};
  const creativeNativeResponseReceived = creativeNativeAnswerBasisModes.has(String(responseAnswerBasis.mode));
  const creativeStateUpdatePresent = responseHasCreativeStateUpdate(responseCandidate, responseStructuredOutput);
  const creativeDecisionPresent = responseHasCreativeDecision(responseCandidate, responseStructuredOutput);
  const activityEventTypes = activityEventTypesFrom(effectiveActivityEventsCandidate);
  const creativeIdeationActivityDiagnostics = {
    activity_event_types: activityEventTypes,
    raw_activity_event_types: creativeIdeationCanonicalization.rawActivityEventTypes,
    activity_events_allowed_for_creative_ideation: creativeIdeationCanonicalization.canonicalized,
    creative_ideation_canonicalized: creativeIdeationCanonicalization.canonicalized,
    rejected_activity_event_type: creativeIdeationCanonicalization.rejectedActivityEventType,
    fallback_used: false,
  };
  if (creativeNativeResponseReceived) {
    responseCandidate = {
      ...responseCandidate,
      structured_output: {
        ...responseStructuredOutput,
        creative_ideation_response_received: responseAnswerBasis.mode === "creative_ideation",
        creative_session_response_received: responseAnswerBasis.mode === "creative_session" || responseAnswerBasis.mode === "creative_refinement",
        creative_state_update_present: creativeStateUpdatePresent,
        creative_decision_present: creativeDecisionPresent,
        answer_basis_mode: String(responseAnswerBasis.mode),
        ...creativeIdeationActivityDiagnostics,
        rejected_by_m1_validator: false,
      },
      activity_summary: {
        ...(isRecord(responseCandidate.activity_summary) ? responseCandidate.activity_summary : {}),
        creative_ideation_response_received: responseAnswerBasis.mode === "creative_ideation",
        creative_session_response_received: responseAnswerBasis.mode === "creative_session" || responseAnswerBasis.mode === "creative_refinement",
        creative_state_update_present: creativeStateUpdatePresent,
        creative_decision_present: creativeDecisionPresent,
        answer_basis_mode: String(responseAnswerBasis.mode),
        ...creativeIdeationActivityDiagnostics,
        rejected_by_m1_validator: false,
      },
    };
  }
  const effectiveActivityValidation: HermesCmoActivityValidationOptions = {
    ...activityValidation,
    allowToolCapableCmoSource: isToolCapableResponseCandidate(responseCandidate),
  };
  const activityEvents = effectiveActivityEventsCandidate
    .map((event, index) => normalizedActivityEvent(event, request, index + 1))
    .filter((event): event is HermesCmoRuntimeActivityEvent => Boolean(event));

  if (!validateHermesCmoRuntimeResponse(responseCandidate, request, responseValidation)) {
    const rejectedField = responseValidationFailureReason(responseCandidate, request, responseValidation);
    const creativeNativeValidationSuffix = creativeNativeResponseReceived
      ? ` creative_ideation_response_received=${String(responseAnswerBasis.mode === "creative_ideation")} creative_session_response_received=${String(responseAnswerBasis.mode === "creative_session" || responseAnswerBasis.mode === "creative_refinement")} answer_basis_mode=${String(responseAnswerBasis.mode)} creative_state_update_present=${String(creativeStateUpdatePresent)} creative_decision_present=${String(creativeDecisionPresent)} creative_ideation_canonicalized=${String(creativeIdeationCanonicalization.canonicalized)} activity_event_types=${activityEventTypes.join(",") || "none"} raw_activity_event_types=${creativeIdeationCanonicalization.rawActivityEventTypes.join(",") || "none"} activity_events_allowed_for_creative_ideation=${String(creativeIdeationCanonicalization.canonicalized)} rejected_activity_event_type=${creativeIdeationCanonicalization.rejectedActivityEventType ?? "none"} fallback_used=false rejected_by_m1_validator=true rejected_field=${rejectedField}.`
      : "";

    throw new Error(
      creativeMetadataPresent
        ? `Hermes CMO Agent response did not match hermes.cmo.response.v1 or violated M1 execution boundaries. Rejected field: ${rejectedField}. creative_response_received=true creative_metadata_present=true rejected_by_m1_validator=true rejected_field=${rejectedField} fallback_used=false.`
        : `Hermes CMO Agent response did not match hermes.cmo.response.v1 or violated M1 execution boundaries. Rejected field: ${rejectedField}.${creativeNativeValidationSuffix}`,
    );
  }

  if (sideEffects === null) {
    throw new Error(
      creativeMetadataPresent
        ? `Hermes CMO Agent response included unsafe side_effects. creative_response_received=true creative_metadata_present=true side_effects_present=${String(sideEffectsValidation.present)} side_effects_allowed_for_creative=false rejected_side_effect_type=${sideEffectsValidation.rejectedType ?? "unknown"} fallback_used=false.`
        : "Hermes CMO Agent response included unsafe side_effects.",
    );
  }

  if (responseCandidate.activity_summary.events_count !== effectiveActivityEventsCandidate.length) {
    throw new Error("Hermes CMO Agent activity_summary.events_count did not match returned activity_events length.");
  }

  if (
    activityEvents.length !== activityEventsCandidate.length ||
    !activityEvents.every((event) => validateHermesCmoRuntimeActivityEvent(event, request, effectiveActivityValidation))
  ) {
    const failedEvent = effectiveActivityEventsCandidate.find((event, index) => {
      const normalized = normalizedActivityEvent(event, request, index + 1);

      return !normalized || !validateHermesCmoRuntimeActivityEvent(normalized, request, effectiveActivityValidation);
    });
    const failedEventType = isRecord(failedEvent) && typeof failedEvent.type === "string" ? failedEvent.type : undefined;
    const creativeIdeationDiagnosticSuffix = creativeNativeResponseReceived
      ? ` creative_ideation_response_received=${String(responseAnswerBasis.mode === "creative_ideation")} creative_session_response_received=${String(responseAnswerBasis.mode === "creative_session" || responseAnswerBasis.mode === "creative_refinement")} answer_basis_mode=${String(responseAnswerBasis.mode)} creative_state_update_present=${String(creativeStateUpdatePresent)} creative_decision_present=${String(creativeDecisionPresent)} creative_ideation_canonicalized=${String(creativeIdeationCanonicalization.canonicalized)} activity_event_types=${activityEventTypes.join(",") || "none"} raw_activity_event_types=${creativeIdeationCanonicalization.rawActivityEventTypes.join(",") || "none"} activity_events_allowed_for_creative_ideation=${String(creativeIdeationCanonicalization.canonicalized)} rejected_activity_event_type=${creativeIdeationCanonicalization.rejectedActivityEventType ?? failedEventType ?? "unknown"} fallback_used=false rejected_by_m1_validator=true`
      : "";

    throw new Error(`Hermes CMO Agent activity_events did not match hermes.activity.event.v1 or included forbidden delegation events. Rejected field: ${activityValidationFailureReason(failedEvent, request, effectiveActivityValidation)}.${creativeIdeationDiagnosticSuffix}`);
  }

  return {
    response: responseCandidate,
    activityEvents,
    sideEffects,
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

const agentsUsedFrom = (delegationResult: HermesCmoDelegationExecutionResult): Array<"cmo" | "echo" | "surf" | "creative"> =>
  Array.from(new Set<"cmo" | "echo" | "surf" | "creative">(["cmo", ...delegationResult.agentsUsed]));

const callHermesCmoAgent = async (request: HermesCmoRuntimeRequest, config: HermesCmoAgentConfig): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    await writeHermesTrace(request, "request", {
      kind: "hermes_cmo_request",
      endpoint_path: config.endpointPath,
      endpoint_kind: config.endpointKind,
      route_decision: config.routeDecision,
      tool_endpoint_enabled: config.toolEndpointEnabled,
      timeout_ms: config.timeoutMs,
      timeout_source: config.timeoutSource,
      creative_trace: creativeRequestTraceSummary(request, config),
      request,
    });
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
    await writeHermesTrace(request, "response", {
      kind: "hermes_cmo_response",
      endpoint_path: config.endpointPath,
      endpoint_kind: config.endpointKind,
      route_decision: config.routeDecision,
      tool_endpoint_enabled: config.toolEndpointEnabled,
      timeout_ms: config.timeoutMs,
      timeout_source: config.timeoutSource,
      http_status: response.status,
      summary: responseTraceSummary(payload),
      response: payload,
    });

    return payload;
  } catch (error) {
    await writeHermesTrace(request, "error", {
      kind: "hermes_cmo_error",
      endpoint_path: config.endpointPath,
      endpoint_kind: config.endpointKind,
      route_decision: config.routeDecision,
      tool_endpoint_enabled: config.toolEndpointEnabled,
      timeout_ms: config.timeoutMs,
      timeout_source: config.timeoutSource,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Hermes CMO Agent request timed out.");
    }

    throw error instanceof Error ? error : new Error("Hermes CMO Agent request failed.");
  } finally {
    clearTimeout(timeout);
  }
};

export async function runHermesCmoRuntime(request: unknown, options: HermesCmoRuntimeOptions = {}): Promise<HermesCmoRuntimeResult> {
  if (!validateHermesCmoRuntimeRequest(request)) {
    throw new Error("Invalid hermes.cmo.request.v1 input for M1 Hermes CMO runtime.");
  }

  const externalResearchRequested = requestIsExternalResearch(request);
  const researchFollowupUsesPriorResult = requestIsResearchFollowupUsingPriorResult(request);
  const orchestrationEnabled = researchFollowupUsesPriorResult
    ? false
    : isCmoHermesCmoOrchestrationEnabled() || externalResearchRequested;
  const maxDelegations = getCmoHermesCmoMaxDelegations();
  let outboundRequest = buildHermesCmoLiveRequest(request, {
    orchestrationEnabled,
  });
  const initialConfig = selectedHermesCmoConfig(outboundRequest, options);
  outboundRequest = initialConfig.endpointKind === "tool_execute" ? toolEndpointRequest(outboundRequest) : outboundRequest;
  outboundRequest = withHermesCmoRouteDecision(outboundRequest, initialConfig.routeDecision);

  if (!validateHermesCmoRuntimeRequest(outboundRequest)) {
    throw new Error("M1 Hermes CMO runtime produced an invalid outbound hermes.cmo.request.v1 envelope.");
  }

  const safetyFlags = makeSafetyFlags(orchestrationEnabled);
  const livePayload = await callHermesCmoAgent(outboundRequest, initialConfig);
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

    const synthesisConfig = selectedHermesCmoConfig(synthesisRequest, options);
    const outboundSynthesisBase = synthesisConfig.endpointKind === "tool_execute" ? toolEndpointRequest(synthesisRequest) : synthesisRequest;
    const outboundSynthesisRequest = withHermesCmoRouteDecision(outboundSynthesisBase, synthesisConfig.routeDecision);
    const synthesisPayload = await callHermesCmoAgent(outboundSynthesisRequest, synthesisConfig);
    return extractLiveResponsePayload(
      synthesisPayload,
      outboundSynthesisRequest,
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
        workspaceId: outboundRequest.workspace.workspace_id,
        appId: outboundRequest.workspace.app_id,
        appName: outboundRequest.workspace.app_name,
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
    hermesCmoAgentPath: initialConfig.endpointPath,
    hermesCmoEndpointKind: initialConfig.endpointKind,
    hermesCmoEndpointTimeoutMs: initialConfig.timeoutMs,
    hermesCmoEndpointTimeoutSource: initialConfig.timeoutSource,
    hermesCmoRouteDecision: initialConfig.routeDecision,
    hermesCmoToolEndpointEnabled: initialConfig.toolEndpointEnabled,
    ...(firstResult.sideEffects !== undefined ? { sideEffects: firstResult.sideEffects } : {}),
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
