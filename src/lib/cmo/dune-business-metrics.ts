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

const DUNE_QUERY_BASE_URL = "https://api.dune.com/api/v1/query";
const DUNE_EXECUTION_BASE_URL = "https://api.dune.com/api/v1/execution";
const DEFAULT_TIMEZONE = process.env.CMO_VAULT_TIME_ZONE ?? "Asia/Saigon";
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
const DEFAULT_RESULT_STALE_AFTER_DAYS = 2;
const DEFAULT_EXECUTION_POLL_INTERVAL_MS = 5_000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;
const TERMINAL_EXECUTION_STATES = new Set([
  "QUERY_STATE_COMPLETED",
  "QUERY_STATE_COMPLETED_PARTIAL",
  "QUERY_STATE_FAILED",
  "QUERY_STATE_CANCELED",
  "QUERY_STATE_EXPIRED",
]);

export type DuneBusinessQueryKey = "wld_aggregator_daily" | "wld_partner_stats_daily";
export type DuneBusinessSyncMode = "refresh_all" | "refresh_if_stale";
export type DuneBusinessResultMode = "latest_result" | "execute_and_poll" | "execute_if_stale";
export type DuneBusinessSnapshotStatus = "connected" | "partial" | "missing" | "stale" | "failed";

export interface DuneBusinessQueryConfig {
  queryKey: DuneBusinessQueryKey;
  metricGroup: Extract<CmoBusinessMetricGroup, "wld_aggregator_daily" | "wld_partner_stats_daily">;
  queryName: string;
  queryId: string;
  limit: number;
  resultMode: DuneBusinessResultMode;
  staleAfterDays: number;
  sourceFields: string[];
  seriesId: string;
  tableId?: string;
}

export interface DuneExecutionSummary {
  executionId?: string;
  state: string;
  costCredits: number | null;
  submittedAt?: string;
  executionStartedAt?: string;
  executionEndedAt?: string;
  expiresAt?: string;
  pollCount: number;
  resultSource: "latest_result" | "execute_and_poll" | "skipped_fresh_latest_result" | "local_snapshot" | "dry_run";
  errorType?: string;
  errorMessage?: string;
}

