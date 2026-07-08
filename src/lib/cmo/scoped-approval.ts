import type { CmoGoalApprovalNameV1, CmoGoalApprovalV1 } from "@/lib/cmo/goal-state";
import type { CmoWeeklyGoalPlanV1 } from "@/lib/cmo/weekly-goal-plan";

export const CMO_SCOPED_APPROVAL_CONTRACT = "cmo.scoped_approval.v1" as const;
export const CMO_SCOPED_APPROVAL_SET_CONTRACT = "cmo.scoped_approval_set.v1" as const;
export const CMO_GOAL_APPROVAL_PATCH_CONTRACT = "cmo.goal_approval_patch.v1" as const;
export const CMO_SCOPED_APPROVAL_RESPONSE_METADATA_CONTRACT =
  "cmo.scoped_approval_response_metadata.v1" as const;

export const CMO_SCOPED_APPROVAL_SCOPE_TYPES = [
  "plan",
  "draft",
  "creative",
  "execution",
  "publish",
  "schedule",
  "paid_generation",
  "revision",
] as const;

export const CMO_SCOPED_APPROVAL_STATUSES = [
  "requested",
  "approved",
  "rejected",
  "expired",
  "superseded",
] as const;

export type CmoScopedApprovalContractV1 = typeof CMO_SCOPED_APPROVAL_CONTRACT;
export type CmoScopedApprovalSetContractV1 = typeof CMO_SCOPED_APPROVAL_SET_CONTRACT;
export type CmoGoalApprovalPatchContractV1 = typeof CMO_GOAL_APPROVAL_PATCH_CONTRACT;
export type CmoScopedApprovalResponseMetadataContractV1 =
  typeof CMO_SCOPED_APPROVAL_RESPONSE_METADATA_CONTRACT;
export type CmoScopedApprovalScopeTypeV1 = (typeof CMO_SCOPED_APPROVAL_SCOPE_TYPES)[number];
export type CmoScopedApprovalStatusV1 = (typeof CMO_SCOPED_APPROVAL_STATUSES)[number];

export interface CmoScopedApprovalScopeV1 {
  type: CmoScopedApprovalScopeTypeV1;
  target_id: string;
  target_contract: string;
  target_summary: string;
}

export interface CmoScopedApprovalRequestedV1 {
  requested_at: string;
  requested_by: string | null;
  prompt: string;
  safe_user_message: string;
}

export interface CmoScopedApprovalDecisionV1 {
  approved: boolean;
  decided_at: string | null;
  decided_by: string | null;
  reason: string | null;
}

export interface CmoScopedApprovalConstraintsV1 {
  expires_at: string | null;
  max_scope: CmoScopedApprovalScopeTypeV1;
  requires_separate_execution_approval: boolean;
  requires_separate_publish_approval: boolean;
  requires_separate_schedule_approval: boolean;
  requires_separate_paid_generation_approval: boolean;
}

export interface CmoScopedApprovalGuardrailsV1 {
  no_execution_without_execution_approval: true;
  no_publish_without_publish_approval: true;
  no_schedule_without_schedule_approval: true;
  no_paid_generation_without_paid_generation_approval: true;
}

export interface CmoScopedApprovalV1 {
  contract: CmoScopedApprovalContractV1;
  approval_id: string;
  goal_id: string | null;
  workspace_id: string | null;
  app_id: string | null;
  session_id: string | null;
  scope: CmoScopedApprovalScopeV1;
  status: CmoScopedApprovalStatusV1;
  requested: CmoScopedApprovalRequestedV1;
  decision: CmoScopedApprovalDecisionV1;
  constraints: CmoScopedApprovalConstraintsV1;
  guardrails: CmoScopedApprovalGuardrailsV1;
}

export interface CmoScopedApprovalSetV1 {
  contract: CmoScopedApprovalSetContractV1;
  approvals: CmoScopedApprovalV1[];
  guardrails: CmoScopedApprovalGuardrailsV1;
}

export interface CmoScopedApprovalProceedResultV1 {
  allowed: boolean;
  requested_scope: CmoScopedApprovalScopeTypeV1;
  target_id: string;
  target_contract: string | null;
  matched_approval_ids: string[];
  blocked_approval_ids: string[];
  missing_scopes: CmoScopedApprovalScopeTypeV1[];
  safe_user_message: string;
}

