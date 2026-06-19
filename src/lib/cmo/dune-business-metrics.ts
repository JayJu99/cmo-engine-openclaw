import "server-only";

import { getCmoDuneApiKey, isCmoDuneNativeDashboardEnabled, isCmoDuneNativeEnabled } from "@/lib/cmo/config";
import type {
  CmoBusinessMetric,
  CmoBusinessMetricGroup,
  CmoBusinessMetricSeries,
  CmoBusinessMetricTable,
  CmoBusinessMetricsSnapshot,
} from "@/lib/cmo/app-workspace-types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireWorkspaceRegistryEntry, type WorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

const DUNE_RESULTS_BASE_URL = "https://api.dune.com/api/v1/query";
const DEFAULT_TIMEZONE = process.env.CMO_VAULT_TIME_ZONE ?? "Asia/Saigon";
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export type DuneBusinessQueryKey = "wld_aggregator_daily" | "wld_partner_stats_daily";
export type DuneBusinessSyncMode = "refresh_all" | "refresh_if_stale";
export type DuneBusinessSnapshotStatus = "connected" | "partial" | "missing" | "stale" | "failed";

export interface DuneBusinessQueryConfig {
  queryKey: DuneBusinessQueryKey;
  metricGroup: Extract<CmoBusinessMetricGroup, "wld_aggregator_daily" | "wld_partner_stats_daily">;
  queryName: string;
  queryId: string;
  limit: number;
  sourceFields: string[];
  seriesId: string;
  tableId?: string;
}

export const DUNE_BUSINESS_QUERY_REGISTRY: Record<DuneBusinessQueryKey, DuneBusinessQueryConfig> = {
  wld_aggregator_daily: {
    queryKey: "wld_aggregator_daily",
    metricGroup: "wld_aggregator_daily",
    queryName: "holdstation_wld_aggregator_tx",
    queryId: "5057875",
    limit: 1000,
    sourceFields: ["evt_block_date", "count_tx", "cumulative_tx_count", "daily_volume", "cumulative_volume", "fee_amount"],
    seriesId: "wld_aggregator_daily_series",
  },
  wld_partner_stats_daily: {
    queryKey: "wld_partner_stats_daily",
    metricGroup: "wld_partner_stats_daily",
    queryName: "Partner Stats on WLD",
    queryId: "5454333",
    limit: 3000,
    sourceFields: ["partnerCode", "evt_block_date", "volume", "count_tx"],
    seriesId: "wld_partner_daily_series",
    tableId: "wld_partner_summary",
  },
};

export interface NativeDuneBusinessSnapshot {
  tenantId: string;
  workspaceId: string;
  appId: string;
  sourceType: "dune";
  sourceId: "dune_native";
  provider: "dune";
  metricDomain: "business";
  metricGroup: DuneBusinessQueryConfig["metricGroup"];
  queryId: string;
  queryName: string;
  rangePreset: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  timezone: string | null;
  status: DuneBusinessSnapshotStatus;
  metrics: CmoBusinessMetric[];
  series: CmoBusinessMetricSeries[];
  tables: CmoBusinessMetricTable[];
  diagnostics: {
    availableMetrics: string[];
    missingMetrics: string[];
    notes: string[];
    sourceRows: number;
    qualityStatus: DuneBusinessSnapshotStatus;
  };
  provenance: Record<string, unknown>;
  syncedAt: string | null;
}

interface WorkspaceBusinessMetricSnapshotRow {
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  source_type: "dune";
  source_id: "dune_native";
  provider: "dune";
  metric_domain: "business";
  metric_group: DuneBusinessQueryConfig["metricGroup"];
  query_id: string | null;
  query_name: string | null;
  range_preset: string | null;
  date_start: string | null;
  date_end: string | null;
  timezone: string | null;
  status: DuneBusinessSnapshotStatus;
  metrics_json: unknown;
  series_json: unknown;
  tables_json: unknown;
  diagnostics_json: unknown;
  provenance_json: unknown;
  synced_at: string | null;
}

interface DuneBusinessSyncResultItem {
  queryKey: DuneBusinessQueryKey;
  metricGroup: DuneBusinessQueryConfig["metricGroup"];
  queryId: string;
  queryName: string;
  status: "synced" | "skipped" | "dry_run" | "failed";
  snapshot?: NativeDuneBusinessSnapshot;
  errorCode?: string;
}

