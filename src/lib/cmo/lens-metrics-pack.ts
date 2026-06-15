import "server-only";

import {
  getLatestWorkspaceGa4MetricSnapshot,
  type WorkspaceGa4MetricRangeKey,
  type WorkspaceGa4MetricSnapshot,
} from "@/lib/cmo/workspace-metric-snapshots";
import {
  getWorkspaceGa4MetricSourceMapping,
  type WorkspaceGa4MetricSourceMapping,
} from "@/lib/cmo/workspace-metric-sources";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export type LensMetricsPackContract = "lens.metrics_pack.v1";
export type LensMetricsPackQualityStatus = "ready" | "partial" | "missing_snapshot" | "error";
export type LensMetricsPackMappingStatus = "mapped" | "unavailable" | "definition_needed";
export type LensMetricsPackConfidence = "high" | "none";
export type LensMetricsPackSemanticRole = "audience" | "acquisition" | "traffic" | "engagement" | "activation" | "retention";
export type LensMetricsPackMetricUnit = "users" | "sessions" | "events" | "ratio";

export interface LensMetricsPackRange {
  key: WorkspaceGa4MetricRangeKey;
  dateStart: string | null;
  dateEnd: string | null;
  timezone: string | null;
}

export interface LensMetricsPackSource {
  sourceType: "ga4";
  sourceId: "ga4_native";
  provider: "ga4_native";
  propertyId?: string;
  propertyDisplayName?: string;
  accountDisplayName?: string;
  snapshotId?: string;
  syncedAt?: string | null;
  status: "synced" | "error" | "missing_snapshot";
}

export interface LensMetricsPackMetric {
  key: string;
  label: string;
  value: number | null;
  unit: LensMetricsPackMetricUnit;
  displayValue?: string;
  sourceType?: "ga4";
  sourceId?: "ga4_native";
  sourceMetric?: string;
  mappingStatus: LensMetricsPackMappingStatus;
  confidence: LensMetricsPackConfidence;
  semanticRole: LensMetricsPackSemanticRole;
  missingDefinition?: "activation_event" | "cohort_retention_logic";
}

export interface LensMetricsPack {
  contract: LensMetricsPackContract;
  tenantId: string;
  workspaceId: string;
  appId: string;
  range: LensMetricsPackRange;
  generatedAt: string;
  sources: LensMetricsPackSource[];
  metrics: LensMetricsPackMetric[];
  quality: {
    status: LensMetricsPackQualityStatus;
    isStale: boolean;
    staleThresholdHours: number;
    missingDefinitions: Array<"activation_event" | "cohort_retention_logic">;
    warnings: string[];
  };
}

interface WorkspaceScope {
  tenantId: string;
  workspaceId: string;
  appId: string;
}

interface CreateLensMetricsPackInput {
  scope: WorkspaceScope;
  rangeKey: WorkspaceGa4MetricRangeKey;
  snapshot: WorkspaceGa4MetricSnapshot | null;
  mapping: WorkspaceGa4MetricSourceMapping | null;
  generatedAt?: string;
}

const DEFAULT_TIMEZONE = process.env.CMO_VAULT_TIME_ZONE ?? "Asia/Saigon";
const MISSING_DEFINITIONS: LensMetricsPack["quality"]["missingDefinitions"] = ["activation_event", "cohort_retention_logic"];

function staleThresholdHours(rangeKey: WorkspaceGa4MetricRangeKey): number {
  return rangeKey === "last_30_days" || rangeKey === "this_month" ? 48 : 24;
}

function isSnapshotStale(snapshot: WorkspaceGa4MetricSnapshot | null, rangeKey: WorkspaceGa4MetricRangeKey, generatedAt: string): boolean {
  if (!snapshot?.syncedAt || snapshot.status !== "synced") {
    return false;
  }

  const syncedAt = Date.parse(snapshot.syncedAt);
  const current = Date.parse(generatedAt);

  return Number.isFinite(syncedAt) && Number.isFinite(current) && current - syncedAt > staleThresholdHours(rangeKey) * 60 * 60 * 1000;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function zonedDateParts(value: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? "0");

  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
  };
}

