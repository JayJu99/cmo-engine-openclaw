// H3 is dry-run contract harness only, not used by live runtime.

import type {
  H3Assumption,
  H3IntakeCase,
  H3IntakeClassification,
  H3SimulationMarker,
  HermesAllowedAgent,
  HermesCmoRequest,
  HermesDelegationMode,
  HermesDelegationPlan,
  HermesSurfMode,
} from "./types";

const SIMULATION_MARKER: H3SimulationMarker = {
  dry_run_only: true,
  live_call_performed: false,
  no_vault_write: true,
  no_runtime_mutation: true,
  note: "Simulated delegation plan only. No Echo, Surf, Vault Agent, OpenClaw, Supabase, session, raw capture, UI, or Kanban runtime is called.",
};

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const hasAny = (value: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(value));

const countProvidedContextItems = (request: HermesCmoRequest) => {
  const contextPack = request.context_pack;

  return (
    contextPack.current_priority.length +
    contextPack.selected_context.length +
    contextPack.indexed_context_supplement.length +
    contextPack.artifacts_in.length +
    (contextPack.recent_session_summary ? 1 : 0)
  );
};

const allowedAgent = (request: HermesCmoRequest, agent: HermesAllowedAgent) =>
  request.constraints.allowed_agents.includes(agent);

const chooseSurfMode = (request: HermesCmoRequest, message: string): HermesSurfMode => {
  const preferredMode = hasAny(message, [/\bpulse\b/])
    ? "surf.pulse"
    : hasAny(message, [/\btrend\b/, /\btrending\b/])
      ? "surf.trend"
      : hasAny(message, [/\bx\b/, /\btwitter\b/, /\bsocial\b/, /\bsignal/])
        ? "surf.x"
        : "surf.default";

  if (request.constraints.allowed_surf_modes.includes(preferredMode)) {
    return preferredMode;
  }

  return request.constraints.allowed_surf_modes[0] ?? "surf.default";
};

const makeDelegation = (
  request: HermesCmoRequest,
  agent: HermesAllowedAgent,
  mode: HermesDelegationMode,
  index: number,
  objective: string,
  brief: string,
  requiredSections: string[],
): HermesDelegationPlan => ({
  schema_version: "hermes.delegation.request.v1",
  delegation_id: `del_${request.request_id}_${agent}_${String(index).padStart(3, "0")}`,
  parent_request_id: request.request_id,
  parent_session_id: request.session_id,
  target: {
    agent,
    mode,
  },
  objective,
  input: {
    brief,
    context: [
      {
        workspace: request.workspace,
        context_pack: request.context_pack,
      },
    ],
    constraints: [
      "dry-run only",
      "do not call live agent runtime",
      "do not mutate Vault, Supabase, sessions, raw captures, UI state, or Kanban",
    ],
  },
  expected_output: {
    format: "structured_json",
    required_sections: requiredSections,
  },
  simulation: SIMULATION_MARKER,
});

const buildDelegationPlan = (
  request: HermesCmoRequest,
  caseId: H3IntakeCase,
  message: string,
): HermesDelegationPlan[] => {
  const plan: HermesDelegationPlan[] = [];

  const addSurf = () => {
    if (!allowedAgent(request, "surf")) {
      return;
    }

    plan.push(
      makeDelegation(
        request,
        "surf",
        chooseSurfMode(request, message),
        plan.length + 1,
        "Collect bounded evidence and claim boundaries for CMO synthesis.",
        "H3 simulates the Surf request that a future CMO Agent would create. No Surf call is performed.",
        ["verified_facts", "weak_signals", "assumptions", "unknowns", "claim_boundaries"],
      ),
    );
  };

  const addEcho = () => {
    if (!allowedAgent(request, "echo")) {
      return;
    }

    plan.push(
      makeDelegation(
        request,
        "echo",
        "echo.default",
        plan.length + 1,
        "Create bounded final-copy artifacts from the approved CMO brief.",
        "H3 simulates the Echo request that a future CMO Agent would create. Echo must not invent claims.",
        ["artifacts", "claims_used", "claims_avoided"],
      ),
    );
  };

  const addVaultAgent = () => {
    if (!allowedAgent(request, "vault_agent") || !request.constraints.vault_agent_delegation_allowed) {
      return;
    }

    plan.push(
      makeDelegation(
        request,
        "vault_agent",
        "vault.write",
        plan.length + 1,
        "Prepare a Vault Agent write request only because explicit save intent exists.",
        "H3 simulates the Vault Agent request. No Vault file write is performed.",
        ["write_confirmed", "vault_location", "summary"],
      ),
    );
  };

  if (caseId === "needs_surf" || caseId === "needs_surf_then_echo" || caseId === "mixed_workflow") {
    addSurf();
  }

  if (caseId === "needs_echo" || caseId === "needs_surf_then_echo" || caseId === "mixed_workflow") {
    addEcho();
  }

  if (caseId === "needs_vault_agent" || caseId === "mixed_workflow") {
    addVaultAgent();
  }

  return plan;
};

