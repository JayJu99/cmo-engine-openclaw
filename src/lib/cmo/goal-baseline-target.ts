import type { CmoGoalV1 } from "@/lib/cmo/goal-state";
import type {
  LensMetricGoalKindV1,
  LensMetricSourceResolutionV1,
  LensMetricSourceTypeV1,
} from "@/lib/cmo/lens-metric-source-resolution";

export const CMO_GOAL_BASELINE_TARGET_CONTRACT = "cmo.goal_baseline_target.v1" as const;

export type CmoGoalBaselineTargetContractV1 = typeof CMO_GOAL_BASELINE_TARGET_CONTRACT;
export type CmoGoalBaselineTargetBaselineStatusV1 =
  | "ready"
  | "missing_primary_source"
  | "manual_required"
  | "estimated"
  | "unavailable";
export type CmoGoalBaselineTargetTargetStatusV1 =
  | "ready"
  | "needs_baseline"
  | "invalid_goal"
  | "unsupported";
export type CmoGoalBaselineTargetSourceKindV1 =
  | "ga4_utm"
  | "meta_page_insights"
  | "x_post_insights"
  | "x_api"
  | "manual_input"
  | "estimated"
  | "unknown";
export type CmoGoalBaselineTargetConfidenceV1 = "high" | "medium" | "low" | "unknown";
export type CmoGoalBaselineInputKindV1 = "real" | "manual" | "estimated";
export type CmoGoalTargetModeV1 = "percent_increase" | "absolute" | "delta";

export interface CmoGoalBaselineTargetMetricV1 {
  kind: LensMetricGoalKindV1 | "unsupported" | "unknown";
  key: string;
  label: string;
}

export interface CmoGoalBaselineTargetEvidenceV1 {
  source_kind: CmoGoalBaselineTargetSourceKindV1;
  source_id?: string | null;
  label?: string | null;
  metric_key?: string | null;
  observed_at?: string | null;
  note?: string | null;
}

export interface CmoGoalBaselineTargetBaselineV1 {
  status: CmoGoalBaselineTargetBaselineStatusV1;
  value: number | null;
  unit: string;
  source_kind: CmoGoalBaselineTargetSourceKindV1;
  confidence: CmoGoalBaselineTargetConfidenceV1;
  evidence: CmoGoalBaselineTargetEvidenceV1[];
  is_real_measurement: boolean;
  is_estimated: boolean;
  planning_only: boolean;
}

export interface CmoGoalBaselineTargetWindowV1 {
  label?: string;
  start_date?: string | null;
  end_date?: string | null;
  timezone?: string | null;
}

export interface CmoGoalBaselineTargetDailyTargetV1 {
  day_index: number;
  date: string | null;
  target_value: number;
  delta_value: number;
  cumulative_delta_value: number;
}

export interface CmoGoalBaselineTargetTargetV1 {
  status: CmoGoalBaselineTargetTargetStatusV1;
  target_value: number | null;
  delta_value: number | null;
  delta_percent: number | null;
  window: CmoGoalBaselineTargetWindowV1 | null;
  daily_targets: CmoGoalBaselineTargetDailyTargetV1[];
}

export interface CmoGoalBaselineTargetMissingCapabilityRequestV1 {
  source_kind: CmoGoalBaselineTargetSourceKindV1;
  action: string;
  safe_user_message: string;
}

export interface CmoGoalBaselineTargetMissingV1 {
  missing_capability_request: CmoGoalBaselineTargetMissingCapabilityRequestV1 | null;
  reason: string | null;
  code: string | null;
}

export interface CmoGoalBaselineTargetGuardrailsV1 {
  no_execution: true;
  approval_required_before_execution: true;
}

export interface CmoGoalBaselineTargetV1 {
  contract: CmoGoalBaselineTargetContractV1;
  goal_id: string | null;
  workspace_id: string | null;
  app_id: string | null;
  session_id: string | null;
  metric: CmoGoalBaselineTargetMetricV1;
  baseline: CmoGoalBaselineTargetBaselineV1;
  target: CmoGoalBaselineTargetTargetV1;
  missing: CmoGoalBaselineTargetMissingV1;
  guardrails: CmoGoalBaselineTargetGuardrailsV1;
}

