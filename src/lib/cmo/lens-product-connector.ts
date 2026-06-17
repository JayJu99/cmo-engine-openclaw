import "server-only";

import {
  fetchLensGa4CoreMetrics,
  LensGa4DataError,
  resolveLensGa4DateRange,
} from "@/lib/cmo/lens-ga4-data";
import { LensGoogleAccessTokenError } from "@/lib/cmo/lens-google-oauth";
import {
  getLatestWorkspaceGa4MetricSnapshot,
  upsertWorkspaceGa4MetricSnapshot,
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
export type ProductLensConnectorMode = "cache_only" | "refresh_if_missing" | "refresh_if_stale";

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

export interface ProductLensConnectorMetricsBatchRange {
  status: ProductLensConnectorMetricsStatus;
  metrics: ProductLensConnectorMetricsResponse["metrics"] | null;
  range: ProductLensConnectorMetricsResponse["range"];
  source: ProductLensConnectorMetricsResponse["source"];
  quality: ProductLensConnectorMetricsResponse["quality"];
}

export interface ProductLensConnectorMetricsBatchResponse {
  schema_version: "product.lens_connector_metrics_batch.v1";
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  mode: ProductLensConnectorMode;
  ranges: Partial<Record<WorkspaceGa4MetricRangeKey, ProductLensConnectorMetricsBatchRange>>;
  safety: ProductLensConnectorMetricsResponse["safety"];
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

function shouldRefresh(input: {
  mode: ProductLensConnectorMode;
  snapshot: WorkspaceGa4MetricSnapshot | null;
  stale: boolean;
}): boolean {
  if (input.mode === "cache_only") {
    return false;
  }

  if (input.mode === "refresh_if_missing") {
    return !input.snapshot;
  }

  return !input.snapshot || input.stale;
}

function syncWarningCode(error: unknown): string {
  if (error instanceof LensGoogleAccessTokenError) {
    return "source_auth_failed";
  }

  if (error instanceof LensGa4DataError) {
    return error.code;
  }

  return error instanceof Error ? error.message : "ga4_data_sync_failed";
}

async function refreshWorkspaceGa4Snapshot(input: {
  tenantId: string;
  workspaceId: string;
  appId: string;
  rangeKey: WorkspaceGa4MetricRangeKey;
  mapping: WorkspaceGa4MetricSourceMapping | null;
}): Promise<WorkspaceGa4MetricSnapshot | null> {
  const mapping = input.mapping;

  if (!mapping?.enabled || !mapping.propertyId || !mapping.oauthAccountId) {
    return null;
  }

  if (mapping.verificationStatus !== "verified") {
    return null;
  }

  try {
    const result = await fetchLensGa4CoreMetrics({
      tenantId: input.tenantId,
      rangeKey: input.rangeKey,
      mapping,
    });

    return await upsertWorkspaceGa4MetricSnapshot({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      appId: input.appId,
      rangeKey: input.rangeKey,
      dateStart: result.range.dateStart,
      dateEnd: result.range.dateEnd,
      timezone: result.range.timezone,
      status: "synced",
      metrics: result.metrics,
      sourceMeta: {
        ...result.sourceMeta,
        metricNames: result.sourceMeta.metricNames,
      },
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    const range = resolveLensGa4DateRange({
      rangeKey: input.rangeKey,
      timezone: mapping.timezone,
    });

    return await upsertWorkspaceGa4MetricSnapshot({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      appId: input.appId,
      rangeKey: input.rangeKey,
      dateStart: range.dateStart,
      dateEnd: range.dateEnd,
      timezone: range.timezone,
      status: "error",
      metrics: {},
      sourceMeta: {
        propertyId: mapping.propertyId,
        propertyDisplayName: mapping.propertyDisplayName,
        accountDisplayName: mapping.accountDisplayName,
      },
      lastError: syncWarningCode(error),
      syncedAt: new Date().toISOString(),
    });
  }
}

function batchRangeFromResponse(response: ProductLensConnectorMetricsResponse): ProductLensConnectorMetricsBatchRange {
  return {
    status: response.quality.status,
    metrics: response.quality.status === "missing_snapshot" ? null : response.metrics,
    range: response.range,
    source: response.source,
    quality: response.quality,
  };
}

export async function getProductLensConnectorMetrics(input: {
  appId: string;
  rangeKey: WorkspaceGa4MetricRangeKey;
  mode: ProductLensConnectorMode;
}): Promise<ProductLensConnectorMetricsResponse> {
  const entry = requireWorkspaceRegistryEntry(input.appId);
  const nowIso = new Date().toISOString();
  const [initialSnapshot, mapping] = await Promise.all([
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
  let snapshot = initialSnapshot;
  let stale = isSnapshotStale(snapshot, input.rangeKey, nowIso);
  const refreshNeeded = shouldRefresh({
    mode: input.mode,
    snapshot,
    stale,
  });
  const refreshWarnings: string[] = [];

  if (refreshNeeded) {
    const refreshed = await refreshWorkspaceGa4Snapshot({
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      appId: entry.appId,
      rangeKey: input.rangeKey,
      mapping,
    });

    if (refreshed) {
      snapshot = refreshed;
      stale = isSnapshotStale(snapshot, input.rangeKey, new Date().toISOString());
    } else if (!mapping?.enabled || !mapping.propertyId || !mapping.oauthAccountId) {
      refreshWarnings.push("refresh_skipped_missing_ga4_source_mapping");
    } else if (mapping.verificationStatus !== "verified") {
      refreshWarnings.push("refresh_skipped_ga4_source_not_verified");
    }
  }

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

  if (refreshWarnings.length > 0) {
    response.quality.warnings.push(...refreshWarnings);
  }

  return response;
}

export async function getProductLensConnectorMetricsBatch(input: {
  appId: string;
  rangeKeys: WorkspaceGa4MetricRangeKey[];
  mode: ProductLensConnectorMode;
}): Promise<ProductLensConnectorMetricsBatchResponse> {
  const entry = requireWorkspaceRegistryEntry(input.appId);
  const ranges: ProductLensConnectorMetricsBatchResponse["ranges"] = {};

  for (const rangeKey of input.rangeKeys) {
    try {
      const response = await getProductLensConnectorMetrics({
        appId: entry.appId,
        rangeKey,
        mode: input.mode,
      });

      ranges[rangeKey] = batchRangeFromResponse(response);
    } catch (error) {
      ranges[rangeKey] = {
        status: "error",
        metrics: null,
        range: fallbackRange({
          rangeKey,
          timezone: DEFAULT_TIMEZONE,
          nowIso: new Date().toISOString(),
        }),
        source: {
          provider: "ga4",
          source_type: "ga4",
          source_id: "ga4_native",
        },
        quality: {
          status: "error",
          confidence: "low",
          warnings: [error instanceof Error ? error.message : "range_failed"],
        },
      };
    }
  }

  return {
    schema_version: "product.lens_connector_metrics_batch.v1",
    tenant_id: entry.tenantId,
    workspace_id: entry.workspaceId,
    app_id: entry.appId,
    mode: input.mode,
    ranges,
    safety: {
      no_tokens_returned: true,
      raw_ga4_response_included: false,
      vault_write_performed: false,
      gbrain_used: false,
    },
  };
}
