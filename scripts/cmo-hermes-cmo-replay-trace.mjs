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

const latestFile = (dir, predicate) => {
  if (!existsSync(dir)) return null;
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter(predicate)
    .map((filePath) => ({ filePath, mtimeMs: statSync(filePath).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath ?? null;
};

const sessionPath = () => {
  if (process.env.SESSION_JSON) return path.resolve(process.env.SESSION_JSON);
  if (process.env.SESSION_ID) return path.join(appChatDir, `${process.env.SESSION_ID}.json`);
  return latestFile(appChatDir, (filePath) => path.basename(filePath).startsWith("session_feeback_") && filePath.endsWith(".json"));
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
  extraction_status: source?.extraction_status,
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
        calledHermesCmo: message.calledHermesCmo,
        hermesCmoStatus: message.hermesCmoStatus,
        hermesCmoMetadata: message.hermesCmoMetadata
          ? {
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

const summarizeHermesRequest = (request) => ({
  request_id: request.request_id,
  session_id: request.session_id,
  turn_id: request.turn_id,
  workspace: request.workspace,
  user_message: request.intent?.user_message,
  context_pack_keys: Object.keys(request.context_pack ?? {}),
  active_source_id: request.context_pack?.active_source_id,
  artifacts_in: Array.isArray(request.context_pack?.artifacts_in)
    ? request.context_pack.artifacts_in.map((artifact) => ({
        type: artifact?.type,
        schema_version: artifact?.schema_version,
        workspace_id: artifact?.workspace_id,
        source_id: artifact?.source_id,
        source_title: artifact?.source_title,
        original_url: artifact?.original_url,
        extraction_status: artifact?.extraction_status,
        saved_to_vault: artifact?.saved_to_vault,
        truth_status: artifact?.truth_status,
      }))
    : [],
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
    safety_counters: root.safety_counters ?? response.safety_counters ?? response.safety?.counters,
    forbidden_counters: root.forbidden_counters ?? response.forbidden_counters,
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

const run = async () => {
  const foundSessionPath = sessionPath();
  const foundTracePath = tracePath();
  const output = {
    sessionPath: foundSessionPath,
    tracePath: foundTracePath,
    session: foundSessionPath && existsSync(foundSessionPath) ? summarizeSession(readJson(foundSessionPath)) : null,
    request: null,
    replay: null,
  };

  if (foundTracePath && existsSync(foundTracePath)) {
    const trace = readJson(foundTracePath);
    const request = trace.request ?? trace;
    output.request = summarizeHermesRequest(request);

    if (process.env.CMO_HERMES_BASE_URL && process.env.CMO_HERMES_API_KEY) {
      const response = await fetch(`${process.env.CMO_HERMES_BASE_URL.replace(/\/+$/, "")}/agents/cmo/execute`, {
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

  console.log(JSON.stringify(output, null, 2));
};

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
