import "server-only";

import type {
  CMOAppChatRequest,
  CMOAppChatResponse,
  CMOChatMessage,
  CMOContextPackage,
  CmoRuntimeContext,
  ContextPack,
  HermesCmoActivityEventSummary,
  HermesCmoAgentUsed,
  HermesCmoChatMetadata,
  HermesCmoDelegationSummaryItem,
  HermesCmoForbiddenCounters,
  HermesCmoSafetyCounters,
  VaultNoteRef,
} from "@/lib/cmo/app-workspace-types";
import { getCmoHermesApiKey, getCmoHermesBaseUrl, getCmoHermesTimeoutMs } from "@/lib/cmo/config";
import { normalizeCmoActivityEvents } from "@/lib/cmo/activity-events";
import {
  OUTBOUND_HERMES_CALLSITE_GUARD_VERSION,
  buildOutboundHermesTraceSafeRequest,
  inspectOutboundHermesCallsiteBlock,
  mergeOutboundHermesCallsiteBlockInspections,
  sanitizeOutboundHermesPayload,
  withOutboundHermesPayloadGuardDiagnostics,
} from "@/lib/cmo/hermes-outbound-payload-sanitizer";
import { normalizeCmoRuntimeUserIdentity, type CmoServerUserIdentity } from "@/lib/cmo/user-metadata";

export const HERMES_FIRST_CMO_CHAT_ENDPOINT = "/agents/cmo/chat" as const;
export const HERMES_FIRST_CMO_CHAT_REQUEST_SCHEMA = "hermes.cmo.chat.request.v1_1" as const;
export const HERMES_FIRST_CMO_CHAT_RESPONSE_SCHEMA = "hermes.cmo.chat.response.v1_1" as const;

type HermesFirstCmoChatStatus = "completed" | "needs_user_input" | "failed";
type HermesFirstBoundaryFailureType =
  | "configuration_error"
  | "request_contract_violation"
  | "request_payload_blocked"
  | "timeout"
  | "http_error"
  | "network_error"
  | "malformed_json"
  | "invalid_response"
  | "missing_answer_body"
  | "invalid_side_effects";

export interface HermesFirstCmoChatRequestInput {
  contextPack: ContextPack;
  contextPackage: CMOContextPackage;
  message: string;
  history: CMOChatMessage[];
  request: CMOAppChatRequest;
  contextUsed: VaultNoteRef[];
  missingContext: VaultNoteRef[];
  sessionId: string;
  userMessageId: string;
  createdAt: string;
  userIdentity: CmoServerUserIdentity;
  sessionSummary?: string;
  sessionArtifacts?: Record<string, unknown>[];
  vaultContext?: unknown;
  inputMaterialAttachments?: Record<string, unknown>[];
  runtimeContext?: CmoRuntimeContext;
}

export interface HermesFirstCmoChatRequest {
  schema_version: typeof HERMES_FIRST_CMO_CHAT_REQUEST_SCHEMA;
  request_id: string;
  session_id: string;
  turn_id: string;
  created_at: string;
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  app_name: string;
  user: {
    user_id?: string;
    user_slug: string;
    display_name?: string;
    email?: string;
    auth_mode: CmoServerUserIdentity["authMode"] | "unknown";
  };
  intent: {
    user_message: string;
  };
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
    attachments?: Record<string, unknown>[];
  }>;
  context_pack: {
    session_summary: Record<string, unknown> | null;
    selected_context: Record<string, unknown>[];
    artifacts_in: Record<string, unknown>[];
    vault_context: unknown;
    lens_readout_context?: Record<string, unknown>;
  };
  attachments: Record<string, unknown>[];
  tool_policy: {
    mode: "cmo.normal_chat";
    read_web_allowed: boolean;
    read_browser_allowed: boolean;
    read_attachments_allowed: boolean;
    allow_vault_write: false;
    allow_memory_mutation: false;
    allow_paid_media_generation: false;
    allow_publish: false;
    context_grounding_rules: string[];
  };
  persistence_policy: {
    session_json_owner: "product";
    supabase_indexing_owner: "product";
    raw_capture_owner: "product";
    suggested_vault_updates: "draft_only";
    vault_writes_require_product_approval: true;
    creative_paid_generation_requires_existing_approval_flow: true;
  };
  ui_contract: {
    answer_format: "markdown";
    require_activity_events: true;
    require_artifacts_out: true;
    require_boundary_safe_warnings: true;
    product_must_not_synthesize_fallback: true;
  };
  shell_trace: {
    product_endpoint: "/api/cmo/chat";
    product_route: "hermes_first_normal_chat";
    legacy_direct_command_bypassed: false;
    local_review_command_bypassed: false;
  };
  runtime_context?: CmoRuntimeContext;
  context_diagnostics?: Record<string, unknown>;
  artifact_transport?: Record<string, unknown>;
}

