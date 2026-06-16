import "server-only";

import {
  createLensDiagnosticsPack,
  type LensDiagnosticsDataStatus,
  type LensDiagnosticsPack,
  type LensDiagnosticSeverity,
  type LensRecommendedActionPriority,
} from "@/lib/cmo/lens-diagnostics-pack";
import {
  getLensMetricsPackForApp,
  type LensMetricsPack,
  type LensMetricsPackMetric,
  type LensMetricsPackRange,
} from "@/lib/cmo/lens-metrics-pack";
import type { WorkspaceGa4MetricRangeKey } from "@/lib/cmo/workspace-metric-snapshots";

export type LensReadoutContract = "lens.readout.v1";
export type LensReadoutOverallStatus = "ready" | "partial" | "missing_snapshot" | "blocked";
export type LensReadoutConfidence = "high" | "medium" | "low";
export type LensReadoutFindingType = "data_readiness" | "configuration_gap" | "cache_freshness" | "data_error";

export interface LensReadout {
  contract: LensReadoutContract;
  tenantId: string;
  workspaceId: string;
  appId: string;
  range: LensMetricsPackRange;
  generatedAt: string;
  basis: {
    metricsPackContract: "lens.metrics_pack.v1";
    diagnosticsPackContract: "lens.diagnostics_pack.v1";
    sourceSnapshotIds: string[];
    interpretationMode: "deterministic_readout";
    liveFetchUsed: false;
    llmUsed: false;
  };
  status: {
    overall: LensReadoutOverallStatus;
    dataStatus: LensDiagnosticsDataStatus;
    canAnswerBasicPerformance: boolean;
    canAnswerActivation: boolean;
    canAnswerRetention: boolean;
    canCompareTrend: boolean;
    canGenerateReadout: boolean;
  };
  headline: {
    title: string;
    summary: string;
    confidence: LensReadoutConfidence;
  };
  metricHighlights: LensMetricHighlight[];
  readiness: {
    mappedMetrics: string[];
    blockedMetrics: string[];
    missingDefinitions: string[];
  };
  deterministicFindings: LensDeterministicFinding[];
  recommendedActions: LensReadoutRecommendedAction[];
  limitations: string[];
  comparisonReadiness: LensComparisonReadiness;
}

export interface LensMetricHighlight {
  key: string;
  label: string;
  value: number;
  displayValue: string;
  unit: LensMetricsPackMetric["unit"];
  role: LensMetricsPackMetric["semanticRole"];
  source: "Lens GA4";
}

export interface LensDeterministicFinding {
  key: string;
  type: LensReadoutFindingType;
  severity: LensDiagnosticSeverity;
  title: string;
  body: string;
}

export interface LensReadoutRecommendedAction {
  key: string;
  label: string;
  priority: LensRecommendedActionPriority;
  reason: string;
}

export interface LensComparisonReadiness {
  canCompareTrend: boolean;
  reason: "comparison_snapshot_missing" | "ready" | "unsupported";
  availableRanges: WorkspaceGa4MetricRangeKey[];
  missingRanges: WorkspaceGa4MetricRangeKey[];
}

const COMPARISON_RANGE_KEYS: WorkspaceGa4MetricRangeKey[] = ["this_week", "last_7_days", "last_30_days", "this_month"];
const HIGHLIGHT_KEYS = ["ga4.active_users", "ga4.new_users", "ga4.sessions", "ga4.event_count", "ga4.engagement_rate"];

function mappedMetrics(metricsPack: LensMetricsPack): LensMetricsPackMetric[] {
  return metricsPack.metrics.filter((metric) => metric.mappingStatus === "mapped" && typeof metric.value === "number" && Number.isFinite(metric.value));
}

function blockedMetricKeys(diagnosticsPack: LensDiagnosticsPack): string[] {
  return diagnosticsPack.blockedMetrics.map((metric) => metric.key);
}

function missingDefinitions(metricsPack: LensMetricsPack): string[] {
  return [...metricsPack.quality.missingDefinitions];
}

function displayValue(metric: LensMetricsPackMetric): string {
  if (metric.displayValue) {
    return metric.displayValue;
  }

  const value = typeof metric.value === "number" && Number.isFinite(metric.value) ? metric.value : 0;

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: metric.unit === "ratio" ? 2 : 0,
  }).format(value);
}

function metricHighlights(metricsPack: LensMetricsPack): LensMetricHighlight[] {
  const highlights = new Map(metricsPack.metrics.map((metric) => [metric.key, metric]));

  return HIGHLIGHT_KEYS
    .map((key) => highlights.get(key))
    .filter((metric): metric is LensMetricsPackMetric => {
      if (!metric) {
        return false;
      }

      return typeof metric.value === "number" && Number.isFinite(metric.value);
    })
    .map((metric) => ({
      key: metric.key,
      label: metric.label,
      value: metric.value as number,
      displayValue: displayValue(metric),
      unit: metric.unit,
      role: metric.semanticRole,
      source: "Lens GA4",
    }));
}

