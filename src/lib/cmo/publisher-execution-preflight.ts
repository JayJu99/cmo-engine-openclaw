import {
  CMO_SCOPED_APPROVAL_CONTRACT,
  CMO_SCOPED_APPROVAL_SET_CONTRACT,
  canCmoProceedWithScope,
  type CmoScopedApprovalScopeTypeV1,
  type CmoScopedApprovalSetV1,
  type CmoScopedApprovalV1,
} from "@/lib/cmo/scoped-approval";

export const CMO_PUBLISHER_EXECUTION_PREFLIGHT_CONTRACT =
  "cmo.publisher_execution_preflight.v1" as const;

export const CMO_PUBLISHER_EXECUTION_PREFLIGHT_ACTION_TYPES = [
  "execute",
  "publish",
  "schedule",
  "paid_generation",
] as const;

export type CmoPublisherExecutionPreflightContractV1 =
  typeof CMO_PUBLISHER_EXECUTION_PREFLIGHT_CONTRACT;
export type CmoPublisherExecutionPreflightActionTypeV1 =
  (typeof CMO_PUBLISHER_EXECUTION_PREFLIGHT_ACTION_TYPES)[number];
export type CmoPublisherApprovalScopeForActionV1 = Extract<
  CmoScopedApprovalScopeTypeV1,
  "execution" | "publish" | "schedule" | "paid_generation"
>;

export interface CmoPublisherExecutionPreflightActionV1 {
  type: CmoPublisherExecutionPreflightActionTypeV1;
  target_id: string;
  target_contract: string;
  channel: string | null;
  provider: string | null;
  scheduled_for: string | null;
}

export interface CmoPublisherExecutionPreflightApprovalCheckV1 {
  allowed: boolean;
  required_scopes: CmoPublisherApprovalScopeForActionV1[];
  satisfied_scopes: CmoPublisherApprovalScopeForActionV1[];
  missing_scopes: CmoPublisherApprovalScopeForActionV1[];
  rejected_scopes: CmoPublisherApprovalScopeForActionV1[];
  expired_or_superseded_scopes: CmoPublisherApprovalScopeForActionV1[];
  safe_user_message: string;
}

export interface CmoPublisherExecutionPreflightIdempotencyV1 {
  key: string;
  scope: string;
  target_id: string;
  action_type: CmoPublisherExecutionPreflightActionTypeV1;
}

export interface CmoPublisherExecutionPreflightAuditV1 {
  dry_run_only: true;
  no_side_effects: true;
  would_call_publisher: false;
  would_schedule: false;
  would_publish: false;
}

export interface CmoPublisherExecutionPreflightGuardrailsV1 {
  no_execution_in_preflight: true;
  approval_required_before_execution: true;
  publish_requires_publish_approval: true;
  schedule_requires_schedule_approval: true;
  paid_generation_requires_paid_generation_approval: true;
}

export interface CmoPublisherExecutionPreflightResultV1 {
  contract: CmoPublisherExecutionPreflightContractV1;
  preflight_id: string;
  goal_id: string | null;
  workspace_id: string | null;
  app_id: string | null;
  session_id: string | null;
  requested_action: CmoPublisherExecutionPreflightActionV1;
  approval_check: CmoPublisherExecutionPreflightApprovalCheckV1;
  idempotency: CmoPublisherExecutionPreflightIdempotencyV1;
  audit: CmoPublisherExecutionPreflightAuditV1;
  guardrails: CmoPublisherExecutionPreflightGuardrailsV1;
}

export interface CmoPublisherExecutionPreflightRequestV1 {
  preflightId: string;
  goalId?: string | null;
  workspaceId?: string | null;
  appId?: string | null;
  sessionId?: string | null;
  approvals?: CmoScopedApprovalV1[] | CmoScopedApprovalSetV1 | null;
  requestedAction: {
    type: CmoPublisherExecutionPreflightActionTypeV1;
    targetId: string;
    targetContract: string;
    channel?: string | null;
    provider?: string | null;
    scheduledFor?: string | null;
    executionRequired?: boolean | null;
  };
  now?: string | null;
}

interface ScopeStatus {
  scope: CmoPublisherApprovalScopeForActionV1;
  allowed: boolean;
  rejected: boolean;
  expiredOrSuperseded: boolean;
  missing: boolean;
  matchedApprovalIds: string[];
  blockedApprovalIds: string[];
  safeUserMessage: string;
}

