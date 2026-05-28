import {
  executeHermesEcho,
  executeHermesSurf,
  type HermesEchoBrief,
  type HermesSurfBrief,
} from "./hermes-client";

export type HermesCmoExecutableAgent = "echo" | "surf";
export type HermesCmoExecutableMode = "echo.default" | "surf.default" | "surf.x" | "surf.trend" | "surf.pulse";

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
  agentsUsed: Array<"surf" | "echo">;
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

  return value === "echo" || value === "surf" ? value : null;
}

function targetMode(delegation: Record<string, unknown>, agent: HermesCmoExecutableAgent): HermesCmoExecutableMode | null {
  const target = isRecord(delegation.target) ? delegation.target : {};
  const rawMode = text(target.mode ?? delegation.mode);

  if (agent === "echo") {
    return rawMode === "echo.default" || !rawMode ? "echo.default" : null;
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
  const taskType = text(delegation.taskType ?? delegation.task_type ?? task.taskType ?? task.task_type ?? input.taskType ?? input.task_type, agent === "echo" ? "cmo_orchestrated_final_copy" : "cmo_orchestrated_research_pack");
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
  const brief = text(input.brief, objective);
  const constraints = [...textList(delegation.constraints), ...textList(input.constraints)];
  const outputContract = delegation.outputContract ?? delegation.output_contract ?? task.outputContract ?? task.output_contract ?? input.outputContract ?? input.output_contract;
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

function echoBrief(input: ExecutorInput, delegation: NormalizedDelegation, previousResults: HermesCmoDelegationExecution[]): HermesEchoBrief {
  const prior = previousResults.length
    ? `Prior delegation results for claim boundaries:\n${JSON.stringify(previousResults, null, 2)}`
    : "";

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
    brief: {
      angle: delegation.brief,
    },
    claim_boundaries: [delegation.brief, prior].filter(Boolean),
    output_contract: delegation.outputContract ?? "echo.response.v1",
    source_context: {
      raw_request: input.userMessage,
      origin: "cmo_engine_m1_hermes_cmo_orchestration",
      claim_constraints: [delegation.brief, prior].filter(Boolean),
    },
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
  return {
    handoff_id: delegation.delegationId,
    source_agent: "cmo",
    target_agent: "surf",
    mode: delegation.mode === "echo.default" ? "surf.default" : delegation.mode,
    workspace: cleanWorkspaceSlug(input.workspaceSlug),
    task_type: delegation.taskType,
    objective: delegation.objective,
    input: isRecord(delegation.raw.input) ? delegation.raw.input : undefined,
    input_material: [delegation.brief].filter(Boolean),
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
    source_context: {
      raw_request: input.userMessage,
      origin: "cmo_engine_m1_hermes_cmo_orchestration",
    },
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
): Promise<Pick<HermesCmoDelegationExecutionResult, "executions" | "activityEvents" | "surfCalls" | "echoCalls">> {
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
      mode: "echo.default",
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
        mode: "echo.default",
        status: execution.status,
      }),
    );

    return { executions: [execution], activityEvents, surfCalls: 0, echoCalls: 1 };
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

  return { executions: [execution], activityEvents, surfCalls: 1, echoCalls: 0 };
}

export function executableDelegations(delegations: Record<string, unknown>[], maxDelegations: number): NormalizedDelegation[] {
  return delegations
    .map(normalizeDelegation)
    .filter((delegation): delegation is NormalizedDelegation => Boolean(delegation))
    .sort((left, right) => {
      if (left.targetAgent === right.targetAgent) {
        return 0;
      }

      return left.targetAgent === "surf" ? -1 : 1;
    })
    .slice(0, Math.max(0, maxDelegations));
}

export async function executeHermesCmoDelegations(input: ExecutorInput): Promise<HermesCmoDelegationExecutionResult> {
  const normalized = executableDelegations(input.delegations, input.maxDelegations);
  const executions: HermesCmoDelegationExecution[] = [];
  const activityEvents: HermesCmoDelegationActivityEvent[] = [];
  let surfCalls = 0;
  let echoCalls = 0;

  for (const delegation of normalized) {
    const result = await executeOne(input, delegation, executions);
    executions.push(...result.executions);
    activityEvents.push(...result.activityEvents);
    surfCalls += result.surfCalls;
    echoCalls += result.echoCalls;
  }

  return {
    executions,
    activityEvents,
    surfCalls,
    echoCalls,
    agentsUsed: Array.from(new Set(executions.map((execution) => execution.targetAgent))),
    forbiddenCounters: {
      vaultAgentCalls: 0,
      vaultWrites: 0,
      openclawCalls: 0,
      directSupabaseMutations: 0,
    },
  };
}
