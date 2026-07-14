export const CMO_WEEKLY_CAMPAIGN_WORKFLOW_KIND = "weekly_campaign" as const;
export const CMO_WEEKLY_CAMPAIGN_WORKFLOW_CONTRACT = "cmo.weekly_campaign_workflow.v1" as const;
export const CMO_WEEKLY_CAMPAIGN_WORKFLOW_ROUTE_REASON = "weekly_campaign_workflow" as const;
export const CMO_WEEKLY_CAMPAIGN_WORKFLOW_ENDPOINT = "/agents/cmo/execute" as const;

export type CmoWeeklyCampaignSafeFailureReason =
  | "weekly_campaign_workflow_timeout"
  | "weekly_campaign_workflow_invalid_response"
  | "weekly_campaign_workflow_unavailable";

export type CmoWeeklyCampaignFailureStage = "request_preparation" | "hermes_execute";

function safeFailureReason(reason: string): CmoWeeklyCampaignSafeFailureReason {
  if (/timeout|timed out|aborted/i.test(reason)) {
    return "weekly_campaign_workflow_timeout";
  }

  if (/invalid|schema|contract|response did not match|rejected field|counter/i.test(reason)) {
    return "weekly_campaign_workflow_invalid_response";
  }

  return "weekly_campaign_workflow_unavailable";
}

export function createWeeklyCampaignWorkflowFailure(input: {
  reason: string;
  hermesRequestSent: boolean;
}) {
  const failureReason = safeFailureReason(input.reason);
  const failureStage: CmoWeeklyCampaignFailureStage = input.hermesRequestSent
    ? "hermes_execute"
    : "request_preparation";
  const runtimeErrorReason = failureReason === "weekly_campaign_workflow_timeout"
    ? "timeout" as const
    : failureReason === "weekly_campaign_workflow_invalid_response"
      ? "invalid_response" as const
      : "execution_error" as const;
  const runtimeError = failureReason === "weekly_campaign_workflow_timeout"
    ? "The Hermes weekly campaign workflow timed out before completion."
    : failureReason === "weekly_campaign_workflow_invalid_response"
      ? "The Hermes weekly campaign workflow returned a response that Product could not safely accept."
      : "The Hermes weekly campaign workflow was unavailable before completion.";

  return {
    answer: [
      "## Weekly Campaign Workflow Unavailable",
      "",
      "The CMO weekly campaign workflow could not complete this turn. No Product-authored campaign or Echo fallback was substituted.",
      "",
      "A target platform is optional for this workflow. Retry to let CMO produce the cross-channel campaign pack.",
    ].join("\n"),
    runtimeError,
    runtimeErrorReason,
    failureReason,
    failureStage,
    metadata: {
      selectedEndpoint: CMO_WEEKLY_CAMPAIGN_WORKFLOW_ENDPOINT,
      selectedHermesEndpoint: CMO_WEEKLY_CAMPAIGN_WORKFLOW_ENDPOINT,
      requestedEndpoint: CMO_WEEKLY_CAMPAIGN_WORKFLOW_ENDPOINT,
      requested_endpoint: CMO_WEEKLY_CAMPAIGN_WORKFLOW_ENDPOINT,
      endpointKind: "execute" as const,
      hermesEndpointKind: "execute" as const,
      endpoint_kind: "execute" as const,
      routeReason: CMO_WEEKLY_CAMPAIGN_WORKFLOW_ROUTE_REASON,
      route_reason: CMO_WEEKLY_CAMPAIGN_WORKFLOW_ROUTE_REASON,
      route_decision: "execute" as const,
      workflowKind: CMO_WEEKLY_CAMPAIGN_WORKFLOW_KIND,
      workflow_kind: CMO_WEEKLY_CAMPAIGN_WORKFLOW_KIND,
      workflow_contract: CMO_WEEKLY_CAMPAIGN_WORKFLOW_CONTRACT,
      failureStage,
      failure_stage: failureStage,
      safeFailureReason: failureReason,
      safe_failure_reason: failureReason,
      default_channel_scope: "cross_channel" as const,
      fallback_used: false,
    },
  };
}
