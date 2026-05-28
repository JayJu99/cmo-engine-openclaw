// H3 is dry-run contract harness only, not used by live runtime.

import { classifyHermesCmoIntake } from "./intake-classifier";
import { buildMockActivityEvents } from "./mock-activity-events";
import { buildMockCmoResponse } from "./mock-response-builder";
import {
  H3_DRY_RUN_BOUNDARY,
  type HermesAllowedAgent,
  type HermesCmoDryRunResult,
  type HermesCmoRequest,
  type HermesSurfMode,
} from "./types";

const allowedAgents = new Set<HermesAllowedAgent>(["echo", "surf", "vault_agent"]);
const allowedSurfModes = new Set<HermesSurfMode>(["surf.default", "surf.x", "surf.trend", "surf.pulse"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown) => typeof value === "string" && value.length > 0;

const isStringOrNull = (value: unknown) => typeof value === "string" || value === null;

const hasOnlyAllowedValues = <T extends string>(values: unknown, allowedValues: Set<T>) =>
  Array.isArray(values) && values.every((value): value is T => typeof value === "string" && allowedValues.has(value as T));

export const validateHermesCmoRequestForDryRun = (request: unknown): request is HermesCmoRequest => {
  if (!isRecord(request)) {
    return false;
  }

  if (
    request.schema_version !== "hermes.cmo.request.v1" ||
    !isNonEmptyString(request.request_id) ||
    !isNonEmptyString(request.session_id) ||
    !isNonEmptyString(request.turn_id) ||
    !isNonEmptyString(request.created_at)
  ) {
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

export const runHermesCmoDryRun = (request: unknown): HermesCmoDryRunResult => {
  if (!validateHermesCmoRequestForDryRun(request)) {
    throw new Error("Invalid hermes.cmo.request.v1 input for H3 dry-run.");
  }

  const classification = classifyHermesCmoIntake(request);
  const responseDraft = buildMockCmoResponse(request, classification, 0);
  const activityEvents = buildMockActivityEvents(request, classification, responseDraft);
  const response = buildMockCmoResponse(request, classification, activityEvents.length);

  return {
    boundary: H3_DRY_RUN_BOUNDARY,
    request,
    classification,
    response,
    activity_events: activityEvents,
  };
};
