import "server-only";

import {
  getLensMetricsPackForApp,
  type LensMetricsPack,
  type LensMetricsPackMetric,
  type LensMetricsPackRange,
} from "@/lib/cmo/lens-metrics-pack";
import type { WorkspaceGa4MetricRangeKey } from "@/lib/cmo/workspace-metric-snapshots";

export type LensDiagnosticsPackContract = "lens.diagnostics_pack.v1";
export type LensDiagnosticsSummaryStatus = "ready" | "partial" | "blocked" | "missing_snapshot";
export type LensDiagnosticsDataStatus = "synced" | "stale" | "missing_snapshot" | "error";
export type LensDiagnosticStatus = "ok" | "warning" | "blocked" | "needs_definition" | "error";
export type LensDiagnosticSeverity = "info" | "warning" | "error";
export type LensRecommendedActionPriority = "high" | "medium" | "low";

export interface LensDiagnosticsPack {
  contract: LensDiagnosticsPackContract;
  tenantId: string;
  workspaceId: string;
  appId: string;
  range: LensMetricsPackRange;
  generatedAt: string;
  basis: {
    metricsPackContract: "lens.metrics_pack.v1";
    metricsPackGeneratedAt: string;
    sourceSnapshotIds: string[];
    sourceTypes: string[];
    interpretationMode: "deterministic_readiness";
  };
  summary: {
    status: LensDiagnosticsSummaryStatus;
    dataStatus: LensDiagnosticsDataStatus;
    mappedMetricCount: number;
    definitionNeededCount: number;
    canGenerateInsight: boolean;
    canCompareTrend: false;
  };
  diagnostics: LensDiagnostic[];
  facts: LensDiagnosticFact[];
  blockedMetrics: LensBlockedMetric[];
  recommendedNextActions: LensRecommendedAction[];
  warnings: string[];
}

export interface LensDiagnostic {
  key: string;
  title: string;
  status: LensDiagnosticStatus;
  severity: LensDiagnosticSeverity;
  message: string;
  evidenceMetricKeys?: string[];
  affectedMetricKeys?: string[];
  missingDefinition?: string;
}

export interface LensDiagnosticFact {
  key: string;
  label: string;
  value: number;
  unit: LensMetricsPackMetric["unit"];
  sourceMetric?: string;
}

export interface LensBlockedMetric {
  key: string;
  reason: "definition_needed" | "unavailable";
  missingDefinition?: string;
}

export interface LensRecommendedAction {
  key: string;
  label: string;
  priority: LensRecommendedActionPriority;
  reason: string;
}

function mappedMetrics(metricsPack: LensMetricsPack): LensMetricsPackMetric[] {
  return metricsPack.metrics.filter((metric) => metric.mappingStatus === "mapped" && typeof metric.value === "number" && Number.isFinite(metric.value));
}

function definitionNeededMetrics(metricsPack: LensMetricsPack): LensMetricsPackMetric[] {
  return metricsPack.metrics.filter((metric) => metric.mappingStatus === "definition_needed");
}

function dataStatus(metricsPack: LensMetricsPack): LensDiagnosticsDataStatus {
  if (metricsPack.quality.status === "missing_snapshot") {
    return "missing_snapshot";
  }

  if (metricsPack.quality.status === "error" || metricsPack.sources.some((source) => source.status === "error")) {
    return "error";
  }

  if (metricsPack.quality.isStale) {
    return "stale";
  }

  return "synced";
}

function summaryStatus(input: {
  metricsPack: LensMetricsPack;
  dataStatus: LensDiagnosticsDataStatus;
  mappedMetricCount: number;
}): LensDiagnosticsSummaryStatus {
  if (input.dataStatus === "missing_snapshot") {
    return "missing_snapshot";
  }

  if (input.dataStatus === "error") {
    return "blocked";
  }

  if (input.dataStatus === "stale" || input.metricsPack.quality.status === "partial" || input.mappedMetricCount === 0) {
    return "partial";
  }

  return "ready";
}

