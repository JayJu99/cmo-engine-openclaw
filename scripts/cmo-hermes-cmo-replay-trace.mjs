import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const appChatDir = path.join(rootDir, "data", "cmo-dashboard", "app-chat");
const traceDir = path.resolve(process.env.CMO_HERMES_CMO_TRACE_DIR || path.join(rootDir, "data", "cmo-dashboard", "hermes-cmo-traces"));

const compact = (value, max = 1000) => {
  if (typeof value !== "string") return value;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trimEnd()}...` : normalized;
};

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8"));

const safeSourceClassifications = new Set([
  "native_conversation",
  "source_answer",
  "structured_review",
  "strategy_only",
  "external_research",
  "source_translate",
  "source_transform",
  "save_to_vault",
  "clarify",
]);

const latestFile = (dir, predicate) => {
  if (!existsSync(dir)) return null;
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter(predicate)
    .map((filePath) => ({ filePath, mtimeMs: statSync(filePath).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath ?? null;
};

const latestSessionPath = () => latestFile(appChatDir, (filePath) => path.basename(filePath).startsWith("session_") && filePath.endsWith(".json"));

const findSessionPathByRequest = (request) => {
  if (!isRecord(request)) return null;
  const sessionId = typeof request.session_id === "string" && request.session_id.trim() ? request.session_id.trim() : null;
  const appId = typeof request.workspace?.app_id === "string" && request.workspace.app_id.trim() ? request.workspace.app_id.trim() : null;
  const exactSessionPath = sessionId ? path.join(appChatDir, `${sessionId}.json`) : null;

  if (exactSessionPath && existsSync(exactSessionPath)) {
    return exactSessionPath;
  }

  if (!existsSync(appChatDir)) return null;

  const candidates = readdirSync(appChatDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith("session_") && entry.name.endsWith(".json"))
    .map((entry) => path.join(appChatDir, entry.name))
    .map((filePath) => {
      try {
        const session = readJson(filePath);
        return { filePath, session, mtimeMs: statSync(filePath).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const matchingSessionId = sessionId ? candidates.filter((candidate) => candidate.session?.id === sessionId) : [];
  if (matchingSessionId.length) {
    return matchingSessionId.sort((left, right) => right.mtimeMs - left.mtimeMs)[0].filePath;
  }

  const matchingApp = appId ? candidates.filter((candidate) => candidate.session?.appId === appId) : [];
  if (matchingApp.length) {
    return matchingApp.sort((left, right) => right.mtimeMs - left.mtimeMs)[0].filePath;
  }

  return null;
};

const sessionPath = (request) => {
  if (process.env.SESSION_JSON) return path.resolve(process.env.SESSION_JSON);
  if (process.env.SESSION_ID) return path.join(appChatDir, `${process.env.SESSION_ID}.json`);
  return findSessionPathByRequest(request) ?? latestSessionPath();
};

const tracePath = () => {
  if (process.env.TRACE_JSON) return path.resolve(process.env.TRACE_JSON);
  return latestFile(traceDir, (filePath) => filePath.endsWith("_request.json"));
};

const sourceSummary = (source) => ({
  type: source?.type,
  schema_version: source?.schema_version,
  workspace_id: source?.workspace_id,
  session_id: source?.session_id,
  source_id: source?.source_id,
  source_title: source?.source_title,
  original_url: source?.original_url,
  canonical_url: source?.canonical_url,
  extraction_status: source?.extraction_status,
  main_content_quality: source?.main_content_quality,
  extraction_coverage: source?.extraction_coverage,
  read_depth: source?.read_depth,
  cache_role: source?.cache_role,
  nav_heavy: source?.nav_heavy,
  tool_read_recommended: source?.tool_read_recommended,
  saved_to_vault: source?.saved_to_vault,
  truth_status: source?.truth_status,
});

const summarizeSession = (session) => {
  const interesting = /feeback\.org|dịch tiếng việt|ap dụng|áp dụng|Ok thanks bro|Bro đọc được link/i;
  return {
    id: session.id,
    appId: session.appId,
    appName: session.appName,
    runtimeStatus: session.runtimeStatus,
    runtimeProvider: session.runtimeProvider,
    isRuntimeFallback: session.isRuntimeFallback,
    productRenderSource: session.productRenderSource,
    productFallbackReason: session.productFallbackReason,
    hermesRequestSent: session.hermesRequestSent,
    calledHermesCmo: session.calledHermesCmo,
    hermesCmoStatus: session.hermesCmoStatus,
    activeSourceId: session.activeSourceId,
    sessionLocalSources: (session.sessionLocalSources ?? []).map(sourceSummary),
    messages: (session.messages ?? [])
      .filter((message) => interesting.test(message.content ?? "") || message.role === "assistant")
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: compact(message.content, 500),
        runtimeStatus: message.runtimeStatus,
        runtimeProvider: message.runtimeProvider,
        isRuntimeFallback: message.isRuntimeFallback,
        productRenderSource: message.productRenderSource,
        productFallbackReason: message.productFallbackReason,
        hermesRequestSent: message.hermesRequestSent,
        calledHermesCmo: message.calledHermesCmo,
        hermesCmoStatus: message.hermesCmoStatus,
        hermesCmoMetadata: message.hermesCmoMetadata
          ? {
              hermesRequestSent: message.hermesCmoMetadata.hermesRequestSent,
              productRenderSource: message.hermesCmoMetadata.productRenderSource,
              selectedHermesEndpoint: message.hermesCmoMetadata.selectedHermesEndpoint,
              hermesEndpointKind: message.hermesCmoMetadata.hermesEndpointKind,
              hermesEndpointTimeoutMs: message.hermesCmoMetadata.hermesEndpointTimeoutMs,
              hermesToolEndpointEnabled: message.hermesCmoMetadata.hermesToolEndpointEnabled,
              sideEffects: message.hermesCmoMetadata.sideEffects,
              responseStatus: message.hermesCmoMetadata.responseStatus,
              strategyMode: message.hermesCmoMetadata.strategyMode,
              decisionLabel: message.hermesCmoMetadata.decisionLabel,
              echoCalls: message.hermesCmoMetadata.echoCalls,
              surfCalls: message.hermesCmoMetadata.surfCalls,
              agentsUsed: message.hermesCmoMetadata.agentsUsed,
              activityTypes: (message.hermesCmoMetadata.activityEvents ?? []).map((event) => event.type),
              delegationSummary: message.hermesCmoMetadata.delegationSummary,
            }
          : undefined,
        sourceReviewContext: message.sourceReviewContext
          ? {
              mode: message.sourceReviewContext.mode,
              workspace_id: message.sourceReviewContext.workspace_id,
              source_id: message.sourceReviewContext.source?.source_id,
              source_title: message.sourceReviewContext.source?.source_title,
              extraction_status: message.sourceReviewContext.extraction?.status,
            }
          : undefined,
        sessionLocalSources: (message.sessionLocalSources ?? []).map(sourceSummary),
        activeSourceId: message.activeSourceId,
      })),
  };
};

const stringOrNull = (value) => (typeof value === "string" && value.trim() ? value : null);

const requestUserMessage = (request) =>
  stringOrNull(request?.user_message) ??
  stringOrNull(request?.message) ??
  stringOrNull(request?.input?.user_message) ??
  stringOrNull(request?.input?.message) ??
  stringOrNull(request?.intent?.user_message);

const requestActiveSourceId = (request) =>
  stringOrNull(request?.active_source_id) ??
  stringOrNull(request?.context_pack?.active_source_id) ??
  stringOrNull(request?.source_acquisition?.active_source_id);

const summarizeHermesRequest = (request) => ({
  request_present: true,
  request_id: request.request_id,
  session_id: request.session_id,
  turn_id: request.turn_id,
  workspace: request.workspace,
  user_message: stringOrNull(request.user_message),
  message: stringOrNull(request.message),
  input_user_message: stringOrNull(request.input?.user_message),
  input_message: stringOrNull(request.input?.message),
  nested_user_message: stringOrNull(request.intent?.user_message),
  resolved_user_message_present: Boolean(requestUserMessage(request)),
  tool_policy: request.tool_policy,
  product_boundary: request.product_boundary,
  source_acquisition: request.source_acquisition,
  tool_endpoint: request.tool_endpoint,
  context_pack_keys: Object.keys(request.context_pack ?? {}),
  active_source_id: requestActiveSourceId(request),
  top_active_source_id: stringOrNull(request.active_source_id),
  context_pack_active_source_id: stringOrNull(request.context_pack?.active_source_id),
  source_acquisition_active_source_id: stringOrNull(request.source_acquisition?.active_source_id),
  artifacts_in: Array.isArray(request.context_pack?.artifacts_in)
    ? request.context_pack.artifacts_in.map((artifact) => ({
        type: artifact?.type,
        schema_version: artifact?.schema_version,
        workspace_id: artifact?.workspace_id,
        source_id: artifact?.source_id,
        source_title: artifact?.source_title,
        original_url: artifact?.original_url,
        canonical_url: artifact?.canonical_url,
        extraction_status: artifact?.extraction_status,
        extraction_quality: artifact?.extraction_quality,
        extraction_coverage: artifact?.extraction_coverage,
        read_depth: artifact?.read_depth,
        cache_role: artifact?.cache_role,
        nav_heavy: artifact?.nav_heavy,
        tool_read_recommended: artifact?.tool_read_recommended,
        saved_to_vault: artifact?.saved_to_vault,
        truth_status: artifact?.truth_status,
      }))
    : [],
  source_answer_context: request.context_pack?.source_answer_context
    ? {
        schema_version: request.context_pack.source_answer_context.schema_version,
        workspace_id: request.context_pack.source_answer_context.workspace_id,
        session_id: request.context_pack.source_answer_context.session_id,
        source_id: request.context_pack.source_answer_context.source_id,
        query_type: request.context_pack.source_answer_context.query_type,
        action: request.context_pack.source_answer_context.action,
        answerable: request.context_pack.source_answer_context.answerable,
        extraction_quality: request.context_pack.source_answer_context.extraction_quality,
        extraction_coverage: request.context_pack.source_answer_context.extraction_coverage,
        read_depth: request.context_pack.source_answer_context.read_depth,
        cache_role: request.context_pack.source_answer_context.cache_role,
        nav_heavy: request.context_pack.source_answer_context.nav_heavy,
        tool_read_recommended: request.context_pack.source_answer_context.tool_read_recommended,
      }
    : null,
  source_review_context: request.context_pack?.source_review_context
    ? {
        mode: request.context_pack.source_review_context.mode,
        workspace_id: request.context_pack.source_review_context.workspace_id,
        source_id: request.context_pack.source_review_context.source?.source_id,
        source_title: request.context_pack.source_review_context.source?.source_title,
        extraction_status: request.context_pack.source_review_context.extraction?.status,
      }
    : null,
  runtime_context: request.runtime_context,
  constraints: {
    allowed_agents: request.constraints?.allowed_agents,
    allowed_surf_modes: request.constraints?.allowed_surf_modes,
    delegations_mode: request.constraints?.delegations_mode,
    vault_agent_delegation_allowed: request.constraints?.vault_agent_delegation_allowed,
    execution_boundary: request.constraints?.execution_boundary,
  },
});

const summarizeHermesResponse = (payload, httpStatus) => {
  const root = isRecord(payload) ? payload : {};
  const response = isRecord(root.response) ? root.response : root;
  const structured = isRecord(response.structured_output) ? response.structured_output : {};
  const basis = isRecord(response.answer_basis) ? response.answer_basis : {};
  const answer = isRecord(response.answer) ? response.answer : {};
  return {
    httpStatus,
    status: response.status,
    classification: response.classification ?? structured.classification,
    answer_basis_mode: basis.mode,
    delegations: Array.isArray(response.delegations)
      ? response.delegations.map((delegation) => {
          const target = isRecord(delegation?.target) ? delegation.target : {};
          return {
            target_agent: target.agent ?? delegation.targetAgent ?? delegation.target_agent ?? delegation.agent,
            mode: target.mode ?? delegation.mode,
            status: delegation.status,
            objective: compact(delegation.objective, 300),
          };
        })
      : response.delegations,
    activity_event_types: Array.isArray(root.activity_events) ? root.activity_events.map((event) => event?.type) : [],
    tool_read_events: Array.isArray(root.activity_events)
      ? root.activity_events
          .filter((event) => event?.type === "cmo.tool_read.started" || event?.type === "cmo.tool_read.completed")
          .map((event) => ({
            type: event?.type,
            status: event?.status,
            tool_family: event?.data?.tool_family,
            source_type: event?.data?.source_type,
            http_status: event?.data?.http_status,
          }))
      : [],
    safety_counters: root.safety_counters ?? response.safety_counters ?? response.safety?.counters,
    forbidden_counters: root.forbidden_counters ?? response.forbidden_counters,
    side_effects: root.side_effects ?? response.side_effects,
    mutation_flags: {
      direct_vault_write: response.direct_vault_write,
      direct_memory_mutation: response.direct_memory_mutation,
      direct_supabase_mutation: response.direct_supabase_mutation,
      direct_supabase_write: response.direct_supabase_write,
      openclaw_call: response.openclaw_call,
      gbrain_mutation: response.gbrain_mutation,
    },
    answer_body_preview: compact(answer.body, 1000),
  };
};

const requestHasSourceContext = (request) => {
  const contextPack = isRecord(request?.context_pack) ? request.context_pack : {};
  const artifacts = Array.isArray(contextPack.artifacts_in) ? contextPack.artifacts_in : [];

  return Boolean(
    contextPack.active_source_id ||
      contextPack.source_review_context ||
      contextPack.source_answer_context ||
      artifacts.some((artifact) =>
        artifact?.type === "session_local_source" ||
        artifact?.type === "source_answer_context" ||
        artifact?.type === "vault_context_pack",
      ),
  );
};

const replayHasBoundaryFailure = (replay) => {
  if (!isRecord(replay) || replay.skipped) return false;
  if (typeof replay.httpStatus === "number" && (replay.httpStatus < 200 || replay.httpStatus >= 300)) return true;
  if (replay.status === "failed" || replay.status === "cancelled") return true;

  const flags = isRecord(replay.mutation_flags) ? replay.mutation_flags : {};
  return Object.values(flags).some((value) => value === true);
};

const sessionShowsFallbackOrLocalSourceReview = (session) => {
  if (!isRecord(session)) return false;
  const fallbackStatus = typeof session.hermesCmoStatus === "string" && session.hermesCmoStatus !== "live";
  const fallbackRuntime = session.isRuntimeFallback === true || session.runtimeProvider === "fallback";
  const explicitProductFallback = session.productRenderSource === "fallback_after_hermes_failure";
  const localSourceReview = Array.isArray(session.messages) && session.messages.some((message) =>
    message?.role === "assistant" &&
      /Source Review:|This source is available as temporary review-only context|No Vault save, GBrain indexing, or knowledge promotion was performed/i.test(message.content ?? ""),
  );

  return Boolean(fallbackStatus || fallbackRuntime || explicitProductFallback || localSourceReview);
};

const sessionFallbackReason = (session) => {
  if (!isRecord(session)) return "";
  const latestAssistant = Array.isArray(session.messages)
    ? [...session.messages].reverse().find((message) => message?.role === "assistant")
    : null;

  return String(session.productFallbackReason ?? latestAssistant?.productFallbackReason ?? "");
};

const rootCauseClassification = ({ request, replay, session }) => {
  const fallbackReason = sessionFallbackReason(session);

  if (/Rejected field/i.test(fallbackReason)) {
    return {
      case_id: "D_validator_rejected_valid_or_new_shape",
      summary: `CMO Engine validator rejected the Hermes response shape: ${compact(fallbackReason, 400)}`,
    };
  }

  if (!request) {
    return {
      case_id: "no_trace_available",
      summary: "No Hermes request trace was found to classify.",
    };
  }

  const hasSourceContext = requestHasSourceContext(request);

  if (!hasSourceContext) {
    return {
      case_id: "A_request_context_missing",
      summary: "CMO Engine did not include active source/cache context in the Hermes request.",
    };
  }

  if (replayHasBoundaryFailure(replay)) {
    return {
      case_id: "C_hermes_invalid_or_boundary_rejected",
      summary: "Hermes replay failed, returned an unsafe mutation signal, or violated the response boundary.",
    };
  }

  if (sessionShowsFallbackOrLocalSourceReview(session)) {
    return {
      case_id: "D_cmo_engine_mapping_or_fallback",
      summary: "CMO Engine session output indicates fallback/local Source Review rendering after Hermes was expected.",
    };
  }

  const classification = replay?.classification ?? replay?.answer_basis_mode;
  if (classification && !safeSourceClassifications.has(classification)) {
    return {
      case_id: "B_hermes_classification_or_answer_mismatch",
      summary: `Hermes replay used unexpected classification ${classification}.`,
    };
  }

  if (replay && replay.skipped) {
    return {
      case_id: "replay_skipped",
      summary: "Request/session context was available, but live replay credentials were not configured.",
    };
  }

  return {
    case_id: "no_root_cause_detected",
    summary: "Request, replay, and session summaries do not show the known A/B/C/D failure signatures.",
  };
};

const run = async () => {
  const foundTracePath = tracePath();
  let traceRoot = null;
  let request = null;

  if (foundTracePath && existsSync(foundTracePath)) {
    traceRoot = readJson(foundTracePath);
    request = traceRoot.request ?? traceRoot;
  }

  const foundSessionPath = sessionPath(request);
  const output = {
    sessionPath: foundSessionPath,
    tracePath: foundTracePath,
    selectedHermesEndpoint: traceRoot?.endpoint_path ?? null,
    hermesEndpointKind: traceRoot?.endpoint_kind ?? null,
    hermesToolEndpointEnabled: traceRoot?.tool_endpoint_enabled ?? null,
    hermesEndpointTimeoutMs: traceRoot?.timeout_ms ?? null,
    sessionTraceMatch: {
      request_session_id: request?.session_id ?? null,
      request_app_id: request?.workspace?.app_id ?? null,
      matched_session_file: foundSessionPath ? path.basename(foundSessionPath) : null,
    },
    session: foundSessionPath && existsSync(foundSessionPath) ? summarizeSession(readJson(foundSessionPath)) : null,
    request: null,
    replay: null,
    productRenderSource: null,
    fallbackReason: null,
    rootCauseClassification: null,
  };

  if (request) {
    if (request.schema_version === "hermes.cmo.request.v1" && !requestUserMessage(request)) {
      throw new Error(
        "Hermes CMO trace request is missing user_message/message/input.user_message/intent.user_message for a user turn.",
      );
    }

    output.request = summarizeHermesRequest(request);

    if (process.env.CMO_HERMES_BASE_URL && process.env.CMO_HERMES_API_KEY) {
      const replayEndpointPath = typeof traceRoot?.endpoint_path === "string" && traceRoot.endpoint_path.startsWith("/")
        ? traceRoot.endpoint_path
        : "/agents/cmo/execute";
      const response = await fetch(`${process.env.CMO_HERMES_BASE_URL.replace(/\/+$/, "")}${replayEndpointPath}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.CMO_HERMES_API_KEY}`,
        },
        body: JSON.stringify(request),
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = { parse_error: await response.text() };
      }
      output.replay = summarizeHermesResponse(payload, response.status);
    } else {
      output.replay = {
        skipped: "Set CMO_HERMES_BASE_URL and CMO_HERMES_API_KEY to replay this trace.",
      };
    }
  }

  const latestAssistant = output.session?.messages?.filter((message) => message.role === "assistant").at(-1);
  output.productRenderSource = output.session?.productRenderSource ?? latestAssistant?.productRenderSource ?? null;
  output.fallbackReason = output.session?.productFallbackReason ?? latestAssistant?.productFallbackReason ?? null;

  output.rootCauseClassification = rootCauseClassification({
    request: output.request,
    replay: output.replay,
    session: output.session,
  });

  console.log(JSON.stringify(output, null, 2));
};

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
