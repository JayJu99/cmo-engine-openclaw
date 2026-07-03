import "server-only";

import {
  createLensCapabilityContext,
  createLensMissingCapabilityResult,
  LENS_MEASUREMENT_RESULT_CONTRACT,
  sanitizeLensMeasurementSafeText,
  type LensMeasurementMetricIntentKey,
  type LensMeasurementMetricIntentResolution,
  type LensMeasurementRangeKey,
  type LensMeasurementResult,
  type LensMeasurementScope,
} from "@/lib/cmo/lens-measurement-result";
import { getLatestProductMetricDefinitionSnapshots } from "@/lib/cmo/lens-metric-definitions";
import {
  createLensMetricsPackFromSnapshot,
  type LensMetricsPack,
  type LensMetricsPackMetric,
  type LensMetricsPackSource,
} from "@/lib/cmo/lens-metrics-pack";
import {
  getWorkspaceGa4MetricSourceMapping,
  type WorkspaceGa4MetricSourceMapping,
} from "@/lib/cmo/workspace-metric-sources";
import {
  getLatestWorkspaceGa4MetricSnapshot,
  type WorkspaceGa4MetricRangeKey,
  type WorkspaceGa4MetricSnapshot,
} from "@/lib/cmo/workspace-metric-snapshots";

export interface RunLensMeasurementRequestInput {
  tenantId?: string;
  workspaceId: string;
  appId: string;
  rangeKey?: "last_7_days" | "last_30_days" | string;
  metricIntent?: string;
  requestId?: string;
}

interface LensMissingCapabilityRequirementInput {
  key: string;
  type: string;
  severity: "blocking" | "warning";
  action: string;
  safe_user_message: string;
}

const DEFAULT_SAFE_ERROR_MESSAGE = "Lens could not complete this measurement request safely.";
const NO_DATA_MESSAGE = "Lens found a configured GA4 source, but no cached metrics snapshot exists for this range. Sync GA4 metrics before asking Lens to measure it.";

function scopeFromInput(input: RunLensMeasurementRequestInput): LensMeasurementScope {
  return createLensCapabilityContext({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    appId: input.appId,
    rangeKey: input.rangeKey,
  }).scope;
}

function workspaceScope(scope: LensMeasurementScope): {
  tenantId: string;
  workspaceId: string;
  appId: string;
} {
  return {
    tenantId: scope.tenant_id,
    workspaceId: scope.workspace_id,
    appId: scope.app_id,
  };
}

function missingSourceMappingRequirement(): LensMissingCapabilityRequirementInput {
  return {
    key: "ga4.source_mapping",
    type: "connector",
    severity: "blocking",
    action: "connect_ga4_property",
    safe_user_message: "Connect and verify a GA4 property before Lens can answer this.",
  };
}

function missingOAuthRequirement(): LensMissingCapabilityRequirementInput {
  return {
    key: "ga4.oauth_account",
    type: "connector",
    severity: "blocking",
    action: "connect_or_verify_google_analytics",
    safe_user_message: "Connect or verify Google Analytics access before Lens can answer this.",
  };
}

function sourceVerificationRequirement(): LensMissingCapabilityRequirementInput {
  return {
    key: "ga4.source_verification",
    type: "connector",
    severity: "blocking",
    action: "verify_ga4_property",
    safe_user_message: "Verify the connected GA4 property before Lens can answer this.",
  };
}

function missingCapabilityResult(input: {
  scope: LensMeasurementScope;
  requirement: LensMissingCapabilityRequirementInput;
  intent: LensMeasurementMetricIntentResolution;
  safeUserMessage?: string;
}): LensMeasurementResult {
  return {
    ...createLensMissingCapabilityResult({
      scope: input.scope,
      requirements: [input.requirement],
      safeUserMessage: input.safeUserMessage,
    }),
    metric_intent: input.intent,
  };
}

function missingRequirementForMapping(mapping: WorkspaceGa4MetricSourceMapping | null): LensMissingCapabilityRequirementInput | null {
  if (!mapping?.enabled || !mapping.propertyId) {
    return missingSourceMappingRequirement();
  }

  if (!mapping.oauthAccountId || mapping.verificationStatus === "needs_reconnect") {
    return missingOAuthRequirement();
  }

  if (mapping.verificationStatus !== "verified") {
    return sourceVerificationRequirement();
  }

  return null;
}