export interface CmoGoalBaselineSnapshotInputV1 {
  kind?: CmoGoalBaselineInputKindV1 | null;
  value?: number | null;
  unit?: string | null;
  source_kind?: CmoGoalBaselineTargetSourceKindV1 | LensMetricSourceTypeV1 | null;
  confidence?: CmoGoalBaselineTargetConfidenceV1 | "estimated" | null;
  evidence?: Array<Partial<CmoGoalBaselineTargetEvidenceV1>> | null;
  measured_at?: string | null;
  planning_only?: boolean | null;
  is_real_measurement?: boolean | null;
  is_estimated?: boolean | null;
}

export interface CmoGoalTargetInputV1 {
  mode?: CmoGoalTargetModeV1 | null;
  percent?: number | null;
  target_value?: number | null;
  delta_value?: number | null;
  daily_breakdown?: boolean | null;
}

export interface CalculateCmoGoalBaselineTargetInputV1 {
  goal?: CmoGoalV1 | null;
  sourceResolution?: LensMetricSourceResolutionV1 | null;
  baseline?: CmoGoalBaselineSnapshotInputV1 | null;
  target?: CmoGoalTargetInputV1 | null;
  metricLabel?: string | null;
}

export interface CmoGoalResolvedTargetValuesV1 {
  target_value: number;
  delta_value: number;
  delta_percent: number | null;
}

const UNKNOWN_METRIC_KEY = "unknown_metric";
const DEFAULT_UNIT = "count";
const MAX_DAILY_TARGET_DAYS = 366;
const SAFE_TEXT_PATTERN =
  /(?:\b(?:api[_-]?key|apiKey|authorization|bearer|cookie|headers?|access[_-]?token|refresh[_-]?token|refreshToken|secret)\b|raw[\s_-]?ga4|rawGa4Response)/i;