const SAFE_TEXT_PATTERN =
  /(?:\b(?:api[_-]?key|apiKey|authorization|bearer|cookie|headers?|access[_-]?token|refresh[_-]?token|refreshToken|secret)\b|raw[\s_-]?ga4|rawGa4Response)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeString(value: unknown, fallback: string, maxLength = 180): string {
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

  if (!text || SAFE_TEXT_PATTERN.test(text)) {
    return fallback;
  }

  const safeValue = text.replace(/[^A-Za-z0-9_.:-]/g, "-").replace(/-+/g, "-").slice(0, 140);

  return safeValue || fallback;
}

function normalizeKeyPart(value: string | null | undefined): string {
  return (value ?? "none")
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "none";
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
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

function approvalsFromInput(input: CmoScopedApprovalV1[] | CmoScopedApprovalSetV1 | null | undefined): CmoScopedApprovalV1[] {
  if (Array.isArray(input)) {
    return input.filter((approval) => approval.contract === CMO_SCOPED_APPROVAL_CONTRACT);
  }

  if (isRecord(input) && input.contract === CMO_SCOPED_APPROVAL_SET_CONTRACT && Array.isArray(input.approvals)) {
    return input.approvals.filter((approval) => approval.contract === CMO_SCOPED_APPROVAL_CONTRACT);
  }

  return [];
}

function scopeStatus(input: {
  approvals: CmoScopedApprovalV1[];
  scope: CmoPublisherApprovalScopeForActionV1;
  targetId: string;
  targetContract: string;
  now: string | null | undefined;
}): ScopeStatus {
  const proceed = canCmoProceedWithScope({
    approvals: input.approvals,
    scopeType: input.scope,
    targetId: input.targetId,
    targetContract: input.targetContract,
    now: input.now,
  });
  const matched = input.approvals.filter((approval) =>
    approval.scope.type === input.scope &&
    approval.scope.target_id === input.targetId &&
    approval.scope.target_contract === input.targetContract,
  );
  const rejected = matched.some((approval) => approval.status === "rejected");
  const expiredOrSuperseded = matched.some((approval) =>
    approval.status === "expired" ||
    approval.status === "superseded" ||
    approvalExpiredByTime(approval, input.now),
  );

  return {
    scope: input.scope,
    allowed: proceed.allowed,
    rejected,
    expiredOrSuperseded,
    missing: !proceed.allowed && !rejected && !expiredOrSuperseded,
    matchedApprovalIds: proceed.matched_approval_ids,
    blockedApprovalIds: proceed.blocked_approval_ids,
    safeUserMessage: proceed.safe_user_message,
  };
}

function audit(): CmoPublisherExecutionPreflightAuditV1 {
  return {
    dry_run_only: true,
    no_side_effects: true,
    would_call_publisher: false,
    would_schedule: false,
    would_publish: false,
  };
}

function guardrails(): CmoPublisherExecutionPreflightGuardrailsV1 {
  return {
    no_execution_in_preflight: true,
    approval_required_before_execution: true,
    publish_requires_publish_approval: true,
    schedule_requires_schedule_approval: true,
    paid_generation_requires_paid_generation_approval: true,
  };
}

export function requiredCmoApprovalScopesForPublisherAction(input: {
  actionType: CmoPublisherExecutionPreflightActionTypeV1;
  executionRequired?: boolean | null;
}): CmoPublisherApprovalScopeForActionV1[] {
  if (input.actionType === "execute") {
    return ["execution"];
  }

  if (input.actionType === "publish") {
    return input.executionRequired === false ? ["publish"] : ["execution", "publish"];
  }

  if (input.actionType === "schedule") {
    return input.executionRequired === false ? ["schedule"] : ["execution", "schedule"];
  }

  return ["paid_generation"];
}

export function createCmoPublisherIdempotencyKey(input: {
  actionType: CmoPublisherExecutionPreflightActionTypeV1;
  goalId?: string | null;
  targetContract: string;
  targetId: string;
  channel?: string | null;
  provider?: string | null;
  scheduledFor?: string | null;
}): string {
  const parts = [
    "cmo_publisher_preflight",
    normalizeKeyPart(input.actionType),
    normalizeKeyPart(input.goalId ?? null),
    normalizeKeyPart(input.targetContract),
    normalizeKeyPart(input.targetId),
    normalizeKeyPart(input.channel ?? null),
    normalizeKeyPart(input.provider ?? null),
    normalizeKeyPart(input.scheduledFor ?? null),
  ];
  const base = parts.join(":");

  return `${base}:${hashString(base)}`;
}

export function summarizeCmoPublisherPreflightBlock(input: {
  actionType: CmoPublisherExecutionPreflightActionTypeV1;
  targetId: string;
  missingScopes: CmoPublisherApprovalScopeForActionV1[];
  rejectedScopes: CmoPublisherApprovalScopeForActionV1[];
  expiredOrSupersededScopes: CmoPublisherApprovalScopeForActionV1[];
}): string {
  const blockers = [
    input.missingScopes.length ? `missing ${input.missingScopes.join(", ")} approval` : "",
    input.rejectedScopes.length ? `rejected ${input.rejectedScopes.join(", ")} approval` : "",
    input.expiredOrSupersededScopes.length
      ? `expired or superseded ${input.expiredOrSupersededScopes.join(", ")} approval`
      : "",
  ].filter(Boolean);

  if (!blockers.length) {
    return `${input.actionType} preflight is allowed for ${input.targetId}. This is still dry-run only and performs no action.`;
  }

  return `${input.actionType} preflight is blocked for ${input.targetId}: ${blockers.join("; ")}. Request explicit scoped approval before proceeding.`;
}

export function createCmoPublisherExecutionPreflight(
  input: CmoPublisherExecutionPreflightRequestV1,
): CmoPublisherExecutionPreflightResultV1 {
  const actionType = input.requestedAction.type;
  const targetId = safeId(input.requestedAction.targetId, `${actionType}_target`);
  const targetContract = safeString(input.requestedAction.targetContract, "unknown.contract", 120);
  const channel = nullableSafeString(input.requestedAction.channel, 120);
  const provider = nullableSafeString(input.requestedAction.provider, 120);
  const scheduledFor = nullableSafeString(input.requestedAction.scheduledFor, 120);
  const requiredScopes = requiredCmoApprovalScopesForPublisherAction({
    actionType,
    executionRequired: input.requestedAction.executionRequired,
  });
  const approvals = approvalsFromInput(input.approvals);
  const statuses = requiredScopes.map((scope) =>
    scopeStatus({
      approvals,
      scope,
      targetId,
      targetContract,
      now: input.now,
    }),
  );
  const satisfiedScopes = statuses
    .filter((status) => status.allowed)
    .map((status) => status.scope);
  const missingScopes = statuses
    .filter((status) => status.missing)
    .map((status) => status.scope);
  const rejectedScopes = statuses
    .filter((status) => status.rejected)
    .map((status) => status.scope);
  const expiredOrSupersededScopes = statuses
    .filter((status) => status.expiredOrSuperseded)
    .map((status) => status.scope);
  const allowed = requiredScopes.every((scope) => satisfiedScopes.includes(scope));
  const idempotencyKey = createCmoPublisherIdempotencyKey({
    actionType,
    goalId: input.goalId,
    targetContract,
    targetId,
    channel,
    provider,
    scheduledFor,
  });

  return {
    contract: CMO_PUBLISHER_EXECUTION_PREFLIGHT_CONTRACT,
    preflight_id: safeId(input.preflightId, `${actionType}_${targetId}_preflight`),
    goal_id: nullableSafeString(input.goalId, 120),
    workspace_id: nullableSafeString(input.workspaceId, 120),
    app_id: nullableSafeString(input.appId, 120),
    session_id: nullableSafeString(input.sessionId, 120),
    requested_action: {
      type: actionType,
      target_id: targetId,
      target_contract: targetContract,
      channel,
      provider,
      scheduled_for: scheduledFor,
    },
    approval_check: {
      allowed,
      required_scopes: requiredScopes,
      satisfied_scopes: satisfiedScopes,
      missing_scopes: missingScopes,
      rejected_scopes: rejectedScopes,
      expired_or_superseded_scopes: expiredOrSupersededScopes,
      safe_user_message: allowed
        ? `${actionType} preflight is allowed for ${targetId}. This remains dry-run only and does not execute, publish, schedule, or call a provider.`
        : summarizeCmoPublisherPreflightBlock({
          actionType,
          targetId,
          missingScopes,
          rejectedScopes,
          expiredOrSupersededScopes,
        }),
    },
    idempotency: {
      key: idempotencyKey,
      scope: requiredScopes.join("+"),
      target_id: targetId,
      action_type: actionType,
    },
    audit: audit(),
    guardrails: guardrails(),
  };
}
