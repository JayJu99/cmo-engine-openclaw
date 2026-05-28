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

function targetAgent(delegation: Record<string, unknown>): HermesCmoExecutableAgent | null {
  const target = isRecord(delegation.target) ? delegation.target : {};
  const value = text(target.agent ?? delegation.target_agent ?? delegation.agent).toLowerCase();

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

function delegationInput(delegation: Record<string, unknown>): Record<string, unknown> {
  return isRecord(delegation.input) ? delegation.input : {};
}

function normalizeDelegation(delegation: Record<string, unknown>, index: number): NormalizedDelegation | null {
  if (Array.isArray(delegation.delegations) && delegation.delegations.length > 0) {
    return null;
  }

  const agent = targetAgent(delegation);

  if (!agent) {
    return null;
  }

  const mode = targetMode(delegation, agent);

  if (!mode) {
    return null;
  }

  const input = delegationInput(delegation);
  const task = isRecord(delegation.task) ? delegation.task : {};
  const objective = text(delegation.objective ?? task.objective ?? input.brief, `Execute ${agent} delegation ${index + 1}`);
  const brief = text(input.brief, objective);
  const constraints = textList(input.constraints);

  return {
    raw: delegation,
    delegationId: text(delegation.delegation_id ?? delegation.id, `del_m1_${index + 1}`),
    targetAgent: agent,
    mode,
    objective,
    brief,
    constraints,
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
    task_type: "cmo_orchestrated_final_copy",
    objective: delegation.objective,
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
    task_type: "cmo_orchestrated_research_pack",
    objective: delegation.objective,
    input_material: [delegation.brief].filter(Boolean),
    allow_web_research: true,
    search_scope: delegation.objective,
    max_sources: 5,
    max_search_queries: 3,
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
    task_type: "cmo_orchestrated_x_signal_pack",
    topic: delegation.objective,
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