function normalizeIntentKey(metricIntent: string | null | undefined): LensMeasurementMetricIntentKey {
  const normalized = typeof metricIntent === "string" ? metricIntent.toLowerCase() : "";

  if (/\b(?:activation|activate|activated|onboard|onboarding)\b/.test(normalized)) {
    return "activation";
  }

  if (/\b(?:social|channel|traffic|acquisition|utm|referral|source)\b/.test(normalized)) {
    return "social_traffic";
  }

  if (/\b(?:weekly|week|goal|baseline|target)\b/.test(normalized)) {
    return "weekly_goal_baseline";
  }

  return "default";
}

function metricMatchesIntent(metric: LensMetricsPackMetric, intent: LensMeasurementMetricIntentKey): boolean {
  if (intent === "activation") {
    return metric.semanticRole === "activation";
  }

  if (intent === "social_traffic") {
    return metric.semanticRole === "acquisition" || metric.semanticRole === "traffic";
  }

  if (intent === "weekly_goal_baseline") {
    return ["audience", "acquisition", "traffic", "engagement", "activation"].includes(metric.semanticRole);
  }

  return ["audience", "acquisition", "traffic", "engagement"].includes(metric.semanticRole);
}

export function resolveLensMeasurementMetricIntent(input: {
  metricIntent?: string | null;
  metricsPack?: LensMetricsPack | null;
}): LensMeasurementMetricIntentResolution {
  const resolvedKey = normalizeIntentKey(input.metricIntent);
  const matchedMetricKeys = input.metricsPack
    ? input.metricsPack.metrics
      .filter((metric) => metricMatchesIntent(metric, resolvedKey))
      .map((metric) => metric.key)
      .slice(0, 20)
    : [];

  return {
    resolved_key: resolvedKey,
    matched_metric_keys: matchedMetricKeys,
  };
}

function safeOptionalText(value: unknown): string | undefined {
  const sanitized = sanitizeLensMeasurementSafeText(value, "");

  return sanitized || undefined;
}

function safeWarning(value: unknown): string | null {
  const sanitized = sanitizeLensMeasurementSafeText(value, "");

  return sanitized || null;
}

function safeMetric(metric: LensMetricsPackMetric): LensMetricsPackMetric {
  return {
    key: sanitizeLensMeasurementSafeText(metric.key, "metric.unavailable"),
    label: sanitizeLensMeasurementSafeText(metric.label, "Metric unavailable"),
    value: typeof metric.value === "number" && Number.isFinite(metric.value) ? metric.value : null,
    unit: metric.unit,
    displayValue: safeOptionalText(metric.displayValue),
    sourceType: metric.sourceType,
    sourceId: metric.sourceId,
    sourceMetric: metric.sourceMetric,
    mappingStatus: metric.mappingStatus,
    confidence: metric.confidence,
    semanticRole: metric.semanticRole,
    missingDefinition: metric.missingDefinition,
    definitionStatus: safeOptionalText(metric.definitionStatus),
    unavailableReason: safeOptionalText(metric.unavailableReason),
  };
}

function safeSource(source: LensMetricsPackSource): LensMetricsPackSource {
  return {
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    provider: source.provider,
    propertyId: safeOptionalText(source.propertyId),
    propertyDisplayName: safeOptionalText(source.propertyDisplayName),
    accountDisplayName: safeOptionalText(source.accountDisplayName),
    snapshotId: safeOptionalText(source.snapshotId),
    syncedAt: safeOptionalText(source.syncedAt),
    status: source.status,
  };
}

function safeMetricsPack(pack: LensMetricsPack): LensMetricsPack {
  return {
    contract: pack.contract,
    tenantId: pack.tenantId,
    workspaceId: pack.workspaceId,
    appId: pack.appId,
    range: {
      key: pack.range.key,
      dateStart: pack.range.dateStart,
      dateEnd: pack.range.dateEnd,
      timezone: safeOptionalText(pack.range.timezone) ?? null,
    },
    generatedAt: pack.generatedAt,
    sources: pack.sources.map(safeSource).slice(0, 5),
    metrics: pack.metrics.map(safeMetric).slice(0, 50),
    quality: {
      status: pack.quality.status,
      isStale: pack.quality.isStale,
      staleThresholdHours: Number.isFinite(pack.quality.staleThresholdHours) ? pack.quality.staleThresholdHours : 24,
      missingDefinitions: [...pack.quality.missingDefinitions],
      warnings: pack.quality.warnings.map(safeWarning).filter((warning): warning is string => Boolean(warning)).slice(0, 20),
    },
  };
}