export interface DuneBusinessSyncResult {
  schema_version: "product.dune_business_sync_result.v1";
  status: "completed" | "partial" | "failed";
  workspaces: Array<{
    tenant_id: string;
    workspace_id: string;
    app_id: string;
  }>;
  results: DuneBusinessSyncResultItem[];
  summary: {
    requested_query_keys: DuneBusinessQueryKey[];
    synced_count: number;
    skipped_count: number;
    failed_count: number;
    dry_run: boolean;
    native_enabled: boolean;
  };
  safety: DuneBusinessSafety;
}

export interface DuneBusinessSafety {
  no_api_key_returned: true;
  raw_dune_response_included: false;
  vault_write_performed: false;
  gbrain_used: false;
  hermes_called: false;
}

export const DUNE_BUSINESS_SAFETY: DuneBusinessSafety = {
  no_api_key_returned: true,
  raw_dune_response_included: false,
  vault_write_performed: false,
  gbrain_used: false,
  hermes_called: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) {
    return [];
  }

  const result = isRecord(value.result) ? value.result : {};
  const rows = Array.isArray(result.rows) ? result.rows : Array.isArray(value.rows) ? value.rows : [];

  return rows.filter(isRecord);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replaceAll(",", ""));

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function numberOrZero(value: unknown): number {
  return numberValue(value) ?? 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function dateString(value: unknown): string {
  const input = stringValue(value);
  const match = input.match(/^\d{4}-\d{2}-\d{2}/);

  return match?.[0] ?? "";
}

function formatCount(value: number | null): string {
  return value === null ? "No data" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatUsd(value: number | null): string {
  return value === null ? "No data" : `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}`;
}

function metric(input: {
  id: string;
  label: string;
  value: number | null;
  unit?: CmoBusinessMetric["unit"];
  displayValue?: string;
  textValue?: string;
  description: string;
}): CmoBusinessMetric {
  const hasValue = input.value !== null || Boolean(input.textValue);

  return {
    id: input.id,
    label: input.label,
    value: input.value,
    ...(input.textValue ? { textValue: input.textValue } : {}),
    displayValue: input.displayValue ?? input.textValue ?? (input.unit === "usd" ? formatUsd(input.value) : formatCount(input.value)),
    ...(input.unit ? { unit: input.unit } : {}),
    status: hasValue ? "connected" : "missing",
    description: input.description,
  };
}

function snapshotStatus(metrics: CmoBusinessMetric[], pointCount: number): DuneBusinessSnapshotStatus {
  if (pointCount === 0 || metrics.every((item) => item.status === "missing")) {
    return "missing";
  }

  return metrics.every((item) => item.status === "connected") ? "connected" : "partial";
}

function availableMetricIds(metrics: CmoBusinessMetric[]): string[] {
  return metrics.filter((item) => item.status === "connected").map((item) => item.id);
}

function missingMetricIds(metrics: CmoBusinessMetric[]): string[] {
  return metrics.filter((item) => item.status !== "connected").map((item) => item.id);
}

function sortedRowsByDate(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((left, right) => dateString(left.evt_block_date).localeCompare(dateString(right.evt_block_date)));
}

function rangeForRows(rows: Record<string, unknown>[]): { dateStart: string | null; dateEnd: string | null } {
  const dates = sortedRowsByDate(rows).map((row) => dateString(row.evt_block_date)).filter(Boolean);

  return {
    dateStart: dates[0] ?? null,
    dateEnd: dates[dates.length - 1] ?? null,
  };
}

function normalizeAggregatorRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return sortedRowsByDate(rows)
    .map((row) => ({
      evt_block_date: dateString(row.evt_block_date),
      count_tx: numberOrZero(row.count_tx),
      cumulative_tx_count: numberOrZero(row.cumulative_tx_count),
      daily_volume: numberOrZero(row.daily_volume),
      cumulative_volume: numberOrZero(row.cumulative_volume),
      fee_amount: numberOrZero(row.fee_amount),
    }))
    .filter((row) => row.evt_block_date);
}

function normalizePartnerRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return sortedRowsByDate(rows)
    .map((row) => ({
      partnerCode: stringValue(row.partnerCode) || "Unknown",
      evt_block_date: dateString(row.evt_block_date),
      volume: numberOrZero(row.volume),
      count_tx: numberOrZero(row.count_tx),
    }))
    .filter((row) => row.evt_block_date);
}

