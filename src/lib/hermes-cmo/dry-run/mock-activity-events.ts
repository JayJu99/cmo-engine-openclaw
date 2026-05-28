// H3 is dry-run contract harness only, not used by live runtime.

import type {
  H3IntakeClassification,
  HermesActivityEvent,
  HermesActivityStatus,
  HermesActivityType,
  HermesCmoRequest,
  HermesCmoResponse,
  HermesDelegationPlan,
} from "./types";

const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, "_");

const addSeconds = (timestamp: string, seconds: number) => {
  const base = Date.parse(timestamp);
  const date = Number.isNaN(base) ? new Date(seconds * 1000) : new Date(base + seconds * 1000);

  return date.toISOString();
};

const delegationCreatedType = (delegation: HermesDelegationPlan): HermesActivityType =>
  delegation.target.agent === "vault_agent" ? "vault_agent.delegation.created" : "delegation.created";

const delegationStartedType = (delegation: HermesDelegationPlan): HermesActivityType =>
  delegation.target.agent === "vault_agent" ? "vault_agent.delegation.started" : "delegation.started";

const delegationCompletedType = (delegation: HermesDelegationPlan): HermesActivityType =>
  delegation.target.agent === "vault_agent" ? "vault_agent.delegation.completed" : "delegation.completed";

export const buildMockActivityEvents = (
  request: HermesCmoRequest,
  classification: H3IntakeClassification,
  response: HermesCmoResponse,
): HermesActivityEvent[] => {
  const events: HermesActivityEvent[] = [];

  const addEvent = (
    type: HermesActivityType,
    status: HermesActivityStatus,
    message: string,
    data: Record<string, unknown> = {},
  ) => {
    const seq = events.length + 1;

    events.push({
      schema_version: "hermes.activity.event.v1",
      event_id: `evt_${safeId(request.request_id)}_${String(seq).padStart(3, "0")}`,
      request_id: request.request_id,
      session_id: request.session_id,
      turn_id: request.turn_id,
      seq,
      created_at: addSeconds(request.created_at, seq),
      source: {
        agent: "cmo",
        mode: "cmo.default",
      },
      type,
      status,
      user_visible: true,
      message,
      data,
    });
  };

  addEvent("run.started", "running", "CMO dry-run is reviewing the request and loading available context.", {
    dry_run_only: true,
  });
  addEvent("context.loaded", "running", "CMO dry-run loaded the provided context pack and constraints.", {
    context_items:
      request.context_pack.current_priority.length +
      request.context_pack.selected_context.length +
      request.context_pack.indexed_context_supplement.length +
      request.context_pack.artifacts_in.length +
      (request.context_pack.recent_session_summary ? 1 : 0),
    allowed_agents: request.constraints.allowed_agents,
  });

  if (classification.case_id === "needs_clarification") {
    addEvent(
      "clarification.required",
      "waiting",
      "CMO dry-run needs one clarification before making a reliable recommendation.",
      {
        missing_inputs: classification.missing_inputs,
      },
    );
    addEvent("clarification.asked", "waiting", "CMO dry-run produced a mock clarification question.", {
      question: response.clarifying_question.question,
      missing_inputs: classification.missing_inputs,
    });
    addEvent("run.completed", "waiting", "CMO dry-run stopped at the user-input boundary.", {
      final_state: "waiting_for_user",
      dry_run_only: true,
    });

    return events;
  }

  addEvent("plan.created", "running", "CMO dry-run created a simulated execution plan.", {
    case_id: classification.case_id,
    stages: classification.stages,
    simulated_only: true,
  });

  if (classification.assumptions_used.length > 0) {
    addEvent("assumption.notice", "running", "CMO dry-run is proceeding with explicit assumptions.", {
      missing_inputs: classification.missing_inputs,
      assumptions_used: classification.assumptions_used.map((assumption) => assumption.assumption),
    });
  }

  for (const delegation of classification.delegation_plan) {
    addEvent(delegationCreatedType(delegation), "running", `CMO dry-run created a simulated ${delegation.target.agent} delegation.`, {
      delegation_id: delegation.delegation_id,
      target: delegation.target,
      simulation: delegation.simulation,
    });
    addEvent(delegationStartedType(delegation), "running", `CMO dry-run started simulated ${delegation.target.agent} planning.`, {
      delegation_id: delegation.delegation_id,
      target: delegation.target,
      simulation: delegation.simulation,
    });
    addEvent("run.heartbeat", "running", `CMO dry-run is waiting on simulated ${delegation.target.agent} output.`, {
      current_stage: "simulated_delegation",
      waiting_on: delegation.target.agent,
      delegation_id: delegation.delegation_id,
      simulation: delegation.simulation,
    });
    addEvent(delegationCompletedType(delegation), "completed", `CMO dry-run completed simulated ${delegation.target.agent} planning.`, {
      delegation_id: delegation.delegation_id,
      target: delegation.target,
      simulation: delegation.simulation,
    });
  }

  if (response.artifacts.length > 0) {
    addEvent("artifact.created", "completed", "CMO dry-run attached mock artifacts from simulated planning.", {
      artifact_ids: response.artifacts.map((artifact) => artifact.artifact_id),
      dry_run_only: true,
    });
  }

  if (response.memory_suggestions.length > 0) {
    addEvent("memory_suggestion.created", "completed", "CMO dry-run emitted memory suggestions without writing Vault.", {
      suggestion_ids: response.memory_suggestions.map((suggestion) => suggestion.suggestion_id),
      dry_run_only: true,
      live_write_performed: false,
    });
  }

  addEvent("run.completed", "completed", "CMO dry-run returned mock response and activity contracts.", {
    final_state: response.activity_summary.final_state,
    dry_run_only: true,
  });

  return events;
};