export interface CmoGoalApprovalPatchV1 {
  contract: CmoGoalApprovalPatchContractV1;
  goal_id: string;
  scope: CmoGoalApprovalNameV1;
  approvals: Partial<Record<CmoGoalApprovalNameV1, CmoGoalApprovalV1>>;
  touched_scopes: CmoGoalApprovalNameV1[];
  no_other_scopes_touched: true;
}

export interface CmoScopedApprovalSeparationRuleV1 {
  scope: CmoScopedApprovalScopeTypeV1;
  permits: string;
  does_not_permit: CmoScopedApprovalScopeTypeV1[];
}

export interface CmoScopedApprovalSeparationSummaryV1 {
  contract: "cmo.scoped_approval_separation_summary.v1";
  rules: CmoScopedApprovalSeparationRuleV1[];
}

export interface CmoScopedApprovalResponseMetadataV1 {
  contract: CmoScopedApprovalResponseMetadataContractV1;
  approval_requests: CmoScopedApprovalV1[];
  proceed_checks: CmoScopedApprovalProceedResultV1[];
  separation_summary: CmoScopedApprovalSeparationSummaryV1;
}

export interface CreateCmoScopedApprovalRequestInputV1 {
  approvalId: string;
  now: string;
  goalId?: string | null;
  workspaceId?: string | null;
  appId?: string | null;
  sessionId?: string | null;
  scope: {
    type: CmoScopedApprovalScopeTypeV1;
    targetId: string;
    targetContract: string;
    targetSummary: string;
  };
  requestedBy?: string | null;
  prompt?: string | null;
  safeUserMessage?: string | null;
  expiresAt?: string | null;
  maxScope?: CmoScopedApprovalScopeTypeV1 | null;
}

export interface ApplyCmoScopedApprovalDecisionInputV1 {
  approval: CmoScopedApprovalV1;
  approved: boolean;
  decidedAt: string;
  decidedBy?: string | null;
  reason?: string | null;
  status?: Exclude<CmoScopedApprovalStatusV1, "requested"> | null;
}

export interface CanCmoProceedWithScopeInputV1 {
  approvals: CmoScopedApprovalV1[] | CmoScopedApprovalSetV1 | null | undefined;
  scopeType: CmoScopedApprovalScopeTypeV1;
  targetId: string;
  targetContract?: string | null;
  now?: string | null;
}

export interface CreateCmoWeeklyPlanApprovalRequestInputV1 {
  weeklyPlan: CmoWeeklyGoalPlanV1;
  approvalId: string;
  now: string;
  requestedBy?: string | null;
  expiresAt?: string | null;
}

const SAFE_TEXT_PATTERN =
  /(?:\b(?:api[_-]?key|apiKey|authorization|bearer|cookie|headers?|access[_-]?token|refresh[_-]?token|refreshToken|secret)\b|raw[\s_-]?ga4|rawGa4Response)/i;
const GOAL_APPROVAL_SCOPES = new Set<CmoGoalApprovalNameV1>([
  "plan",
  "execution",
  "publish",
  "schedule",
  "paid_generation",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeString(value: unknown, fallback: string, maxLength = 280): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";

  if (!text || SAFE_TEXT_PATTERN.test(text)) {
    return fallback;
  }

  return text;
}

function nullableSafeString(value: unknown, maxLength = 160): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";

  if (!text || SAFE_TEXT_PATTERN.test(text)) {
    return null;
  }

  return text;
}

function safeId(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value : "";
  const safeValue = text.replace(/[^A-Za-z0-9_.:-]/g, "-").replace(/-+/g, "-").slice(0, 120);

  return safeValue || fallback;
}

function isScopeType(value: unknown): value is CmoScopedApprovalScopeTypeV1 {
  return CMO_SCOPED_APPROVAL_SCOPE_TYPES.includes(value as CmoScopedApprovalScopeTypeV1);
}

function isGoalApprovalScope(value: CmoScopedApprovalScopeTypeV1): value is CmoGoalApprovalNameV1 {
  return GOAL_APPROVAL_SCOPES.has(value as CmoGoalApprovalNameV1);
}