function buildAggregatorSnapshot(entry: WorkspaceRegistryEntry, config: DuneBusinessQueryConfig, rows: Record<string, unknown>[], syncedAt: string): NativeDuneBusinessSnapshot {
  const points = normalizeAggregatorRows(rows);
  const latest = points[points.length - 1];
  const latestDailyTx = latest ? numberValue(latest.count_tx) : null;
  const cumulativeTx = latest ? numberValue(latest.cumulative_tx_count) : null;
  const latestDailyVolume = latest ? numberValue(latest.daily_volume) : null;
  const cumulativeVolume = latest ? numberValue(latest.cumulative_volume) : null;
  const latestFee = latest ? numberValue(latest.fee_amount) : null;
  const metrics = [
    metric({
      id: "wld_aggregator_latest_daily_tx",
      label: "Latest Daily Transactions",
      value: latestDailyTx,
      unit: "count",
      description: "Latest daily WLD aggregator transaction count from native Dune / Worldchain sync.",
    }),
    metric({
      id: "wld_aggregator_cumulative_tx",
      label: "Cumulative Transactions",
      value: cumulativeTx,
      unit: "count",
      description: "Cumulative WLD aggregator transaction count from native Dune / Worldchain sync.",
    }),
    metric({
      id: "wld_aggregator_latest_daily_volume_usd",
      label: "Latest Daily Volume",
      value: latestDailyVolume,
      unit: "usd",
      description: "Latest daily WLD aggregator volume in USD from native Dune / Worldchain sync.",
    }),
    metric({
      id: "wld_aggregator_cumulative_volume_usd",
      label: "Cumulative Volume",
      value: cumulativeVolume,
      unit: "usd",
      description: "Cumulative WLD aggregator volume in USD from native Dune / Worldchain sync.",
    }),
    metric({
      id: "wld_aggregator_latest_fee_usd",
      label: "Latest Fee Amount",
      value: latestFee,
      unit: "usd",
      description: "Latest WLD aggregator fee amount in USD from native Dune / Worldchain sync.",
    }),
  ];
  const range = rangeForRows(points);
  const status = snapshotStatus(metrics, points.length);

  return nativeSnapshot({
    entry,
    config,
    metrics,
    series: [{ id: config.seriesId, points }],
    tables: [],
    range,
    status,
    sourceRows: rows.length,
    syncedAt,
  });
}

function buildPartnerSummaryRows(points: Record<string, unknown>[]): Record<string, unknown>[] {
  const summary = new Map<string, { partnerCode: string; total_volume: number; total_transactions: number; dates: Set<string> }>();

  points.forEach((point) => {
    const partnerCode = stringValue(point.partnerCode) || "Unknown";
    const existing = summary.get(partnerCode) ?? {
      partnerCode,
      total_volume: 0,
      total_transactions: 0,
      dates: new Set<string>(),
    };

    existing.total_volume += numberOrZero(point.volume);
    existing.total_transactions += numberOrZero(point.count_tx);
    existing.dates.add(dateString(point.evt_block_date));
    summary.set(partnerCode, existing);
  });

  const rows = [...summary.values()]
    .filter((row) => row.total_volume > 0 || row.total_transactions > 0)
    .sort((left, right) => right.total_volume - left.total_volume);
  const totalVolume = rows.reduce((sum, row) => sum + row.total_volume, 0);
  const totalTransactions = rows.reduce((sum, row) => sum + row.total_transactions, 0);

  return rows.map((row) => ({
    partnerCode: row.partnerCode,
    total_volume: row.total_volume,
    total_transactions: row.total_transactions,
    volume_share_pct: totalVolume > 0 ? Number((row.total_volume / totalVolume * 100).toFixed(2)) : 0,
    tx_share_pct: totalTransactions > 0 ? Number((row.total_transactions / totalTransactions * 100).toFixed(2)) : 0,
    active_days: row.dates.size,
  }));
}