function sourceSnapshotIds(metricsPack: LensMetricsPack): string[] {
  return metricsPack.sources
    .map((source) => source.snapshotId)
    .filter((snapshotId): snapshotId is string => typeof snapshotId === "string" && Boolean(snapshotId.trim()));
}

function sourceTypes(metricsPack: LensMetricsPack): string[] {
  return Array.from(new Set(metricsPack.sources.map((source) => source.sourceType).filter(Boolean)));
}

function facts(metricsPack: LensMetricsPack): LensDiagnosticFact[] {
  return mappedMetrics(metricsPack).map((metric) => ({
    key: metric.key,
    label: metric.label,
    value: metric.value as number,
    unit: metric.unit,
    sourceMetric: metric.sourceMetric,
  }));
}

function blockedMetrics(metricsPack: LensMetricsPack): LensBlockedMetric[] {
  return metricsPack.metrics
    .filter((metric) => metric.mappingStatus === "definition_needed" || metric.mappingStatus === "unavailable")
    .map((metric) => ({
      key: metric.key,
      reason: metric.mappingStatus === "definition_needed" ? "definition_needed" : "unavailable",
      missingDefinition: metric.missingDefinition,
    }));
}

function definitionKeys(metricsPack: LensMetricsPack, missingDefinition: string): string[] {
  return metricsPack.metrics
    .filter((metric) => metric.missingDefinition === missingDefinition)
    .map((metric) => metric.key);
}

function dataDiagnostic(input: {
  metricsPack: LensMetricsPack;
  dataStatus: LensDiagnosticsDataStatus;
  mappedMetricKeys: string[];
}): LensDiagnostic {
  if (input.dataStatus === "missing_snapshot") {
    return {
      key: "data.ga4_snapshot_missing",
      title: "GA4 snapshot missing",
      status: "blocked",
      severity: "warning",
      message: "No cached GA4 snapshot is available for the selected range.",
      affectedMetricKeys: input.metricsPack.metrics.filter((metric) => metric.sourceType === "ga4").map((metric) => metric.key),
    };
  }

  if (input.dataStatus === "error") {
    return {
      key: "data.ga4_snapshot_error",
      title: "GA4 snapshot error",
      status: "error",
      severity: "error",
      message: "Latest cached GA4 snapshot is in an error state.",
      affectedMetricKeys: input.metricsPack.metrics.filter((metric) => metric.sourceType === "ga4").map((metric) => metric.key),
    };
  }

  if (input.dataStatus === "stale") {
    return {
      key: "data.ga4_snapshot_stale",
      title: "GA4 snapshot stale",
      status: "warning",
      severity: "warning",
      message: `Latest cached GA4 snapshot is older than ${input.metricsPack.quality.staleThresholdHours} hours for the selected range.`,
      evidenceMetricKeys: input.mappedMetricKeys,
    };
  }

  return {
    key: "data.ga4_snapshot_ready",
    title: "GA4 snapshot ready",
    status: "ok",
    severity: "info",
    message: "Latest cached GA4 snapshot is available for the selected range.",
    evidenceMetricKeys: input.mappedMetricKeys,
  };
}

function definitionDiagnostics(metricsPack: LensMetricsPack): LensDiagnostic[] {
  const diagnostics: LensDiagnostic[] = [];
  const activationMetricKeys = definitionKeys(metricsPack, "activation_event");
  const retentionMetricKeys = definitionKeys(metricsPack, "cohort_retention_logic");

  if (activationMetricKeys.length) {
    diagnostics.push({
      key: "definition.activation_missing",
      title: "Activation definition needed",
      status: "needs_definition",
      severity: "warning",
      message: "Activation metrics are not mapped because no activation event definition exists yet.",
      affectedMetricKeys: activationMetricKeys,
      missingDefinition: "activation_event",
    });
  }

  if (retentionMetricKeys.length) {
    diagnostics.push({
      key: "definition.retention_missing",
      title: "Retention definition needed",
      status: "needs_definition",
      severity: "warning",
      message: "D1/D7 retention is not mapped because cohort retention logic is not defined yet.",
      affectedMetricKeys: retentionMetricKeys,
      missingDefinition: "cohort_retention_logic",
    });
  }

  return diagnostics;
}