export interface HermesFirstCmoChatResponse {
  schema_version: typeof HERMES_FIRST_CMO_CHAT_RESPONSE_SCHEMA;
  request_id: string;
  session_id: string;
  turn_id: string;
  mode: "cmo.chat";
  status: HermesFirstCmoChatStatus;
  answer: {
    body: string;
    format?: "markdown" | string;
    [key: string]: unknown;
  };
  intent_decision?: Record<string, unknown>;
  route_decision?: Record<string, unknown>;
  answer_basis?: Record<string, unknown>;
  activity_events: HermesCmoActivityEventSummary[];
  delegation_summary: HermesCmoDelegationSummaryItem[];
  agents_used?: HermesCmoAgentUsed[];
  artifacts_out: Record<string, unknown>[];
  approval_requests: Record<string, unknown>[];
  suggested_vault_updates: Record<string, unknown>[];
  vault_context_usage?: unknown;
  suggested_session_summary_update?: unknown;
  state_updates?: Record<string, unknown>;
  warnings: string[];
  errors: Record<string, unknown>[];
  side_effects: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface HermesFirstBoundaryFailure {
  type: HermesFirstBoundaryFailureType;
  publicReason: string;
  runtimeError: string;
  runtimeErrorReason: CMOAppChatResponse["runtimeErrorReason"];
  requestId: string;
  request?: HermesFirstCmoChatRequest;
  httpStatus?: number;
  retryable?: boolean;
  timeoutMs?: number;
  outerTimeoutMs?: number;
  responsePreview?: string;
  detail?: string;
}

export type HermesFirstCmoChatRun =
  | {
      ok: true;
      request: HermesFirstCmoChatRequest;
      response: HermesFirstCmoChatResponse;
      liveAttemptStartedAt: string;
      liveAttemptDurationMs: number;
    }
  | {
      ok: false;
      request?: HermesFirstCmoChatRequest;
      failure: HermesFirstBoundaryFailure;
      liveAttemptStartedAt?: string;
      liveAttemptDurationMs?: number;
    };

export interface HermesFirstMappedAppChat {
  answer: string;
  status: CMOAppChatResponse["status"];
  assumptions: string[];
  suggestedActions: CMOAppChatResponse["suggestedActions"];
  isDevelopmentFallback: false;
  isRuntimeFallback: false;
  runtimeStatus: CMOAppChatResponse["runtimeStatus"];
  runtimeMode: "live";
  attemptedRuntimeMode: "live";
  runtimeLabel: "Hermes CMO chat v1.1";
  runtimeProvider: "hermes";
  runtimeAgent: "cmo";
  runtimeError?: string;
  runtimeErrorReason?: CMOAppChatResponse["runtimeErrorReason"];
  productRenderSource: "hermes_cmo" | "hermes_cmo_boundary_failure";
  calledHermesCmo: true;
  hermesRequestSent: true;
  hermesCmoStatus: "live" | "failed_boundary";
  hermesCmoErrorReason?: string;
  hermesCmoCounters: HermesCmoSafetyCounters;
  hermesCmoMetadata: HermesCmoChatMetadata;
  vault_context_usage?: unknown;
  activityEvents?: HermesCmoActivityEventSummary[];
  delegationSummary?: HermesCmoDelegationSummaryItem[];
  agentsUsed?: HermesCmoAgentUsed[];
  surfCalls?: number;
  echoCalls?: number;
  forbiddenCounters: HermesCmoForbiddenCounters;
  delegationsMode: "proposals_only";
  sessionArtifacts: Record<string, unknown>[];
  suggestedVaultUpdates: Record<string, unknown>[];
  approvalRequests: Record<string, unknown>[];
  suggestedSessionSummaryUpdate?: unknown;
  liveAttemptStartedAt?: string;
  liveAttemptDurationMs?: number;
  timeoutMs?: number;
  outerTimeoutMs?: number;
}

const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_CONTEXT_ITEMS = 40;
const MAX_CONTEXT_CHARS = 6_000;
const MAX_RECORDS = 40;
const MAX_RECORD_JSON_CHARS = 16_000;
const MAX_WARNING_CHARS = 240;
const MAX_RESPONSE_PREVIEW_CHARS = 1_200;

const PRODUCT_SEMANTIC_FIELD_NAMES = new Set([
  "product_intent_hint",
  "routeintent",
  "route_intent",
  "routedecision",
  "route_decision",
  "selectedhermesendpoint",
  "selected_hermes_endpoint",
  "requested_endpoint",
  "hassourceortooltask",
  "sourceortooltask",
  "creativeideationdetected",
  "creative_ideation_detected",
  "creativesessionfollowupdetected",
  "creative_session_followup_detected",
  "creative_session",
  "creativesession",
  "creative_decision_context",
  "creativeexecutionintent",
  "creative_execution_intent",
  "creativeexecutionrequested",
  "creative_execution_requested",
  "productpredictedcreativelongrunningturn",
  "product_predicted_creative_long_running_turn",
  "cmoownedcreativedecisionenvelope",
  "cmo_owns_creative_decision",
  "creativedecisionownerwhenlive",
  "creative_decision_owner_when_live",
  "product_must_not_choose_creative_execution",
  "allowed_agents",
  "allowed_surf_modes",
  "delegations_mode",
  "allowsubagentexecution",
  "allow_sub_agent_execution",
  "allowsurfexecution",
  "allow_surf_execution",
  "allowechoexecution",
  "allow_echo_execution",
  "tool_capable_cmo",
  "cmo_call_surf",
  "cmo_call_echo",
  "cmo_surf_orchestration",
  "mixed_cmo_echo",
  "fallbackenabled",
  "fallback_enabled",
  "fallback_from",
  "fallback_to",
  "fallback_reason",
  "workspace_fallback_suppressed_for_creative",
]);

const PRODUCT_SEMANTIC_TEXT_PATTERNS = [
  /CMO orchestration instruction:/i,
  /CMO evidence orchestration instruction:/i,
  /Treat @Echo as a specialist execution request/i,
  /Use Surf output as evidence only/i,
  /CMO owns diagnosis and decision/i,
  /Do not write final copy yourself/i,
  /Decision: KEEP \/ CUT \/ TEST \/ SCALE \/ WAIT/i,
  /Direct Jay Mode/i,
  /Product M1 validation/i,
  /fallback generated this response/i,
  /Live app-chat is unavailable/i,
];

const PRODUCT_AUTHORED_NAMESPACES = new Set([
  "intent",
  "tool_policy",
  "persistence_policy",
  "ui_contract",
  "shell_trace",
  "runtime_context",
  "context_diagnostics",
  "artifact_transport",
]);

const SAFE_CONTEXT_NAMESPACES = new Set([
  "messages",
  "context_pack",
  "attachments",
]);

const FORBIDDEN_SIDE_EFFECT_KEYS = new Set([
  "vault_write_performed",
  "memory_mutation_performed",
  "paid_media_generation_performed",
  "publish_performed",
  "supabase_write_performed",
  "openclaw_mutation_performed",
  "vault_write",
  "memory_mutation",
  "paid_media_generation",
  "publish",
  "publishing",
  "supabase_mutation",
  "openclaw_mutation",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactString(value: unknown, maxChars = 0): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

  if (!text || maxChars <= 0 || text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function safeRecord(value: unknown, maxJsonChars = MAX_RECORD_JSON_CHARS): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const safe = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  const serialized = JSON.stringify(safe);

  if (serialized.length <= maxJsonChars) {
    return safe;
  }

  return {
    schema_version: typeof value.schema_version === "string" ? value.schema_version : "cmo.truncated_record.v1",
    truncated: true,
    preview: serialized.slice(0, Math.max(0, maxJsonChars - 32)),
  };
}

function safeRecordList(value: unknown, maxRecords = MAX_RECORDS): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, maxRecords)
    .map((item) => safeRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function stringList(value: unknown, maxItems = 20): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, maxItems)
    .map((item) => compactString(item, MAX_WARNING_CHARS))
    .filter(Boolean);
}

function errorsList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 20)
    .map((item, index) => {
      if (isRecord(item)) {
        return safeRecord(item, 2_000);
      }

      const message = compactString(item, MAX_WARNING_CHARS);

      return message ? { code: `error_${index + 1}`, message } : undefined;
    })
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function normalizeSourceAgent(value: unknown): HermesCmoAgentUsed | undefined {
  return value === "cmo" ||
    value === "echo" ||
    value === "surf" ||
    value === "creative" ||
    value === "lens" ||
    value === "vault_agent"
    ? value
    : undefined;
}