function buildPartnerSnapshot(entry: WorkspaceRegistryEntry, config: DuneBusinessQueryConfig, rows: Record<string, unknown>[], syncedAt: string): NativeDuneBusinessSnapshot {
  const points = normalizePartnerRows(rows);
  const tableRows = buildPartnerSummaryRows(points);
  const totalVolume = tableRows.reduce((sum, row) => sum + numberOrZero(row.total_volume), 0);
  const totalTransactions = tableRows.reduce((sum, row) => sum + numberOrZero(row.total_transactions), 0);
  const topByVolume = stringValue(tableRows[0]?.partnerCode);
  const topByTx = stringValue([...tableRows].sort((left, right) => numberOrZero(right.total_transactions) - numberOrZero(left.total_transactions))[0]?.partnerCode);
  const metrics = [
    metric({
      id: "wld_partner_total_volume_usd",
      label: "Partner Total Volume",
      value: tableRows.length ? totalVolume : null,
      unit: "usd",
      description: "Total WLD partner volume in USD from native Dune / Worldchain sync.",
    }),
    metric({
      id: "wld_partner_total_transactions",
      label: "Partner Total Transactions",
      value: tableRows.length ? totalTransactions : null,
      unit: "count",
      description: "Total WLD partner transaction count from native Dune / Worldchain sync.",
    }),
    metric({
      id: "wld_partner_active_count",
      label: "Active Partners",
      value: tableRows.length ? tableRows.length : null,
      unit: "count",
      description: "Active WLD partner count from native Dune / Worldchain sync.",
    }),
    metric({
      id: "wld_partner_top_by_volume",
      label: "Top Partner by Volume",
      value: null,
      textValue: topByVolume || undefined,
      displayValue: topByVolume || "No data",
      description: "Top WLD partner by volume from native Dune / Worldchain sync.",
    }),
    metric({
      id: "wld_partner_top_by_tx",
      label: "Top Partner by Transactions",
      value: null,
      textValue: topByTx || undefined,
      displayValue: topByTx || "No data",
      description: "Top WLD partner by transaction count from native Dune / Worldchain sync.",
    }),
  ];
  const range = rangeForRows(points);
  const status = snapshotStatus(metrics, points.length);

  return nativeSnapshot({
    entry,
    config,
    metrics,
    series: [{ id: config.seriesId, points }],
    tables: [{ id: config.tableId ?? "wld_partner_summary", rows: tableRows }],
    range,
    status,
    sourceRows: rows.length,
    syncedAt,
  });
}

function nativeSnapshot(input: {
  entry: WorkspaceRegistryEntry;
  config: DuneBusinessQueryConfig;
  metrics: CmoBusinessMetric[];
  series: CmoBusinessMetricSeries[];
  tables: CmoBusinessMetricTable[];
  range: { dateStart: string | null; dateEnd: string | null };
  status: DuneBusinessSnapshotStatus;
  sourceRows: number;
  syncedAt: string;
}): NativeDuneBusinessSnapshot {
  return {
    tenantId: input.entry.tenantId,
    workspaceId: input.entry.workspaceId,
    appId: input.entry.appId,
    sourceType: "dune",
    sourceId: "dune_native",
    provider: "dune",
    metricDomain: "business",
    metricGroup: input.config.metricGroup,
    queryId: input.config.queryId,
    queryName: input.config.queryName,
    rangePreset: "latest_results",
    dateStart: input.range.dateStart,
    dateEnd: input.range.dateEnd,
    timezone: "UTC",
    status: input.status,
    metrics: input.metrics,
    series: input.series,
    tables: input.tables,
    diagnostics: {
      availableMetrics: availableMetricIds(input.metrics),
      missingMetrics: missingMetricIds(input.metrics),
      notes: [
        "Loaded from Product native Dune connector.",
        "Raw Dune API response is not stored or returned.",
      ],
      sourceRows: input.sourceRows,
      qualityStatus: input.status,
    },
    provenance: {
      sourceWorkflow: "product_native_dune_connector",
      queryKey: input.config.queryKey,
      queryId: input.config.queryId,
      queryName: input.config.queryName,
      nativeConnector: true,
      rawDuneResponseStored: false,
      vaultWritePerformed: false,
      gbrainUsed: false,
      hermesCalled: false,
    },
    syncedAt: input.syncedAt,
  };
}

