import type { CMOAppChatResponse } from "@/lib/cmo/app-workspace-types";
import { calculateCmoGoalBaselineTarget } from "@/lib/cmo/goal-baseline-target";
import { createCmoGoalDraft, type CmoGoalV1 } from "@/lib/cmo/goal-state";
import {
  createCmoPublisherExecutionPreflight,
  type CmoPublisherExecutionPreflightActionTypeV1,
} from "@/lib/cmo/publisher-execution-preflight";
import {
  createCmoScopedApprovalResponseMetadata,
  createCmoWeeklyPlanApprovalRequest,
  type CmoScopedApprovalSetV1,
  type CmoScopedApprovalV1,
} from "@/lib/cmo/scoped-approval";
import { assembleCmoWeeklyGoalPlan } from "@/lib/cmo/weekly-goal-plan";

export type CmoGoalWorkflowSmokeKind = "weekly_goal_plan" | "publisher_preflight";
export const CMO_GOAL_WORKFLOW_SMOKE_METADATA_CONTRACT =
  "cmo.goal_workflow_smoke_metadata.v1" as const;

export interface CmoGoalWorkflowSmokeInput {
  message: string;
  workspaceId?: string | null;
  appId?: string | null;
  sessionId?: string | null;
  userId?: string | null;
  now?: string | null;
  activeGoalState?: Record<string, unknown> | null;
  approvals?: CmoScopedApprovalV1[] | CmoScopedApprovalSetV1 | null;
}

export type CmoGoalWorkflowSmokeResponse = Omit<
  CMOAppChatResponse,
  "messageId" | "contextUsed" | "missingContext"
> & {
  smokeKind: CmoGoalWorkflowSmokeKind;
};

interface CmoGoalWorkflowSmokeArtifacts {
  goal: CmoGoalV1;
  baselineTarget: ReturnType<typeof calculateCmoGoalBaselineTarget>;
  weeklyPlan: ReturnType<typeof assembleCmoWeeklyGoalPlan>;
  planApproval: CmoScopedApprovalV1;
  approvalMetadata: ReturnType<typeof createCmoScopedApprovalResponseMetadata>;
}

const DEFAULT_WORKSPACE_ID = "workspace_smoke";
const DEFAULT_APP_ID = "app_smoke";
const DEFAULT_SESSION_ID = "session_smoke";
const DEFAULT_USER_ID = "user_smoke";
const DEFAULT_NOW = "2026-07-08T00:00:00.000Z";
const SMOKE_RUNTIME_LABEL = "CMO goal workflow smoke";
const GOAL_WORKFLOW_TRIGGER = "/goal";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeString(value: unknown, fallback: string, maxLength = 160): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";

  return text || fallback;
}

function safeId(value: unknown, fallback: string, maxLength = 96): string {
  const safe = safeString(value, fallback, maxLength)
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);

  return safe || fallback;
}