function noDataResult(input: {
  scope: LensMeasurementScope;
  intent: LensMeasurementMetricIntentResolution;
}): LensMeasurementResult {
  return {
    contract: LENS_MEASUREMENT_RESULT_CONTRACT,
    status: "no_data",
    scope: input.scope,
    metric_intent: input.intent,
    safe_user_message: NO_DATA_MESSAGE,
  };
}

function failedResult(input: {
  scope: LensMeasurementScope;
  code: string;
  safeMessage?: string;
  retryable?: boolean;
  intent: LensMeasurementMetricIntentResolution;
}): LensMeasurementResult {
  return {
    contract: LENS_MEASUREMENT_RESULT_CONTRACT,
    status: "failed",
    scope: input.scope,
    metric_intent: input.intent,
    error: {
      code: sanitizeLensMeasurementSafeText(input.code, "lens_measurement_failed"),
      safe_message: sanitizeLensMeasurementSafeText(input.safeMessage, DEFAULT_SAFE_ERROR_MESSAGE),
      retryable: input.retryable,
    },
    safe_user_message: sanitizeLensMeasurementSafeText(input.safeMessage, DEFAULT_SAFE_ERROR_MESSAGE),
  };
}

async function metricDefinitionSnapshots(input: {
  appId: string;
  rangeKey: LensMeasurementRangeKey;
}): Promise<Awaited<ReturnType<typeof getLatestProductMetricDefinitionSnapshots>>["snapshots"]> {
  try {
    const result = await getLatestProductMetricDefinitionSnapshots({
      appId: input.appId,
      rangeKey: input.rangeKey === "this_month" ? "this_week" : input.rangeKey,
    });

    return result.snapshots;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unknown workspace app scope")) {
      return [];
    }

    throw error;
  }
}

function snapshotFailureCode(snapshot: WorkspaceGa4MetricSnapshot): string {
  return snapshot.status === "error" ? "ga4_snapshot_error" : "lens_measurement_failed";
}

export async function runLensMeasurementRequest(input: RunLensMeasurementRequestInput): Promise<LensMeasurementResult> {
  const scope = scopeFromInput(input);
  const baseIntent = resolveLensMeasurementMetricIntent({ metricIntent: input.metricIntent });

  try {
    const mapping = await getWorkspaceGa4MetricSourceMapping({
      tenantId: scope.tenant_id,
      workspaceId: scope.workspace_id,
      appId: scope.app_id,
    });
    const missingRequirement = missingRequirementForMapping(mapping);

    if (missingRequirement) {
      return missingCapabilityResult({
        scope,
        requirement: missingRequirement,
        intent: baseIntent,
      });
    }

    const snapshot = await getLatestWorkspaceGa4MetricSnapshot({
      tenantId: scope.tenant_id,
      workspaceId: scope.workspace_id,
      appId: scope.app_id,
      rangeKey: scope.range_key as WorkspaceGa4MetricRangeKey,
    });

    if (!snapshot) {
      return noDataResult({
        scope,
        intent: baseIntent,
      });
    }

    if (snapshot.status !== "synced") {
      return failedResult({
        scope,
        code: snapshotFailureCode(snapshot),
        safeMessage: "Lens found a cached GA4 snapshot in an error state. Re-sync GA4 metrics before using this measurement.",
        retryable: true,
        intent: baseIntent,
      });
    }

    const definitions = await metricDefinitionSnapshots({
      appId: scope.app_id,
      rangeKey: scope.range_key,
    });
    const pack = safeMetricsPack(createLensMetricsPackFromSnapshot({
      scope: workspaceScope(scope),
      rangeKey: scope.range_key as WorkspaceGa4MetricRangeKey,
      snapshot,
      mapping,
      metricDefinitionSnapshots: definitions,
    }));
    const resolvedIntent = resolveLensMeasurementMetricIntent({
      metricIntent: input.metricIntent,
      metricsPack: pack,
    });

    return {
      contract: LENS_MEASUREMENT_RESULT_CONTRACT,
      status: "completed",
      scope,
      metric_intent: resolvedIntent,
      metrics_pack: pack,
      safe_user_message: "Lens found cached GA4 metrics for this app and range.",
    };
  } catch {
    return failedResult({
      scope,
      code: "lens_measurement_failed",
      safeMessage: DEFAULT_SAFE_ERROR_MESSAGE,
      retryable: true,
      intent: baseIntent,
    });
  }
}