export function configuredDuneBusinessQueryKeys(input?: string[]): DuneBusinessQueryKey[] {
  const requested = input?.filter((value): value is DuneBusinessQueryKey => value === "wld_aggregator_daily" || value === "wld_partner_stats_daily") ?? [];

  return Array.from(new Set(requested.length ? requested : ["wld_aggregator_daily", "wld_partner_stats_daily"]));
}

async function fetchDuneRows(config: DuneBusinessQueryConfig): Promise<Record<string, unknown>[]> {
  const apiKey = getCmoDuneApiKey();

  if (!apiKey) {
    throw new Error("dune_api_key_not_configured");
  }

  const url = `${DUNE_RESULTS_BASE_URL}/${encodeURIComponent(config.queryId)}/results?limit=${config.limit}`;
  const response = await fetch(url, {
    headers: {
      "x-dune-api-key": apiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`dune_results_request_failed_${response.status}`);
  }

  const payload = await response.json() as unknown;

  return asRows(payload);
}

export function transformDuneBusinessRows(entry: WorkspaceRegistryEntry, queryKey: DuneBusinessQueryKey, rows: Record<string, unknown>[], syncedAt = new Date().toISOString()): NativeDuneBusinessSnapshot {
  const config = DUNE_BUSINESS_QUERY_REGISTRY[queryKey];

  if (queryKey === "wld_aggregator_daily") {
    return buildAggregatorSnapshot(entry, config, rows, syncedAt);
  }

  return buildPartnerSnapshot(entry, config, rows, syncedAt);
}

function toRow(snapshot: NativeDuneBusinessSnapshot): Record<string, unknown> {
  return {
    tenant_id: snapshot.tenantId,
    workspace_id: snapshot.workspaceId,
    app_id: snapshot.appId,
    source_type: snapshot.sourceType,
    source_id: snapshot.sourceId,
    provider: snapshot.provider,
    metric_domain: snapshot.metricDomain,
    metric_group: snapshot.metricGroup,
    query_id: snapshot.queryId,
    query_name: snapshot.queryName,
    range_preset: snapshot.rangePreset,
    date_start: snapshot.dateStart,
    date_end: snapshot.dateEnd,
    timezone: snapshot.timezone,
    status: snapshot.status,
    metrics_json: snapshot.metrics,
    series_json: snapshot.series,
    tables_json: snapshot.tables,
    diagnostics_json: snapshot.diagnostics,
    provenance_json: snapshot.provenance,
    synced_at: snapshot.syncedAt,
  };
}

function jsonArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function toNativeSnapshot(row: WorkspaceBusinessMetricSnapshotRow): NativeDuneBusinessSnapshot {
  const config = DUNE_BUSINESS_QUERY_REGISTRY[row.metric_group === "wld_partner_stats_daily" ? "wld_partner_stats_daily" : "wld_aggregator_daily"];
  const diagnostics = isRecord(row.diagnostics_json) ? row.diagnostics_json : {};

  return {
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    appId: row.app_id,
    sourceType: "dune",
    sourceId: "dune_native",
    provider: "dune",
    metricDomain: "business",
    metricGroup: row.metric_group,
    queryId: row.query_id ?? config.queryId,
    queryName: row.query_name ?? config.queryName,
    rangePreset: row.range_preset,
    dateStart: row.date_start,
    dateEnd: row.date_end,
    timezone: row.timezone,
    status: row.status,
    metrics: jsonArray(row.metrics_json) as unknown as CmoBusinessMetric[],
    series: jsonArray(row.series_json) as unknown as CmoBusinessMetricSeries[],
    tables: jsonArray(row.tables_json) as unknown as CmoBusinessMetricTable[],
    diagnostics: {
      availableMetrics: Array.isArray(diagnostics.availableMetrics) ? diagnostics.availableMetrics.filter((value): value is string => typeof value === "string") : [],
      missingMetrics: Array.isArray(diagnostics.missingMetrics) ? diagnostics.missingMetrics.filter((value): value is string => typeof value === "string") : [],
      notes: Array.isArray(diagnostics.notes) ? diagnostics.notes.filter((value): value is string => typeof value === "string") : [],
      sourceRows: numberOrZero(diagnostics.sourceRows),
      qualityStatus: row.status,
    },
    provenance: isRecord(row.provenance_json) ? row.provenance_json : {},
    syncedAt: row.synced_at,
  };
}

export async function upsertNativeDuneBusinessSnapshot(snapshot: NativeDuneBusinessSnapshot): Promise<NativeDuneBusinessSnapshot> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("workspace_business_metric_snapshots")
    .upsert(toRow(snapshot), {
      onConflict: "tenant_id,workspace_id,app_id,source_type,source_id,metric_group",
    })
    .select("tenant_id,workspace_id,app_id,source_type,source_id,provider,metric_domain,metric_group,query_id,query_name,range_preset,date_start,date_end,timezone,status,metrics_json,series_json,tables_json,diagnostics_json,provenance_json,synced_at")
    .single();

  if (error) {
    throw new Error(`native_dune_snapshot_upsert_failed:${error.message}`);
  }

  return toNativeSnapshot(data as WorkspaceBusinessMetricSnapshotRow);
}