const SUPPORTED_GOAL_KINDS = new Set<LensMetricGoalKindV1>([
  "traffic",
  "facebook_engagement",
  "x_engagement",
  "platform_engagement",
  "conversion",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeString(value: unknown, fallback: string | null = null, maxLength = 160): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";

  if (!text || SAFE_TEXT_PATTERN.test(text)) {
    return fallback;
  }

  return text;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundMetric(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function normalizeSourceKind(value: unknown): CmoGoalBaselineTargetSourceKindV1 {
  if (
    value === "ga4_utm" ||
    value === "meta_page_insights" ||
    value === "x_post_insights" ||
    value === "x_api" ||
    value === "manual_input" ||
    value === "estimated"
  ) {
    return value;
  }

  return "unknown";
}

function normalizeConfidence(value: unknown): CmoGoalBaselineTargetConfidenceV1 {
  if (value === "high" || value === "medium" || value === "low" || value === "unknown") {
    return value;
  }

  if (value === "estimated") {
    return "low";
  }

  return "unknown";
}

function confidenceFromSourceResolution(value: unknown): CmoGoalBaselineTargetConfidenceV1 {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }

  return "unknown";
}

function normalizeGoalKind(value: unknown): LensMetricGoalKindV1 | "unknown" {
  if (
    value === "traffic" ||
    value === "facebook_engagement" ||
    value === "x_engagement" ||
    value === "platform_engagement" ||
    value === "conversion" ||
    value === "activation" ||
    value === "unknown"
  ) {
    return value;
  }

  return "unknown";
}

function metricLabelFromKey(key: string): string {
  if (key === "website_traffic") {
    return "Website traffic";
  }

  if (key === "facebook_engagement") {
    return "Facebook engagement";
  }

  if (key === "x_engagement") {
    return "X engagement";
  }

  if (key === "platform_engagement") {
    return "Platform engagement";
  }

  if (key === "conversions") {
    return "Conversions";
  }

  if (key === "activation") {
    return "Activation";
  }

  return key
    .split("_")
    .filter(Boolean)
    .map((part, index) => (index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(" ") || "Unknown metric";
}

function cloneWindow(value: unknown): CmoGoalBaselineTargetWindowV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const window: CmoGoalBaselineTargetWindowV1 = {};
  const label = safeString(value.label, null, 80);
  const startDate = safeString(value.start_date, null, 40);
  const endDate = safeString(value.end_date, null, 40);
  const timezone = safeString(value.timezone, null, 80);

  if (label) {
    window.label = label;
  }

  if ("start_date" in value) {
    window.start_date = startDate;
  }

  if ("end_date" in value) {
    window.end_date = endDate;
  }

  if ("timezone" in value) {
    window.timezone = timezone;
  }

  return Object.keys(window).length ? window : null;
}

function primarySourceRecord(resolution: unknown): Record<string, unknown> | null {
  if (!isRecord(resolution) || !isRecord(resolution.primary_source)) {
    return null;
  }

  return resolution.primary_source;
}

function sourceIsUsable(source: Record<string, unknown> | null): boolean {
  return source?.status === "ready" || source?.status === "partial";
}

function evidenceFromInput(
  input: CmoGoalBaselineSnapshotInputV1 | null | undefined,
  fallback: CmoGoalBaselineTargetEvidenceV1 | null,
): CmoGoalBaselineTargetEvidenceV1[] {
  const evidence = Array.isArray(input?.evidence)
    ? input.evidence
      .filter(isRecord)
      .map((item): CmoGoalBaselineTargetEvidenceV1 => ({
        source_kind: normalizeSourceKind(item.source_kind),
        ...(safeString(item.source_id, null, 120) ? { source_id: safeString(item.source_id, null, 120) } : {}),
        ...(safeString(item.label, null, 120) ? { label: safeString(item.label, null, 120) } : {}),
        ...(safeString(item.metric_key, null, 120) ? { metric_key: safeString(item.metric_key, null, 120) } : {}),
        ...(safeString(item.observed_at, null, 80) ? { observed_at: safeString(item.observed_at, null, 80) } : {}),
        ...(safeString(item.note, null, 180) ? { note: safeString(item.note, null, 180) } : {}),
      }))
    : [];

  if (evidence.length) {
    return evidence.slice(0, 8);
  }

  return fallback ? [fallback] : [];
}

function evidenceFromSource(source: Record<string, unknown> | null, metricKey: string): CmoGoalBaselineTargetEvidenceV1 | null {
  if (!source) {
    return null;
  }

  return {
    source_kind: normalizeSourceKind(source.source_type),
    ...(safeString(source.source_id, null, 120) ? { source_id: safeString(source.source_id, null, 120) } : {}),
    ...(safeString(source.label, null, 120) ? { label: safeString(source.label, null, 120) } : {}),
    metric_key: metricKey,
  };
}

function normalizeBaselineKind(input: CmoGoalBaselineSnapshotInputV1 | null | undefined): CmoGoalBaselineInputKindV1 | null {
  if (input?.kind === "real" || input?.kind === "manual" || input?.kind === "estimated") {
    return input.kind;
  }

  if (input?.source_kind === "manual_input") {
    return "manual";
  }

  if (input?.source_kind === "estimated" || input?.is_estimated === true) {
    return "estimated";
  }

  return finiteNumber(input?.value) === null ? null : "real";
}

function emptyMissing(): CmoGoalBaselineTargetMissingV1 {
  return {
    missing_capability_request: null,
    reason: null,
    code: null,
  };
}

function missingRequestFromResolution(resolution: unknown): CmoGoalBaselineTargetMissingCapabilityRequestV1 | null {
  if (!isRecord(resolution) || !Array.isArray(resolution.missing_requirements)) {
    return null;
  }

  const requirements = resolution.missing_requirements.filter(isRecord);
  const requirement = requirements.find((item) => item.severity === "blocking") ?? requirements[0];

  if (!requirement) {
    return null;
  }

  return {
    source_kind: normalizeSourceKind(requirement.source_type),
    action: safeString(requirement.action, "resolve_measurement_source", 100) ?? "resolve_measurement_source",
    safe_user_message: safeString(
      requirement.safe_user_message,
      "Resolve the primary measurement source before claiming a real baseline.",
      240,
    ) ?? "Resolve the primary measurement source before claiming a real baseline.",
  };
}

export function createRealBaseline(input: {
  value: number;
  unit?: string | null;
  source_kind?: CmoGoalBaselineTargetSourceKindV1 | LensMetricSourceTypeV1 | null;
  confidence?: CmoGoalBaselineTargetConfidenceV1 | "estimated" | null;
  evidence?: CmoGoalBaselineTargetEvidenceV1[];
}): CmoGoalBaselineTargetBaselineV1 {
  return {
    status: "ready",
    value: roundMetric(input.value),
    unit: safeString(input.unit, DEFAULT_UNIT, 40) ?? DEFAULT_UNIT,
    source_kind: normalizeSourceKind(input.source_kind),
    confidence: normalizeConfidence(input.confidence) === "unknown" ? "high" : normalizeConfidence(input.confidence),
    evidence: input.evidence ?? [],
    is_real_measurement: true,
    is_estimated: false,
    planning_only: false,
  };
}

export function createManualBaseline(input: {
  value: number;
  unit?: string | null;
  confidence?: CmoGoalBaselineTargetConfidenceV1 | "estimated" | null;
  evidence?: CmoGoalBaselineTargetEvidenceV1[];
  isRealMeasurement?: boolean | null;
}): CmoGoalBaselineTargetBaselineV1 {
  return {
    status: "ready",
    value: roundMetric(input.value),
    unit: safeString(input.unit, DEFAULT_UNIT, 40) ?? DEFAULT_UNIT,
    source_kind: "manual_input",
    confidence: normalizeConfidence(input.confidence) === "unknown" ? "medium" : normalizeConfidence(input.confidence),
    evidence: input.evidence ?? [],
    is_real_measurement: input.isRealMeasurement === true,
    is_estimated: false,
    planning_only: false,
  };
}

export function createEstimatedBaseline(input: {
  value: number | null;
  unit?: string | null;
  evidence?: CmoGoalBaselineTargetEvidenceV1[];
}): CmoGoalBaselineTargetBaselineV1 {
  return {
    status: "estimated",
    value: input.value === null ? null : roundMetric(input.value),
    unit: safeString(input.unit, DEFAULT_UNIT, 40) ?? DEFAULT_UNIT,
    source_kind: "estimated",
    confidence: "low",
    evidence: input.evidence ?? [],
    is_real_measurement: false,
    is_estimated: true,
    planning_only: true,
  };
}

export function createMissingPrimarySourceBaseline(input?: {
  unit?: string | null;
  source_kind?: CmoGoalBaselineTargetSourceKindV1 | LensMetricSourceTypeV1 | null;
}): CmoGoalBaselineTargetBaselineV1 {
  return {
    status: "missing_primary_source",
    value: null,
    unit: safeString(input?.unit, DEFAULT_UNIT, 40) ?? DEFAULT_UNIT,
    source_kind: normalizeSourceKind(input?.source_kind),
    confidence: "unknown",
    evidence: [],
    is_real_measurement: false,
    is_estimated: false,
    planning_only: false,
  };
}

export function createManualRequiredBaseline(input?: {
  unit?: string | null;
  source_kind?: CmoGoalBaselineTargetSourceKindV1 | LensMetricSourceTypeV1 | null;
}): CmoGoalBaselineTargetBaselineV1 {
  return {
    status: "manual_required",
    value: null,
    unit: safeString(input?.unit, DEFAULT_UNIT, 40) ?? DEFAULT_UNIT,
    source_kind: normalizeSourceKind(input?.source_kind),
    confidence: "unknown",
    evidence: [],
    is_real_measurement: false,
    is_estimated: false,
    planning_only: false,
  };
}

function unavailableBaseline(input?: {
  unit?: string | null;
}): CmoGoalBaselineTargetBaselineV1 {
  return {
    status: "unavailable",
    value: null,
    unit: safeString(input?.unit, DEFAULT_UNIT, 40) ?? DEFAULT_UNIT,
    source_kind: "unknown",
    confidence: "unknown",
    evidence: [],
    is_real_measurement: false,
    is_estimated: false,
    planning_only: false,
  };
}

export function calculatePercentageIncreaseTarget(input: {
  baselineValue: number;
  percent: number;
}): CmoGoalResolvedTargetValuesV1 | null {
  if (!Number.isFinite(input.baselineValue) || !Number.isFinite(input.percent)) {
    return null;
  }

  const deltaValue = input.baselineValue * (input.percent / 100);
  const targetValue = input.baselineValue + deltaValue;

  return {
    target_value: roundMetric(targetValue),
    delta_value: roundMetric(deltaValue),
    delta_percent: roundMetric(input.percent),
  };
}

export function calculateAbsoluteTarget(input: {
  baselineValue: number;
  targetValue: number;
}): CmoGoalResolvedTargetValuesV1 | null {
  if (!Number.isFinite(input.baselineValue) || !Number.isFinite(input.targetValue)) {
    return null;
  }

  const deltaValue = input.targetValue - input.baselineValue;

  return {
    target_value: roundMetric(input.targetValue),
    delta_value: roundMetric(deltaValue),
    delta_percent: input.baselineValue === 0 ? null : roundMetric((deltaValue / input.baselineValue) * 100),
  };
}

function calculateDeltaTarget(input: {
  baselineValue: number;
  deltaValue: number;
}): CmoGoalResolvedTargetValuesV1 | null {
  if (!Number.isFinite(input.baselineValue) || !Number.isFinite(input.deltaValue)) {
    return null;
  }

  return {
    target_value: roundMetric(input.baselineValue + input.deltaValue),
    delta_value: roundMetric(input.deltaValue),
    delta_percent: input.baselineValue === 0 ? null : roundMetric((input.deltaValue / input.baselineValue) * 100),
  };
}

function parseDateOnly(value: string | null | undefined): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
  };
}

function dateToEpochDay(value: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(value.year, value.month - 1, value.day) / 86_400_000);
}