function headline(input: {
  overall: LensReadoutOverallStatus;
  dataStatus: LensDiagnosticsDataStatus;
  highlightCount: number;
}): LensReadout["headline"] {
  if (input.overall === "missing_snapshot") {
    return {
      title: "GA4 metrics need syncing",
      summary: "No cached GA4 snapshot is available for the selected range. Sync GA4 metrics before using this Lens readout.",
      confidence: "low",
    };
  }

  if (input.overall === "blocked") {
    return {
      title: "Lens readout is blocked",
      summary: "The cached GA4 snapshot cannot produce a basic performance readout for the selected range.",
      confidence: "low",
    };
  }

  if (input.dataStatus === "stale") {
    return {
      title: "GA4 performance readout is available with stale data",
      summary: `Lens can summarize ${input.highlightCount} cached GA4 performance metrics, but the latest snapshot is stale.`,
      confidence: "medium",
    };
  }

  return {
    title: "GA4 performance readout is ready",
    summary: `Lens can summarize ${input.highlightCount} cached GA4 performance metrics for the selected range.`,
    confidence: input.overall === "ready" ? "high" : "medium",
  };
}

function dataReadinessFinding(input: {
  dataStatus: LensDiagnosticsDataStatus;
  metricsPack: LensMetricsPack;
  mappedMetricKeys: string[];
}): LensDeterministicFinding {
  if (input.dataStatus === "missing_snapshot") {
    return {
      key: "ga4_snapshot_missing",
      type: "data_readiness",
      severity: "warning",
      title: "GA4 snapshot is missing",
      body: "The selected range does not have a cached GA4 snapshot. Sync GA4 metrics before generating a readout.",
    };
  }

  if (input.dataStatus === "error") {
    return {
      key: "ga4_snapshot_error",
      type: "data_error",
      severity: "error",
      title: "GA4 snapshot is in an error state",
      body: "The latest cached GA4 snapshot for the selected range is marked as an error and cannot support a reliable readout.",
    };
  }

  if (input.dataStatus === "stale") {
    return {
      key: "ga4_snapshot_stale",
      type: "cache_freshness",
      severity: "warning",
      title: "GA4 snapshot is stale",
      body: `The selected range has cached GA4 metrics, but the snapshot is older than ${input.metricsPack.quality.staleThresholdHours} hours.`,
    };
  }

  return {
    key: "ga4_core_ready",
    type: "data_readiness",
    severity: "info",
    title: "GA4 core metrics are ready",
    body: "The selected range has a synced GA4 snapshot with audience, acquisition, traffic, and engagement metrics.",
  };
}

function configurationFindings(metricsPack: LensMetricsPack): LensDeterministicFinding[] {
  const findings: LensDeterministicFinding[] = [];

  if (metricsPack.quality.missingDefinitions.includes("activation_event")) {
    findings.push({
      key: "activation_not_configured",
      type: "configuration_gap",
      severity: "warning",
      title: "Activation is not configured",
      body: "Activated Users and Activation Rate are intentionally not computed until an activation event is defined.",
    });
  }

  if (metricsPack.quality.missingDefinitions.includes("cohort_retention_logic")) {
    findings.push({
      key: "retention_not_configured",
      type: "configuration_gap",
      severity: "warning",
      title: "Retention is not configured",
      body: "D1/D7 retention are intentionally not computed until cohort retention logic is defined.",
    });
  }

  return findings;
}

function limitations(input: {
  dataStatus: LensDiagnosticsDataStatus;
  comparisonReadiness: LensComparisonReadiness;
}): string[] {
  const items = [
    "This readout is deterministic and does not use LLM interpretation.",
    "Activation and retention are blocked until definitions are configured.",
  ];

  if (!input.comparisonReadiness.canCompareTrend) {
    items.push("Trend comparison is unavailable until comparison snapshots are synced.");
  }

  if (input.dataStatus === "missing_snapshot") {
    items.push("The selected range cannot be summarized until a cached GA4 snapshot exists.");
  }

  return items;
}

function overallStatus(input: {
  diagnosticsPack: LensDiagnosticsPack;
  mappedMetricCount: number;
}): LensReadoutOverallStatus {
  if (input.diagnosticsPack.summary.status === "missing_snapshot") {
    return "missing_snapshot";
  }

  if (input.diagnosticsPack.summary.status === "blocked") {
    return "blocked";
  }

  if (input.diagnosticsPack.summary.dataStatus === "stale" || input.mappedMetricCount === 0 || input.diagnosticsPack.summary.status === "partial") {
    return "partial";
  }

  return "ready";
}