export async function getNativeDuneBusinessSnapshots(appId: string): Promise<NativeDuneBusinessSnapshot[]> {
  const entry = requireWorkspaceRegistryEntry(appId);
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("workspace_business_metric_snapshots")
    .select("tenant_id,workspace_id,app_id,source_type,source_id,provider,metric_domain,metric_group,query_id,query_name,range_preset,date_start,date_end,timezone,status,metrics_json,series_json,tables_json,diagnostics_json,provenance_json,synced_at")
    .eq("tenant_id", entry.tenantId)
    .eq("workspace_id", entry.workspaceId)
    .eq("app_id", entry.appId)
    .eq("source_type", "dune")
    .eq("source_id", "dune_native")
    .order("metric_group", { ascending: true });

  if (error) {
    throw new Error(`native_dune_snapshot_lookup_failed:${error.message}`);
  }

  return (data ?? []).map((row) => toNativeSnapshot(row as WorkspaceBusinessMetricSnapshotRow));
}

export async function getNativeDuneBusinessSnapshot(appId: string, group: CmoBusinessMetricGroup): Promise<NativeDuneBusinessSnapshot | null> {
  if (group !== "wld_aggregator_daily" && group !== "wld_partner_stats_daily") {
    return null;
  }

  const snapshots = await getNativeDuneBusinessSnapshots(appId);

  return snapshots.find((snapshot) => snapshot.metricGroup === group) ?? null;
}

function isStale(snapshot: NativeDuneBusinessSnapshot | null): boolean {
  if (!snapshot?.syncedAt) {
    return true;
  }

  const syncedAt = Date.parse(snapshot.syncedAt);

  return !Number.isFinite(syncedAt) || Date.now() - syncedAt > STALE_AFTER_MS;
}

export function nativeDuneSnapshotToBusinessMetrics(snapshot: NativeDuneBusinessSnapshot): CmoBusinessMetricsSnapshot {
  const entry = requireWorkspaceRegistryEntry(snapshot.appId);

  return {
    schemaVersion: "cmo.business-metrics.v1",
    workspaceId: snapshot.workspaceId,
    appId: snapshot.appId,
    sourceId: entry.sourceId,
    source: {
      type: "dune",
      fetchedAt: snapshot.syncedAt ?? new Date(0).toISOString(),
      sourceId: "dune_native",
      label: "Dune Native",
      queryId: snapshot.queryId,
      queryName: snapshot.queryName,
    },
    metricDomain: "business",
    metricGroup: snapshot.metricGroup,
    dateRange: {
      preset: snapshot.rangePreset ?? undefined,
      startDate: snapshot.dateStart ?? undefined,
      endDate: snapshot.dateEnd ?? undefined,
      timezone: snapshot.timezone ?? DEFAULT_TIMEZONE,
    },
    status: snapshot.status === "connected" ? "connected" : snapshot.status === "missing" || snapshot.status === "failed" ? "missing" : "partial",
    lastUpdatedAt: snapshot.syncedAt,
    metrics: snapshot.metrics,
    series: snapshot.series,
    tables: snapshot.tables,
    diagnostics: {
      availableMetrics: snapshot.diagnostics.availableMetrics,
      missingMetrics: snapshot.diagnostics.missingMetrics,
      notes: snapshot.diagnostics.notes,
    },
    sourceStats: {
      native: true,
      status: snapshot.status,
      queryId: snapshot.queryId,
      queryName: snapshot.queryName,
      syncedAt: snapshot.syncedAt,
      stale: isStale(snapshot),
    },
    provenance: snapshot.provenance,
  };
}