function epochDayToDate(value: number): string {
  return new Date(value * 86_400_000).toISOString().slice(0, 10);
}

function dayCountForWindow(window: CmoGoalBaselineTargetWindowV1 | null): {
  days: number;
  startEpochDay: number | null;
} | null {
  const start = parseDateOnly(window?.start_date ?? null);
  const end = parseDateOnly(window?.end_date ?? null);

  if (start && end) {
    const startEpochDay = dateToEpochDay(start);
    const days = dateToEpochDay(end) - startEpochDay + 1;

    if (days > 0 && days <= MAX_DAILY_TARGET_DAYS) {
      return {
        days,
        startEpochDay,
      };
    }

    return null;
  }

  if (start && !end && isWeeklyCmoGoalWindow(window)) {
    return {
      days: 7,
      startEpochDay: dateToEpochDay(start),
    };
  }

  if (isWeeklyCmoGoalWindow(window)) {
    return {
      days: 7,
      startEpochDay: null,
    };
  }

  return null;
}

export function isWeeklyCmoGoalWindow(window: CmoGoalBaselineTargetWindowV1 | null): boolean {
  const label = window?.label?.toLowerCase() ?? "";

  return label.includes("week") || label.includes("weekly");
}

export function createWeeklyDailyTargets(input: {
  baselineValue: number;
  targetValue: number;
  window: CmoGoalBaselineTargetWindowV1 | null;
}): CmoGoalBaselineTargetDailyTargetV1[] {
  if (!Number.isFinite(input.baselineValue) || !Number.isFinite(input.targetValue)) {
    return [];
  }

  const windowDays = dayCountForWindow(input.window);

  if (!windowDays) {
    return [];
  }

  const deltaValue = input.targetValue - input.baselineValue;
  const dailyTargets: CmoGoalBaselineTargetDailyTargetV1[] = [];
  let previousCumulativeDelta = 0;

  for (let dayIndex = 1; dayIndex <= windowDays.days; dayIndex += 1) {
    const cumulativeDelta = dayIndex === windowDays.days
      ? roundMetric(deltaValue)
      : roundMetric((deltaValue * dayIndex) / windowDays.days);
    const dailyDelta = roundMetric(cumulativeDelta - previousCumulativeDelta);

    dailyTargets.push({
      day_index: dayIndex,
      date: windowDays.startEpochDay === null ? null : epochDayToDate(windowDays.startEpochDay + dayIndex - 1),
      target_value: dayIndex === windowDays.days
        ? roundMetric(input.targetValue)
        : roundMetric(input.baselineValue + cumulativeDelta),
      delta_value: dailyDelta,
      cumulative_delta_value: cumulativeDelta,
    });
    previousCumulativeDelta = cumulativeDelta;
  }

  return dailyTargets;
}