function stableHash(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function normalizeMessage(message: string): string {
  return message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cmoGoalWorkflowSmokeCommandText(message: string): string | null {
  const trimmed = message.trim();

  if (!/^\/goal(?:\s|$)/i.test(trimmed)) {
    return null;
  }

  const commandText = trimmed.replace(/^\/goal(?:\s+|$)/i, "").trim();

  return commandText || null;
}

function hasWord(normalized: string, word: string): boolean {
  return new RegExp(`(?:^|\\s)${word}(?:\\s|$)`).test(normalized);
}

function percentageFromMessage(message: string): number {
  const match = message.match(/(\d+(?:\.\d+)?)\s*%/);
  const value = match ? Number(match[1]) : Number.NaN;

  return Number.isFinite(value) && value > 0 ? Math.min(value, 500) : 30;
}

function dateOnly(now: string): string {
  const direct = now.match(/^\d{4}-\d{2}-\d{2}/)?.[0];

  if (direct) {
    return direct;
  }

  const parsed = new Date(now);

  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : DEFAULT_NOW.slice(0, 10);
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (!Number.isFinite(parsed.getTime())) {
    return date;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);

  return parsed.toISOString().slice(0, 10);
}

function isCmoGoal(value: unknown): value is CmoGoalV1 {
  return isRecord(value) &&
    value.contract === "cmo.goal.v1" &&
    typeof value.goal_id === "string" &&
    typeof value.workspace_id === "string" &&
    typeof value.app_id === "string" &&
    typeof value.user_id === "string" &&
    typeof value.session_id === "string" &&
    isRecord(value.metric_source_resolution) &&
    isRecord(value.approvals);
}

export function isCmoGoalWorkflowSmokeRequest(message: string): boolean {
  return isCmoWeeklyCampaignWorkflowRequest(message);
}

export function isCmoWeeklyCampaignWorkflowRequest(message: string): boolean {
  const commandText = cmoGoalWorkflowSmokeCommandText(message);

  if (!commandText) {
    return false;
  }

  const normalized = normalizeMessage(commandText);
  const hasWeeklyWindow = normalized.includes("this week") ||
    normalized.includes("weekly") ||
    normalized.includes("tuan nay") ||
    normalized.includes("hang tuan");
  const hasCampaignIntent = hasWord(normalized, "campaign") ||
    normalized.includes("chien dich");
  const hasTrafficGoal = hasWord(normalized, "traffic") &&
    (hasWord(normalized, "social") || hasWord(normalized, "website"));
  const hasIncreaseIntent = hasWord(normalized, "increase") ||
    hasWord(normalized, "grow") ||
    hasWord(normalized, "boost") ||
    hasWord(normalized, "raise") ||
    hasWord(normalized, "tang");

  return hasWeeklyWindow && (hasCampaignIntent || (hasTrafficGoal && hasIncreaseIntent));
}

export function publisherPreflightSmokeActionType(
  message: string,
): CmoPublisherExecutionPreflightActionTypeV1 | null {
  const commandText = cmoGoalWorkflowSmokeCommandText(message);

  if (!commandText) {
    return null;
  }

  const normalized = normalizeMessage(commandText);
  const tokenCount = normalized ? normalized.split(" ").length : 0;

  if (!normalized || tokenCount > 8) {
    return null;
  }

  if (normalized.includes("paid generation")) {
    return "paid_generation";
  }

  if (hasWord(normalized, "schedule") || normalized.includes("len lich")) {
    return "schedule";
  }

  if (hasWord(normalized, "execute") || hasWord(normalized, "chay")) {
    return "execute";
  }

  if (hasWord(normalized, "publish") || hasWord(normalized, "dang")) {
    return "publish";
  }

  return null;
}

export function isCmoPublisherPreflightSmokeRequest(message: string): boolean {
  return publisherPreflightSmokeActionType(message) !== null;
}

function goalIdForSmoke(input: Required<Pick<CmoGoalWorkflowSmokeInput, "message" | "workspaceId" | "appId" | "sessionId">>): string {
  return safeId(
    `goal_smoke_${input.workspaceId}_${input.appId}_${input.sessionId}_${stableHash(input.message)}`,
    "goal_smoke",
    140,
  );
}

function createEphemeralGoal(input: CmoGoalWorkflowSmokeInput): CmoGoalV1 {
  if (isCmoGoal(input.activeGoalState)) {
    return input.activeGoalState;
  }

  const now = safeString(input.now, DEFAULT_NOW, 80);
  const startDate = dateOnly(now);
  const workspaceId = safeString(input.workspaceId, DEFAULT_WORKSPACE_ID, 120);
  const appId = safeString(input.appId, DEFAULT_APP_ID, 120);
  const sessionId = safeString(input.sessionId, DEFAULT_SESSION_ID, 140);
  const userId = safeString(input.userId, DEFAULT_USER_ID, 120);

  return createCmoGoalDraft({
    goalId: goalIdForSmoke({
      message: input.message,
      workspaceId,
      appId,
      sessionId,
    }),
    rawUserMessage: input.message,
    normalizedGoalKind: "traffic",
    workspaceId,
    appId,
    userId,
    sessionId,
    targetWindow: {
      label: "this week",
      start_date: startDate,
      end_date: addDays(startDate, 6),
      timezone: "Asia/Saigon",
    },
    now,
  });
}

function baselineVisibilityLabel(baselineTarget: ReturnType<typeof calculateCmoGoalBaselineTarget>): "missing" | "manual" | "estimated" | "real" {
  const baseline = baselineTarget.baseline;

  if (baseline.is_estimated || baseline.status === "estimated" || baseline.source_kind === "estimated") {
    return "estimated";
  }

  if (baseline.status === "manual_required" || baseline.source_kind === "manual_input") {
    return "manual";
  }

  if (baseline.is_real_measurement) {
    return "real";
  }

  return "missing";
}

export function createCmoGoalWorkflowSmokeArtifacts(input: CmoGoalWorkflowSmokeInput): CmoGoalWorkflowSmokeArtifacts {
  const now = safeString(input.now, DEFAULT_NOW, 80);
  const goal = createEphemeralGoal(input);
  const baselineTarget = calculateCmoGoalBaselineTarget({
    goal,
    target: {
      mode: "percent_increase",
      percent: percentageFromMessage(input.message),
      daily_breakdown: true,
    },
    metricLabel: "Social traffic",
  });
  const weeklyPlan = assembleCmoWeeklyGoalPlan({
    goal,
    baselineTarget,
    now,
  });
  const planApproval = createCmoWeeklyPlanApprovalRequest({
    weeklyPlan,
    now,
    approvalId: safeId(`approval_plan_${goal.goal_id}`, "approval_plan", 160),
    requestedBy: goal.user_id,
  });
  const approvalMetadata = createCmoScopedApprovalResponseMetadata({
    approvalRequests: [planApproval],
  });

  return {
    goal,
    baselineTarget,
    weeklyPlan,
    planApproval,
    approvalMetadata,
  };
}

function approvalRequestForUi(artifacts: CmoGoalWorkflowSmokeArtifacts): Record<string, unknown> {
  return {
    ...artifacts.planApproval,
    kind: "plan",
    type: "plan",
    title: artifacts.weeklyPlan.plan_summary.user_visible_title,
    summary: "Review the weekly goal plan. This approval is limited to plan direction.",
    side_effect_if_approved: "Approves the plan only; does not permit execution, publish, schedule, paid generation, connector calls, or external API calls.",
  };
}

function smokeMetadataArtifact(input: {
  kind: CmoGoalWorkflowSmokeKind;
  commandText: string;
}): Record<string, unknown> {
  return {
    contract: CMO_GOAL_WORKFLOW_SMOKE_METADATA_CONTRACT,
    goal_workflow_smoke: true,
    goal_workflow_trigger: GOAL_WORKFLOW_TRIGGER,
    smoke_kind: input.kind,
    command_text: input.commandText,
    native_cmo_chat_for_non_goal_messages: true,
    no_external_api_calls: true,
    no_connector_calls: true,
    no_publisher_calls: true,
    no_execution: true,
    no_publish: true,
    no_schedule: true,
    no_separate_goal_state_save: true,
  };
}

export function createCmoGoalWorkflowSmokeMarkdown(artifacts: CmoGoalWorkflowSmokeArtifacts): string {
  const baselineLabel = baselineVisibilityLabel(artifacts.baselineTarget);

  return [
    `# ${artifacts.weeklyPlan.plan_summary.user_visible_title}`,
    "",
    "This is the `/goal` weekly campaign workflow. Native CMO chat remains available by sending normal messages without `/goal`.",
    "",
    artifacts.weeklyPlan.plan_summary.user_visible_body,
    "",
    "## Smoke contract trace",
    "",
    "- Artifact: `cmo.goal.v1`",
    "- Artifact: `cmo.goal_baseline_target.v1`",
    "- Artifact: `cmo.weekly_goal_plan.v1`",
    "- Approval request: `cmo.scoped_approval.v1` with `plan` scope",
    "- Scope: plan/draft/preflight only.",
    `- Baseline label: ${baselineLabel}. No real baseline is claimed unless the baseline artifact marks a real measurement.`,
    "- Approval boundary: plan approval is separate from execution, publish, schedule, and paid generation approval.",
    "- Side effects: no publish, schedule, execution, connector, database, file, or external API call is performed by this smoke path.",
  ].join("\n");
}

function baseSmokeResponse(input: CmoGoalWorkflowSmokeInput): Omit<
  CmoGoalWorkflowSmokeResponse,
  "answer" | "sessionArtifacts" | "approvalRequests" | "suggestedActions" | "smokeKind"
> {
  return {
    sessionId: safeString(input.sessionId, DEFAULT_SESSION_ID, 140),
    status: "completed",
    assumptions: [],
    isDevelopmentFallback: false,
    isRuntimeFallback: false,
    runtimeStatus: "live",
    runtimeMode: "live",
    runtimeLabel: SMOKE_RUNTIME_LABEL,
    runtimeProvider: "product",
    runtimeAgent: "goal-workflow-smoke",
    hermesRequestSent: false,
    calledHermesCmo: false,
  };
}

function createWeeklyGoalSmokeResponse(input: CmoGoalWorkflowSmokeInput): CmoGoalWorkflowSmokeResponse {
  const artifacts = createCmoGoalWorkflowSmokeArtifacts(input);
  const commandText = cmoGoalWorkflowSmokeCommandText(input.message) ?? input.message;

  return {
    ...baseSmokeResponse(input),
    smokeKind: "weekly_goal_plan",
    answer: createCmoGoalWorkflowSmokeMarkdown(artifacts),
    suggestedActions: [
      {
        type: "approval_required",
        label: "Review scoped plan approval before any execution.",
      },
    ],
    sessionArtifacts: [
      artifacts.goal as unknown as Record<string, unknown>,
      artifacts.baselineTarget as unknown as Record<string, unknown>,
      artifacts.weeklyPlan as unknown as Record<string, unknown>,
      artifacts.planApproval as unknown as Record<string, unknown>,
      artifacts.approvalMetadata as unknown as Record<string, unknown>,
      smokeMetadataArtifact({ kind: "weekly_goal_plan", commandText }),
    ],
    approvalRequests: [approvalRequestForUi(artifacts)],
  };
}

function createPublisherPreflightSmokeResponse(
  input: CmoGoalWorkflowSmokeInput,
  actionType: CmoPublisherExecutionPreflightActionTypeV1,
): CmoGoalWorkflowSmokeResponse {
  const activeGoal = isCmoGoal(input.activeGoalState) ? input.activeGoalState : null;
  const commandText = cmoGoalWorkflowSmokeCommandText(input.message) ?? input.message;
  const workspaceId = safeString(input.workspaceId ?? activeGoal?.workspace_id, DEFAULT_WORKSPACE_ID, 120);
  const appId = safeString(input.appId ?? activeGoal?.app_id, DEFAULT_APP_ID, 120);
  const sessionId = safeString(input.sessionId ?? activeGoal?.session_id, DEFAULT_SESSION_ID, 140);
  const targetId = safeId(activeGoal?.goal_id ?? `${actionType}_weekly_plan_smoke`, `${actionType}_weekly_plan_smoke`, 140);
  const preflight = createCmoPublisherExecutionPreflight({
    preflightId: safeId(`preflight_${actionType}_${targetId}`, "preflight_smoke", 160),
    goalId: activeGoal?.goal_id ?? null,
    workspaceId,
    appId,
    sessionId,
    approvals: input.approvals ?? null,
    now: safeString(input.now, DEFAULT_NOW, 80),
    requestedAction: {
      type: actionType,
      targetId,
      targetContract: "cmo.weekly_goal_plan.v1",
      channel: null,
      provider: null,
      scheduledFor: null,
    },
  });
  const missingScopes = preflight.approval_check.missing_scopes.join(", ") || "none";

  return {
    ...baseSmokeResponse({
      ...input,
      workspaceId,
      appId,
      sessionId,
    }),
    smokeKind: "publisher_preflight",
    answer: [
      "# Publisher preflight blocked",
      "",
      preflight.approval_check.safe_user_message,
      "",
      `Missing scopes: ${missingScopes}.`,
      "",
      "This is the `/goal` publisher preflight smoke path. Native CMO chat remains available by sending normal messages without `/goal`.",
      "",
      "This is dry-run only. Product did not publish, schedule, execute, call Publisher, call connectors, write a runtime database row, write a runtime file, or create an executable job object.",
      "",
      "Artifact: `cmo.publisher_execution_preflight.v1`.",
    ].join("\n"),
    suggestedActions: [
      {
        type: "approval_required",
        label: "Request explicit scoped approval before publisher action.",
      },
    ],
    sessionArtifacts: [
      preflight as unknown as Record<string, unknown>,
      smokeMetadataArtifact({ kind: "publisher_preflight", commandText }),
    ],
    approvalRequests: [],
  };
}

export function maybeCreateCmoGoalWorkflowSmokeResponse(
  input: CmoGoalWorkflowSmokeInput,
): CmoGoalWorkflowSmokeResponse | null {
  const commandText = cmoGoalWorkflowSmokeCommandText(input.message);

  if (!commandText) {
    return null;
  }

  const commandInput = {
    ...input,
    message: commandText,
  };

  if (isCmoGoalWorkflowSmokeRequest(input.message)) {
    return createWeeklyGoalSmokeResponse(commandInput);
  }

  const actionType = publisherPreflightSmokeActionType(input.message);

  if (actionType) {
    return createPublisherPreflightSmokeResponse(commandInput, actionType);
  }

  return null;
}
