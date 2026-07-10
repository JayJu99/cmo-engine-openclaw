import {
  executeHermesEcho,
  executeHermesSurf,
  type HermesEchoBrief,
  type HermesSurfBrief,
} from "./hermes-client";
import {
  runLensMeasurementRequest,
} from "./lens-measurement-runner";
import type { LensMeasurementResult } from "./lens-measurement-result";

export type HermesCmoExecutableAgent = "echo" | "surf" | "lens";
export type HermesCmoExecutableMode = "echo.default" | "echo.source_translate" | "surf.default" | "surf.x" | "surf.trend" | "surf.pulse" | "lens.measurement";

export interface HermesCmoForbiddenCounters {
  vaultAgentCalls: number;
  vaultWrites: number;
  openclawCalls: number;
  directSupabaseMutations: number;
}

export interface HermesCmoDelegationExecution {
  delegationKey: string;
  delegationId: string;
  targetAgent: HermesCmoExecutableAgent;
  mode: HermesCmoExecutableMode;
  objective: string;
  status: "completed" | "failed" | "skipped";
  summary: string;
  response?: unknown;
  failureReason?: string;
}

export interface HermesCmoDelegationActivityEvent {
  schema_version: "hermes.activity.event.v1";
  event_id: string;
  request_id: string;
  session_id: string;
  turn_id: string;
  seq: number;
  created_at: string;
  source: {
    agent: HermesCmoExecutableAgent;
    mode: HermesCmoExecutableMode;
  };
  type: "delegation.started" | "delegation.completed";
  status: "running" | "completed" | "failed";
  user_visible: true;
  message: string;
  data: Record<string, unknown>;
}

export interface HermesCmoDelegationExecutionResult {
  executions: HermesCmoDelegationExecution[];
  activityEvents: HermesCmoDelegationActivityEvent[];
  surfCalls: number;
  echoCalls: number;
  lensCalls: number;
  agentsUsed: Array<"surf" | "echo" | "lens">;
  forbiddenCounters: HermesCmoForbiddenCounters;
}

interface NormalizedDelegation {
  raw: Record<string, unknown>;
  delegationId: string;
  targetAgent: HermesCmoExecutableAgent;
  mode: HermesCmoExecutableMode;
  taskType: string;
  surface?: string;
  entity?: string;
  query?: string;
  searchQuery?: string;
  topic?: string;
  topics: string[];
  outputContract?: unknown;
  platform?: string;
  contentCount?: number;
  audience?: string;
  input?: unknown;
  inputMaterial?: unknown;
  sourceMaterial?: unknown;
  context?: unknown;
  claimBoundaries: string[];
  retryOf?: string;
  retryReason?: string;
  objective: string;
  brief: string;
  constraints: string[];
}

interface ExecutorInput {
  parentRequestId: string;
  sessionId: string;
  turnId: string;
  workspaceSlug: string;
  tenantId?: string;
  workspaceId?: string;
  appId?: string;
  appName?: string;
  userMessage: string;
  delegations: Record<string, unknown>[];
  maxDelegations: number;
}