function targetValuesFromInput(
  baselineValue: number,
  target: CmoGoalTargetInputV1 | null | undefined,
): CmoGoalResolvedTargetValuesV1 | null {
  const targetRecord = isRecord(target) ? target : {};
  const mode = targetRecord.mode;

  if (mode === "percent_increase") {
    return calculatePercentageIncreaseTarget({
      baselineValue,
      percent: finiteNumber(targetRecord.percent) ?? Number.NaN,
    });
  }

  if (mode === "absolute") {
    return calculateAbsoluteTarget({
      baselineValue,
      targetValue: finiteNumber(targetRecord.target_value) ?? finiteNumber(targetRecord.targetValue) ?? Number.NaN,
    });
  }

  if (mode === "delta") {
    return calculateDeltaTarget({
      baselineValue,
      deltaValue: finiteNumber(targetRecord.delta_value) ?? finiteNumber(targetRecord.deltaValue) ?? Number.NaN,
    });
  }

  return null;
}

function calculateBaseline(input: {
  baseline: CmoGoalBaselineSnapshotInputV1 | null | undefined;
  primarySource: Record<string, unknown> | null;
  resolution: LensMetricSourceResolutionV1 | null | undefined;
  metricKey: string;
  unsupported: boolean;
}): {
  baseline: CmoGoalBaselineTargetBaselineV1;
  missing: CmoGoalBaselineTargetMissingV1;
} {
  const unit = input.baseline?.unit;

  if (input.unsupported) {
    return {
      baseline: unavailableBaseline({ unit }),
      missing: {
        missing_capability_request: null,
        reason: "The goal kind is not supported by the baseline and target calculator.",
        code: "unsupported_goal_kind",
      },
    };
  }

  const baselineValue = finiteNumber(input.baseline?.value);
  const baselineKind = normalizeBaselineKind(input.baseline);
  const primarySourceKind = normalizeSourceKind(input.primarySource?.source_type);
  const fallbackEvidence = evidenceFromSource(input.primarySource, input.metricKey);
  const evidence = evidenceFromInput(input.baseline, fallbackEvidence);

  if (baselineKind === "estimated") {
    const estimatedEvidence = evidence.length
      ? evidence
      : [{
        source_kind: "estimated" as const,
        metric_key: input.metricKey,
        note: "Explicit planning estimate supplied by caller.",
      }];

    return {
      baseline: createEstimatedBaseline({
        value: baselineValue,
        unit,
        evidence: estimatedEvidence,
      }),
      missing: baselineValue === null
        ? {
          missing_capability_request: null,
          reason: "Estimated baseline was requested, but no numeric estimate was supplied.",
          code: "estimated_baseline_value_missing",
        }
        : emptyMissing(),
    };
  }

  if (baselineKind === "manual") {
    if (baselineValue === null) {
      return {
        baseline: createManualRequiredBaseline({
          unit,
          source_kind: "manual_input",
        }),
        missing: {
          missing_capability_request: null,
          reason: "Manual baseline input is required before a target can be calculated.",
          code: "manual_baseline_required",
        },
      };
    }

    return {
      baseline: createManualBaseline({
        value: baselineValue,
        unit,
        confidence: input.baseline?.confidence,
        evidence: evidence.length ? evidence : [{
          source_kind: "manual_input",
          metric_key: input.metricKey,
          note: "Manual baseline supplied by caller.",
        }],
        isRealMeasurement: input.baseline?.is_real_measurement,
      }),
      missing: emptyMissing(),
    };
  }

  if (baselineValue !== null && sourceIsUsable(input.primarySource)) {
    return {
      baseline: createRealBaseline({
        value: baselineValue,
        unit,
        source_kind: normalizeSourceKind(input.baseline?.source_kind) === "unknown"
          ? primarySourceKind
          : normalizeSourceKind(input.baseline?.source_kind),
        confidence: normalizeConfidence(input.baseline?.confidence) === "unknown"
          ? confidenceFromSourceResolution(input.resolution?.confidence)
          : normalizeConfidence(input.baseline?.confidence),
        evidence,
      }),
      missing: emptyMissing(),
    };
  }

  if (!sourceIsUsable(input.primarySource)) {
    return {
      baseline: createMissingPrimarySourceBaseline({
        unit,
        source_kind: primarySourceKind,
      }),
      missing: {
        missing_capability_request: missingRequestFromResolution(input.resolution),
        reason: "Primary measurement source is missing, so the calculator cannot claim a real baseline.",
        code: "missing_primary_source",
      },
    };
  }

  return {
    baseline: createManualRequiredBaseline({
      unit,
      source_kind: primarySourceKind,
    }),
    missing: {
      missing_capability_request: null,
      reason: "A primary source is available, but no baseline value was supplied to the pure calculator.",
      code: "baseline_value_required",
    },
  };
}