export async function readNativeDuneBusinessMetricsSnapshot(appId: string, group: CmoBusinessMetricGroup): Promise<CmoBusinessMetricsSnapshot | null> {
  if (!isCmoDuneNativeDashboardEnabled()) {
    return null;
  }

  try {
    const snapshot = await getNativeDuneBusinessSnapshot(appId, group);

    return snapshot ? nativeDuneSnapshotToBusinessMetrics(snapshot) : null;
  } catch {
    return null;
  }
}

export async function runNativeDuneBusinessSync(input: {
  appId: string;
  queryKeys?: DuneBusinessQueryKey[];
  mode?: DuneBusinessSyncMode;
  trigger?: string;
  dryRun?: boolean;
}): Promise<DuneBusinessSyncResult> {
  const entry = requireWorkspaceRegistryEntry(input.appId);
  const requestedQueryKeys = configuredDuneBusinessQueryKeys(input.queryKeys);
  const dryRun = input.dryRun === true;
  const nativeEnabled = isCmoDuneNativeEnabled();
  const results: DuneBusinessSyncResultItem[] = [];

  for (const queryKey of requestedQueryKeys) {
    const config = DUNE_BUSINESS_QUERY_REGISTRY[queryKey];

    if (dryRun) {
      results.push({
        queryKey,
        metricGroup: config.metricGroup,
        queryId: config.queryId,
        queryName: config.queryName,
        status: "dry_run",
      });
      continue;
    }

    if (!nativeEnabled) {
      results.push({
        queryKey,
        metricGroup: config.metricGroup,
        queryId: config.queryId,
        queryName: config.queryName,
        status: "failed",
        errorCode: "native_dune_disabled",
      });
      continue;
    }

    try {
      if (input.mode === "refresh_if_stale") {
        const existing = await getNativeDuneBusinessSnapshot(entry.appId, config.metricGroup);

        if (existing && !isStale(existing)) {
          results.push({
            queryKey,
            metricGroup: config.metricGroup,
            queryId: config.queryId,
            queryName: config.queryName,
            status: "skipped",
            snapshot: existing,
          });
          continue;
        }
      }

      const rows = await fetchDuneRows(config);
      const snapshot = transformDuneBusinessRows(entry, queryKey, rows);
      const persisted = await upsertNativeDuneBusinessSnapshot(snapshot);

      results.push({
        queryKey,
        metricGroup: config.metricGroup,
        queryId: config.queryId,
        queryName: config.queryName,
        status: "synced",
        snapshot: persisted,
      });
    } catch (error) {
      results.push({
        queryKey,
        metricGroup: config.metricGroup,
        queryId: config.queryId,
        queryName: config.queryName,
        status: "failed",
        errorCode: error instanceof Error ? error.message.split(":")[0] : "native_dune_sync_failed",
      });
    }
  }

  const failedCount = results.filter((item) => item.status === "failed").length;
  const syncedCount = results.filter((item) => item.status === "synced").length;
  const skippedCount = results.filter((item) => item.status === "skipped").length;
  const completedCount = syncedCount + skippedCount + results.filter((item) => item.status === "dry_run").length;

  return {
    schema_version: "product.dune_business_sync_result.v1",
    status: failedCount === 0 ? "completed" : completedCount > 0 ? "partial" : "failed",
    workspaces: [
      {
        tenant_id: entry.tenantId,
        workspace_id: entry.workspaceId,
        app_id: entry.appId,
      },
    ],
    results,
    summary: {
      requested_query_keys: requestedQueryKeys,
      synced_count: syncedCount,
      skipped_count: skippedCount,
      failed_count: failedCount,
      dry_run: dryRun,
      native_enabled: nativeEnabled,
    },
    safety: DUNE_BUSINESS_SAFETY,
  };
}

export function snapshotsStatus(snapshots: NativeDuneBusinessSnapshot[]): "completed" | "missing" | "partial" {
  if (!snapshots.length) {
    return "missing";
  }

  return snapshots.length === Object.keys(DUNE_BUSINESS_QUERY_REGISTRY).length && snapshots.every((snapshot) => snapshot.status === "connected") ? "completed" : "partial";
}
