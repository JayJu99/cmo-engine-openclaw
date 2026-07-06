export const CURRENT_TURN_RESPONSE_CONTRACT_SCHEMA = "cmo.current_turn_response_contract.v1" as const;

export const CURRENT_TURN_RESPONSE_INSTRUCTION =
  "Current-turn deliverable overrides prior assistant answers, Lens or metric context, session summary, and background context. Infer the requested output semantically from intent.user_message and return the user-visible deliverable requested by the latest user message. Ask clarification only when blocked; do not perform publishing, Vault writes, or paid generation without explicit approval." as const;

export interface CurrentTurnResponseContract {
  schema_version: typeof CURRENT_TURN_RESPONSE_CONTRACT_SCHEMA;
  source: "latest_user_message";
  interpretation_owner: "hermes_cmo";
  semantic_task_inference: "infer_from_latest_user_message";
  must_answer_latest_user_message: true;
  latest_user_message_is_deliverable_authority: true;
  context_role: "enrich_only";
  history_role: "background_only";
  session_summary_role: "background_only";
  conflict_resolution: {
    if_latest_message_requests_new_deliverable: "latest_user_message_wins";
    previous_topic_must_not_replace_current_deliverable: true;
    lens_or_metric_context_must_not_replace_non_metric_deliverable: true;
  };
  deliverable_policy: {
    infer_requested_output_type_semantically: true;
    honor_explicit_count_if_present: true;
    return_user_visible_artifact_when_requested: true;
    ask_clarification_only_if_blocked: true;
  };
  side_effect_policy: {
    no_publish_without_explicit_execution_approval: true;
    no_vault_write_without_explicit_save_approval: true;
    no_paid_generation_without_explicit_approval: true;
  };
}

export function createCurrentTurnResponseContract(): CurrentTurnResponseContract {
  return {
    schema_version: CURRENT_TURN_RESPONSE_CONTRACT_SCHEMA,
    source: "latest_user_message",
    interpretation_owner: "hermes_cmo",
    semantic_task_inference: "infer_from_latest_user_message",
    must_answer_latest_user_message: true,
    latest_user_message_is_deliverable_authority: true,
    context_role: "enrich_only",
    history_role: "background_only",
    session_summary_role: "background_only",
    conflict_resolution: {
      if_latest_message_requests_new_deliverable: "latest_user_message_wins",
      previous_topic_must_not_replace_current_deliverable: true,
      lens_or_metric_context_must_not_replace_non_metric_deliverable: true,
    },
    deliverable_policy: {
      infer_requested_output_type_semantically: true,
      honor_explicit_count_if_present: true,
      return_user_visible_artifact_when_requested: true,
      ask_clarification_only_if_blocked: true,
    },
    side_effect_policy: {
      no_publish_without_explicit_execution_approval: true,
      no_vault_write_without_explicit_save_approval: true,
      no_paid_generation_without_explicit_approval: true,
    },
  };
}