function calculateTarget(input: {
  unsupported: boolean;
  baseline: CmoGoalBaselineTargetBaselineV1;
  target: CmoGoalTargetInputV1 | null | undefined;
  window: CmoGoalBaselineTargetWindowV1 | null;
}): CmoGoalBaselineTargetTargetV1 {
  if (input.unsupported) {
    return {
      status: "unsupported",
      target_value: null,
      delta_value: null,
      delta_percent: null,
      window: input.window,
      daily_targets: [],
    };
  }

  if (input.baseline.value === null || input.baseline.status === "missing_primary_source" || input.baseline.status === "manual_required" || input.baseline.status === "unavailable") {
    return {
      status: "needs_baseline",
      target_value: null,
      delta_value: null,
      delta_percent: null,
      window: input.window,
      daily_targets: [],
    };
  }

  const values = targetValuesFromInput(input.baseline.value, input.target);

  if (!values) {
    return {
      status: "invalid_goal",
      target_value: null,
      delta_value: null,
      delta_percent: null,
      window: input.window,
      daily_targets: [],
    };
  }

  const wantsDailyBreakdown = isRecord(input.target) && input.target.daily_breakdown === false
    ? false
    : isWeeklyCmoGoalWindow(input.window);

  return {
    status: "ready",
    ...values,
    window: input.window,
    daily_targets: wantsDailyBreakdown
      ? createWeeklyDailyTargets({
        baselineValue: input.baseline.value,
        targetValue: values.target_value,
        window: input.window,
      })
      : [],
  };
}