function normalizeActivityEvents(value: unknown, context: {
  sessionId?: string;
  turnId?: string;
  requestId?: string;
  createdAt?: string;
} = {}): HermesCmoActivityEventSummary[] {
  return normalizeCmoActivityEvents(value, context) as HermesCmoActivityEventSummary[];
}

function normalizeDelegationSummary(value: unknown): HermesCmoDelegationSummaryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 40)
    .map((item, index): HermesCmoDelegationSummaryItem | null => {
      if (!isRecord(item)) {
        return null;
      }

      const targetAgent = normalizeSourceAgent(item.target_agent ?? item.targetAgent);
      const status = item.status;
      const delegationId = compactString(item.delegation_id ?? item.delegationId, 120) || `delegation_${index + 1}`;
      const mode = compactString(item.mode, 120);
      const objective = compactString(item.objective ?? item.title, 400);
      const summary = compactString(item.summary, 1_000);
      const failureReason = compactString(item.failure_reason ?? item.failureReason, 400);

      if (
        !targetAgent ||
        targetAgent === "cmo" ||
        !(status === "completed" || status === "failed" || status === "skipped") ||
        !mode ||
        !summary
      ) {
        return null;
      }

      return {
        delegationId,
        targetAgent,
        mode: mode as HermesCmoDelegationSummaryItem["mode"],
        ...(objective ? { objective } : {}),
        status,
        summary,
        ...(failureReason ? { failureReason } : {}),
      };
    })
    .filter((item): item is HermesCmoDelegationSummaryItem => Boolean(item));
}

function normalizeAgentsUsed(value: unknown): HermesCmoAgentUsed[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const agents = value
    .map(normalizeSourceAgent)
    .filter((agent): agent is HermesCmoAgentUsed => Boolean(agent));

  return agents.length ? Array.from(new Set(agents)) : undefined;
}

function selectedContextFromContextPack(contextPack: ContextPack): Record<string, unknown>[] {
  return contextPack.items
    .filter((item) => item.exists)
    .slice(0, MAX_CONTEXT_ITEMS)
    .map((item) => ({
      kind: item.kind,
      title: item.title,
      content: item.content.length > MAX_CONTEXT_CHARS ? `${item.content.slice(0, MAX_CONTEXT_CHARS - 3).trimEnd()}...` : item.content,
      source_id: item.source.sourceId,
      truth_status: item.contextQuality,
      provenance: {
        source_type: item.source.type,
        label: item.source.label,
        inclusion_reason: item.inclusionReason,
        truncated: item.truncated,
      },
    }));
}

function buildSafeHistory(history: CMOChatMessage[]): HermesFirstCmoChatRequest["messages"] {
  return history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => message.productRenderSource !== "hermes_cmo_boundary_failure")
    .filter((message) => message.productRenderSource !== "local_session_command")
    .filter((message) => message.productRenderSource !== "fallback_after_hermes_failure")
    .filter((message) => message.productRenderSource !== "local_runtime_fallback")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      id: message.id,
      role: message.role as "user" | "assistant",
      content: message.content.length > MAX_MESSAGE_CHARS ? `${message.content.slice(0, MAX_MESSAGE_CHARS - 3).trimEnd()}...` : message.content,
      created_at: message.createdAt,
      ...(message.attachments?.length ? { attachments: safeRecordList(message.attachments, 8) } : {}),
    }));
}

function sessionSummaryRecord(summary?: string): Record<string, unknown> | null {
  const text = compactString(summary, 6_000);

  if (!text) {
    return null;
  }

  return {
    schema_version: "cmo.session_summary.v1",
    summary: text,
  };
}

function artifactInputs(input: HermesFirstCmoChatRequestInput): Record<string, unknown>[] {
  return [
    ...safeRecordList(input.sessionArtifacts, 20),
    ...(isRecord(input.contextPackage.lensReadoutContext)
      ? [{
          schema_version: "cmo.lens_readout_context_ref.v1",
          kind: "lens_readout_context",
          artifact_id: `lens_readout_${input.request.appId}_${input.request.rangeKey ?? "this_week"}`,
          context: safeRecord(input.contextPackage.lensReadoutContext, MAX_RECORD_JSON_CHARS),
        }]
      : []),
    ...safeRecordList(input.inputMaterialAttachments, 20),
  ].slice(0, MAX_RECORDS);
}

function contextDiagnostics(input: HermesFirstCmoChatRequestInput): Record<string, unknown> {
  return {
    context_used_count: input.contextUsed.length,
    missing_context_count: input.missingContext.length,
    selected_context_count: input.contextPack.items.filter((item) => item.exists).length,
    selected_context_chars: input.contextPack.items.reduce((total, item) => total + item.content.length, 0),
    attachment_count: input.inputMaterialAttachments?.length ?? 0,
  };
}

