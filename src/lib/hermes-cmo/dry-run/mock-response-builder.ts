// H3 is dry-run contract harness only, not used by live runtime.

import type { H3IntakeCase, H3IntakeClassification, HermesCmoRequest, HermesCmoResponse } from "./types";

const titleForCase = (caseId: H3IntakeCase) => {
  switch (caseId) {
    case "strategy_only":
      return "H3 mock strategy response";
    case "needs_clarification":
      return "H3 mock clarification response";
    case "assumption_based_strategy":
      return "H3 mock assumption-based strategy response";
    case "needs_surf":
      return "H3 mock Surf delegation response";
    case "needs_echo":
      return "H3 mock Echo delegation response";
    case "needs_surf_then_echo":
      return "H3 mock Surf then Echo response";
    case "needs_vault_agent":
      return "H3 mock Vault Agent delegation response";
    case "mixed_workflow":
      return "H3 mock mixed workflow response";
  }
};

const decisionForCase = (caseId: H3IntakeCase) => {
  switch (caseId) {
    case "strategy_only":
      return "Answer directly from provided context.";
    case "needs_clarification":
      return "Ask for user input before answering.";
    case "assumption_based_strategy":
      return "Proceed with disclosed assumptions.";
    case "needs_surf":
      return "Simulate Surf planning only.";
    case "needs_echo":
      return "Simulate Echo planning only.";
    case "needs_surf_then_echo":
      return "Simulate Surf evidence before Echo copy.";
    case "needs_vault_agent":
      return "Simulate Vault Agent write planning only.";
    case "mixed_workflow":
      return "Simulate staged strategy, evidence, copy, and save planning.";
  }
};

const summaryForCase = (caseId: H3IntakeCase) => {
  switch (caseId) {
    case "strategy_only":
      return "The request can be handled by CMO strategy from the provided context without delegation.";
    case "needs_clarification":
      return "The request is too broad to answer reliably without a review lens.";
    case "assumption_based_strategy":
      return "The request can proceed only if the missing campaign metrics are disclosed as an assumption.";
    case "needs_surf":
      return "The request needs current or external evidence, so H3 returns a simulated Surf plan.";
    case "needs_echo":
      return "The request asks for final copy, so H3 returns a simulated Echo plan and mock artifact.";
    case "needs_surf_then_echo":
      return "The request asks for evidence-backed copy, so H3 simulates Surf, CMO synthesis, and Echo.";
    case "needs_vault_agent":
      return "The request has explicit save intent, so H3 simulates a Vault Agent delegation without writing Vault.";
    case "mixed_workflow":
      return "The request spans strategy, evidence, copy, and saving, so H3 returns a simulated staged plan.";
  }
};

const bodyForCase = (classification: H3IntakeClassification) =>
  [
    "H3 is dry-run contract harness only, not used by live runtime.",
    `Classification: ${classification.case_id}.`,
    `Route: ${classification.route}`,
    "No Echo, Surf, Vault Agent, OpenClaw, Supabase, session writer, raw capture writer, UI state, or Kanban runtime was called.",
    "All delegations in this response are simulated planning records only.",
  ].join("\n\n");

const suggestedInputsForCase = (caseId: H3IntakeCase) => {
  switch (caseId) {
    case "needs_clarification":
      return ["Tell CMO whether to review strategy, execution risk, demo readiness, or content quality."];
    case "assumption_based_strategy":
      return ["Provide latest campaign metrics.", "Confirm whether the target is demo readiness or production readiness."];
    default:
      return [];
  }
};

const buildStructuredOutput = (classification: H3IntakeClassification) => ({
  diagnosis: [
    `H3 intake classified the request as ${classification.case_id}.`,
    "This is a local contract simulation derived from H1/H2 policies.",
  ],
  recommendations: [
    classification.route,
    "Keep this harness isolated from production runtime until a later approved phase.",
  ],
  risks: [
    "Mock outputs are not evidence, content, or Vault write confirmations.",
    "Delegation records must remain simulation-only in H3.",
  ],
  next_steps: classification.stages,
});

const buildArtifacts = (request: HermesCmoRequest, classification: H3IntakeClassification) => {
  const hasEcho = classification.delegation_plan.some((delegation) => delegation.target.agent === "echo");

  if (!hasEcho) {
    return [];
  }

  return [
    {
      artifact_id: `mock_echo_artifact_${request.request_id}`,
      type: "x_posts",
      content_format: "markdown",
      content:
        "Mock Echo artifact placeholder. H3 did not call Echo and did not generate publish-ready production copy.",
      simulation: {
        dry_run_only: true,
        live_call_performed: false,
      },
    },
  ];
};

const buildMemorySuggestions = (request: HermesCmoRequest, classification: H3IntakeClassification) => {
  if (classification.case_id !== "strategy_only" && classification.case_id !== "assumption_based_strategy") {
    return [];
  }

  return [
    {
      suggestion_id: `mock_memory_suggestion_${request.request_id}`,
      type: "dry_run_note",
      title: "H3 dry-run produced a memory-worthy planning boundary",
      reason: "The result may be useful later, but H3 cannot write Vault or mutate memory.",
      confidence: "medium",
      requires_user_save_intent: true,
      simulation: {
        dry_run_only: true,
        live_write_performed: false,
      },
    },
  ];
};

export const buildMockCmoResponse = (
  request: HermesCmoRequest,
  classification: H3IntakeClassification,
  eventsCount: number,
): HermesCmoResponse => {
  if (classification.case_id === "needs_clarification") {
    return {
      schema_version: "hermes.cmo.response.v1",
      request_id: request.request_id,
      session_id: request.session_id,
      turn_id: request.turn_id,
      status: "needs_user_input",
      answer_basis: {
        mode: "needs_user_input",
        missing_inputs: classification.missing_inputs,
        assumptions_used: [],
        user_can_override: true,
        suggested_user_inputs: suggestedInputsForCase(classification.case_id),
      },
      clarifying_question: {
        required: true,
        question: "Which lens should CMO use: strategy, execution risk, demo readiness, or content quality?",
        reason: "The request is broad and has no provided review lens or context.",
        missing_inputs: classification.missing_inputs,
      },
      answer: null,
      structured_output: null,
      delegations: [],
      artifacts: [],
      memory_suggestions: [],
      activity_summary: {
        events_count: eventsCount,
        final_state: "waiting_for_user",
      },
    };
  }

  const answerMode =
    classification.case_id === "assumption_based_strategy" ? "assumption_based" : "fully_grounded";

  return {
    schema_version: "hermes.cmo.response.v1",
    request_id: request.request_id,
    session_id: request.session_id,
    turn_id: request.turn_id,
    status: "completed",
    answer_basis: {
      mode: answerMode,
      missing_inputs: classification.missing_inputs,
      assumptions_used: classification.assumptions_used,
      user_can_override: true,
      suggested_user_inputs: suggestedInputsForCase(classification.case_id),
    },
    clarifying_question: {
      required: false,
      question: null,
      reason: null,
      missing_inputs: [],
    },
    answer: {
      format: "markdown",
      title: titleForCase(classification.case_id),
      summary: summaryForCase(classification.case_id),
      decision: decisionForCase(classification.case_id),
      body: bodyForCase(classification),
    },
    structured_output: buildStructuredOutput(classification),
    delegations: classification.delegation_plan,
    artifacts: buildArtifacts(request, classification),
    memory_suggestions: buildMemorySuggestions(request, classification),
    activity_summary: {
      events_count: eventsCount,
      final_state: "completed",
    },
  };
};
