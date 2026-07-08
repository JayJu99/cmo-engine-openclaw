import type { CmoGoalV1 } from "@/lib/cmo/goal-state";

export const CMO_GOAL_STATE_TRANSPORT_CONTRACT = "cmo.goal.v1" as const;

function jsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function activeGoalStateForHermesContext(goal: CmoGoalV1 | null | undefined): Record<string, unknown> | null {
  if (!goal || goal.contract !== CMO_GOAL_STATE_TRANSPORT_CONTRACT) {
    return null;
  }

  return {
    contract: CMO_GOAL_STATE_TRANSPORT_CONTRACT,
    goal_id: goal.goal_id,
    raw_user_message: goal.raw_user_message,
    normalized_goal_kind: goal.normalized_goal_kind,
    resolved_metric: goal.resolved_metric,
    workspace_id: goal.workspace_id,
    app_id: goal.app_id,
    user_id: goal.user_id,
    session_id: goal.session_id,
    target_window: goal.target_window ? jsonRecord(goal.target_window) : null,
    metric_source_resolution: jsonRecord(goal.metric_source_resolution),
    status: goal.status,
    approvals: jsonRecord(goal.approvals),
    created_at: goal.created_at,
    updated_at: goal.updated_at,
  };
}