function keyToken(key: string): string {
  return key.replace(/[^a-z0-9_]/gi, "").toLowerCase();
}

function inspectProductNamespace(value: unknown, path: string[]): string | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const violation = inspectProductNamespace(value[index], [...path, String(index)]);

      if (violation) {
        return violation;
      }
    }

    return undefined;
  }

  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const nextPath = [...path, key];
      const token = keyToken(key);

      if (PRODUCT_SEMANTIC_FIELD_NAMES.has(token)) {
        return `forbidden_field:${nextPath.join(".")}`;
      }

      const violation = inspectProductNamespace(item, nextPath);

      if (violation) {
        return violation;
      }
    }

    return undefined;
  }

  if (typeof value === "string") {
    if (path.join(".") === "intent.user_message") {
      return undefined;
    }

    const violation = PRODUCT_SEMANTIC_TEXT_PATTERNS.find((pattern) => pattern.test(value));

    return violation ? `forbidden_product_instruction:${path.join(".")}` : undefined;
  }

  return undefined;
}

export function assertNoProductSemanticFields(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error("Hermes-first request must be an object.");
  }

  for (const [key, item] of Object.entries(value)) {
    const token = keyToken(key);

    if (PRODUCT_SEMANTIC_FIELD_NAMES.has(token)) {
      throw new Error(`Hermes-first request contains Product semantic field: ${key}`);
    }

    if (SAFE_CONTEXT_NAMESPACES.has(key)) {
      continue;
    }

    if (!PRODUCT_AUTHORED_NAMESPACES.has(key)) {
      continue;
    }

    const violation = inspectProductNamespace(item, [key]);

    if (violation) {
      throw new Error(`Hermes-first request contains Product semantic content: ${violation}`);
    }
  }
}

export function buildHermesFirstCmoChatRequest(input: HermesFirstCmoChatRequestInput): HermesFirstCmoChatRequest {
  const runtimeUser = normalizeCmoRuntimeUserIdentity(input.userIdentity);
  const tenantId = input.request.tenantId ?? "holdstation";
  const requestBody: HermesFirstCmoChatRequest = {
    schema_version: HERMES_FIRST_CMO_CHAT_REQUEST_SCHEMA,
    request_id: `req_hf_cmo_chat_${input.userMessageId}`,
    session_id: input.sessionId,
    turn_id: input.userMessageId,
    created_at: input.createdAt,
    tenant_id: tenantId,
    workspace_id: input.request.workspaceId,
    app_id: input.request.appId,
    app_name: input.request.appName,
    user: {
      ...(runtimeUser.user_id ? { user_id: runtimeUser.user_id } : {}),
      user_slug: runtimeUser.user_slug,
      ...(runtimeUser.user_display_name ? { display_name: runtimeUser.user_display_name } : {}),
      ...(runtimeUser.email ? { email: runtimeUser.email } : {}),
      auth_mode: input.userIdentity.authMode ?? "unknown",
    },
    intent: {
      user_message: input.message,
    },
    messages: buildSafeHistory(input.history),
    context_pack: {
      session_summary: sessionSummaryRecord(input.sessionSummary),
      selected_context: selectedContextFromContextPack(input.contextPack),
      artifacts_in: artifactInputs(input),
      vault_context: input.vaultContext ?? null,
      ...(isRecord(input.contextPackage.lensReadoutContext) ? { lens_readout_context: input.contextPackage.lensReadoutContext } : {}),
    },
    attachments: safeRecordList(input.inputMaterialAttachments, 20),
    tool_policy: {
      mode: "cmo.normal_chat",
      read_web_allowed: true,
      read_browser_allowed: true,
      read_attachments_allowed: Boolean(input.inputMaterialAttachments?.length),
      allow_vault_write: false,
      allow_memory_mutation: false,
      allow_paid_media_generation: false,
      allow_publish: false,
      context_grounding_rules: [
        "Use provided context as grounding when relevant.",
        "Treat suggested Vault updates as draft-only unless Product later approves them.",
        "Do not perform durable writes, paid generation, or publishing in this turn.",
      ],
    },
    persistence_policy: {
      session_json_owner: "product",
      supabase_indexing_owner: "product",
      raw_capture_owner: "product",
      suggested_vault_updates: "draft_only",
      vault_writes_require_product_approval: true,
      creative_paid_generation_requires_existing_approval_flow: true,
    },
    ui_contract: {
      answer_format: "markdown",
      require_activity_events: true,
      require_artifacts_out: true,
      require_boundary_safe_warnings: true,
      product_must_not_synthesize_fallback: true,
    },
    shell_trace: {
      product_endpoint: "/api/cmo/chat",
      product_route: "hermes_first_normal_chat",
      legacy_direct_command_bypassed: false,
      local_review_command_bypassed: false,
    },
    ...(input.runtimeContext ? { runtime_context: input.runtimeContext } : {}),
    context_diagnostics: contextDiagnostics(input),
    artifact_transport: {
      mode: "product_shell_refs",
      paid_generation_allowed: false,
      publish_allowed: false,
      attachment_refs_count: input.inputMaterialAttachments?.length ?? 0,
    },
  };

  assertNoProductSemanticFields(requestBody);

  return requestBody;
}

function missingAnswerBody(payload: Record<string, unknown>): boolean {
  if (!isRecord(payload.answer)) {
    return true;
  }

  return typeof payload.answer.body !== "string" || !payload.answer.body.trim();
}

function responseFieldMismatch(
  payload: Record<string, unknown>,
  field: "request_id" | "session_id" | "turn_id",
  expected: string,
): string | undefined {
  if (!(field in payload)) {
    return undefined;
  }

  return payload[field] === expected ? undefined : `${field}:expected=${expected}`;
}