export function calculateCmoGoalBaselineTarget(
  input: CalculateCmoGoalBaselineTargetInputV1 = {},
): CmoGoalBaselineTargetV1 {
  const goal = isRecord(input.goal) ? input.goal : null;
  const resolution = isRecord(input.sourceResolution)
    ? input.sourceResolution as LensMetricSourceResolutionV1
    : isRecord(goal?.metric_source_resolution)
      ? goal.metric_source_resolution as LensMetricSourceResolutionV1
      : null;
  const goalKind = normalizeGoalKind(goal?.normalized_goal_kind ?? resolution?.goal_kind);
  const unsupported = !SUPPORTED_GOAL_KINDS.has(goalKind as LensMetricGoalKindV1);
  const metricKey = safeString(goal?.resolved_metric ?? resolution?.resolved_metric, UNKNOWN_METRIC_KEY, 120) ?? UNKNOWN_METRIC_KEY;
  const window = cloneWindow(goal?.target_window);
  const primarySource = primarySourceRecord(resolution);
  const baselineResult = calculateBaseline({
    baseline: isRecord(input.baseline) ? input.baseline : null,
    primarySource,
    resolution,
    metricKey,
    unsupported,
  });

  return {
    contract: CMO_GOAL_BASELINE_TARGET_CONTRACT,
    goal_id: safeString(goal?.goal_id, null, 120),
    workspace_id: safeString(goal?.workspace_id, null, 120),
    app_id: safeString(goal?.app_id, null, 120),
    session_id: safeString(goal?.session_id, null, 120),
    metric: {
      kind: unsupported ? goalKind === "unknown" ? "unknown" : "unsupported" : goalKind,
      key: metricKey,
      label: safeString(input.metricLabel, null, 120) ?? metricLabelFromKey(metricKey),
    },
    baseline: baselineResult.baseline,
    target: calculateTarget({
      unsupported,
      baseline: baselineResult.baseline,
      target: isRecord(input.target) ? input.target : null,
      window,
    }),
    missing: baselineResult.missing,
    guardrails: {
      no_execution: true,
      approval_required_before_execution: true,
    },
  };
}

export function pairCmoGoalBaselineTargetWithActiveGoalState(input: {
  activeGoalState: Record<string, unknown> | null | undefined;
  baselineTarget: CmoGoalBaselineTargetV1 | null | undefined;
}): Record<string, unknown> | null {
  if (!isRecord(input.activeGoalState) || input.activeGoalState.contract !== "cmo.goal.v1") {
    return null;
  }

  if (!input.baselineTarget || input.baselineTarget.contract !== CMO_GOAL_BASELINE_TARGET_CONTRACT) {
    return null;
  }

  if (safeString(input.activeGoalState.goal_id, null, 120) !== input.baselineTarget.goal_id) {
    return null;
  }

  return {
    active_goal_state: JSON.parse(JSON.stringify(input.activeGoalState)) as Record<string, unknown>,
    goal_baseline_target: JSON.parse(JSON.stringify(input.baselineTarget)) as Record<string, unknown>,
  };
}