export const DUNE_BUSINESS_QUERY_REGISTRY: Record<DuneBusinessQueryKey, DuneBusinessQueryConfig> = {
  wld_aggregator_daily: {
    queryKey: "wld_aggregator_daily",
    metricGroup: "wld_aggregator_daily",
    queryName: "holdstation_wld_aggregator_tx",
    queryId: "5057875",
    limit: 1000,
    resultMode: "execute_if_stale",
    staleAfterDays: DEFAULT_RESULT_STALE_AFTER_DAYS,
    sourceFields: ["evt_block_date", "count_tx", "cumulative_tx_count", "daily_volume", "cumulative_volume", "fee_amount"],
    seriesId: "wld_aggregator_daily_series",
  },
  wld_partner_stats_daily: {
    queryKey: "wld_partner_stats_daily",
    metricGroup: "wld_partner_stats_daily",
    queryName: "Partner Stats on WLD",
    queryId: "5454333",
    limit: 3000,
    resultMode: "latest_result",
    staleAfterDays: DEFAULT_RESULT_STALE_AFTER_DAYS,
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
    resultMode?: DuneBusinessResultMode;
    latestResultMaxDate?: string | null;
    latestResultWasStale?: boolean;
    execution?: DuneExecutionSummary | null;
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
  created_at?: string | null;
  updated_at?: string | null;
}

interface DuneBusinessSyncResultItem {
  queryKey: DuneBusinessQueryKey;
  metricGroup: DuneBusinessQueryConfig["metricGroup"];
  queryId: string;
  queryName: string;
  resultMode: DuneBusinessResultMode;
  status: "synced" | "skipped" | "dry_run" | "failed";
  dateStart: string | null;
  dateEnd: string | null;
  metricCount: number;
  seriesRowCount: number;
  tableRowCount: number;
  executionState: string | null;
  executionCostCredits: number | null;
  resultSource?: DuneExecutionSummary["resultSource"];
  errorCode?: string;
  errorMessage?: string;
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

function safeErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  return value.replace(/\s+/g, " ").trim().slice(0, 240);
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

function maxDateForQueryRows(queryKey: DuneBusinessQueryKey, rows: Record<string, unknown>[]): string | null {
  const normalized = queryKey === "wld_aggregator_daily" ? normalizeAggregatorRows(rows) : normalizePartnerRows(rows);

  return rangeForRows(normalized).dateEnd;
}

function isResultDateStale(dateEnd: string | null, staleAfterDays: number, now = Date.now()): boolean {
  if (!dateEnd) {
    return true;
  }

  const parsed = Date.parse(`${dateEnd}T00:00:00.000Z`);

  return !Number.isFinite(parsed) || now - parsed > staleAfterDays * 24 * 60 * 60 * 1000;
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

interface DuneBusinessTransformMetadata {
  resultMode?: DuneBusinessResultMode;
  latestResultMaxDate?: string | null;
  latestResultWasStale?: boolean;
  execution?: DuneExecutionSummary | null;
}

function buildAggregatorSnapshot(entry: WorkspaceRegistryEntry, config: DuneBusinessQueryConfig, rows: Record<string, unknown>[], syncedAt: string, metadata: DuneBusinessTransformMetadata = {}): NativeDuneBusinessSnapshot {
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
    ...metadata,
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

function buildPartnerSnapshot(entry: WorkspaceRegistryEntry, config: DuneBusinessQueryConfig, rows: Record<string, unknown>[], syncedAt: string, metadata: DuneBusinessTransformMetadata = {}): NativeDuneBusinessSnapshot {
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
    ...metadata,
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
  resultMode?: DuneBusinessResultMode;
  latestResultMaxDate?: string | null;
  latestResultWasStale?: boolean;
  execution?: DuneExecutionSummary | null;
}): NativeDuneBusinessSnapshot {
  const resultMode = input.resultMode ?? input.config.resultMode;

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
      resultMode,
      latestResultMaxDate: input.latestResultMaxDate ?? input.range.dateEnd,
      latestResultWasStale: input.latestResultWasStale,
      execution: input.execution ?? null,
    },
    provenance: {
      sourceWorkflow: "product_native_dune_connector",
      queryKey: input.config.queryKey,
      queryId: input.config.queryId,
      queryName: input.config.queryName,
      resultMode,
      latestResultMaxDate: input.latestResultMaxDate ?? input.range.dateEnd,
      latestResultWasStale: input.latestResultWasStale,
      executionId: input.execution?.executionId,
      executionState: input.execution?.state,
      executionCostCredits: input.execution?.costCredits ?? null,
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

export function configuredDuneBusinessResultMode(input: unknown, fallback: DuneBusinessResultMode): DuneBusinessResultMode {
  return input === "latest_result" || input === "execute_and_poll" || input === "execute_if_stale" ? input : fallback;
}

function duneApiHeaders(apiKey: string, json = false): HeadersInit {
  return {
    "x-dune-api-key": apiKey,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

async function duneJsonRequest(url: string, init: RequestInit, errorCode: string): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`${errorCode}_${response.status}`);
  }

  return response.json() as Promise<unknown>;
}

async function fetchLatestDuneRows(config: DuneBusinessQueryConfig): Promise<Record<string, unknown>[]> {
  const apiKey = getCmoDuneApiKey();

  if (!apiKey) {
    throw new Error("dune_api_key_not_configured");
  }

  const url = `${DUNE_QUERY_BASE_URL}/${encodeURIComponent(config.queryId)}/results?limit=${config.limit}`;
  const payload = await duneJsonRequest(url, { headers: duneApiHeaders(apiKey) }, "dune_latest_results_request_failed");

  return asRows(payload);
}

function executionIdFromPayload(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  return stringValue(payload.execution_id);
}

function executionSummaryFromPayload(payload: unknown, resultSource: DuneExecutionSummary["resultSource"], pollCount: number): DuneExecutionSummary {
  const record = isRecord(payload) ? payload : {};
  const error = isRecord(record.error) ? record.error : {};

  return {
    executionId: stringValue(record.execution_id) || undefined,
    state: stringValue(record.state) || "QUERY_STATE_UNKNOWN",
    costCredits: numberValue(record.execution_cost_credits),
    submittedAt: stringValue(record.submitted_at) || undefined,
    executionStartedAt: stringValue(record.execution_started_at) || undefined,
    executionEndedAt: stringValue(record.execution_ended_at) || undefined,
    expiresAt: stringValue(record.expires_at) || undefined,
    pollCount,
    resultSource,
    errorType: stringValue(error.type) || undefined,
    errorMessage: safeErrorMessage(error.message),
  };
}

class DuneExecutionError extends Error {
  code: string;
  execution: DuneExecutionSummary;

  constructor(code: string, execution: DuneExecutionSummary) {
    super(code);
    this.name = "DuneExecutionError";
    this.code = code;
    this.execution = execution;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeDuneQuery(config: DuneBusinessQueryConfig): Promise<DuneExecutionSummary> {
  const apiKey = getCmoDuneApiKey();

  if (!apiKey) {
    throw new Error("dune_api_key_not_configured");
  }

  const url = `${DUNE_QUERY_BASE_URL}/${encodeURIComponent(config.queryId)}/execute`;
  const payload = await duneJsonRequest(url, {
    method: "POST",
    headers: duneApiHeaders(apiKey, true),
    body: JSON.stringify({}),
  }, "dune_execute_request_failed");
  const executionId = executionIdFromPayload(payload);

  if (!executionId) {
    throw new Error("dune_execute_missing_execution_id");
  }

  return {
    ...executionSummaryFromPayload(payload, "execute_and_poll", 0),
    executionId,
  };
}

async function fetchDuneExecutionStatus(executionId: string, pollCount: number): Promise<DuneExecutionSummary> {
  const apiKey = getCmoDuneApiKey();

  if (!apiKey) {
    throw new Error("dune_api_key_not_configured");
  }

  const url = `${DUNE_EXECUTION_BASE_URL}/${encodeURIComponent(executionId)}/status`;
  const payload = await duneJsonRequest(url, { headers: duneApiHeaders(apiKey) }, "dune_execution_status_request_failed");

  return executionSummaryFromPayload(payload, "execute_and_poll", pollCount);
}

async function fetchDuneExecutionRows(config: DuneBusinessQueryConfig, executionId: string): Promise<Record<string, unknown>[]> {
  const apiKey = getCmoDuneApiKey();

  if (!apiKey) {
    throw new Error("dune_api_key_not_configured");
  }

  const url = `${DUNE_EXECUTION_BASE_URL}/${encodeURIComponent(executionId)}/results?limit=${config.limit}`;
  const payload = await duneJsonRequest(url, { headers: duneApiHeaders(apiKey) }, "dune_execution_results_request_failed");

  return asRows(payload);
}

async function executeAndPollDuneRows(config: DuneBusinessQueryConfig, options: { timeoutMs?: number; pollIntervalMs?: number } = {}): Promise<{ rows: Record<string, unknown>[]; execution: DuneExecutionSummary }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_EXECUTION_POLL_INTERVAL_MS;
  const startedAt = Date.now();
  let execution = await executeDuneQuery(config);
  let pollCount = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    if (execution.executionId && TERMINAL_EXECUTION_STATES.has(execution.state)) {
      if (execution.state === "QUERY_STATE_COMPLETED") {
        const rows = await fetchDuneExecutionRows(config, execution.executionId);

        return { rows, execution };
      }

      throw new DuneExecutionError(`dune_execution_${execution.state.toLowerCase()}`, execution);
    }

    await sleep(pollIntervalMs);
    pollCount += 1;

    if (!execution.executionId) {
      throw new Error("dune_execution_missing_execution_id");
    }

    execution = await fetchDuneExecutionStatus(execution.executionId, pollCount);
  }

  throw new DuneExecutionError("dune_execution_poll_timeout", {
    ...execution,
    state: execution.state || "QUERY_STATE_TIMEOUT",
    pollCount,
  });
}

async function fetchDuneRowsForResultMode(queryKey: DuneBusinessQueryKey, config: DuneBusinessQueryConfig, resultMode: DuneBusinessResultMode): Promise<{
  rows: Record<string, unknown>[];
  resultMode: DuneBusinessResultMode;
  latestResultMaxDate: string | null;
  latestResultWasStale?: boolean;
  execution: DuneExecutionSummary;
}> {
  if (resultMode === "latest_result") {
    const rows = await fetchLatestDuneRows(config);
    const latestResultMaxDate = maxDateForQueryRows(queryKey, rows);

    return {
      rows,
      resultMode,
      latestResultMaxDate,
      latestResultWasStale: false,
      execution: {
        state: "LATEST_RESULT",
        costCredits: null,
        pollCount: 0,
        resultSource: "latest_result",
      },
    };
  }

  if (resultMode === "execute_and_poll") {
    const { rows, execution } = await executeAndPollDuneRows(config);

    return {
      rows,
      resultMode,
      latestResultMaxDate: maxDateForQueryRows(queryKey, rows),
      latestResultWasStale: true,
      execution,
    };
  }

  const latestRows = await fetchLatestDuneRows(config);
  const latestResultMaxDate = maxDateForQueryRows(queryKey, latestRows);
  const latestResultWasStale = isResultDateStale(latestResultMaxDate, config.staleAfterDays);

  if (!latestResultWasStale) {
    return {
      rows: latestRows,
      resultMode,
      latestResultMaxDate,
      latestResultWasStale,
      execution: {
        state: "SKIPPED_FRESH_LATEST_RESULT",
        costCredits: null,
        pollCount: 0,
        resultSource: "skipped_fresh_latest_result",
      },
    };
  }

  const { rows, execution } = await executeAndPollDuneRows(config);

  return {
    rows,
    resultMode,
    latestResultMaxDate,
    latestResultWasStale,
    execution,
  };
}

export function transformDuneBusinessRows(entry: WorkspaceRegistryEntry, queryKey: DuneBusinessQueryKey, rows: Record<string, unknown>[], syncedAt = new Date().toISOString(), metadata: DuneBusinessTransformMetadata = {}): NativeDuneBusinessSnapshot {
  const config = DUNE_BUSINESS_QUERY_REGISTRY[queryKey];

  if (queryKey === "wld_aggregator_daily") {
    return buildAggregatorSnapshot(entry, config, rows, syncedAt, metadata);
  }

  return buildPartnerSnapshot(entry, config, rows, syncedAt, metadata);
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
  const syncedAt = row.synced_at ?? row.updated_at ?? row.created_at ?? null;

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
      resultMode: configuredDuneBusinessResultMode(diagnostics.resultMode, config.resultMode),
      latestResultMaxDate: typeof diagnostics.latestResultMaxDate === "string" ? diagnostics.latestResultMaxDate : null,
      latestResultWasStale: typeof diagnostics.latestResultWasStale === "boolean" ? diagnostics.latestResultWasStale : undefined,
      execution: isRecord(diagnostics.execution) ? {
        executionId: stringValue(diagnostics.execution.executionId) || undefined,
        state: stringValue(diagnostics.execution.state) || "QUERY_STATE_UNKNOWN",
        costCredits: numberValue(diagnostics.execution.costCredits),
        submittedAt: stringValue(diagnostics.execution.submittedAt) || undefined,
        executionStartedAt: stringValue(diagnostics.execution.executionStartedAt) || undefined,
        executionEndedAt: stringValue(diagnostics.execution.executionEndedAt) || undefined,
        expiresAt: stringValue(diagnostics.execution.expiresAt) || undefined,
        pollCount: numberOrZero(diagnostics.execution.pollCount),
        resultSource: stringValue(diagnostics.execution.resultSource) === "execute_and_poll" ? "execute_and_poll" : stringValue(diagnostics.execution.resultSource) === "skipped_fresh_latest_result" ? "skipped_fresh_latest_result" : stringValue(diagnostics.execution.resultSource) === "local_snapshot" ? "local_snapshot" : stringValue(diagnostics.execution.resultSource) === "dry_run" ? "dry_run" : "latest_result",
        errorType: stringValue(diagnostics.execution.errorType) || undefined,
        errorMessage: safeErrorMessage(diagnostics.execution.errorMessage),
      } : null,
    },
    provenance: isRecord(row.provenance_json) ? row.provenance_json : {},
    syncedAt,
  };
}

export async function upsertNativeDuneBusinessSnapshot(snapshot: NativeDuneBusinessSnapshot): Promise<NativeDuneBusinessSnapshot> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("workspace_business_metric_snapshots")
    .upsert(toRow(snapshot), {
      onConflict: "tenant_id,workspace_id,app_id,source_type,source_id,metric_group",
    })
    .select("tenant_id,workspace_id,app_id,source_type,source_id,provider,metric_domain,metric_group,query_id,query_name,range_preset,date_start,date_end,timezone,status,metrics_json,series_json,tables_json,diagnostics_json,provenance_json,synced_at,created_at,updated_at")
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
    .select("tenant_id,workspace_id,app_id,source_type,source_id,provider,metric_domain,metric_group,query_id,query_name,range_preset,date_start,date_end,timezone,status,metrics_json,series_json,tables_json,diagnostics_json,provenance_json,synced_at,created_at,updated_at")
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

function seriesRowCount(snapshot: NativeDuneBusinessSnapshot): number {
  return snapshot.series.reduce((sum, series) => sum + series.points.length, 0);
}

function tableRowCount(snapshot: NativeDuneBusinessSnapshot): number {
  return snapshot.tables.reduce((sum, table) => sum + table.rows.length, 0);
}

function nativeSnapshotHasDashboardPayload(snapshot: NativeDuneBusinessSnapshot): boolean {
  return snapshot.metrics.some((metric) => metric.status === "connected") || seriesRowCount(snapshot) > 0 || tableRowCount(snapshot) > 0;
}

function executionForSnapshot(snapshot: NativeDuneBusinessSnapshot, fallback: DuneExecutionSummary): DuneExecutionSummary {
  return snapshot.diagnostics.execution ?? fallback;
}

function syncItemFromSnapshot(input: {
  queryKey: DuneBusinessQueryKey;
  config: DuneBusinessQueryConfig;
  resultMode: DuneBusinessResultMode;
  status: DuneBusinessSyncResultItem["status"];
  snapshot: NativeDuneBusinessSnapshot;
  execution?: DuneExecutionSummary;
}): DuneBusinessSyncResultItem {
  const execution = executionForSnapshot(input.snapshot, input.execution ?? {
    state: input.status === "skipped" ? "SKIPPED_PRODUCT_SNAPSHOT_FRESH" : "UNKNOWN",
    costCredits: null,
    pollCount: 0,
    resultSource: input.status === "skipped" ? "local_snapshot" : "latest_result",
  });

  return {
    queryKey: input.queryKey,
    metricGroup: input.config.metricGroup,
    queryId: input.config.queryId,
    queryName: input.config.queryName,
    resultMode: input.resultMode,
    status: input.status,
    dateStart: input.snapshot.dateStart,
    dateEnd: input.snapshot.dateEnd,
    metricCount: input.snapshot.metrics.length,
    seriesRowCount: seriesRowCount(input.snapshot),
    tableRowCount: tableRowCount(input.snapshot),
    executionState: execution.state,
    executionCostCredits: execution.costCredits,
    resultSource: execution.resultSource,
  };
}

function dryRunSyncItem(queryKey: DuneBusinessQueryKey, config: DuneBusinessQueryConfig, resultMode: DuneBusinessResultMode): DuneBusinessSyncResultItem {
  return {
    queryKey,
    metricGroup: config.metricGroup,
    queryId: config.queryId,
    queryName: config.queryName,
    resultMode,
    status: "dry_run",
    dateStart: null,
    dateEnd: null,
    metricCount: 0,
    seriesRowCount: 0,
    tableRowCount: 0,
    executionState: "DRY_RUN",
    executionCostCredits: null,
    resultSource: "dry_run",
  };
}

function failedSyncItem(input: {
  queryKey: DuneBusinessQueryKey;
  config: DuneBusinessQueryConfig;
  resultMode: DuneBusinessResultMode;
  errorCode: string;
  errorMessage?: string;
  execution?: DuneExecutionSummary;
}): DuneBusinessSyncResultItem {
  return {
    queryKey: input.queryKey,
    metricGroup: input.config.metricGroup,
    queryId: input.config.queryId,
    queryName: input.config.queryName,
    resultMode: input.resultMode,
    status: "failed",
    dateStart: null,
    dateEnd: null,
    metricCount: 0,
    seriesRowCount: 0,
    tableRowCount: 0,
    executionState: input.execution?.state ?? null,
    executionCostCredits: input.execution?.costCredits ?? null,
    resultSource: input.execution?.resultSource,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  };
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

    if (!snapshot || snapshot.status === "missing" || snapshot.status === "failed" || !nativeSnapshotHasDashboardPayload(snapshot)) {
      return null;
    }

    return nativeDuneSnapshotToBusinessMetrics(snapshot);
  } catch {
    return null;
  }
}