function responseContractFailure(payload: Record<string, unknown>, request: HermesFirstCmoChatRequest): HermesFirstBoundaryFailure | undefined {
  if ("schema_version" in payload && payload.schema_version !== HERMES_FIRST_CMO_CHAT_RESPONSE_SCHEMA) {
    return boundaryFailure("invalid_response", request, "Hermes CMO chat returned an unexpected schema_version", {
      detail: `schema_version=${String(payload.schema_version)}`,
    });
  }

  if ("mode" in payload && payload.mode !== "cmo.chat") {
    return boundaryFailure("invalid_response", request, "Hermes CMO chat returned an unexpected mode", {
      detail: `mode=${String(payload.mode)}`,
    });
  }

  const mismatch =
    responseFieldMismatch(payload, "request_id", request.request_id) ??
    responseFieldMismatch(payload, "session_id", request.session_id) ??
    responseFieldMismatch(payload, "turn_id", request.turn_id);

  return mismatch
    ? boundaryFailure("invalid_response", request, "Hermes CMO chat response identifiers did not match the request", { detail: mismatch })
    : undefined;
}

function findForbiddenSideEffect(value: unknown, path: string[] = []): string | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const violation = findForbiddenSideEffect(value[index], [...path, String(index)]);

      if (violation) {
        return violation;
      }
    }

    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const [key, item] of Object.entries(value)) {
    const token = keyToken(key);
    const nextPath = [...path, key];

    if (FORBIDDEN_SIDE_EFFECT_KEYS.has(token) && item === true) {
      return nextPath.join(".");
    }

    const violation = findForbiddenSideEffect(item, nextPath);

    if (violation) {
      return violation;
    }
  }

  return undefined;
}

export function normalizeHermesFirstCmoChatResponse(
  payload: unknown,
  request: HermesFirstCmoChatRequest,
): HermesFirstCmoChatResponse | { failure: HermesFirstBoundaryFailure } {
  if (!isRecord(payload)) {
    return { failure: boundaryFailure("malformed_json", request, "Hermes CMO chat returned malformed JSON") };
  }

  const contractFailure = responseContractFailure(payload, request);

  if (contractFailure) {
    return { failure: contractFailure };
  }

  if (missingAnswerBody(payload)) {
    return { failure: boundaryFailure("missing_answer_body", request, "Hermes CMO chat did not return answer.body") };
  }

  if (!isRecord(payload.side_effects)) {
    return { failure: boundaryFailure("invalid_side_effects", request, "Hermes CMO chat response declared side effects outside Phase 2 policy", {
      detail: "missing_side_effects",
    }) };
  }

  const forbiddenSideEffect = findForbiddenSideEffect(payload.side_effects);

  if (forbiddenSideEffect) {
    return { failure: boundaryFailure("invalid_side_effects", request, "Hermes CMO chat response declared side effects outside Phase 2 policy", {
      detail: forbiddenSideEffect,
    }) };
  }

  const answer = payload.answer as Record<string, unknown>;
  const status = payload.status === "needs_user_input" || payload.status === "failed" ? payload.status : "completed";
  const metadata = safeRecord(payload.metadata, 8_000) ?? {};

  return {
    schema_version: HERMES_FIRST_CMO_CHAT_RESPONSE_SCHEMA,
    request_id: compactString(payload.request_id, 160) || request.request_id,
    session_id: compactString(payload.session_id, 160) || request.session_id,
    turn_id: compactString(payload.turn_id, 160) || request.turn_id,
    mode: "cmo.chat",
    status,
    answer: {
      ...answer,
      body: typeof answer.body === "string" ? answer.body.trim() : "",
      format: compactString(answer.format) || "markdown",
    },
    ...(safeRecord(payload.intent_decision, 4_000) ? { intent_decision: safeRecord(payload.intent_decision, 4_000) } : {}),
    ...(safeRecord(payload.route_decision, 4_000) ? { route_decision: safeRecord(payload.route_decision, 4_000) } : {}),
    ...(safeRecord(payload.answer_basis, 4_000) ? { answer_basis: safeRecord(payload.answer_basis, 4_000) } : {}),
    activity_events: normalizeActivityEvents(payload.activity_events, {
      sessionId: compactString(payload.session_id, 160) || request.session_id,
      turnId: compactString(payload.turn_id, 160) || request.turn_id,
      requestId: compactString(payload.request_id, 160) || request.request_id,
      createdAt: request.created_at,
    }),
    delegation_summary: normalizeDelegationSummary(payload.delegation_summary),
    agents_used: normalizeAgentsUsed(payload.agents_used ?? metadata.agents_used),
    artifacts_out: safeRecordList(payload.artifacts_out, 40),
    approval_requests: safeRecordList(payload.approval_requests, 40),
    suggested_vault_updates: safeRecordList(payload.suggested_vault_updates, 40),
    ...(payload.vault_context_usage !== undefined ? { vault_context_usage: payload.vault_context_usage } : {}),
    suggested_session_summary_update: payload.suggested_session_summary_update,
    ...(safeRecord(payload.state_updates, 4_000) ? { state_updates: safeRecord(payload.state_updates, 4_000) } : {}),
    warnings: stringList(payload.warnings ?? payload.contract_warnings, 20),
    errors: errorsList(payload.errors),
    side_effects: payload.side_effects,
    metadata,
  };
}

function responsePreview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_RESPONSE_PREVIEW_CHARS);
}

async function parseJsonResponse(response: Response): Promise<{ ok: true; payload: unknown; raw: string } | { ok: false; raw: string }> {
  const raw = await response.text();

  try {
    return { ok: true, payload: raw ? JSON.parse(raw) as unknown : null, raw };
  } catch {
    return { ok: false, raw };
  }
}