function guardrails(): CmoScopedApprovalGuardrailsV1 {
  return {
    no_execution_without_execution_approval: true,
    no_publish_without_publish_approval: true,
    no_schedule_without_schedule_approval: true,
    no_paid_generation_without_paid_generation_approval: true,
  };
}

function constraintsForScope(input: {
  scopeType: CmoScopedApprovalScopeTypeV1;
  expiresAt?: string | null;
  maxScope?: CmoScopedApprovalScopeTypeV1 | null;
}): CmoScopedApprovalConstraintsV1 {
  const maxScope = input.maxScope && isScopeType(input.maxScope) ? input.maxScope : input.scopeType;

  return {
    expires_at: nullableSafeString(input.expiresAt, 80),
    max_scope: maxScope,
    requires_separate_execution_approval: input.scopeType !== "execution",
    requires_separate_publish_approval: input.scopeType !== "publish",
    requires_separate_schedule_approval: input.scopeType !== "schedule",
    requires_separate_paid_generation_approval: input.scopeType !== "paid_generation",
  };
}

function defaultPrompt(scopeType: CmoScopedApprovalScopeTypeV1, targetSummary: string): string {
  return `Approve the ${scopeType} scope for ${targetSummary}. This approval is scoped and does not grant other scopes.`;
}

function statusFromDecision(input: ApplyCmoScopedApprovalDecisionInputV1): CmoScopedApprovalStatusV1 {
  if (input.status) {
    return input.status;
  }

  return input.approved ? "approved" : "rejected";
}

function dateMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function approvalExpiredByTime(approval: CmoScopedApprovalV1, now: string | null | undefined): boolean {
  const expiresAt = dateMs(approval.constraints.expires_at);
  const nowMs = dateMs(now);

  return expiresAt !== null && nowMs !== null && nowMs > expiresAt;
}

function approvalMatchesTarget(input: {
  approval: CmoScopedApprovalV1;
  scopeType: CmoScopedApprovalScopeTypeV1;
  targetId: string;
  targetContract?: string | null;
}): boolean {
  if (input.approval.scope.type !== input.scopeType) {
    return false;
  }

  if (input.approval.scope.target_id !== input.targetId) {
    return false;
  }

  return !input.targetContract || input.approval.scope.target_contract === input.targetContract;
}

function approvedAndUsable(approval: CmoScopedApprovalV1, now: string | null | undefined): boolean {
  return approval.status === "approved" &&
    approval.decision.approved === true &&
    !approvalExpiredByTime(approval, now);
}

function blockedMessage(
  scopeType: CmoScopedApprovalScopeTypeV1,
  targetId: string,
  matchedApprovals: CmoScopedApprovalV1[],
  now: string | null | undefined,
): string {
  const rejected = matchedApprovals.find((approval) => approval.status === "rejected");

  if (rejected) {
    return `The ${scopeType} approval for ${targetId} was rejected. Request a new scoped approval before proceeding.`;
  }

  const expired = matchedApprovals.find((approval) => approval.status === "expired" || approvalExpiredByTime(approval, now));

  if (expired) {
    return `The ${scopeType} approval for ${targetId} is expired. Request a fresh scoped approval before proceeding.`;
  }

  const superseded = matchedApprovals.find((approval) => approval.status === "superseded");

  if (superseded) {
    return `The ${scopeType} approval for ${targetId} was superseded. Use the current scoped approval before proceeding.`;
  }

  return `Missing ${scopeType} approval for ${targetId}. A different approval scope does not grant this scope.`;
}

function approvalsFromInput(input: CmoScopedApprovalV1[] | CmoScopedApprovalSetV1 | null | undefined): CmoScopedApprovalV1[] {
  if (Array.isArray(input)) {
    return input.filter((approval) => approval.contract === CMO_SCOPED_APPROVAL_CONTRACT);
  }

  if (isRecord(input) && input.contract === CMO_SCOPED_APPROVAL_SET_CONTRACT && Array.isArray(input.approvals)) {
    return input.approvals.filter((approval) => approval.contract === CMO_SCOPED_APPROVAL_CONTRACT);
  }

  return [];
}