export async function runNativeDuneBusinessSync(input: {
  appId: string;
  queryKeys?: DuneBusinessQueryKey[];
  mode?: DuneBusinessSyncMode;
  resultMode?: DuneBusinessResultMode;
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
    const resultMode = input.resultMode ?? config.resultMode;

    if (dryRun) {
      results.push(dryRunSyncItem(queryKey, config, resultMode));
      continue;
    }

    if (!nativeEnabled) {
      results.push(failedSyncItem({
        queryKey,
        config,
        resultMode,
        errorCode: "native_dune_disabled",
      }));
      continue;
    }

    try {
      if (input.mode === "refresh_if_stale") {
        const existing = await getNativeDuneBusinessSnapshot(entry.appId, config.metricGroup);

        if (existing && !isStale(existing)) {
          results.push(syncItemFromSnapshot({
            queryKey,
            config,
            resultMode,
            status: "skipped",
            snapshot: existing,
            execution: {
              state: "SKIPPED_PRODUCT_SNAPSHOT_FRESH",
              costCredits: null,
              pollCount: 0,
              resultSource: "local_snapshot",
            },
          }));
          continue;
        }
      }

      const result = await fetchDuneRowsForResultMode(queryKey, config, resultMode);
      const snapshot = transformDuneBusinessRows(entry, queryKey, result.rows, new Date().toISOString(), {
        resultMode: result.resultMode,
        latestResultMaxDate: result.latestResultMaxDate,
        latestResultWasStale: result.latestResultWasStale,
        execution: result.execution,
      });
      const persisted = await upsertNativeDuneBusinessSnapshot(snapshot);

      results.push(syncItemFromSnapshot({
        queryKey,
        config,
        resultMode,
        status: "synced",
        snapshot: persisted,
        execution: result.execution,
      }));
    } catch (error) {
      const executionError = error instanceof DuneExecutionError ? error : null;

      results.push(failedSyncItem({
        queryKey,
        config,
        resultMode,
        errorCode: executionError?.code ?? (error instanceof Error ? error.message.split(":")[0] : "native_dune_sync_failed"),
        errorMessage: executionError?.execution.errorMessage,
        execution: executionError?.execution,
      }));
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
