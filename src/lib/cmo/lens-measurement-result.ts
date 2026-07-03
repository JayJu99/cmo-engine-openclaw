export const LENS_METRICS_PACK_CONTRACT = "lens.metrics_pack.v1" as const;
export const LENS_MEASUREMENT_RESULT_CONTRACT = "lens.measurement_result.v1" as const;
export const LENS_CAPABILITY_CONTRACTS = [
  LENS_METRICS_PACK_CONTRACT,
  LENS_MEASUREMENT_RESULT_CONTRACT,
] as const;

export type LensCapabilityContract = (typeof LENS_CAPABILITY_CONTRACTS)[number];
export type LensMeasurementRangeKey = "this_week" | "last_7_days" | "last_30_days" | "this_month";
export type LensMeasurementResultStatus = "missing_capability" | "no_data" | "completed" | "failed";
export type LensMissingRequirementSeverity = "blocking" | "warning";

export interface LensMeasurementScope {
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  range_key: LensMeasurementRangeKey;
}

export interface LensCapabilityContext {
  enabled: true;
  scope: LensMeasurementScope;
  contracts: LensCapabilityContract[];
}

export interface LensMissingCapabilityRequirement {
  key: string;
  type: string;
  severity: LensMissingRequirementSeverity;
  action: string;
  safe_user_message: string;
}

export interface LensMeasurementResult {
  contract: typeof LENS_MEASUREMENT_RESULT_CONTRACT;
  status: LensMeasurementResultStatus;
  scope: LensMeasurementScope;
  missing_requirements?: LensMissingCapabilityRequirement[];
  safe_user_message?: string;
}

export interface LensCapabilityScopeInput {
  tenantId?: string | null;
  workspaceId?: string | null;
  appId?: string | null;
  rangeKey?: string | null;
}

export const DEFAULT_LENS_MEASUREMENT_RANGE_KEY: LensMeasurementRangeKey = "last_7_days";

const UNSAFE_TEXT_PATTERN =
  /(?:\b(?:api[_-]?key|apiKey|authorization|bearer|cookie|headers?|refresh[_-]?token|refreshToken|secret|token)\b|raw[\s_-]?ga4|rawGa4Response|prompt|answer[\s_-]?body|file:|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|\/(?:tmp|Users|home|var|mnt|private|Volumes)(?:\/|\b))/i;

function safeId(value: string | null | undefined, fallback: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";

  return trimmed || fallback;
}

export function normalizeLensMeasurementRangeKey(value: string | null | undefined): LensMeasurementRangeKey {
  return value === "this_week" || value === "last_7_days" || value === "last_30_days" || value === "this_month"
    ? value
    : DEFAULT_LENS_MEASUREMENT_RANGE_KEY;
}

function safeText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const bounded = text ? text.slice(0, 240) : fallback;

  return UNSAFE_TEXT_PATTERN.test(bounded) ? fallback : bounded;
}

export function createLensCapabilityContext(input: LensCapabilityScopeInput): LensCapabilityContext {
  const appId = safeId(input.appId, safeId(input.workspaceId, "unknown_app"));
  const workspaceId = safeId(input.workspaceId, appId);
  const tenantId = safeId(input.tenantId, workspaceId);

  return {
    enabled: true,
    scope: {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      app_id: appId,
      range_key: normalizeLensMeasurementRangeKey(input.rangeKey),
    },
    contracts: [...LENS_CAPABILITY_CONTRACTS],
  };
}

export function createLensMissingCapabilityResult(input: {
  scope: LensMeasurementScope;
  requirements: Array<Partial<LensMissingCapabilityRequirement>>;
  safeUserMessage?: string;
}): LensMeasurementResult {
  const missingRequirements = input.requirements
    .map((requirement): LensMissingCapabilityRequirement => ({
      key: safeText(requirement.key, "lens.capability_missing"),
      type: safeText(requirement.type, "configuration"),
      severity: requirement.severity === "warning" ? "warning" : "blocking",
      action: safeText(requirement.action, "configure_lens_capability"),
      safe_user_message: safeText(requirement.safe_user_message, "Lens needs more setup before it can answer this measurement request."),
    }))
    .slice(0, 12);

  return {
    contract: LENS_MEASUREMENT_RESULT_CONTRACT,
    status: "missing_capability",
    scope: input.scope,
    missing_requirements: missingRequirements,
    safe_user_message: safeText(input.safeUserMessage, "Lens needs more setup before it can answer this measurement request."),
  };
}
