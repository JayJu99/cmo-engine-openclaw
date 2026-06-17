import "server-only";

import {
  getLatestWorkspaceGa4MetricSnapshot,
  type WorkspaceGa4CoreMetrics,
  type WorkspaceGa4MetricRangeKey,
  type WorkspaceGa4MetricSnapshot,
} from "@/lib/cmo/workspace-metric-snapshots";
import {
  getWorkspaceGa4MetricSourceMapping,
  type WorkspaceGa4MetricSourceMapping,
} from "@/lib/cmo/workspace-metric-sources";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export type ProductLensConnectorMetricsStatus = "synced" | "missing_snapshot" | "stale" | "error";
export type ProductLensConnectorConfidence = "high" | "medium" | "low";
export type ProductLensConnectorMode = "cache_only" | "refresh_if_stale";

export interface ProductLensConnectorMetricsResponse {
  schema_version: "product.lens_connector_metrics.v1";
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  range: {
    key: WorkspaceGa4MetricRangeKey;
    date_start: string;
    date_end: string;
    timezone: string;
  };
  source: {
    provider: "ga4";
    source_type: "ga4";
    source_id: "ga4_native";
    property_id?: string;
    property_display_name?: string;
    snapshot_id?: string;
    synced_at?: string | null;
  };
  metrics: {
    active_users: number | null;
    new_users: number | null;
    sessions: number | null;
    event_count: number | null;
    engagement_rate: number | null;
  };
  definitions: {
    activation_event: null;
    retention_logic: null;
  };
  quality: {
    status: ProductLensConnectorMetricsStatus;
    confidence: ProductLensConnectorConfidence;
    warnings: string[];
  };
  safety: {
    no_tokens_returned: true;
    raw_ga4_response_included: false;
    vault_write_performed: false;
    gbrain_used: false;
  };
}

const DEFAULT_TIMEZONE = process.env.CMO_VAULT_TIME_ZONE ?? "Asia/Saigon";

function staleThresholdHours(rangeKey: WorkspaceGa4MetricRangeKey): number {
  return rangeKey === "last_30_days" || rangeKey === "this_month" ? 48 : 24;
}