function boundaryFailure(
  type: HermesFirstBoundaryFailureType,
  request: HermesFirstCmoChatRequest,
  publicReason: string,
  extra: Partial<HermesFirstBoundaryFailure> = {},
): HermesFirstBoundaryFailure {
  const runtimeError =
    type === "timeout"
      ? "Hermes CMO chat v1.1 request timed out."
      : type === "http_error"
        ? `Hermes CMO chat v1.1 returned HTTP ${extra.httpStatus ?? "error"}`
        : type === "malformed_json"
          ? "Hermes CMO chat v1.1 returned malformed JSON"
          : type === "invalid_response"
            ? "Hermes CMO chat v1.1 returned invalid response metadata"
          : type === "missing_answer_body"
            ? "Hermes CMO chat v1.1 response missing answer.body"
            : type === "invalid_side_effects"
              ? "Hermes CMO chat v1.1 response declared forbidden side effects"
              : extra.runtimeError ?? publicReason;
  const runtimeErrorReason: CMOAppChatResponse["runtimeErrorReason"] =
    type === "timeout"
      ? "timeout"
      : type === "missing_answer_body"
        ? "empty_answer"
        : type === "http_error" || type === "network_error" || type === "configuration_error"
          ? "execution_error"
          : "invalid_response";

  return {
    type,
    publicReason,
    runtimeError,
    runtimeErrorReason,
    requestId: request.request_id,
    request,
    ...extra,
  };
}