async function comparisonReadiness(input: {
  appId: string;
  selectedRangeKey: WorkspaceGa4MetricRangeKey;
  selectedMetricsPack: LensMetricsPack;
}): Promise<LensComparisonReadiness> {
  const packs = await Promise.all(
    COMPARISON_RANGE_KEYS.map(async (rangeKey) => {
      if (rangeKey === input.selectedRangeKey) {
        return input.selectedMetricsPack;
      }

      return getLensMetricsPackForApp({
        appId: input.appId,
        rangeKey,
      });
    }),
  );
  const availableRanges = packs
    .filter((pack) => pack.quality.status !== "missing_snapshot" && pack.sources.some((source) => source.snapshotId))
    .map((pack) => pack.range.key);
  const missingRanges = COMPARISON_RANGE_KEYS.filter((rangeKey) => !availableRanges.includes(rangeKey));
  const canCompareTrend = missingRanges.length === 0;

  return {
    canCompareTrend,
    reason: canCompareTrend ? "ready" : "comparison_snapshot_missing",
    availableRanges,
    missingRanges,
  };
}

export function createLensReadout(input: {
  metricsPack: LensMetricsPack;
  diagnosticsPack: LensDiagnosticsPack;
  comparisonReadiness: LensComparisonReadiness;
}): LensReadout {
  const mapped = mappedMetrics(input.metricsPack);
  const mappedMetricKeys = mapped.map((metric) => metric.key);
  const overall = overallStatus({
    diagnosticsPack: input.diagnosticsPack,
    mappedMetricCount: mapped.length,
  });
  const canAnswerBasicPerformance = input.diagnosticsPack.summary.dataStatus !== "missing_snapshot" && input.diagnosticsPack.summary.dataStatus !== "error" && mapped.length > 0;
  const canAnswerActivation = !input.metricsPack.quality.missingDefinitions.includes("activation_event");
  const canAnswerRetention = !input.metricsPack.quality.missingDefinitions.includes("cohort_retention_logic");

  return {
    contract: "lens.readout.v1",
    tenantId: input.metricsPack.tenantId,
    workspaceId: input.metricsPack.workspaceId,
    appId: input.metricsPack.appId,
    range: input.metricsPack.range,
    generatedAt: new Date().toISOString(),
    basis: {
      metricsPackContract: input.metricsPack.contract,
      diagnosticsPackContract: input.diagnosticsPack.contract,
      sourceSnapshotIds: input.diagnosticsPack.basis.sourceSnapshotIds,
      interpretationMode: "deterministic_readout",
      liveFetchUsed: false,
      llmUsed: false,
    },
    status: {
      overall,
      dataStatus: input.diagnosticsPack.summary.dataStatus,
      canAnswerBasicPerformance,
      canAnswerActivation,
      canAnswerRetention,
      canCompareTrend: input.comparisonReadiness.canCompareTrend,
      canGenerateReadout: overall !== "missing_snapshot" && overall !== "blocked",
    },
    headline: headline({
      overall,
      dataStatus: input.diagnosticsPack.summary.dataStatus,
      highlightCount: mapped.length,
    }),
    metricHighlights: metricHighlights(input.metricsPack),
    readiness: {
      mappedMetrics: mappedMetricKeys,
      blockedMetrics: blockedMetricKeys(input.diagnosticsPack),
      missingDefinitions: missingDefinitions(input.metricsPack),
    },
    deterministicFindings: [
      dataReadinessFinding({
        dataStatus: input.diagnosticsPack.summary.dataStatus,
        metricsPack: input.metricsPack,
        mappedMetricKeys,
      }),
      ...configurationFindings(input.metricsPack),
    ],
    recommendedActions: input.diagnosticsPack.recommendedNextActions,
    limitations: limitations({
      dataStatus: input.diagnosticsPack.summary.dataStatus,
      comparisonReadiness: input.comparisonReadiness,
    }),
    comparisonReadiness: input.comparisonReadiness,
  };
}

export async function getLensReadoutForApp(input: {
  appId: string;
  rangeKey: WorkspaceGa4MetricRangeKey;
}): Promise<LensReadout> {
  const metricsPack = await getLensMetricsPackForApp({
    appId: input.appId,
    rangeKey: input.rangeKey,
  });
  const diagnosticsPack = createLensDiagnosticsPack(metricsPack);
  const readiness = await comparisonReadiness({
    appId: input.appId,
    selectedRangeKey: input.rangeKey,
    selectedMetricsPack: metricsPack,
  });

  return createLensReadout({
    metricsPack,
    diagnosticsPack,
    comparisonReadiness: readiness,
  });
}