function isSnapshotStale(snapshot: WorkspaceGa4MetricSnapshot | null, rangeKey: WorkspaceGa4MetricRangeKey, nowIso: string): boolean {
  if (!snapshot?.syncedAt || snapshot.status !== "synced") {
    return false;
  }

  const syncedAt = Date.parse(snapshot.syncedAt);
  const now = Date.parse(nowIso);

  return Number.isFinite(syncedAt) && Number.isFinite(now) && now - syncedAt > staleThresholdHours(rangeKey) * 60 * 60 * 1000;
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

function fallbackRange(input: {
  rangeKey: WorkspaceGa4MetricRangeKey;
  timezone: string;
  nowIso: string;
}): ProductLensConnectorMetricsResponse["range"] {
  const generated = new Date(input.nowIso);
  const today = dateFromParts(zonedDateParts(Number.isNaN(generated.getTime()) ? new Date() : generated, input.timezone));
  const day = today.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(today);

  if (input.rangeKey === "last_7_days") {
    start.setUTCDate(today.getUTCDate() - 6);
  } else if (input.rangeKey === "last_30_days") {
    start.setUTCDate(today.getUTCDate() - 29);
  } else if (input.rangeKey === "this_month") {
    start.setUTCDate(1);
  } else {
    start.setUTCDate(today.getUTCDate() + mondayOffset);
  }

  return {
    key: input.rangeKey,
    date_start: isoDate(start),
    date_end: isoDate(today),
    timezone: input.timezone,
  };
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function connectorMetrics(metrics: WorkspaceGa4CoreMetrics | undefined): ProductLensConnectorMetricsResponse["metrics"] {
  return {
    active_users: numberOrNull(metrics?.activeUsers),
    new_users: numberOrNull(metrics?.newUsers),
    sessions: numberOrNull(metrics?.sessions),
    event_count: numberOrNull(metrics?.eventCount),
    engagement_rate: numberOrNull(metrics?.engagementRate),
  };
}

function quality(input: {
  snapshot: WorkspaceGa4MetricSnapshot | null;
  stale: boolean;
}): ProductLensConnectorMetricsResponse["quality"] {
  const warnings: string[] = [];

  if (!input.snapshot) {
    warnings.push("missing_ga4_snapshot");
    return {
      status: "missing_snapshot",
      confidence: "low",
      warnings,
    };
  }

  if (input.snapshot.status === "error") {
    warnings.push(input.snapshot.lastError || "ga4_snapshot_error");
    return {
      status: "error",
      confidence: "low",
      warnings,
    };
  }

  if (input.stale) {
    warnings.push("stale_ga4_snapshot");
    return {
      status: "stale",
      confidence: "medium",
      warnings,
    };
  }

  return {
    status: "synced",
    confidence: "high",
    warnings,
  };
}

function connectorRange(input: {
  rangeKey: WorkspaceGa4MetricRangeKey;
  snapshot: WorkspaceGa4MetricSnapshot | null;
  mapping: WorkspaceGa4MetricSourceMapping | null;
  nowIso: string;
}): ProductLensConnectorMetricsResponse["range"] {
  const timezone = input.snapshot?.timezone ?? input.mapping?.timezone ?? DEFAULT_TIMEZONE;

  if (input.snapshot) {
    return {
      key: input.snapshot.rangeKey,
      date_start: input.snapshot.dateStart,
      date_end: input.snapshot.dateEnd,
      timezone,
    };
  }

  return fallbackRange({
    rangeKey: input.rangeKey,
    timezone,
    nowIso: input.nowIso,
  });
}

export async function getProductLensConnectorMetrics(input: {
  appId: string;
  rangeKey: WorkspaceGa4MetricRangeKey;
  mode: ProductLensConnectorMode;
}): Promise<ProductLensConnectorMetricsResponse> {
  const entry = requireWorkspaceRegistryEntry(input.appId);
  const nowIso = new Date().toISOString();
  const [snapshot, mapping] = await Promise.all([
    getLatestWorkspaceGa4MetricSnapshot({
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      appId: entry.appId,
      rangeKey: input.rangeKey,
    }),
    getWorkspaceGa4MetricSourceMapping({
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      appId: entry.appId,
    }),
  ]);
  const stale = isSnapshotStale(snapshot, input.rangeKey, nowIso);
  const response: ProductLensConnectorMetricsResponse = {
    schema_version: "product.lens_connector_metrics.v1",
    tenant_id: entry.tenantId,
    workspace_id: entry.workspaceId,
    app_id: entry.appId,
    range: connectorRange({
      rangeKey: input.rangeKey,
      snapshot,
      mapping,
      nowIso,
    }),
    source: {
      provider: "ga4",
      source_type: "ga4",
      source_id: "ga4_native",
      property_id: mapping?.propertyId || snapshot?.sourceMeta?.propertyId,
      property_display_name: mapping?.propertyDisplayName || snapshot?.sourceMeta?.propertyDisplayName,
      snapshot_id: snapshot?.snapshotId,
      synced_at: snapshot?.syncedAt,
    },
    metrics: connectorMetrics(snapshot?.metrics),
    definitions: {
      activation_event: null,
      retention_logic: null,
    },
    quality: quality({ snapshot, stale }),
    safety: {
      no_tokens_returned: true,
      raw_ga4_response_included: false,
      vault_write_performed: false,
      gbrain_used: false,
    },
  };

  if (input.mode === "refresh_if_stale" && (stale || !snapshot)) {
    response.quality.warnings.push("refresh_if_stale_not_implemented_cache_only_returned");
  }

  return response;
}