export async function runHermesFirstCmoChat(input: HermesFirstCmoChatRequestInput): Promise<HermesFirstCmoChatRun> {
  let request: HermesFirstCmoChatRequest;

  try {
    request = buildHermesFirstCmoChatRequest(input);
  } catch (error) {
    const fallbackRequest = {
      schema_version: HERMES_FIRST_CMO_CHAT_REQUEST_SCHEMA,
      request_id: `req_hf_cmo_chat_${input.userMessageId}`,
      session_id: input.sessionId,
      turn_id: input.userMessageId,
      created_at: input.createdAt,
      tenant_id: input.request.tenantId ?? "holdstation",
      workspace_id: input.request.workspaceId,
      app_id: input.request.appId,
      app_name: input.request.appName,
      user: { user_slug: "unknown_user", auth_mode: "unknown" },
      intent: { user_message: input.message },
      messages: [],
      context_pack: { session_summary: null, selected_context: [], artifacts_in: [], vault_context: null },
      attachments: [],
      tool_policy: {
        mode: "cmo.normal_chat",
        read_web_allowed: true,
        read_browser_allowed: true,
        read_attachments_allowed: false,
        allow_vault_write: false,
        allow_memory_mutation: false,
        allow_paid_media_generation: false,
        allow_publish: false,
        context_grounding_rules: [],
      },
      persistence_policy: {
        session_json_owner: "product",
        supabase_indexing_owner: "product",
        raw_capture_owner: "product",
        suggested_vault_updates: "draft_only",
        vault_writes_require_product_approval: true,
        creative_paid_generation_requires_existing_approval_flow: true,
      },
      ui_contract: {
        answer_format: "markdown",
        require_activity_events: true,
        require_artifacts_out: true,
        require_boundary_safe_warnings: true,
        product_must_not_synthesize_fallback: true,
      },
      shell_trace: {
        product_endpoint: "/api/cmo/chat",
        product_route: "hermes_first_normal_chat",
        legacy_direct_command_bypassed: false,
        local_review_command_bypassed: false,
      },
    } satisfies HermesFirstCmoChatRequest;

    return {
      ok: false,
      request: fallbackRequest,
      failure: boundaryFailure(
        "request_contract_violation",
        fallbackRequest,
        "Product blocked Hermes-first request contract violation",
        { detail: error instanceof Error ? error.message : String(error) },
      ),
    };
  }

  const outboundSanitizer = sanitizeOutboundHermesPayload(request);
  const outboundDiagnostics = {
    ...outboundSanitizer.diagnostics,
    outbound_callsite_guard_version: OUTBOUND_HERMES_CALLSITE_GUARD_VERSION,
    outbound_callsite_guard_checked: true,
    outbound_callsite_guard_blocked: false,
  };
  let finalOutboundRequest = withOutboundHermesPayloadGuardDiagnostics(outboundSanitizer.payload, outboundDiagnostics);
  assertNoProductSemanticFields(finalOutboundRequest);
  const traceProjection = buildOutboundHermesTraceSafeRequest(finalOutboundRequest);
  const traceDiagnostics = {
    ...outboundDiagnostics,
    ...traceProjection.diagnostics,
  };
  finalOutboundRequest = withOutboundHermesPayloadGuardDiagnostics(finalOutboundRequest, traceDiagnostics);
  const finalOutboundBody = JSON.stringify(finalOutboundRequest);
  const fetchBodyBlockInspection = mergeOutboundHermesCallsiteBlockInspections([
    inspectOutboundHermesCallsiteBlock("fetch_body", finalOutboundBody),
    inspectOutboundHermesCallsiteBlock("fetch_body", finalOutboundRequest),
  ]);

  if (
    outboundSanitizer.diagnostics.outbound_hermes_payload_path_like_blocked ||
    fetchBodyBlockInspection.literals.length > 0
  ) {
    return {
      ok: false,
      request: finalOutboundRequest,
      failure: boundaryFailure(
        "request_payload_blocked",
        finalOutboundRequest,
        "Product blocked Hermes-first request because the final outbound body still contained unsafe local path, secret, or artifact text after scrub",
        {
          detail: fetchBodyBlockInspection.literals.join(", ") || outboundSanitizer.blockedFieldsPreview.join(", "),
        },
      ),
    };
  }

  const baseUrl = getCmoHermesBaseUrl();
  const apiKey = getCmoHermesApiKey();

  if (!baseUrl) {
    return {
      ok: false,
      request: finalOutboundRequest,
      failure: boundaryFailure("configuration_error", finalOutboundRequest, "CMO_HERMES_BASE_URL is not configured"),
    };
  }

  if (!apiKey) {
    return {
      ok: false,
      request: finalOutboundRequest,
      failure: boundaryFailure("configuration_error", finalOutboundRequest, "CMO_HERMES_API_KEY is not configured"),
    };
  }

  const timeoutMs = getCmoHermesTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const liveAttemptStartedAt = new Date().toISOString();
  const liveAttemptStartedMs = Date.now();

  try {
    const response = await fetch(`${baseUrl}${HERMES_FIRST_CMO_CHAT_ENDPOINT}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: finalOutboundBody,
      cache: "no-store",
      signal: controller.signal,
    });

    const liveAttemptDurationMs = Date.now() - liveAttemptStartedMs;

    if (!response.ok) {
      const parsed = await parseJsonResponse(response);

      return {
        ok: false,
        request: finalOutboundRequest,
        liveAttemptStartedAt,
        liveAttemptDurationMs,
        failure: boundaryFailure(
          "http_error",
          finalOutboundRequest,
          `Hermes CMO chat returned HTTP ${response.status}`,
          {
            httpStatus: response.status,
            retryable: response.status >= 500,
            responsePreview: responsePreview(parsed.raw),
          },
        ),
      };
    }

    const parsed = await parseJsonResponse(response);

    if (!parsed.ok) {
      return {
        ok: false,
        request: finalOutboundRequest,
        liveAttemptStartedAt,
        liveAttemptDurationMs,
        failure: boundaryFailure("malformed_json", finalOutboundRequest, "Hermes CMO chat returned malformed JSON", {
          responsePreview: responsePreview(parsed.raw),
        }),
      };
    }

    const normalized = normalizeHermesFirstCmoChatResponse(parsed.payload, finalOutboundRequest);

    if ("failure" in normalized) {
      return {
        ok: false,
        request: finalOutboundRequest,
        liveAttemptStartedAt,
        liveAttemptDurationMs,
        failure: normalized.failure,
      };
    }

    return {
      ok: true,
      request: finalOutboundRequest,
      response: normalized,
      liveAttemptStartedAt,
      liveAttemptDurationMs,
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const liveAttemptDurationMs = Date.now() - liveAttemptStartedMs;

    return {
      ok: false,
      request: finalOutboundRequest,
      liveAttemptStartedAt,
      liveAttemptDurationMs,
      failure: boundaryFailure(
        isTimeout ? "timeout" : "network_error",
        finalOutboundRequest,
        isTimeout
          ? "Hermes CMO chat timed out before returning a valid response"
          : "Hermes CMO chat request failed before returning a valid response",
        {
          timeoutMs,
          outerTimeoutMs: timeoutMs,
          detail: isTimeout ? undefined : error instanceof Error ? error.message : String(error),
        },
      ),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function countersFromResponse(response: HermesFirstCmoChatResponse): HermesCmoSafetyCounters {
  const agents = new Set(response.agents_used ?? []);

  for (const item of response.delegation_summary) {
    agents.add(item.targetAgent);
  }

  return {
    surfCalls: agents.has("surf") ? 1 : 0,
    echoCalls: agents.has("echo") ? 1 : 0,
    vaultAgentCalls: 0,
    vaultWrites: 0,
    directSupabaseMutations: 0,
    openclawCalls: 0,
  };
}

function forbiddenCounters(): HermesCmoForbiddenCounters {
  return {
    vaultAgentCalls: 0,
    vaultWrites: 0,
    openclawCalls: 0,
    directSupabaseMutations: 0,
  };
}

function baseMetadata(input: {
  requestId: string;
  responseStatus: string;
  productRenderSource: "hermes_cmo" | "hermes_cmo_boundary_failure";
  fallbackUsed: boolean;
  activityEvents: HermesCmoActivityEventSummary[];
  delegationSummary: HermesCmoDelegationSummaryItem[];
  agentsUsed?: HermesCmoAgentUsed[];
  counters: HermesCmoSafetyCounters;
  forbidden: HermesCmoForbiddenCounters;
  sideEffects?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}): HermesCmoChatMetadata {
  return {
    runtimeMode: "hermes_cmo",
    runtimeStatus: input.productRenderSource === "hermes_cmo_boundary_failure" ? "runtime_error" : "live",
    calledHermesCmo: true,
    hermesRequestSent: true,
    productRenderSource: input.productRenderSource,
    selectedHermesEndpoint: HERMES_FIRST_CMO_CHAT_ENDPOINT,
    hermesEndpointKind: "agent_chat",
    endpoint_kind: "agent_chat",
    runtime_kind: "ai_agent",
    requested_endpoint: HERMES_FIRST_CMO_CHAT_ENDPOINT,
    fallback_used: input.fallbackUsed,
    side_effects: input.sideEffects as Record<string, boolean> | undefined,
    delegationsMode: "proposals_only",
    counters: input.counters,
    forbiddenCounters: input.forbidden,
    requestId: input.requestId,
    responseStatus: input.responseStatus,
    activityEventsCount: input.activityEvents.length,
    activityEvents: input.activityEvents,
    delegationSummary: input.delegationSummary,
    ...(input.agentsUsed?.length ? { agentsUsed: input.agentsUsed } : {}),
    surfCalls: input.counters.surfCalls,
    echoCalls: input.counters.echoCalls,
    ...input.extra,
  };
}

export function mapHermesFirstCmoChatToAppChat(input: {
  request: HermesFirstCmoChatRequest;
  response: HermesFirstCmoChatResponse;
  liveAttemptStartedAt?: string;
  liveAttemptDurationMs?: number;
}): HermesFirstMappedAppChat {
  const counters = countersFromResponse(input.response);
  const forbidden = forbiddenCounters();
  const agentsUsed = input.response.agents_used;
  const metadata = baseMetadata({
    requestId: input.request.request_id,
    responseStatus: input.response.status,
    productRenderSource: "hermes_cmo",
    fallbackUsed: false,
    activityEvents: input.response.activity_events,
    delegationSummary: input.response.delegation_summary,
    agentsUsed,
    counters,
    forbidden,
    sideEffects: input.response.side_effects,
    extra: {
      intent_decision: input.response.intent_decision,
      route: input.response.route_decision,
      route_decision: input.response.route_decision,
      answerBasis: input.response.answer_basis,
      answer_basis: input.response.answer_basis,
      artifacts_out_count: input.response.artifacts_out.length,
      session_summary_update_present: input.response.suggested_session_summary_update !== undefined,
      suggested_vault_updates_count: input.response.suggested_vault_updates.length,
      ...(input.response.vault_context_usage !== undefined ? { vault_context_usage: input.response.vault_context_usage } : {}),
      approval_requests_count: input.response.approval_requests.length,
      contract_warnings: input.response.warnings,
      contract_warnings_count: input.response.warnings.length,
      errors: input.response.errors,
      raw_hermes_metadata: input.response.metadata,
    },
  });
  const runtimeStatus: CMOAppChatResponse["runtimeStatus"] =
    input.response.status === "failed" ? "runtime_error" : "live";

  return {
    answer: input.response.answer.body.trim(),
    status: input.response.status === "failed" ? "failed" : "completed",
    assumptions: [],
    suggestedActions: [],
    isDevelopmentFallback: false,
    isRuntimeFallback: false,
    runtimeStatus,
    runtimeMode: "live",
    attemptedRuntimeMode: "live",
    runtimeLabel: "Hermes CMO chat v1.1",
    runtimeProvider: "hermes",
    runtimeAgent: "cmo",
    ...(input.response.status === "failed" ? { runtimeError: "Hermes CMO chat v1.1 returned failed status.", runtimeErrorReason: "execution_error" as const } : {}),
    productRenderSource: "hermes_cmo",
    calledHermesCmo: true,
    hermesRequestSent: true,
    hermesCmoStatus: "live",
    hermesCmoCounters: counters,
    hermesCmoMetadata: metadata,
    ...(input.response.vault_context_usage !== undefined ? { vault_context_usage: input.response.vault_context_usage } : {}),
    activityEvents: input.response.activity_events,
    delegationSummary: input.response.delegation_summary,
    ...(agentsUsed?.length ? { agentsUsed } : {}),
    surfCalls: counters.surfCalls,
    echoCalls: counters.echoCalls,
    forbiddenCounters: forbidden,
    delegationsMode: "proposals_only",
    sessionArtifacts: input.response.artifacts_out,
    suggestedVaultUpdates: input.response.suggested_vault_updates,
    approvalRequests: input.response.approval_requests,
    suggestedSessionSummaryUpdate: input.response.suggested_session_summary_update,
    liveAttemptStartedAt: input.liveAttemptStartedAt,
    liveAttemptDurationMs: input.liveAttemptDurationMs,
  };
}

export function hermesFirstBoundaryFailureResponse(input: {
  failure: HermesFirstBoundaryFailure;
  liveAttemptStartedAt?: string;
  liveAttemptDurationMs?: number;
}): HermesFirstMappedAppChat {
  const counters: HermesCmoSafetyCounters = {
    surfCalls: 0,
    echoCalls: 0,
    vaultAgentCalls: 0,
    vaultWrites: 0,
    directSupabaseMutations: 0,
    openclawCalls: 0,
  };
  const forbidden = forbiddenCounters();
  const activityEvents = normalizeCmoActivityEvents([
    {
      event_id: `${input.failure.requestId}_boundary_failure`,
      type: "run.failed",
      status: "failed",
      message: input.failure.publicReason,
      user_visible: true,
      source_agent: "cmo",
      sourceMode: "cmo.default",
    },
  ], {
    requestId: input.failure.requestId,
    createdAt: new Date(0).toISOString(),
  }) as HermesCmoActivityEventSummary[];
  const metadata = baseMetadata({
    requestId: input.failure.requestId,
    responseStatus: "failed",
    productRenderSource: "hermes_cmo_boundary_failure",
    fallbackUsed: false,
    activityEvents,
    delegationSummary: [],
    agentsUsed: ["cmo"],
    counters,
    forbidden,
    sideEffects: {},
    extra: {
      boundary_failure: true,
      boundary_failure_type: input.failure.type,
      runtimeStatus: "runtime_error",
      productRenderSource: "hermes_cmo_boundary_failure",
      ...(input.failure.httpStatus ? { http_status: input.failure.httpStatus } : {}),
      ...(typeof input.failure.retryable === "boolean" ? { retryable: input.failure.retryable } : {}),
      ...(input.failure.responsePreview ? { response_preview: input.failure.responsePreview } : {}),
      ...(input.failure.detail ? { detail: input.failure.detail } : {}),
    },
  });

  return {
    answer: [
      "CMO could not complete this Hermes-first turn.",
      "",
      `Boundary failure: ${input.failure.publicReason}.`,
      `Request id: ${input.failure.requestId}.`,
      "No Product fallback answer was generated.",
    ].join("\n"),
    status: "failed",
    assumptions: [],
    suggestedActions: [
      {
        type: "retry_hermes_cmo_chat",
        label: "Retry Hermes CMO chat",
      },
    ],
    isDevelopmentFallback: false,
    isRuntimeFallback: false,
    runtimeStatus: "runtime_error",
    runtimeMode: "live",
    attemptedRuntimeMode: "live",
    runtimeLabel: "Hermes CMO chat v1.1",
    runtimeProvider: "hermes",
    runtimeAgent: "cmo",
    runtimeError: input.failure.runtimeError,
    runtimeErrorReason: input.failure.runtimeErrorReason,
    productRenderSource: "hermes_cmo_boundary_failure",
    calledHermesCmo: true,
    hermesRequestSent: true,
    hermesCmoStatus: "failed_boundary",
    hermesCmoErrorReason: input.failure.type,
    hermesCmoCounters: counters,
    hermesCmoMetadata: metadata,
    activityEvents,
    delegationSummary: [],
    agentsUsed: ["cmo"],
    surfCalls: 0,
    echoCalls: 0,
    forbiddenCounters: forbidden,
    delegationsMode: "proposals_only",
    sessionArtifacts: [],
    suggestedVaultUpdates: [],
    approvalRequests: [],
    liveAttemptStartedAt: input.liveAttemptStartedAt,
    liveAttemptDurationMs: input.liveAttemptDurationMs,
    timeoutMs: input.failure.timeoutMs,
    outerTimeoutMs: input.failure.outerTimeoutMs,
  };
}