function dateFromParts(parts: { year: number; month: number; day: number }): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function fallbackRange(rangeKey: WorkspaceGa4MetricRangeKey, timezone: string, generatedAt: string): LensMetricsPackRange {
  const generated = new Date(generatedAt);
  const today = dateFromParts(zonedDateParts(Number.isNaN(generated.getTime()) ? new Date() : generated, timezone));
  const day = today.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(today);

  if (rangeKey === "last_7_days") {
    start.setUTCDate(today.getUTCDate() - 6);
  } else if (rangeKey === "last_30_days") {
    start.setUTCDate(today.getUTCDate() - 29);
  } else if (rangeKey === "this_month") {
    start.setUTCDate(1);
  } else {
    start.setUTCDate(today.getUTCDate() + mondayOffset);
  }

  return {
    key: rangeKey,
    dateStart: isoDate(start),
    dateEnd: isoDate(today),
    timezone,
  };
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentDisplayValue(value: number | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value * 100)}%`;
}

function ga4Metric(input: {
  key: string;
  label: string;
  value: number | null;
  unit: LensMetricsPackMetricUnit;
  sourceMetric: keyof WorkspaceGa4MetricSnapshot["metrics"];
  semanticRole: LensMetricsPackSemanticRole;
  displayValue?: string;
}): LensMetricsPackMetric {
  return {
    key: input.key,
    label: input.label,
    value: input.value,
    unit: input.unit,
    displayValue: input.displayValue,
    sourceType: "ga4",
    sourceId: "ga4_native",
    sourceMetric: input.sourceMetric,
    mappingStatus: input.value === null ? "unavailable" : "mapped",
    confidence: input.value === null ? "none" : "high",
    semanticRole: input.semanticRole,
  };
}

function definitionNeededMetric(input: {
  key: string;
  label: string;
  unit: LensMetricsPackMetricUnit;
  semanticRole: "activation" | "retention";
  missingDefinition: "activation_event" | "cohort_retention_logic";
}): LensMetricsPackMetric {
  return {
    key: input.key,
    label: input.label,
    value: null,
    unit: input.unit,
    mappingStatus: "definition_needed",
    confidence: "none",
    semanticRole: input.semanticRole,
    missingDefinition: input.missingDefinition,
  };
}

function sourceMetadata(input: {
  snapshot: WorkspaceGa4MetricSnapshot | null;
  mapping: WorkspaceGa4MetricSourceMapping | null;
}): LensMetricsPackSource {
  const snapshot = input.snapshot;
  const mapping = input.mapping;

  return {
    sourceType: "ga4",
    sourceId: "ga4_native",
    provider: "ga4_native",
    propertyId: mapping?.propertyId || snapshot?.sourceMeta?.propertyId,
    propertyDisplayName: mapping?.propertyDisplayName || snapshot?.sourceMeta?.propertyDisplayName,
    accountDisplayName: mapping?.accountDisplayName || snapshot?.sourceMeta?.accountDisplayName,
    snapshotId: snapshot?.snapshotId,
    syncedAt: snapshot?.syncedAt,
    status: snapshot?.status ?? "missing_snapshot",
  };
}

function qualityStatus(input: {
  snapshot: WorkspaceGa4MetricSnapshot | null;
  ga4Metrics: LensMetricsPackMetric[];
}): LensMetricsPackQualityStatus {
  if (!input.snapshot) {
    return "missing_snapshot";
  }

  if (input.snapshot.status === "error") {
    return "error";
  }

  return input.ga4Metrics.every((metric) => metric.mappingStatus === "mapped") ? "ready" : "partial";
}

export function createLensMetricsPackFromSnapshot(input: CreateLensMetricsPackInput): LensMetricsPack {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const timezone = input.snapshot?.timezone ?? input.mapping?.timezone ?? DEFAULT_TIMEZONE;
  const range = input.snapshot
    ? {
      key: input.snapshot.rangeKey,
      dateStart: input.snapshot.dateStart,
      dateEnd: input.snapshot.dateEnd,
      timezone,
    }
    : fallbackRange(input.rangeKey, timezone, generatedAt);
  const metrics = input.snapshot?.metrics ?? {};
  const activeUsers = numberOrNull(metrics.activeUsers);
  const newUsers = numberOrNull(metrics.newUsers);
  const sessions = numberOrNull(metrics.sessions);
  const eventCount = numberOrNull(metrics.eventCount);
  const engagementRate = numberOrNull(metrics.engagementRate);
  const ga4Metrics: LensMetricsPackMetric[] = [
    ga4Metric({
      key: "ga4.active_users",
      label: "Active Users",
      value: activeUsers,
      unit: "users",
      sourceMetric: "activeUsers",
      semanticRole: "audience",
    }),
    ga4Metric({
      key: "ga4.new_users",
      label: "New Users",
      value: newUsers,
      unit: "users",
      sourceMetric: "newUsers",
      semanticRole: "acquisition",
    }),
    ga4Metric({
      key: "ga4.sessions",
      label: "Sessions",
      value: sessions,
      unit: "sessions",
      sourceMetric: "sessions",
      semanticRole: "traffic",
    }),
    ga4Metric({
      key: "ga4.event_count",
      label: "Event Count",
      value: eventCount,
      unit: "events",
      sourceMetric: "eventCount",
      semanticRole: "engagement",
    }),
    ga4Metric({
      key: "ga4.engagement_rate",
      label: "Engagement Rate",
      value: engagementRate,
      unit: "ratio",
      displayValue: percentDisplayValue(engagementRate),
      sourceMetric: "engagementRate",
      semanticRole: "engagement",
    }),
  ];
  const allMetrics: LensMetricsPackMetric[] = [
    ...ga4Metrics,
    definitionNeededMetric({
      key: "activation.activated_users",
      label: "Activated Users",
      unit: "users",
      semanticRole: "activation",
      missingDefinition: "activation_event",
    }),
    definitionNeededMetric({
      key: "activation.activation_rate",
      label: "Activation Rate",
      unit: "ratio",
      semanticRole: "activation",
      missingDefinition: "activation_event",
    }),
    definitionNeededMetric({
      key: "retention.d1",
      label: "D1 Retention",
      unit: "ratio",
      semanticRole: "retention",
      missingDefinition: "cohort_retention_logic",
    }),
    definitionNeededMetric({
      key: "retention.d7",
      label: "D7 Retention",
      unit: "ratio",
      semanticRole: "retention",
      missingDefinition: "cohort_retention_logic",
    }),
  ];
  const warnings = [
    !input.snapshot ? "missing_ga4_snapshot" : null,
    input.snapshot?.status === "error" ? input.snapshot.lastError || "ga4_snapshot_error" : null,
    input.mapping ? null : "missing_ga4_source_mapping",
    ...ga4Metrics.filter((metric) => metric.mappingStatus !== "mapped").map((metric) => `missing_${metric.sourceMetric}`),
  ].filter((warning): warning is string => Boolean(warning));
  const isStale = isSnapshotStale(input.snapshot, input.rangeKey, generatedAt);

  if (isStale) {
    warnings.push("stale_ga4_snapshot");
  }

  return {
    contract: "lens.metrics_pack.v1",
    tenantId: input.scope.tenantId,
    workspaceId: input.scope.workspaceId,
    appId: input.scope.appId,
    range,
    generatedAt,
    sources: [sourceMetadata({ snapshot: input.snapshot, mapping: input.mapping })],
    metrics: allMetrics,
    quality: {
      status: qualityStatus({ snapshot: input.snapshot, ga4Metrics }),
      isStale,
      staleThresholdHours: staleThresholdHours(input.rangeKey),
      missingDefinitions: MISSING_DEFINITIONS,
      warnings,
    },
  };
}

export async function getLensMetricsPackForApp(input: {
  appId: string;
  rangeKey: WorkspaceGa4MetricRangeKey;
}): Promise<LensMetricsPack> {
  const entry = requireWorkspaceRegistryEntry(input.appId);
  const scope = {
    tenantId: entry.tenantId,
    workspaceId: entry.workspaceId,
    appId: entry.appId,
  };
  const [snapshot, mapping] = await Promise.all([
    getLatestWorkspaceGa4MetricSnapshot({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      appId: scope.appId,
      rangeKey: input.rangeKey,
    }),
    getWorkspaceGa4MetricSourceMapping({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      appId: scope.appId,
    }),
  ]);

  return createLensMetricsPackFromSnapshot({
    scope,
    rangeKey: input.rangeKey,
    snapshot,
    mapping,
  });
}