const makeAssumptions = (caseId: H3IntakeCase): H3Assumption[] => {
  if (caseId !== "assumption_based_strategy") {
    return [];
  }

  return [
    {
      assumption: "The user wants a demo-readiness recommendation rather than a scale or production-readiness decision.",
      reason: "The request provides a plan but states that recent campaign metrics are missing.",
      impact:
        "The mock response prioritizes visible feedback loops and a small activation proof instead of metric-backed scaling.",
    },
  ];
};

const classifyCase = (request: HermesCmoRequest): H3IntakeCase => {
  const message = normalizeText(request.intent.user_message);
  const explicitCommand = normalizeText(request.intent.explicit_command ?? "");
  const contextItemCount = countProvidedContextItems(request);

  const hasResearchNeed = hasAny(message, [
    /\bcheck\b/,
    /\bresearch\b/,
    /\bevidence\b/,
    /\bsource\b/,
    /\bcurrent\b/,
    /\brecent\b/,
    /\bwhat people\b/,
    /\bsocial\b/,
    /\bsignal/,
    /\btrend/,
    /\bpulse\b/,
    /\bexternal\b/,
    /\bvalidate\b/,
  ]);
  const hasEchoNeed =
    hasAny(message, [
      /\bdraft\b/,
      /\bcopy\b/,
      /\bcontent variant/,
      /\bx posts?\b/,
      /\bpost drafts?\b/,
      /\bpolish\b/,
      /\bturn\b.*\binto\b/,
      /\bfinal copy\b/,
    ]) || (/\bwrite\b/.test(message) && !/\bwrite\b.*\bvault\b/.test(message));
  const hasSaveIntent =
    explicitCommand === "save" ||
    hasAny(message, [/\bsave\b/, /\bsave this\b/, /\bvault\b/, /\bluu\b/, /\bghi vao\b/]);
  const hasStrategyNeed = hasAny(message, [
    /\bstrategy\b/,
    /\bstrategic\b/,
    /\breview\b/,
    /\brecommend\b/,
    /\bdecide\b/,
    /\bdecision\b/,
    /\bpositioning\b/,
    /\bplan\b/,
    /\bangle\b/,
    /\bdiagnose\b/,
  ]);
  const hasReviewLens = hasAny(message, [
    /\bdemo\b/,
    /\breadiness\b/,
    /\bstrategy\b/,
    /\bexecution\b/,
    /\brisk\b/,
    /\bcontent\b/,
    /\bactivation\b/,
    /\bpositioning\b/,
    /\bgrowth\b/,
  ]);
  const saysMetricsAreMissing = hasAny(message, [
    /\bmissing\b.*\bmetrics\b/,
    /\bwithout\b.*\bmetrics\b/,
    /\bno\b.*\bmetrics\b/,
    /\bdo not have\b.*\bmetrics\b/,
    /\black\b.*\bmetrics\b/,
    /\bmetrics\b.*\bmissing\b/,
    /\bassume\b/,
  ]);
  const broadReviewWithoutContext =
    hasAny(message, [/\breview\b.*\bplan\b/, /\breview this\b/, /\breview plan\b/]) &&
    !hasReviewLens &&
    contextItemCount === 0 &&
    !hasResearchNeed &&
    !hasEchoNeed &&
    !hasSaveIntent;

  if (hasSaveIntent && hasResearchNeed && hasEchoNeed && hasStrategyNeed) {
    return "mixed_workflow";
  }

  if (hasResearchNeed && hasEchoNeed) {
    return "needs_surf_then_echo";
  }

  if (hasSaveIntent && !hasResearchNeed && !hasEchoNeed) {
    return "needs_vault_agent";
  }

  if (broadReviewWithoutContext) {
    return "needs_clarification";
  }

  if (saysMetricsAreMissing && contextItemCount > 0 && !hasResearchNeed && !hasEchoNeed && !hasSaveIntent) {
    return "assumption_based_strategy";
  }

  if (hasResearchNeed) {
    return "needs_surf";
  }

  if (hasEchoNeed) {
    return "needs_echo";
  }

  return "strategy_only";
};