const SURF_MODES = new Set(["surf.default", "surf.x", "surf.trend", "surf.pulse"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

function textByKey(value: unknown, keys: Set<string>, depth = 4): string | undefined {
  if (depth < 0 || value === null || value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = textByKey(item, keys, depth - 1);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (keys.has(key) && typeof nestedValue === "string" && nestedValue.trim()) {
      return nestedValue.trim();
    }
  }

  for (const nestedValue of Object.values(value)) {
    const found = textByKey(nestedValue, keys, depth - 1);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function positiveInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return undefined;
}

function targetAgent(delegation: Record<string, unknown>): HermesCmoExecutableAgent | null {
  const target = isRecord(delegation.target) ? delegation.target : {};
  const value = text(target.agent ?? delegation.targetAgent ?? delegation.target_agent ?? delegation.agent).toLowerCase();

  return value === "echo" || value === "surf" || value === "lens" ? value : null;
}

function targetMode(delegation: Record<string, unknown>, agent: HermesCmoExecutableAgent): HermesCmoExecutableMode | null {
  const target = isRecord(delegation.target) ? delegation.target : {};
  const rawMode = text(target.mode ?? delegation.mode);

  if (agent === "echo") {
    return rawMode === "echo.default" || !rawMode
      ? "echo.default"
      : rawMode === "source_translate" || rawMode === "echo.source_translate"
        ? "echo.source_translate"
        : null;
  }

  if (agent === "lens") {
    return rawMode === "lens.measurement" || rawMode === "lens.default" || rawMode === "measurement" || !rawMode
      ? "lens.measurement"
      : null;
  }

  if (SURF_MODES.has(rawMode)) {
    return rawMode as HermesCmoExecutableMode;
  }

  return rawMode === "x_search" || rawMode === "surf_x"
    ? "surf.x"
    : rawMode === "last30days" || rawMode === "trend"
      ? "surf.trend"
      : rawMode === "pulse"
        ? "surf.pulse"
        : rawMode
          ? null
          : "surf.default";
}

function explicitXResearch(value: string): boolean {
  const textValue = value.toLowerCase();
  const hasXResearchSignal =
    /\b(x|twitter)\s+(research|search|signal|signals|listening|sentiment|scan|evidence)\b/.test(textValue) ||
    /\b(research|search|scan|analyze|analyse|monitor)\s+(x|twitter)\b/.test(textValue) ||
    /\bsocial\s+(signal|signals|listening|sentiment|research|scan)\b/.test(textValue);

  return hasXResearchSignal;
}

function safeSurfMode(mode: HermesCmoExecutableMode, delegation: Omit<NormalizedDelegation, "mode">): HermesCmoExecutableMode {
  const textValue = `${delegation.taskType}\n${delegation.surface ?? ""}\n${delegation.objective}\n${delegation.brief}\n${delegation.query ?? ""}\n${delegation.searchQuery ?? ""}\n${delegation.topic ?? ""}\n${delegation.topics.join("\n")}`;
  const structuredXIntent =
    delegation.surface?.toLowerCase() === "x" ||
    /^(latest_post_lookup|x_signal_scan|x_search|social_signal_scan)$/i.test(delegation.taskType);

  if (mode === "surf.x" && !structuredXIntent && !explicitXResearch(textValue)) {
    return /pulse|snapshot|quick scan|quick pulse/i.test(textValue) ? "surf.pulse" : "surf.default";
  }

  return mode;
}

function delegationInput(delegation: Record<string, unknown>): Record<string, unknown> {
  return isRecord(delegation.input) ? delegation.input : {};
}

function rawOutputContractSourceMaterial(outputContract: unknown): unknown {
  if (!isRecord(outputContract)) {
    return undefined;
  }

  return firstDefined(outputContract.translation_source_material, outputContract.translationSourceMaterial, outputContract.source_material, outputContract.sourceMaterial);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function explicitDelegationId(delegation: Record<string, unknown>): string | undefined {
  return firstText(delegation.delegation_id, delegation.delegationId, delegation.handoff_id, delegation.handoffId, delegation.id);
}

export function stableDelegationKey(delegation: Record<string, unknown>): string {
  const target = isRecord(delegation.target) ? delegation.target : {};
  const task = isRecord(delegation.task) ? delegation.task : {};
  const input = delegationInput(delegation);
  const agent = text(target.agent ?? delegation.targetAgent ?? delegation.target_agent ?? delegation.agent).toLowerCase();
  const mode = text(target.mode ?? delegation.mode).toLowerCase();
  const id = explicitDelegationId(delegation);

  if (id) {
    return `${agent || "agent"}:${mode || "mode"}:${id}`;
  }

  return stableJson({
    targetAgent: agent,
    mode,
    taskType: delegation.taskType ?? delegation.task_type ?? task.taskType ?? task.task_type ?? input.taskType ?? input.task_type,
    objective: delegation.objective ?? task.objective ?? input.objective,
    query: delegation.query ?? task.query ?? input.query,
    searchQuery: delegation.searchQuery ?? delegation.search_query ?? task.searchQuery ?? task.search_query ?? input.searchQuery ?? input.search_query,
    topic: delegation.topic ?? task.topic ?? input.topic,
    topics: delegation.topics ?? task.topics ?? input.topics,
    input,
  });
}

function normalizeDelegation(delegation: Record<string, unknown>, index: number): NormalizedDelegation | null {
  if (Array.isArray(delegation.delegations) && delegation.delegations.length > 0) {
    return null;
  }

  const agent = targetAgent(delegation);

  if (!agent) {
    return null;
  }

  const rawMode = targetMode(delegation, agent);

  if (!rawMode) {
    return null;
  }

  const input = delegationInput(delegation);
  const task = isRecord(delegation.task) ? delegation.task : {};
  const taskType = text(
    delegation.taskType ?? delegation.task_type ?? task.taskType ?? task.task_type ?? input.taskType ?? input.task_type,
    agent === "echo"
      ? "cmo_orchestrated_final_copy"
      : agent === "lens"
        ? "cmo_orchestrated_measurement"
        : "cmo_orchestrated_research_pack",
  );
  const surface = firstText(delegation.surface, task.surface, input.surface);
  const entity = firstText(delegation.entity, task.entity, input.entity);
  const query = firstText(delegation.query, task.query, input.query);
  const searchQuery = firstText(delegation.searchQuery, delegation.search_query, task.searchQuery, task.search_query, input.searchQuery, input.search_query);
  const topic = firstText(delegation.topic, task.topic, input.topic);
  const topics = [
    ...textList(delegation.topics),
    ...textList(task.topics),
    ...textList(input.topics),
  ];
  const platform = firstText(delegation.platform, task.platform, input.platform, surface);
  const contentCount = positiveInteger(delegation.content_count, delegation.contentCount, task.content_count, task.contentCount, input.content_count, input.contentCount);
  const audience = firstText(delegation.audience, task.audience, input.audience);
  const retryOf = firstText(delegation.retry_of, delegation.retryOf, task.retry_of, task.retryOf, input.retry_of, input.retryOf);
  const retryReason = firstText(delegation.retry_reason, delegation.retryReason, task.retry_reason, task.retryReason, input.retry_reason, input.retryReason);
  const objective = text(delegation.objective ?? task.objective ?? input.objective ?? input.brief ?? query ?? searchQuery ?? topic, `Execute ${agent} delegation ${index + 1}`);
  const briefRecord = isRecord(input.brief) ? input.brief : {};
  const brief = firstText(input.brief, briefRecord.angle) ?? objective;
  const constraints = [...textList(delegation.constraints), ...textList(task.constraints), ...textList(input.constraints)];
  const outputContract = delegation.outputContract ?? delegation.output_contract ?? task.outputContract ?? task.output_contract ?? input.outputContract ?? input.output_contract;
  const inputMaterial = firstDefined(delegation.input_material, delegation.inputMaterial, task.input_material, task.inputMaterial, input.input_material, input.inputMaterial);
  const sourceMaterial = firstDefined(
    delegation.source_material,
    delegation.sourceMaterial,
    task.source_material,
    task.sourceMaterial,
    input.source_material,
    input.sourceMaterial,
    rawOutputContractSourceMaterial(outputContract),
  );
  const context = firstDefined(delegation.context, task.context, input.context);
  const claimBoundaries = [
    ...textList(delegation.claim_boundaries),
    ...textList(delegation.claimBoundaries),
    ...textList(task.claim_boundaries),
    ...textList(task.claimBoundaries),
    ...textList(input.claim_boundaries),
    ...textList(input.claimBoundaries),
  ];
  const normalizedWithoutMode: Omit<NormalizedDelegation, "mode"> = {
    raw: delegation,
    delegationId: text(delegation.delegation_id ?? delegation.delegationId ?? delegation.handoff_id ?? delegation.handoffId ?? delegation.id, `del_m1_${index + 1}`),
    targetAgent: agent,
    taskType,
    surface,
    entity,
    query,
    searchQuery,
    topic,
    topics,
    outputContract,
    platform,
    contentCount,
    audience,
    input: delegation.input,
    inputMaterial,
    sourceMaterial,
    context,
    claimBoundaries,
    retryOf,
    retryReason,
    objective,
    brief,
    constraints,
  };
  const mode = agent === "surf" ? safeSurfMode(rawMode, normalizedWithoutMode) : rawMode;

  return {
    ...normalizedWithoutMode,
    mode,
  };
}

function lensRangeKey(delegation: NormalizedDelegation): string {
  const input = isRecord(delegation.input) ? delegation.input : {};
  const context = isRecord(delegation.context) ? delegation.context : {};
  const value = firstText(
    input.range_key,
    input.rangeKey,
    context.range_key,
    context.rangeKey,
    delegation.raw.range_key,
    delegation.raw.rangeKey,
  );

  return value || "this_week";
}

function lensArtifact(result: LensMeasurementResult): Record<string, unknown> {
  const status = result.status === "completed" ? "completed" : result.status === "failed" ? "failed" : "unavailable";
  const pack = result.status === "completed" ? result.metrics_pack : undefined;
  const caveats = [
    ...(result.missing_requirements ?? []).map((requirement) => requirement.safe_user_message),
    ...(result.error?.safe_message ? [result.error.safe_message] : []),
    ...(result.safe_user_message ? [result.safe_user_message] : []),
  ].filter((value, index, values) => Boolean(value) && values.indexOf(value) === index).slice(0, 12);

  return {
    contract: "lens.measurement_result.v1",
    status,
    source_status: result.status,
    scope: result.scope,
    ...(pack
      ? {
          metric_pack_id: `lens_metrics_${pack.appId}_${pack.range.key}_${pack.generatedAt}`,
          measurement_window: pack.range,
          safe_metadata: {
            metrics_pack_contract: pack.contract,
            quality_status: pack.quality.status,
            is_stale: pack.quality.isStale,
            metric_count: pack.metrics.length,
          },
        }
      : {
          measurement_window: { key: result.scope.range_key },
          safe_metadata: {},
        }),
    baseline: null,
    target: null,
    caveats,
  };
}

function cleanWorkspaceSlug(value: string): string {
  return value.trim() || "holdstation-mini-app";
}

function baseConstraints(delegation: NormalizedDelegation): string[] {
  return [
    ...delegation.constraints,
    "CMO Engine M1 mechanical execution only.",
    "Do not write Vault, mutate memory, mutate Supabase, call OpenClaw, publish, or run arbitrary tools.",
    "Do not perform nested delegation.",
  ];
}

function inputMaterialList(delegation: NormalizedDelegation): unknown {
  return delegation.inputMaterial ?? [delegation.brief].filter(Boolean);
}

function activeSourceUrl(delegation: NormalizedDelegation): string | undefined {
  const urlKeys = new Set([
    "active_source_url",
    "activeSourceUrl",
    "original_url",
    "originalUrl",
    "canonical_url",
    "canonicalUrl",
    "url",
  ]);

  return textByKey(delegation.context, urlKeys) ??
    textByKey(delegation.sourceMaterial, urlKeys) ??
    textByKey(delegation.inputMaterial, urlKeys) ??
    textByKey(delegation.raw, urlKeys);
}

function echoBrief(input: ExecutorInput, delegation: NormalizedDelegation, previousResults: HermesCmoDelegationExecution[]): HermesEchoBrief {
  const prior = previousResults.length
    ? `Prior delegation results for claim boundaries:\n${JSON.stringify(previousResults, null, 2)}`
    : "";
  const claimBoundaries = [...delegation.claimBoundaries, delegation.brief, prior].filter(Boolean);

  return {
    handoff_id: delegation.delegationId,
    source_agent: "cmo",
    target_agent: "echo",
    mode: "echo.default",
    workspace: cleanWorkspaceSlug(input.workspaceSlug),
    task_type: delegation.taskType,
    objective: delegation.objective,
    platform: delegation.platform ?? (delegation.surface === "x" || /\b(x|twitter)\b/i.test(`${delegation.objective}\n${delegation.brief}\n${input.userMessage}`) ? "x" : undefined),
    content_count: delegation.contentCount,
    audience: delegation.audience,
    input: delegation.input,
    input_material: delegation.inputMaterial,
    source_material: delegation.sourceMaterial,
    context: delegation.context,
    brief: {
      angle: delegation.brief,
    },
    claim_boundaries: claimBoundaries,
    output_contract: delegation.outputContract ?? "echo.response.v1",
    source_context: {
      raw_request: input.userMessage,
      origin: "cmo_engine_m1_hermes_cmo_orchestration",
      claim_constraints: claimBoundaries,
      input_material: delegation.inputMaterial,
      source_material: delegation.sourceMaterial,
      delegation_context: delegation.context,
    },
    delegation: delegation.raw,
    raw_delegation: delegation.raw,
    tone: "short, sharp, operator-minded, strategic",
    constraints: [
      ...baseConstraints(delegation),
      "Echo owns final copy only.",
      "Do not decide strategy.",
      "Do not research.",
      "Do not invent unsupported claims.",
    ],
    return_to: "cmo_engine",
    max_turns: 1,
  };
}

function defaultSurfBrief(input: ExecutorInput, delegation: NormalizedDelegation, overrides: Partial<HermesSurfBrief> = {}): HermesSurfBrief {
  const surfMode = delegation.mode === "surf.x" || delegation.mode === "surf.trend" || delegation.mode === "surf.pulse"
    ? delegation.mode
    : "surf.default";
  const sourceUrl = activeSourceUrl(delegation);
  const expectedOutputFormat = delegation.outputContract ?? {
    desired_format: "bounded research evidence pack with sources, confidence, evidence gaps, and recommended next checks",
  };

  return {
    handoff_id: delegation.delegationId,
    source_agent: "cmo",
    target_agent: "surf",
    mode: surfMode,
    workspace: cleanWorkspaceSlug(input.workspaceSlug),
    workspace_id: input.workspaceId ?? input.workspaceSlug,
    app_id: input.appId ?? input.workspaceSlug,
    app_name: input.appName,
    task_type: delegation.taskType,
    objective: delegation.objective,
    research_objective: delegation.objective,
    user_question: input.userMessage,
    active_source_url: sourceUrl,
    input: isRecord(delegation.raw.input) ? delegation.raw.input : undefined,
    input_material: inputMaterialList(delegation),
    source_material: delegation.sourceMaterial,
    context: delegation.context,
    allow_web_research: true,
    search_scope: delegation.objective,
    max_sources: 5,
    max_search_queries: 3,
    surface: delegation.surface,
    entity: delegation.entity,
    query: delegation.query,
    search_query: delegation.searchQuery,
    topic: delegation.topic,
    topics: delegation.topics.length > 0 ? delegation.topics : undefined,
    output_contract: delegation.outputContract,
    expected_output_format: expectedOutputFormat,
    safety_constraints: {
      read_only: true,
      no_vault_write: true,
      no_source_auto_save: true,
      no_knowledge_promotion: true,
      no_gbrain_mutation: true,
      no_supabase_mutation: true,
      no_session_mutation: true,
    },
    source_context: {
      raw_request: input.userMessage,
      origin: "cmo_engine_m1_hermes_cmo_orchestration",
      workspace_id: input.workspaceId ?? input.workspaceSlug,
      app_id: input.appId ?? input.workspaceSlug,
      app_name: input.appName,
      active_source_url: sourceUrl,
      user_question: input.userMessage,
      research_objective: delegation.objective,
      input_material: delegation.inputMaterial,
      source_material: delegation.sourceMaterial,
      delegation_context: delegation.context,
    },
    delegation: delegation.raw,
    raw_delegation: delegation.raw,
    constraints: [
      ...baseConstraints(delegation),
      "Surf owns evidence and signals only.",
      "Do not make the final strategic decision.",
      "Separate verified facts, weak signals, assumptions, and unknowns.",
    ],
    return_to: "cmo_engine",
    max_turns: 1,
    ...overrides,
  };
}

function surfXBrief(input: ExecutorInput, delegation: NormalizedDelegation): HermesSurfBrief {
  return defaultSurfBrief(input, delegation, {
    mode: "surf.x",
    task_type: delegation.taskType,
    surface: delegation.surface,
    entity: delegation.entity,
    query: delegation.query,
    search_query: delegation.searchQuery,
    topic: delegation.topic ?? delegation.query ?? delegation.searchQuery ?? delegation.objective,
    topics: delegation.topics.length > 0 ? delegation.topics : undefined,
    output_contract: delegation.outputContract,
    research_mode: "x_search",
    timeframe: "recent",
    max_results: 5,
    constraints: [
      ...baseConstraints(delegation),
      "Read-only X search.",
      "Treat X posts as weak social signal, not verified fact.",
      "Do not make the final strategic decision.",
    ],
  });
}

function trendBrief(input: ExecutorInput, delegation: NormalizedDelegation): HermesSurfBrief {
  return defaultSurfBrief(input, delegation, {
    mode: "surf.trend",
    task_type: "cmo_orchestrated_trend_signal_pack",
    topic: delegation.objective,
    research_mode: "last30days",
    timeframe: "last 30 days",
    max_results: 5,
    allowed_sources: ["reddit", "hackernews", "polymarket"],
    constraints: [
      ...baseConstraints(delegation),
      "Use only bounded last-30-days safe-mode sources.",
      "Treat trend outputs as weak signals until verified.",
      "Do not make the final strategic decision.",
    ],
  });
}

function pulseBrief(input: ExecutorInput, delegation: NormalizedDelegation): HermesSurfBrief {
  return defaultSurfBrief(input, delegation, {
    task_type: "cmo_orchestrated_lightweight_pulse_pack",
    max_sources: 3,
    max_search_queries: 1,
    timeframe: "recent bounded scan",
    constraints: [
      ...baseConstraints(delegation),
      "surf.pulse M1 lightweight mode: use bounded source caps only.",
      "Do not run risky composite fan-out.",
      "Do not use browser cookies.",
      "Return a compact signal pack with gaps and claim boundaries.",
    ],
  });
}

function event(
  input: ExecutorInput,
  delegation: NormalizedDelegation,
  type: "delegation.started" | "delegation.completed",
  status: "running" | "completed" | "failed",
  message: string,
  data: Record<string, unknown>,
): HermesCmoDelegationActivityEvent {
  return {
    schema_version: "hermes.activity.event.v1",
    event_id: `evt_${delegation.delegationId}_${type.replace(/[^a-z0-9]+/gi, "_")}`,
    request_id: input.parentRequestId,
    session_id: input.sessionId,
    turn_id: input.turnId,
    seq: 1,
    created_at: new Date().toISOString(),
    source: {
      agent: delegation.targetAgent,
      mode: delegation.mode,
    },
    type,
    status,
    user_visible: true,
    message,
    data,
  };
}

async function executeOne(
  input: ExecutorInput,
  delegation: NormalizedDelegation,
  previousResults: HermesCmoDelegationExecution[],
): Promise<Pick<HermesCmoDelegationExecutionResult, "executions" | "activityEvents" | "surfCalls" | "echoCalls" | "lensCalls">> {
  const activityEvents = [
    event(input, delegation, "delegation.started", "running", `CMO Engine started ${delegation.mode} delegation.`, {
      delegation_id: delegation.delegationId,
      target_agent: delegation.targetAgent,
      mode: delegation.mode,
    }),
  ];

  if (delegation.targetAgent === "echo") {
    const result = await executeHermesEcho(echoBrief(input, delegation, previousResults));
    const execution: HermesCmoDelegationExecution = {
      delegationKey: stableDelegationKey(delegation.raw),
      delegationId: delegation.delegationId,
      targetAgent: "echo",
      mode: delegation.mode,
      objective: delegation.objective,
      status: result.ok && result.response ? "completed" : "failed",
      summary: result.ok && result.response ? `Echo returned ${result.response.outputs.length} output(s).` : result.failureReason ?? "Echo failed.",
      response: result.response,
      failureReason: result.ok ? undefined : result.failureReason,
    };
    activityEvents.push(
      event(input, delegation, "delegation.completed", execution.status === "completed" ? "completed" : "failed", execution.summary, {
        delegation_id: delegation.delegationId,
        target_agent: "echo",
        mode: delegation.mode,
        status: execution.status,
      }),
    );

    return { executions: [execution], activityEvents, surfCalls: 0, echoCalls: 1, lensCalls: 0 };
  }

  if (delegation.targetAgent === "lens") {
    const result = await runLensMeasurementRequest({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId ?? input.workspaceSlug,
      appId: input.appId ?? input.workspaceSlug,
      rangeKey: lensRangeKey(delegation),
      metricIntent: delegation.objective,
      requestId: input.parentRequestId,
    });
    const artifact = lensArtifact(result);
    const execution: HermesCmoDelegationExecution = {
      delegationKey: stableDelegationKey(delegation.raw),
      delegationId: delegation.delegationId,
      targetAgent: "lens",
      mode: "lens.measurement",
      objective: delegation.objective,
      status: result.status === "failed" ? "failed" : "completed",
      summary: result.status === "completed"
        ? "Lens returned a safe measurement artifact."
        : result.status === "failed"
          ? "Lens measurement failed; no metrics were invented."
          : "Lens measurement is unavailable for this scope.",
      response: artifact,
      failureReason: result.status === "failed" ? result.safe_user_message : undefined,
    };
    activityEvents.push(
      event(input, delegation, "delegation.completed", execution.status === "completed" ? "completed" : "failed", execution.summary, {
        delegation_id: delegation.delegationId,
        target_agent: "lens",
        mode: "lens.measurement",
        status: artifact.status,
        artifact_contract: artifact.contract,
      }),
    );

    return { executions: [execution], activityEvents, surfCalls: 0, echoCalls: 0, lensCalls: 1 };
  }

  const result =
    delegation.mode === "surf.x"
      ? await executeHermesSurf(surfXBrief(input, delegation))
      : delegation.mode === "surf.trend"
        ? await executeHermesSurf(trendBrief(input, delegation))
        : delegation.mode === "surf.pulse"
          ? await executeHermesSurf(pulseBrief(input, delegation))
          : await executeHermesSurf(defaultSurfBrief(input, delegation));
  const execution: HermesCmoDelegationExecution = {
    delegationKey: stableDelegationKey(delegation.raw),
    delegationId: delegation.delegationId,
    targetAgent: "surf",
    mode: delegation.mode,
    objective: delegation.objective,
    status: result.ok && result.response ? "completed" : "failed",
    summary: result.ok && result.response ? result.response.summary ?? `${delegation.mode} returned evidence.` : result.failureReason ?? `${delegation.mode} failed.`,
    response: result.response,
    failureReason: result.ok ? undefined : result.failureReason,
  };
  activityEvents.push(
    event(input, delegation, "delegation.completed", execution.status === "completed" ? "completed" : "failed", execution.summary, {
      delegation_id: delegation.delegationId,
      target_agent: "surf",
      mode: delegation.mode,
      status: execution.status,
    }),
  );

  return { executions: [execution], activityEvents, surfCalls: 1, echoCalls: 0, lensCalls: 0 };
}

export function executableDelegations(delegations: Record<string, unknown>[], maxDelegations: number): NormalizedDelegation[] {
  return delegations
    .map(normalizeDelegation)
    .filter((delegation): delegation is NormalizedDelegation => Boolean(delegation))
    .sort((left, right) => {
      if (left.targetAgent === right.targetAgent) {
        return 0;
      }

       const order: Record<HermesCmoExecutableAgent, number> = { lens: 0, surf: 1, echo: 2 };

       return order[left.targetAgent] - order[right.targetAgent];
    })
    .slice(0, Math.max(0, maxDelegations));
}

export async function executeHermesCmoDelegations(input: ExecutorInput): Promise<HermesCmoDelegationExecutionResult> {
  const normalized = executableDelegations(input.delegations, input.maxDelegations);
  const executions: HermesCmoDelegationExecution[] = [];
  const activityEvents: HermesCmoDelegationActivityEvent[] = [];
  let surfCalls = 0;
  let echoCalls = 0;
  let lensCalls = 0;

  for (const delegation of normalized) {
    const result = await executeOne(input, delegation, executions);
    executions.push(...result.executions);
    activityEvents.push(...result.activityEvents);
    surfCalls += result.surfCalls;
    echoCalls += result.echoCalls;
    lensCalls += result.lensCalls;
  }

  return {
    executions,
    activityEvents,
    surfCalls,
    echoCalls,
    lensCalls,
    agentsUsed: Array.from(new Set(executions.map((execution) => execution.targetAgent))),
    forbiddenCounters: {
      vaultAgentCalls: 0,
      vaultWrites: 0,
      openclawCalls: 0,
      directSupabaseMutations: 0,
    },
  };
}
