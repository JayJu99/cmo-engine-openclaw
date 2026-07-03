import type { LensMetricsPack } from "@/lib/cmo/lens-metrics-pack";

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
export type LensMeasurementMetricIntentKey =
  | "activation"
  | "social_traffic"
  | "conversion"
  | "retention"
  | "weekly_goal_baseline"
  | "default";

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
  metrics_pack?: LensMetricsPack;
  metric_intent?: LensMeasurementMetricIntentResolution;
  missing_requirements?: LensMissingCapabilityRequirement[];
  error?: LensMeasurementSafeError;
  safe_user_message?: string;
}

export interface LensMeasurementMetricIntentResolution {
  resolved_key: LensMeasurementMetricIntentKey;
  matched_metric_keys: string[];
}

export interface LensMeasurementSafeError {
  code: string;
  safe_message: string;
  retryable?: boolean;
}

export interface LensMeasurementOutboundMetricSummary {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  display_value?: string;
  semantic_role?: string;
  mapping_status?: string;
  confidence?: string;
  missing_definition?: string;
  unavailable_reason?: string;
}

export interface LensMeasurementOutboundMetricsSummary {
  contract: "lens.metrics_summary.v1";
  range: {
    key: LensMeasurementRangeKey;
    date_start?: string | null;
    date_end?: string | null;
    timezone?: string | null;
  };
  generated_at?: string;
  quality?: {
    status?: string;
    is_stale?: boolean;
    missing_definitions?: string[];
    warnings?: string[];
  };
  metrics: LensMeasurementOutboundMetricSummary[];
}

export interface LensMeasurementOutboundContext {
  contract: typeof LENS_MEASUREMENT_RESULT_CONTRACT;
  status: LensMeasurementResultStatus;
  scope: LensMeasurementScope;
  metric_intent?: LensMeasurementMetricIntentResolution;
  safe_user_message?: string;
  missing_requirements?: LensMissingCapabilityRequirement[];
  error?: LensMeasurementSafeError;
  metrics_summary?: LensMeasurementOutboundMetricsSummary;
}

export interface LensCapabilityScopeInput {
  tenantId?: string | null;
  workspaceId?: string | null;
  appId?: string | null;
  rangeKey?: string | null;
}

export const DEFAULT_LENS_MEASUREMENT_RANGE_KEY: LensMeasurementRangeKey = "last_7_days";

export const UNSAFE_TEXT_PATTERN =
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

export function sanitizeLensMeasurementSafeText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const bounded = text ? text.slice(0, 240) : fallback;

  return UNSAFE_TEXT_PATTERN.test(bounded) ? fallback : bounded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => sanitizeLensMeasurementSafeText(item, ""))
    .filter(Boolean)
    .slice(0, maxItems);
}

function safeMetricIntent(value: unknown): LensMeasurementMetricIntentResolution | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const resolvedKey = value.resolved_key;
  const key: LensMeasurementMetricIntentKey =
    resolvedKey === "activation" ||
    resolvedKey === "social_traffic" ||
    resolvedKey === "conversion" ||
    resolvedKey === "retention" ||
    resolvedKey === "weekly_goal_baseline" ||
    resolvedKey === "default"
      ? resolvedKey
      : "default";

  return {
    resolved_key: key,
    matched_metric_keys: safeStringList(value.matched_metric_keys, 20),
  };
}

function safeMissingRequirements(value: unknown): LensMissingCapabilityRequirement[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const requirements = value
    .filter(isRecord)
    .map((requirement): LensMissingCapabilityRequirement => ({
      key: sanitizeLensMeasurementSafeText(requirement.key, "lens.capability_missing"),
      type: sanitizeLensMeasurementSafeText(requirement.type, "configuration"),
      severity: requirement.severity === "warning" ? "warning" : "blocking",
      action: sanitizeLensMeasurementSafeText(requirement.action, "configure_lens_capability"),
      safe_user_message: sanitizeLensMeasurementSafeText(requirement.safe_user_message, "Lens needs more setup before it can answer this measurement request."),
    }))
    .slice(0, 12);

  return requirements.length ? requirements : undefined;
}

function safeError(value: unknown): LensMeasurementSafeError | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    code: sanitizeLensMeasurementSafeText(value.code, "lens_measurement_failed"),
    safe_message: sanitizeLensMeasurementSafeText(value.safe_message, "Lens could not complete this measurement request safely."),
    ...(typeof value.retryable === "boolean" ? { retryable: value.retryable } : {}),
  };
}