export function createCmoScopedApprovalRequest(input: CreateCmoScopedApprovalRequestInputV1): CmoScopedApprovalV1 {
  const scopeType = isScopeType(input.scope.type) ? input.scope.type : "revision";
  const targetId = safeId(input.scope.targetId, `${scopeType}_target`);
  const targetContract = safeString(input.scope.targetContract, "unknown.contract", 120);
  const targetSummary = safeString(input.scope.targetSummary, `${scopeType} target`, 240);
  const prompt = safeString(input.prompt, defaultPrompt(scopeType, targetSummary), 600);

  return {
    contract: CMO_SCOPED_APPROVAL_CONTRACT,
    approval_id: safeId(input.approvalId, `${scopeType}_${targetId}_approval`),
    goal_id: nullableSafeString(input.goalId, 120),
    workspace_id: nullableSafeString(input.workspaceId, 120),
    app_id: nullableSafeString(input.appId, 120),
    session_id: nullableSafeString(input.sessionId, 120),
    scope: {
      type: scopeType,
      target_id: targetId,
      target_contract: targetContract,
      target_summary: targetSummary,
    },
    status: "requested",
    requested: {
      requested_at: safeString(input.now, "unknown_time", 80),
      requested_by: nullableSafeString(input.requestedBy, 120),
      prompt,
      safe_user_message: safeString(input.safeUserMessage, prompt, 1_200),
    },
    decision: {
      approved: false,
      decided_at: null,
      decided_by: null,
      reason: null,
    },
    constraints: constraintsForScope({
      scopeType,
      expiresAt: input.expiresAt,
      maxScope: input.maxScope,
    }),
    guardrails: guardrails(),
  };
}

export function applyCmoScopedApprovalDecision(
  input: ApplyCmoScopedApprovalDecisionInputV1,
): CmoScopedApprovalV1 {
  const status = statusFromDecision(input);
  const approved = status === "approved" && input.approved === true;

  return {
    ...input.approval,
    status,
    decision: {
      approved,
      decided_at: safeString(input.decidedAt, "unknown_time", 80),
      decided_by: nullableSafeString(input.decidedBy, 120),
      reason: nullableSafeString(input.reason, 360),
    },
  };
}

export function createCmoScopedApprovalSet(input: {
  approvals?: CmoScopedApprovalV1[] | null;
} = {}): CmoScopedApprovalSetV1 {
  return {
    contract: CMO_SCOPED_APPROVAL_SET_CONTRACT,
    approvals: (input.approvals ?? []).filter((approval) => approval.contract === CMO_SCOPED_APPROVAL_CONTRACT),
    guardrails: guardrails(),
  };
}

export function canCmoProceedWithScope(input: CanCmoProceedWithScopeInputV1): CmoScopedApprovalProceedResultV1 {
  const targetId = safeId(input.targetId, `${input.scopeType}_target`);
  const targetContract = nullableSafeString(input.targetContract, 120);
  const approvals = approvalsFromInput(input.approvals);
  const matched = approvals.filter((approval) =>
    approvalMatchesTarget({
      approval,
      scopeType: input.scopeType,
      targetId,
      targetContract,
    }),
  );
  const usable = matched.filter((approval) => approvedAndUsable(approval, input.now));

  if (usable.length) {
    return {
      allowed: true,
      requested_scope: input.scopeType,
      target_id: targetId,
      target_contract: targetContract,
      matched_approval_ids: usable.map((approval) => approval.approval_id),
      blocked_approval_ids: [],
      missing_scopes: [],
      safe_user_message: `${input.scopeType} approval is present for ${targetId}. Other scopes still require their own approvals.`,
    };
  }

  return {
    allowed: false,
    requested_scope: input.scopeType,
    target_id: targetId,
    target_contract: targetContract,
    matched_approval_ids: [],
    blocked_approval_ids: matched.map((approval) => approval.approval_id),
    missing_scopes: [input.scopeType],
    safe_user_message: blockedMessage(input.scopeType, targetId, matched, input.now),
  };
}

