import "server-only";

import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import {
  resolveLensMetricSourceResolution,
  type LensExistingChannelMetricsAvailabilityV1,
  type LensMetricGoalKindV1,
  type LensMetricSourceCapabilitiesInputV1,
  type LensMetricSourceResolutionV1,
} from "@/lib/cmo/lens-metric-source-resolution";

export const CMO_GOAL_CONTRACT = "cmo.goal.v1" as const;
export const CMO_GOAL_STORE_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "goals");

export type CmoGoalContractV1 = typeof CMO_GOAL_CONTRACT;
export type CmoGoalStatusV1 =
  | "draft"
  | "needs_metric_resolution"
  | "needs_capability"
  | "source_resolution_ready"
  | "baseline_pending"
  | "plan_pending"
  | "approval_pending"
  | "cancelled";

export type CmoGoalApprovalNameV1 = "execution" | "publish" | "schedule" | "paid_generation" | "plan";

export interface CmoGoalTargetWindowV1 {
  label?: string;
  start_date?: string | null;
  end_date?: string | null;
  timezone?: string | null;
}

export interface CmoGoalApprovalV1 {
  approved: boolean;
  approved_at: string | null;
  approved_by: string | null;
}

export type CmoGoalApprovalsV1 = Record<CmoGoalApprovalNameV1, CmoGoalApprovalV1>;

export interface CmoGoalV1 {
  goal_id: string;
  contract: CmoGoalContractV1;
  raw_user_message: string;
  normalized_goal_kind: LensMetricGoalKindV1;
  resolved_metric: string;
  workspace_id: string;
  app_id: string;
  user_id: string;
  session_id: string;
  target_window: CmoGoalTargetWindowV1 | null;
  metric_source_resolution: LensMetricSourceResolutionV1;
  status: CmoGoalStatusV1;
  approvals: CmoGoalApprovalsV1;
  created_at: string;
  updated_at: string;
}

export interface CmoGoalPlanApprovalInputV1 {
  approved?: boolean;
  approved_at?: string | null;
  approved_by?: string | null;
}

export interface CreateCmoGoalDraftInputV1 {
  rawUserMessage: string;
  normalizedGoalKind?: LensMetricGoalKindV1 | string | null;
  workspaceId: string;
  appId: string;
  userId: string;
  sessionId: string;
  targetWindow?: CmoGoalTargetWindowV1 | null;
  capabilities?: LensMetricSourceCapabilitiesInputV1;
  existingChannelMetricsAvailability?: LensExistingChannelMetricsAvailabilityV1[];
  planApproval?: CmoGoalPlanApprovalInputV1 | null;
  goalId?: string;
  now?: string;
}

export interface CmoGoalStoreOptionsV1 {
  storeDir?: string;
}

function safeId(value: string): string {
  const safeValue = value.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 120);

  return safeValue || "goal";
}

function createGoalId(): string {
  return `goal_${randomUUID()}`;
}

function goalPath(goalId: string, storeDir = CMO_GOAL_STORE_DIR): string {
  return path.join(storeDir, `${safeId(goalId)}.json`);
}

function falseApproval(): CmoGoalApprovalV1 {
  return {
    approved: false,
    approved_at: null,
    approved_by: null,
  };
}

function planApproval(input: CmoGoalPlanApprovalInputV1 | null | undefined, now: string): CmoGoalApprovalV1 {
  if (input?.approved !== true) {
    return falseApproval();
  }

  return {
    approved: true,
    approved_at: input.approved_at ?? now,
    approved_by: input.approved_by ?? null,
  };
}

export function createCmoGoalApprovalDefaults(input?: {
  planApproval?: CmoGoalPlanApprovalInputV1 | null;
  now?: string;
}): CmoGoalApprovalsV1 {
  const now = input?.now ?? new Date().toISOString();

  return {
    execution: falseApproval(),
    publish: falseApproval(),
    schedule: falseApproval(),
    paid_generation: falseApproval(),
    plan: planApproval(input?.planApproval, now),
  };
}

function hasGoalMetricResolutionRequirement(resolution: LensMetricSourceResolutionV1): boolean {
  return resolution.missing_requirements.some((requirement) => requirement.action === "ask_cmo_to_resolve_goal_metric");
}

export function goalStatusFromMetricSourceResolution(resolution: LensMetricSourceResolutionV1): CmoGoalStatusV1 {
  if (
    resolution.goal_kind === "unknown" ||
    resolution.resolved_metric === "unknown_metric" ||
    hasGoalMetricResolutionRequirement(resolution)
  ) {
    return "needs_metric_resolution";
  }

  if (!resolution.primary_source) {
    return "needs_capability";
  }

  if (resolution.baseline_status !== "available") {
    return "baseline_pending";
  }

  return "source_resolution_ready";
}

export function createCmoGoalDraft(input: CreateCmoGoalDraftInputV1): CmoGoalV1 {
  const now = input.now ?? new Date().toISOString();
  const metricSourceResolution = resolveLensMetricSourceResolution({
    raw_user_goal_message: input.rawUserMessage,
    normalized_goal_kind: input.normalizedGoalKind,
    capabilities: input.capabilities,
    existing_channel_metrics_availability: input.existingChannelMetricsAvailability,
  });

  return {
    goal_id: input.goalId ?? createGoalId(),
    contract: CMO_GOAL_CONTRACT,
    raw_user_message: input.rawUserMessage,
    normalized_goal_kind: metricSourceResolution.goal_kind,
    resolved_metric: metricSourceResolution.resolved_metric,
    workspace_id: input.workspaceId,
    app_id: input.appId,
    user_id: input.userId,
    session_id: input.sessionId,
    target_window: input.targetWindow ?? null,
    metric_source_resolution: metricSourceResolution,
    status: goalStatusFromMetricSourceResolution(metricSourceResolution),
    approvals: createCmoGoalApprovalDefaults({
      planApproval: input.planApproval,
      now,
    }),
    created_at: now,
    updated_at: now,
  };
}

export async function saveCmoGoal(goal: CmoGoalV1, options?: CmoGoalStoreOptionsV1): Promise<CmoGoalV1> {
  const filePath = goalPath(goal.goal_id, options?.storeDir);
  const persistedGoal = JSON.parse(JSON.stringify(goal)) as CmoGoalV1;

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(persistedGoal, null, 2)}\n`, "utf8");

  return persistedGoal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isCmoGoal(value: unknown, goalId: string): value is CmoGoalV1 {
  return isRecord(value) && value.contract === CMO_GOAL_CONTRACT && value.goal_id === goalId;
}

export async function readCmoGoal(goalId: string, options?: CmoGoalStoreOptionsV1): Promise<CmoGoalV1 | null> {
  try {
    const value = JSON.parse(await readFile(goalPath(goalId, options?.storeDir), "utf8")) as unknown;

    return isCmoGoal(value, goalId) ? value : null;
  } catch {
    return null;
  }
}

export async function createAndStoreCmoGoalDraft(
  input: CreateCmoGoalDraftInputV1,
  options?: CmoGoalStoreOptionsV1,
): Promise<CmoGoalV1> {
  const goal = createCmoGoalDraft(input);

  return saveCmoGoal(goal, options);
}