function safeMetricsSummary(value: unknown): LensMeasurementOutboundMetricsSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const range = isRecord(value.range) ? value.range : {};
  const quality = isRecord(value.quality) ? value.quality : {};
  const metrics = Array.isArray(value.metrics)
    ? value.metrics
      .filter(isRecord)
      .map((metric): LensMeasurementOutboundMetricSummary => ({
        key: sanitizeLensMeasurementSafeText(metric.key, "metric.unavailable"),
        label: sanitizeLensMeasurementSafeText(metric.label, "Metric unavailable"),
        value: typeof metric.value === "number" && Number.isFinite(metric.value) ? metric.value : null,
        unit: sanitizeLensMeasurementSafeText(metric.unit, "unknown"),
        ...(typeof metric.displayValue === "string" ? { display_value: sanitizeLensMeasurementSafeText(metric.displayValue, "") } : {}),
        ...(typeof metric.semanticRole === "string" ? { semantic_role: sanitizeLensMeasurementSafeText(metric.semanticRole, "") } : {}),
        ...(typeof metric.mappingStatus === "string" ? { mapping_status: sanitizeLensMeasurementSafeText(metric.mappingStatus, "") } : {}),
        ...(typeof metric.confidence === "string" ? { confidence: sanitizeLensMeasurementSafeText(metric.confidence, "") } : {}),
        ...(typeof metric.missingDefinition === "string" ? { missing_definition: sanitizeLensMeasurementSafeText(metric.missingDefinition, "") } : {}),
        ...(typeof metric.unavailableReason === "string" ? { unavailable_reason: sanitizeLensMeasurementSafeText(metric.unavailableReason, "") } : {}),
      }))
      .slice(0, 20)
    : [];

  if (!metrics.length) {
    return undefined;
  }

  return {
    contract: "lens.metrics_summary.v1",
    range: {
      key: normalizeLensMeasurementRangeKey(typeof range.key === "string" ? range.key : undefined),
      ...(typeof range.dateStart === "string" ? { date_start: sanitizeLensMeasurementSafeText(range.dateStart, "") } : {}),
      ...(typeof range.dateEnd === "string" ? { date_end: sanitizeLensMeasurementSafeText(range.dateEnd, "") } : {}),
      ...(typeof range.timezone === "string" ? { timezone: sanitizeLensMeasurementSafeText(range.timezone, "") } : {}),
    },
    ...(typeof value.generatedAt === "string" ? { generated_at: sanitizeLensMeasurementSafeText(value.generatedAt, "") } : {}),
    quality: {
      ...(typeof quality.status === "string" ? { status: sanitizeLensMeasurementSafeText(quality.status, "") } : {}),
      ...(typeof quality.isStale === "boolean" ? { is_stale: quality.isStale } : {}),
      missing_definitions: safeStringList(quality.missingDefinitions, 12),
      warnings: safeStringList(quality.warnings, 12),
    },
    metrics,
  };
}

export function compactLensMeasurementResultForHermesContext(value: unknown): LensMeasurementOutboundContext | null {
  if (!isRecord(value) || value.contract !== LENS_MEASUREMENT_RESULT_CONTRACT) {
    return null;
  }

  const status = value.status === "completed" ||
    value.status === "missing_capability" ||
    value.status === "no_data" ||
    value.status === "failed"
    ? value.status
    : undefined;
  const rawScope = isRecord(value.scope) ? value.scope : null;
  const tenantId = sanitizeLensMeasurementSafeText(rawScope?.tenant_id, "");
  const workspaceId = sanitizeLensMeasurementSafeText(rawScope?.workspace_id, "");
  const appId = sanitizeLensMeasurementSafeText(rawScope?.app_id, "");

  if (!status || !rawScope || !tenantId || !workspaceId || !appId) {
    return null;
  }

  const metricsSummary = status === "completed" ? safeMetricsSummary(value.metrics_pack) : undefined;
  const safeUserMessage = sanitizeLensMeasurementSafeText(value.safe_user_message, "");
  const metricIntent = safeMetricIntent(value.metric_intent);
  const missingRequirements = safeMissingRequirements(value.missing_requirements);
  const error = safeError(value.error);

  return {
    contract: LENS_MEASUREMENT_RESULT_CONTRACT,
    status,
    scope: {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      app_id: appId,
      range_key: normalizeLensMeasurementRangeKey(typeof rawScope.range_key === "string" ? rawScope.range_key : undefined),
    },
    ...(metricIntent ? { metric_intent: metricIntent } : {}),
    ...(safeUserMessage ? { safe_user_message: safeUserMessage } : {}),
    ...(missingRequirements ? { missing_requirements: missingRequirements } : {}),
    ...(error ? { error } : {}),
    ...(metricsSummary ? { metrics_summary: metricsSummary } : {}),
  };
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
      key: sanitizeLensMeasurementSafeText(requirement.key, "lens.capability_missing"),
      type: sanitizeLensMeasurementSafeText(requirement.type, "configuration"),
      severity: requirement.severity === "warning" ? "warning" : "blocking",
      action: sanitizeLensMeasurementSafeText(requirement.action, "configure_lens_capability"),
      safe_user_message: sanitizeLensMeasurementSafeText(requirement.safe_user_message, "Lens needs more setup before it can answer this measurement request."),
    }))
    .slice(0, 12);

  return {
    contract: LENS_MEASUREMENT_RESULT_CONTRACT,
    status: "missing_capability",
    scope: input.scope,
    missing_requirements: missingRequirements,
    safe_user_message: sanitizeLensMeasurementSafeText(input.safeUserMessage, "Lens needs more setup before it can answer this measurement request."),
  };
}