export function createCmoWeeklyPlanApprovalRequest(
  input: CreateCmoWeeklyPlanApprovalRequestInputV1,
): CmoScopedApprovalV1 {
  const plan = input.weeklyPlan;
  const targetId = plan.goal_id ?? `${plan.workspace_id ?? "workspace"}:${plan.session_id ?? "session"}:weekly_plan`;
  const targetSummary = plan.plan_summary.user_visible_title || plan.plan_summary.goal_summary || "CMO weekly goal plan";

  return createCmoScopedApprovalRequest({
    approvalId: input.approvalId,
    now: input.now,
    goalId: plan.goal_id,
    workspaceId: plan.workspace_id,
    appId: plan.app_id,
    sessionId: plan.session_id,
    requestedBy: input.requestedBy,
    expiresAt: input.expiresAt,
    scope: {
      type: "plan",
      targetId,
      targetContract: plan.contract,
      targetSummary,
    },
    prompt: plan.approval.approval_prompt,
    safeUserMessage: plan.plan_summary.user_visible_body,
  });
}

export function deriveCmoGoalApprovalPatch(input: {
  approval: CmoScopedApprovalV1;
}): CmoGoalApprovalPatchV1 | null {
  const scopeType = input.approval.scope.type;
  const goalId = input.approval.goal_id;

  if (!goalId || !isGoalApprovalScope(scopeType)) {
    return null;
  }

  const approved = input.approval.status === "approved" && input.approval.decision.approved === true;
  const approvalPatch: CmoGoalApprovalV1 = {
    approved,
    approved_at: approved ? input.approval.decision.decided_at : null,
    approved_by: approved ? input.approval.decision.decided_by : null,
  };

  return {
    contract: CMO_GOAL_APPROVAL_PATCH_CONTRACT,
    goal_id: goalId,
    scope: scopeType,
    approvals: {
      [scopeType]: approvalPatch,
    },
    touched_scopes: [scopeType],
    no_other_scopes_touched: true,
  };
}

export function summarizeCmoScopedApprovalSeparation(): CmoScopedApprovalSeparationSummaryV1 {
  return {
    contract: "cmo.scoped_approval_separation_summary.v1",
    rules: [
      {
        scope: "plan",
        permits: "Use the weekly plan as approved direction.",
        does_not_permit: ["draft", "creative", "execution", "publish", "schedule", "paid_generation", "revision"],
      },
      {
        scope: "draft",
        permits: "Advance the approved draft to the next review step.",
        does_not_permit: ["creative", "execution", "publish", "schedule", "paid_generation", "revision"],
      },
      {
        scope: "creative",
        permits: "Use the approved creative direction or selected asset.",
        does_not_permit: ["execution", "publish", "schedule", "paid_generation", "revision"],
      },
      {
        scope: "execution",
        permits: "Run execution preflight for the scoped target.",
        does_not_permit: ["publish", "schedule", "paid_generation"],
      },
      {
        scope: "publish",
        permits: "Run publish preflight for the scoped target.",
        does_not_permit: ["schedule", "paid_generation"],
      },
      {
        scope: "schedule",
        permits: "Run schedule preflight for the scoped target.",
        does_not_permit: ["publish", "paid_generation"],
      },
      {
        scope: "paid_generation",
        permits: "Run paid generation preflight for the scoped target.",
        does_not_permit: ["publish", "schedule"],
      },
      {
        scope: "revision",
        permits: "Apply the specific approved revision target.",
        does_not_permit: ["execution", "publish", "schedule", "paid_generation"],
      },
    ],
  };
}

export function createCmoScopedApprovalResponseMetadata(input: {
  approvalRequests?: CmoScopedApprovalV1[] | null;
  proceedChecks?: CmoScopedApprovalProceedResultV1[] | null;
} = {}): CmoScopedApprovalResponseMetadataV1 {
  return {
    contract: CMO_SCOPED_APPROVAL_RESPONSE_METADATA_CONTRACT,
    approval_requests: (input.approvalRequests ?? [])
      .filter((approval) => approval.contract === CMO_SCOPED_APPROVAL_CONTRACT),
    proceed_checks: input.proceedChecks ?? [],
    separation_summary: summarizeCmoScopedApprovalSeparation(),
  };
}