function recommendedNextActions(input: {
  metricsPack: LensMetricsPack;
  dataStatus: LensDiagnosticsDataStatus;
}): LensRecommendedAction[] {
  const actions: LensRecommendedAction[] = [];

  if (input.dataStatus === "missing_snapshot") {
    actions.push({
      key: "sync_ga4_metrics",
      label: "Sync GA4 metrics",
      priority: "high",
      reason: "Required before diagnostics can use cached GA4 product metrics for the selected range.",
    });
  } else if (input.dataStatus === "stale") {
    actions.push({
      key: "refresh_ga4_snapshot",
      label: "Refresh GA4 snapshot",
      priority: "medium",
      reason: "Latest cached GA4 snapshot is stale for the selected range.",
    });
  }

  if (input.metricsPack.quality.missingDefinitions.includes("activation_event")) {
    actions.push({
      key: "define_activation_event",
      label: "Define activation event",
      priority: "high",
      reason: "Required before Activated Users and Activation Rate can be computed.",
    });
  }

  if (input.metricsPack.quality.missingDefinitions.includes("cohort_retention_logic")) {
    actions.push({
      key: "define_retention_logic",
      label: "Define retention cohort logic",
      priority: "medium",
      reason: "Required before D1/D7 retention can be computed.",
    });
  }

  return actions;
}

export function createLensDiagnosticsPack(metricsPack: LensMetricsPack): LensDiagnosticsPack {
  const generatedAt = new Date().toISOString();
  const mapped = mappedMetrics(metricsPack);
  const definitions = definitionNeededMetrics(metricsPack);
  const status = dataStatus(metricsPack);
  const mappedMetricKeys = mapped.map((metric) => metric.key);
  const summary = {
    status: summaryStatus({
      metricsPack,
      dataStatus: status,
      mappedMetricCount: mapped.length,
    }),
    dataStatus: status,
    mappedMetricCount: mapped.length,
    definitionNeededCount: definitions.length,
    canGenerateInsight: status === "synced" && mapped.length > 0,
    canCompareTrend: false as const,
  };

  return {
    contract: "lens.diagnostics_pack.v1",
    tenantId: metricsPack.tenantId,
    workspaceId: metricsPack.workspaceId,
    appId: metricsPack.appId,
    range: metricsPack.range,
    generatedAt,
    basis: {
      metricsPackContract: metricsPack.contract,
      metricsPackGeneratedAt: metricsPack.generatedAt,
      sourceSnapshotIds: sourceSnapshotIds(metricsPack),
      sourceTypes: sourceTypes(metricsPack),
      interpretationMode: "deterministic_readiness",
    },
    summary,
    diagnostics: [
      dataDiagnostic({
        metricsPack,
        dataStatus: status,
        mappedMetricKeys,
      }),
      ...definitionDiagnostics(metricsPack),
    ],
    facts: facts(metricsPack),
    blockedMetrics: blockedMetrics(metricsPack),
    recommendedNextActions: recommendedNextActions({
      metricsPack,
      dataStatus: status,
    }),
    warnings: metricsPack.quality.warnings,
  };
}

export async function getLensDiagnosticsPackForApp(input: {
  appId: string;
  rangeKey: WorkspaceGa4MetricRangeKey;
}): Promise<LensDiagnosticsPack> {
  const metricsPack = await getLensMetricsPackForApp({
    appId: input.appId,
    rangeKey: input.rangeKey,
  });

  return createLensDiagnosticsPack(metricsPack);
}