const routeForCase = (caseId: H3IntakeCase) => {
  switch (caseId) {
    case "strategy_only":
      return "CMO answers directly from provided context.";
    case "needs_clarification":
      return "CMO asks a focused clarification before answering.";
    case "assumption_based_strategy":
      return "CMO answers with explicit assumptions.";
    case "needs_surf":
      return "CMO creates a simulated Surf delegation plan.";
    case "needs_echo":
      return "CMO creates a simulated Echo delegation plan.";
    case "needs_surf_then_echo":
      return "CMO simulates Surf first, CMO synthesis, then Echo.";
    case "needs_vault_agent":
      return "CMO simulates Vault Agent delegation because save intent is explicit.";
    case "mixed_workflow":
      return "CMO simulates staged strategy, evidence, copy, and save planning.";
  }
};

const missingInputsForCase = (caseId: H3IntakeCase) => {
  switch (caseId) {
    case "needs_clarification":
      return ["review_lens"];
    case "assumption_based_strategy":
      return ["latest campaign metrics"];
    default:
      return [];
  }
};

const stagesForCase = (caseId: H3IntakeCase) => {
  switch (caseId) {
    case "strategy_only":
      return ["intake", "cmo_strategy", "final_response"];
    case "needs_clarification":
      return ["intake", "clarification"];
    case "assumption_based_strategy":
      return ["intake", "assumption_notice", "cmo_strategy", "final_response"];
    case "needs_surf":
      return ["intake", "surf_delegation_plan", "mock_surf_completion", "cmo_synthesis"];
    case "needs_echo":
      return ["intake", "echo_delegation_plan", "mock_echo_artifact", "cmo_review"];
    case "needs_surf_then_echo":
      return ["intake", "surf_delegation_plan", "cmo_synthesis", "echo_delegation_plan", "cmo_review"];
    case "needs_vault_agent":
      return ["intake", "save_intent_check", "vault_agent_delegation_plan"];
    case "mixed_workflow":
      return [
        "intake",
        "cmo_strategy",
        "surf_delegation_plan",
        "cmo_synthesis",
        "echo_delegation_plan",
        "vault_agent_delegation_plan",
      ];
  }
};

export const classifyHermesCmoIntake = (request: HermesCmoRequest): H3IntakeClassification => {
  const normalizedMessage = normalizeText(request.intent.user_message);
  const caseId = classifyCase(request);
  const delegationPlan = buildDelegationPlan(request, caseId, normalizedMessage);

  return {
    case_id: caseId,
    route: routeForCase(caseId),
    rationale:
      "Classified by local H3 keyword heuristics derived from the H2 intake policy. This is a contract dry-run, not a live agent decision.",
    missing_inputs: missingInputsForCase(caseId),
    assumptions_used: makeAssumptions(caseId),
    delegation_plan: delegationPlan,
    stages: stagesForCase(caseId),
    simulated_only: true,
  };
};
