import "server-only";

import { createHash } from "crypto";

import {
  getProductLensGa4Catalog,
  LENS_GA4_AD_HOC_ALLOWED_DIMENSIONS,
  LENS_GA4_AD_HOC_ALLOWED_METRICS,
  ProductLensGa4ValidationError,
  productLensGa4ErrorCode,
  resolveProductLensGa4QueryRange,
  runProductLensGa4AdHocQuery,
  type ProductLensGa4CatalogItem,
  type ProductLensGa4QueryOrderBy,
  type ProductLensGa4QueryRangeKey,
} from "@/lib/cmo/lens-ga4-catalog";
import { LensGa4DataError } from "@/lib/cmo/lens-ga4-data";
import { getLensGoogleAccessToken, LensGoogleAccessTokenError } from "@/lib/cmo/lens-google-oauth";
import {
  getWorkspaceGa4MetricSourceMapping,
  type WorkspaceGa4MetricSourceMapping,
} from "@/lib/cmo/workspace-metric-sources";
import {
  requireWorkspaceRegistryEntry,
  workspaceRegistry,
  type WorkspaceRegistryEntry,
} from "@/lib/cmo/workspace-registry";

export type ProductLensDeepSyncMode = "refresh_if_missing" | "refresh_all" | "dryRun";
export type ProductLensDeepSyncTrigger = "daily" | "manual" | string;
export type ProductLensDeepSyncStatus = "completed" | "partial" | "failed";
export type ProductLensDeepSyncWorkspaceStatus = "synced" | "partial" | "failed" | "skipped";
export type ProductLensDeepSyncPackStatus = "synced" | "failed" | "skipped" | "empty";
export type ProductLensDeepSyncRangeKey = Extract<ProductLensGa4QueryRangeKey, "yesterday" | "this_week" | "last_7_days" | "last_30_days">;

export type ProductLensGa4ReportPackKey =
  | "core_summary"
  | "acquisition_channel"
  | "source_medium"
  | "campaign"
  | "top_events"
  | "top_pages_screens"
  | "geo_country"
  | "device_category"
  | "platform"
  | "key_events";

interface ProductLensGa4Safety {
  no_tokens_returned: true;
  raw_ga4_response_included: false;
  vault_write_performed: false;
  gbrain_used: false;
  hermes_called: false;
}

interface DeepSyncPackDefinition {
  packKey: ProductLensGa4ReportPackKey;
  dimensions: string[];
  metrics: string[];
  orderBy?: ProductLensGa4QueryOrderBy[];
  limit: number;
  fallbackDimensions?: string[][];
  optional?: boolean;
}

interface WorkspaceMetricReportPackRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  source_type: "ga4";
  source_id: "ga4_native";
  provider: string;
  property_id: string;
  property_display_name: string | null;
  pack_key: ProductLensGa4ReportPackKey;
  range_key: ProductLensDeepSyncRangeKey;
  date_start: string;
  date_end: string;
  timezone: string | null;
  query_hash: string | null;
  query_result_id: string | null;
  metrics_json: unknown;
  dimensions_json: unknown;
  rows_json: unknown;
  totals_json: unknown;
  row_count: number | null;
  payload_json: unknown;
  quality_json: unknown;
  generated_at: string | null;
}

interface GoogleAnalyticsErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

interface GoogleRunReportResponse {
  dimensionHeaders?: Array<{ name?: string }>;
  metricHeaders?: Array<{ name?: string; type?: string }>;
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
  totals?: Array<{
    metricValues?: Array<{ value?: string }>;
  }>;
}

export interface ProductLensDeepSyncPackResult {
  status: ProductLensDeepSyncPackStatus;
  pack_id?: string;
  query_result_id?: string;
  row_count: number;
  date_start: string;
  date_end: string;
  warnings: string[];
  error?: string;
  reason?: string;
  would_sync?: boolean;
}

export interface ProductLensDeepSyncWorkspaceResult {
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  source_type: "ga4";
  source_id: "ga4_native";
  status: ProductLensDeepSyncWorkspaceStatus;
  ranges: Partial<Record<ProductLensDeepSyncRangeKey, {
    status: ProductLensDeepSyncWorkspaceStatus;
    packs: Partial<Record<ProductLensGa4ReportPackKey, ProductLensDeepSyncPackResult>>;
  }>>;
  errors: string[];
}

export interface ProductLensDeepSyncResult {
  schema_version: "product.lens_deep_sync_result.v1";
  trigger: ProductLensDeepSyncTrigger;
  mode: ProductLensDeepSyncMode;
  status: ProductLensDeepSyncStatus;
  started_at: string;
  completed_at: string;
  range_keys: ProductLensDeepSyncRangeKey[];
  pack_keys: ProductLensGa4ReportPackKey[];
  workspaces: ProductLensDeepSyncWorkspaceResult[];
  summary: {
    workspace_count: number;
    range_count: number;
    pack_count: number;
    synced_count: number;
    failed_count: number;
    skipped_count: number;
  };
  safety: ProductLensGa4Safety;
}

export interface ProductLensGa4ReportPacksResponse {
  schema_version: "product.lens_ga4_report_packs.v1";
  status: "completed" | "missing" | "partial";
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  range_key: ProductLensDeepSyncRangeKey;
  packs: Array<{
    pack_key: ProductLensGa4ReportPackKey;
    date_start: string;
    date_end: string;
    timezone: string;
    rows: Array<Record<string, string | number | null>>;
    row_count: number;
    quality: Record<string, unknown>;
    generated_at: string | null;
  }>;
  safety: ProductLensGa4Safety;
}

export const LENS_GA4_DAILY_DEEP_SYNC_DEFAULT_RANGE_KEYS: ProductLensDeepSyncRangeKey[] = [
  "yesterday",
  "this_week",
  "last_7_days",
  "last_30_days",
];

export const LENS_GA4_DAILY_DEEP_SYNC_DEFAULT_PACK_KEYS: ProductLensGa4ReportPackKey[] = [
  "core_summary",
  "acquisition_channel",
  "source_medium",
  "campaign",
  "top_events",
  "top_pages_screens",
  "geo_country",
  "device_category",
  "platform",
];

export const LENS_GA4_DEEP_SYNC_PACK_DEFINITIONS: DeepSyncPackDefinition[] = [
  {
    packKey: "core_summary",
    dimensions: [],
    metrics: ["activeUsers", "newUsers", "sessions", "eventCount", "engagementRate", "screenPageViews", "userEngagementDuration"],
    limit: 1,
  },
  {
    packKey: "acquisition_channel",
    dimensions: ["sessionDefaultChannelGroup"],
    metrics: ["newUsers", "sessions", "activeUsers", "engagementRate"],
    orderBy: [{ type: "metric", name: "newUsers", desc: true }],
    limit: 25,
  },
  {
    packKey: "source_medium",
    dimensions: ["sessionSourceMedium"],
    metrics: ["newUsers", "sessions", "activeUsers", "engagementRate"],
    orderBy: [{ type: "metric", name: "newUsers", desc: true }],
    limit: 50,
  },
  {
    packKey: "campaign",
    dimensions: ["sessionCampaignName"],
    metrics: ["newUsers", "sessions", "activeUsers", "engagementRate"],
    orderBy: [{ type: "metric", name: "newUsers", desc: true }],
    limit: 50,
  },
  {
    packKey: "top_events",
    dimensions: ["eventName"],
    metrics: ["eventCount", "activeUsers"],
    orderBy: [{ type: "metric", name: "eventCount", desc: true }],
    limit: 50,
  },
  {
    packKey: "top_pages_screens",
    dimensions: ["unifiedPagePathScreen"],
    fallbackDimensions: [["pagePath"]],
    metrics: ["screenPageViews", "activeUsers", "sessions"],
    orderBy: [{ type: "metric", name: "screenPageViews", desc: true }],
    limit: 50,
  },
  {
    packKey: "geo_country",
    dimensions: ["country"],
    metrics: ["activeUsers", "newUsers", "sessions", "engagementRate"],
    orderBy: [{ type: "metric", name: "activeUsers", desc: true }],
    limit: 50,
  },
  {
    packKey: "device_category",
    dimensions: ["deviceCategory"],
    metrics: ["activeUsers", "sessions", "engagementRate"],
    orderBy: [{ type: "metric", name: "activeUsers", desc: true }],
    limit: 20,
  },
  {
    packKey: "platform",
    dimensions: ["platform"],
    metrics: ["activeUsers", "sessions", "engagementRate"],
    orderBy: [{ type: "metric", name: "activeUsers", desc: true }],
    limit: 20,
  },
  {
    packKey: "key_events",
    dimensions: ["eventName"],
    metrics: ["keyEvents", "activeUsers"],
    orderBy: [{ type: "metric", name: "keyEvents", desc: true }],
    limit: 50,
    optional: true,
  },
];

const allowedMetricSet = new Set<string>(LENS_GA4_AD_HOC_ALLOWED_METRICS);
const allowedDimensionSet = new Set<string>(LENS_GA4_AD_HOC_ALLOWED_DIMENSIONS);

function safety(): ProductLensGa4Safety {
  return {
    no_tokens_returned: true,
    raw_ga4_response_included: false,
    vault_write_performed: false,
    gbrain_used: false,
    hermes_called: false,
  };
}

async function getSupabaseClient() {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");

  return createSupabaseAdminClient();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

function queryRows(value: unknown): Array<Record<string, string | number | null>> {
  return Array.isArray(value)
    ? value.filter(isRecord).map((row) => {
        const output: Record<string, string | number | null> = {};

        for (const [key, item] of Object.entries(row)) {
          if (typeof item === "string" || typeof item === "number" || item === null) {
            output[key] = item;
          }
        }

        return output;
      })
    : [];
}

function safeRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const output = { ...value };

  delete output.access_token;
  delete output.accessToken;
  delete output.refresh_token;
  delete output.refreshToken;
  delete output.encrypted_refresh_token;
  delete output.encryptedRefreshToken;
  delete output.id_token;
  delete output.idToken;
  delete output.raw_ga4_response;
  delete output.rawGa4Response;
  delete output.raw_google_response;
  delete output.rawGoogleResponse;

  return output;
}

function safeJsonArray(value: unknown[]): unknown[] {
  return value.map((item) => isRecord(item) ? safeRecord(item) : item);
}

function isDeepSyncRangeKey(value: string): value is ProductLensDeepSyncRangeKey {
  return value === "yesterday" || value === "this_week" || value === "last_7_days" || value === "last_30_days";
}

export function normalizeProductLensDeepSyncRangeKeys(value: unknown): ProductLensDeepSyncRangeKey[] {
  const requested = Array.isArray(value) ? value : [];
  const rangeKeys = requested
    .filter((item): item is ProductLensDeepSyncRangeKey => typeof item === "string" && isDeepSyncRangeKey(item));

  return Array.from(new Set(rangeKeys.length ? rangeKeys : LENS_GA4_DAILY_DEEP_SYNC_DEFAULT_RANGE_KEYS));
}

function isReportPackKey(value: string): value is ProductLensGa4ReportPackKey {
  return LENS_GA4_DEEP_SYNC_PACK_DEFINITIONS.some((definition) => definition.packKey === value);
}

export function normalizeProductLensDeepSyncPackKeys(value: unknown): ProductLensGa4ReportPackKey[] {
  const requested = Array.isArray(value) ? value : [];
  const packKeys = requested
    .filter((item): item is ProductLensGa4ReportPackKey => typeof item === "string" && isReportPackKey(item));

  return Array.from(new Set(packKeys.length ? packKeys : LENS_GA4_DAILY_DEEP_SYNC_DEFAULT_PACK_KEYS));
}

export function normalizeProductLensDeepSyncMode(body: Record<string, unknown>): ProductLensDeepSyncMode {
  if (body.dryRun === true) {
    return "dryRun";
  }

  const value = typeof body.mode === "string" ? body.mode.trim() : "";

  if (value === "refresh_all" || value === "dryRun") {
    return value;
  }

  return "refresh_if_missing";
}

function requestedEntries(appIds: string[] | undefined): WorkspaceRegistryEntry[] {
  if (!appIds?.length) {
    return workspaceRegistry;
  }

  const entries = new Map<string, WorkspaceRegistryEntry>();

  for (const appId of appIds) {
    const entry = requireWorkspaceRegistryEntry(appId);
    entries.set(entry.appId, entry);
  }

  return [...entries.values()];
}

function mappingReady(mapping: WorkspaceGa4MetricSourceMapping | null): mapping is WorkspaceGa4MetricSourceMapping {
  return Boolean(
    mapping?.enabled
    && mapping.oauthAccountId
    && mapping.propertyId
    && mapping.verificationStatus === "verified",
  );
}

function ineligibleMappingReason(mapping: WorkspaceGa4MetricSourceMapping | null): string {
  if (!mapping?.enabled || !mapping?.propertyId || !mapping?.oauthAccountId) {
    return "missing_ga4_source_mapping";
  }

  if (mapping.verificationStatus !== "verified") {
    return "ga4_source_not_verified";
  }

  return "ga4_source_not_ready";
}

function errorCode(error: unknown): string {
  if (error instanceof ProductLensGa4ValidationError) {
    return error.code;
  }

  if (error instanceof LensGoogleAccessTokenError) {
    return error.code;
  }

  if (error instanceof LensGa4DataError) {
    return error.code || error.message;
  }

  return productLensGa4ErrorCode(error);
}

function catalogSet(items: ProductLensGa4CatalogItem[]): Set<string> {
  return new Set(items.map((item) => item.api_name));
}

function definitionForKey(packKey: ProductLensGa4ReportPackKey): DeepSyncPackDefinition {
  const definition = LENS_GA4_DEEP_SYNC_PACK_DEFINITIONS.find((item) => item.packKey === packKey);

  if (!definition) {
    throw new Error(`Unknown GA4 report pack: ${packKey}`);
  }

  return definition;
}

function resolveAvailableDefinition(input: {
  definition: DeepSyncPackDefinition;
  availableMetrics: Set<string>;
  availableDimensions: Set<string>;
}): { definition: DeepSyncPackDefinition; warnings: string[] } | null {
  const metricMissing = input.definition.metrics.filter((metric) => !allowedMetricSet.has(metric) || !input.availableMetrics.has(metric));

  if (metricMissing.length > 0) {
    return input.definition.optional
      ? null
      : {
          definition: input.definition,
          warnings: metricMissing.map((metric) => `metric_unavailable:${metric}`),
        };
  }

  const dimensionSets = [input.definition.dimensions, ...(input.definition.fallbackDimensions ?? [])];
  const selectedDimensions = dimensionSets.find((dimensions) =>
    dimensions.every((dimension) => allowedDimensionSet.has(dimension) && input.availableDimensions.has(dimension)),
  );

  if (!selectedDimensions) {
    return null;
  }

  const warnings = selectedDimensions === input.definition.dimensions
    ? []
    : [`fallback_dimensions:${selectedDimensions.join(",")}`];

  return {
    definition: {
      ...input.definition,
      dimensions: selectedDimensions,
      orderBy: input.definition.orderBy?.filter((item) =>
        item.type === "metric"
          ? input.definition.metrics.includes(item.name)
          : selectedDimensions.includes(item.name),
      ),
    },
    warnings,
  };
}

function stableReportPackHash(input: {
  appId: string;
  propertyId: string;
  packKey: ProductLensGa4ReportPackKey;
  range: ReturnType<typeof resolveProductLensGa4QueryRange>;
  metrics: string[];
  dimensions: string[];
  orderBy: ProductLensGa4QueryOrderBy[];
  limit: number;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

async function getExistingReportPack(input: {
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping;
  packKey: ProductLensGa4ReportPackKey;
  range: ReturnType<typeof resolveProductLensGa4QueryRange>;
}): Promise<WorkspaceMetricReportPackRow | null> {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("workspace_metric_report_packs")
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,property_id,property_display_name,pack_key,range_key,date_start,date_end,timezone,query_hash,query_result_id,metrics_json,dimensions_json,rows_json,totals_json,row_count,payload_json,quality_json,generated_at")
    .eq("tenant_id", input.entry.tenantId)
    .eq("workspace_id", input.entry.workspaceId)
    .eq("app_id", input.entry.appId)
    .eq("source_type", "ga4")
    .eq("source_id", "ga4_native")
    .eq("property_id", input.mapping.propertyId)
    .eq("pack_key", input.packKey)
    .eq("range_key", input.range.key)
    .eq("date_start", input.range.date_start)
    .eq("date_end", input.range.date_end)
    .maybeSingle();

  if (error) {
    throw new Error(`Workspace GA4 report pack lookup failed: ${error.message}`);
  }

  return data ? data as WorkspaceMetricReportPackRow : null;
}

function parseMetricValue(value: string | undefined): number | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function dataApiErrorCode(status: number, payload: GoogleAnalyticsErrorPayload): string {
  const text = JSON.stringify(payload).toLowerCase();

  if (status === 401 || status === 403 && text.includes("invalid_grant")) {
    return "source_auth_failed";
  }

  if (status === 403 && (text.includes("service_disabled") || text.includes("has not been used") || text.includes("disabled"))) {
    return "ga4_data_api_unavailable";
  }

  if (status === 429 || status >= 500) {
    return "ga4_data_api_unavailable";
  }

  return "ga4_data_api_failed";
}

function orderByExpression(orderBy: ProductLensGa4QueryOrderBy): Record<string, unknown> {
  return orderBy.type === "dimension"
    ? { dimension: { dimensionName: orderBy.name }, desc: orderBy.desc }
    : { metric: { metricName: orderBy.name }, desc: orderBy.desc };
}

async function runDirectReport(input: {
  accessToken: string;
  propertyId: string;
  range: ReturnType<typeof resolveProductLensGa4QueryRange>;
  metrics: string[];
  dimensions: string[];
  orderBy: ProductLensGa4QueryOrderBy[];
  limit: number;
}): Promise<{
  rows: Array<Record<string, string | number | null>>;
  totals: Record<string, number | null>;
  rowCount: number;
}> {
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(input.propertyId)}:runReport`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      dateRanges: [
        {
          startDate: input.range.date_start,
          endDate: input.range.date_end,
        },
      ],
      metrics: input.metrics.map((name) => ({ name })),
      dimensions: input.dimensions.map((name) => ({ name })),
      orderBys: input.orderBy.map(orderByExpression),
      limit: input.limit,
      keepEmptyRows: false,
      returnPropertyQuota: false,
    }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleRunReportResponse & GoogleAnalyticsErrorPayload;

  if (!response.ok) {
    throw new LensGa4DataError("ga4_data_api_failed", dataApiErrorCode(response.status, payload));
  }

  const dimensionHeaders = payload.dimensionHeaders?.map((header) => header.name ?? "") ?? [];
  const metricHeaders = payload.metricHeaders?.map((header) => header.name ?? "") ?? [];
  const rows = (payload.rows ?? []).map((row) => {
    const output: Record<string, string | number | null> = {};

    dimensionHeaders.forEach((name, index) => {
      if (name) {
        output[name] = row.dimensionValues?.[index]?.value ?? null;
      }
    });

    metricHeaders.forEach((name, index) => {
      if (name) {
        output[name] = parseMetricValue(row.metricValues?.[index]?.value);
      }
    });

    return output;
  });
  const totalValues = payload.totals?.[0]?.metricValues ?? [];
  const totals = Object.fromEntries(metricHeaders.map((name, index) => [name, parseMetricValue(totalValues[index]?.value)]));

  return {
    rows,
    totals,
    rowCount: rows.length,
  };
}

async function upsertReportPack(input: {
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping;
  packKey: ProductLensGa4ReportPackKey;
  range: ReturnType<typeof resolveProductLensGa4QueryRange>;
  metrics: string[];
  dimensions: string[];
  rows: Array<Record<string, string | number | null>>;
  totals: Record<string, number | null>;
  rowCount: number;
  queryHash: string;
  queryResultId?: string;
  warnings: string[];
}): Promise<WorkspaceMetricReportPackRow> {
  const supabase = await getSupabaseClient();
  const generatedAt = new Date().toISOString();
  const row = {
    tenant_id: input.entry.tenantId,
    workspace_id: input.entry.workspaceId,
    app_id: input.entry.appId,
    source_type: "ga4",
    source_id: "ga4_native",
    provider: "google_analytics",
    property_id: input.mapping.propertyId,
    property_display_name: input.mapping.propertyDisplayName ?? null,
    pack_key: input.packKey,
    range_key: input.range.key,
    date_start: input.range.date_start,
    date_end: input.range.date_end,
    timezone: input.range.timezone,
    query_hash: input.queryHash,
    query_result_id: input.queryResultId ?? null,
    metrics_json: safeJsonArray(input.metrics),
    dimensions_json: safeJsonArray(input.dimensions),
    rows_json: safeJsonArray(input.rows),
    totals_json: safeRecord(input.totals),
    row_count: input.rowCount,
    payload_json: safeRecord({
      schema_version: "product.lens_ga4_report_pack_payload.v1",
      pack_key: input.packKey,
      range_key: input.range.key,
    }),
    quality_json: safeRecord({
      confidence: "high",
      warnings: input.warnings,
    }),
    generated_at: generatedAt,
  };
  const { data, error } = await supabase
    .from("workspace_metric_report_packs")
    .upsert(row, {
      onConflict: "tenant_id,workspace_id,app_id,source_type,source_id,property_id,pack_key,range_key,date_start,date_end",
    })
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,property_id,property_display_name,pack_key,range_key,date_start,date_end,timezone,query_hash,query_result_id,metrics_json,dimensions_json,rows_json,totals_json,row_count,payload_json,quality_json,generated_at")
    .single();

  if (error) {
    throw new Error(`Workspace GA4 report pack write failed: ${error.message}`);
  }

  return data as WorkspaceMetricReportPackRow;
}

function packResultFromRow(input: {
  row: WorkspaceMetricReportPackRow;
  status: ProductLensDeepSyncPackStatus;
  warnings?: string[];
  reason?: string;
  wouldSync?: boolean;
}): ProductLensDeepSyncPackResult {
  return {
    status: input.status,
    pack_id: input.row.id,
    query_result_id: input.row.query_result_id ?? undefined,
    row_count: input.row.row_count ?? 0,
    date_start: input.row.date_start,
    date_end: input.row.date_end,
    warnings: input.warnings ?? stringArray(isRecord(input.row.quality_json) ? input.row.quality_json.warnings : undefined),
    reason: input.reason,
    would_sync: input.wouldSync,
  };
}

async function executePack(input: {
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping;
  rangeKey: ProductLensDeepSyncRangeKey;
  definition: DeepSyncPackDefinition;
  warnings: string[];
  mode: ProductLensDeepSyncMode;
}): Promise<ProductLensDeepSyncPackResult> {
  const range = resolveProductLensGa4QueryRange({
    rangeKey: input.rangeKey,
    timezone: input.mapping.timezone,
  });

  if (input.mode === "dryRun") {
    return {
      status: "skipped",
      row_count: 0,
      date_start: range.date_start,
      date_end: range.date_end,
      warnings: input.warnings,
      reason: "dry_run_would_sync",
      would_sync: true,
    };
  }

  const existing = await getExistingReportPack({
    entry: input.entry,
    mapping: input.mapping,
    packKey: input.definition.packKey,
    range,
  });

  if (input.mode === "refresh_if_missing" && existing) {
    return packResultFromRow({
      row: existing,
      status: "skipped",
      warnings: input.warnings,
      reason: "existing_pack",
      wouldSync: false,
    });
  }

  const queryHash = stableReportPackHash({
    appId: input.entry.appId,
    propertyId: input.mapping.propertyId,
    packKey: input.definition.packKey,
    range,
    metrics: input.definition.metrics,
    dimensions: input.definition.dimensions,
    orderBy: input.definition.orderBy ?? [],
    limit: input.definition.limit,
  });
  const queryBody = {
    rangeKey: input.rangeKey,
    metrics: input.definition.metrics,
    dimensions: input.definition.dimensions,
    orderBy: input.definition.orderBy ?? [],
    limit: input.definition.limit,
    cacheTtlMinutes: 1440,
    reason: `Daily GA4 deep sync pack: ${input.definition.packKey}`,
    refresh: input.mode === "refresh_all",
  };
  const query = input.definition.metrics.length <= 5
    ? await runProductLensGa4AdHocQuery({ appId: input.entry.appId, body: queryBody })
    : null;
  const direct = query
    ? null
    : await runDirectReport({
        accessToken: (await getLensGoogleAccessToken({
          oauthAccountId: input.mapping.oauthAccountId!,
          tenantId: input.entry.tenantId,
        })).accessToken,
        propertyId: input.mapping.propertyId,
        range,
        metrics: input.definition.metrics,
        dimensions: input.definition.dimensions,
        orderBy: input.definition.orderBy ?? [],
        limit: input.definition.limit,
      });
  const rows = query?.rows ?? direct?.rows ?? [];
  const totals = query?.totals ?? direct?.totals ?? {};
  const rowCount = query?.row_count ?? direct?.rowCount ?? rows.length;
  const row = await upsertReportPack({
    entry: input.entry,
    mapping: input.mapping,
    packKey: input.definition.packKey,
    range,
    metrics: input.definition.metrics,
    dimensions: input.definition.dimensions,
    rows,
    totals,
    rowCount,
    queryHash,
    queryResultId: query?.source.query_result_id,
    warnings: input.warnings,
  });

  return packResultFromRow({
    row,
    status: rowCount > 0 ? "synced" : "empty",
    warnings: input.warnings,
    wouldSync: true,
  });
}

function rangeStatus(packs: Partial<Record<ProductLensGa4ReportPackKey, ProductLensDeepSyncPackResult>>): ProductLensDeepSyncWorkspaceStatus {
  const values = Object.values(packs);

  if (values.length === 0 || values.every((pack) => pack.status === "skipped")) {
    return "skipped";
  }

  if (values.every((pack) => pack.status === "failed")) {
    return "failed";
  }

  if (values.some((pack) => pack.status === "failed")) {
    return "partial";
  }

  return values.some((pack) => pack.status === "synced" || pack.status === "empty") ? "synced" : "skipped";
}

function workspaceStatus(ranges: ProductLensDeepSyncWorkspaceResult["ranges"]): ProductLensDeepSyncWorkspaceStatus {
  const values = Object.values(ranges);

  if (values.length === 0 || values.every((range) => range.status === "skipped")) {
    return "skipped";
  }

  if (values.every((range) => range.status === "failed")) {
    return "failed";
  }

  if (values.some((range) => range.status === "failed" || range.status === "partial")) {
    return "partial";
  }

  return "synced";
}

function jobStatus(workspaces: ProductLensDeepSyncWorkspaceResult[]): ProductLensDeepSyncStatus {
  if (workspaces.length === 0) {
    return "completed";
  }

  if (workspaces.every((workspace) => workspace.status === "failed")) {
    return "failed";
  }

  if (workspaces.some((workspace) => workspace.status === "failed" || workspace.status === "partial")) {
    return "partial";
  }

  return "completed";
}

async function syncWorkspace(input: {
  entry: WorkspaceRegistryEntry;
  rangeKeys: ProductLensDeepSyncRangeKey[];
  packKeys: ProductLensGa4ReportPackKey[];
  mode: ProductLensDeepSyncMode;
  includeUnmapped: boolean;
}): Promise<ProductLensDeepSyncWorkspaceResult | null> {
  const mapping = await getWorkspaceGa4MetricSourceMapping({
    tenantId: input.entry.tenantId,
    workspaceId: input.entry.workspaceId,
    appId: input.entry.appId,
  });
  const mappingTimezone = mapping?.timezone ?? null;

  if (!mappingReady(mapping)) {
    if (!input.includeUnmapped) {
      return null;
    }

    const reason = ineligibleMappingReason(mapping);

    return {
      tenant_id: input.entry.tenantId,
      workspace_id: input.entry.workspaceId,
      app_id: input.entry.appId,
      source_type: "ga4",
      source_id: "ga4_native",
      status: "skipped",
      ranges: Object.fromEntries(input.rangeKeys.map((rangeKey) => {
        const range = resolveProductLensGa4QueryRange({ rangeKey, timezone: mappingTimezone });

        return [
          rangeKey,
          {
            status: "skipped",
            packs: Object.fromEntries(input.packKeys.map((packKey) => [
              packKey,
              {
                status: "skipped",
                row_count: 0,
                date_start: range.date_start,
                date_end: range.date_end,
                warnings: [],
                reason,
                would_sync: false,
              },
            ])),
          },
        ];
      })) as ProductLensDeepSyncWorkspaceResult["ranges"],
      errors: [],
    };
  }

  const ranges: ProductLensDeepSyncWorkspaceResult["ranges"] = {};
  const errors: string[] = [];
  const catalog = input.mode === "dryRun"
    ? null
    : await getProductLensGa4Catalog({
        appId: input.entry.appId,
        refreshIfMissing: true,
      });
  const availableMetrics = catalog ? catalogSet(catalog.catalog.metrics) : new Set<string>(LENS_GA4_AD_HOC_ALLOWED_METRICS);
  const availableDimensions = catalog ? catalogSet(catalog.catalog.dimensions) : new Set<string>(LENS_GA4_AD_HOC_ALLOWED_DIMENSIONS);

  for (const rangeKey of input.rangeKeys) {
    const packs: Partial<Record<ProductLensGa4ReportPackKey, ProductLensDeepSyncPackResult>> = {};

    for (const packKey of input.packKeys) {
      const range = resolveProductLensGa4QueryRange({ rangeKey, timezone: mapping.timezone });

      try {
        const resolved = resolveAvailableDefinition({
          definition: definitionForKey(packKey),
          availableMetrics,
          availableDimensions,
        });

        if (!resolved) {
          packs[packKey] = {
            status: "skipped",
            row_count: 0,
            date_start: range.date_start,
            date_end: range.date_end,
            warnings: ["pack_fields_unavailable"],
            reason: "pack_fields_unavailable",
            would_sync: false,
          };
          continue;
        }

        packs[packKey] = await executePack({
          entry: input.entry,
          mapping,
          rangeKey,
          definition: resolved.definition,
          warnings: resolved.warnings,
          mode: input.mode,
        });
      } catch (error) {
        const code = errorCode(error);

        packs[packKey] = {
          status: "failed",
          row_count: 0,
          date_start: range.date_start,
          date_end: range.date_end,
          warnings: [],
          error: code,
        };
        errors.push(`${rangeKey}:${packKey}:${code}`);
      }
    }

    ranges[rangeKey] = {
      status: rangeStatus(packs),
      packs,
    };
  }

  return {
    tenant_id: input.entry.tenantId,
    workspace_id: input.entry.workspaceId,
    app_id: input.entry.appId,
    source_type: "ga4",
    source_id: "ga4_native",
    status: workspaceStatus(ranges),
    ranges,
    errors,
  };
}

async function recordDeepSyncRun(result: ProductLensDeepSyncResult): Promise<void> {
  try {
    const supabase = await getSupabaseClient();
    const rows = result.workspaces.map((workspace) => ({
      tenant_id: workspace.tenant_id,
      workspace_id: workspace.workspace_id,
      app_id: workspace.app_id,
      source_type: workspace.source_type,
      source_id: workspace.source_id,
      trigger: result.trigger === "daily" ? "daily_deep_sync" : result.trigger,
      mode: result.mode,
      range_keys: result.range_keys,
      status: workspace.status,
      started_at: result.started_at,
      completed_at: result.completed_at,
      summary_json: result.summary,
      errors_json: workspace.errors,
    }));

    if (rows.length > 0) {
      await supabase.from("workspace_metric_sync_runs").insert(rows);
    }
  } catch {
    // Sync run logging is optional and must not block the deep sync job.
  }
}

export async function runProductLensDailyDeepSync(input: {
  appIds?: string[];
  rangeKeys?: ProductLensDeepSyncRangeKey[];
  packKeys?: ProductLensGa4ReportPackKey[];
  mode: ProductLensDeepSyncMode;
  trigger: ProductLensDeepSyncTrigger;
  recordRun?: boolean;
}): Promise<ProductLensDeepSyncResult> {
  const startedAt = new Date().toISOString();
  const rangeKeys = input.rangeKeys?.length ? input.rangeKeys : LENS_GA4_DAILY_DEEP_SYNC_DEFAULT_RANGE_KEYS;
  const packKeys = input.packKeys?.length ? input.packKeys : LENS_GA4_DAILY_DEEP_SYNC_DEFAULT_PACK_KEYS;
  const entries = requestedEntries(input.appIds);
  const includeUnmapped = Boolean(input.appIds?.length);
  const workspaces: ProductLensDeepSyncWorkspaceResult[] = [];

  for (const entry of entries) {
    try {
      const workspace = await syncWorkspace({
        entry,
        rangeKeys,
        packKeys,
        mode: input.mode,
        includeUnmapped,
      });

      if (workspace) {
        workspaces.push(workspace);
      }
    } catch (error) {
      workspaces.push({
        tenant_id: entry.tenantId,
        workspace_id: entry.workspaceId,
        app_id: entry.appId,
        source_type: "ga4",
        source_id: "ga4_native",
        status: "failed",
        ranges: {},
        errors: [errorCode(error)],
      });
    }
  }

  const packs = workspaces.flatMap((workspace) =>
    Object.values(workspace.ranges).flatMap((range) => Object.values(range.packs)),
  );
  const result: ProductLensDeepSyncResult = {
    schema_version: "product.lens_deep_sync_result.v1",
    trigger: input.trigger,
    mode: input.mode,
    status: jobStatus(workspaces),
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    range_keys: rangeKeys,
    pack_keys: packKeys,
    workspaces,
    summary: {
      workspace_count: workspaces.length,
      range_count: rangeKeys.length,
      pack_count: packKeys.length,
      synced_count: packs.filter((pack) => pack.status === "synced" || pack.status === "empty").length,
      failed_count: packs.filter((pack) => pack.status === "failed").length,
      skipped_count: packs.filter((pack) => pack.status === "skipped").length,
    },
    safety: safety(),
  };

  if (input.recordRun !== false) {
    await recordDeepSyncRun(result);
  }

  return result;
}

export async function getProductLensGa4ReportPacks(input: {
  appId: string;
  rangeKey: ProductLensDeepSyncRangeKey;
  packKeys?: ProductLensGa4ReportPackKey[];
  latest?: boolean;
}): Promise<ProductLensGa4ReportPacksResponse> {
  const entry = requireWorkspaceRegistryEntry(input.appId);
  const mapping = await getWorkspaceGa4MetricSourceMapping({
    tenantId: entry.tenantId,
    workspaceId: entry.workspaceId,
    appId: entry.appId,
  });
  const packKeys = input.packKeys?.length ? input.packKeys : LENS_GA4_DAILY_DEEP_SYNC_DEFAULT_PACK_KEYS;

  if (!mappingReady(mapping)) {
    return {
      schema_version: "product.lens_ga4_report_packs.v1",
      status: "missing",
      tenant_id: entry.tenantId,
      workspace_id: entry.workspaceId,
      app_id: entry.appId,
      range_key: input.rangeKey,
      packs: [],
      safety: safety(),
    };
  }

  const supabase = await getSupabaseClient();
  let query = supabase
    .from("workspace_metric_report_packs")
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,property_id,property_display_name,pack_key,range_key,date_start,date_end,timezone,query_hash,query_result_id,metrics_json,dimensions_json,rows_json,totals_json,row_count,payload_json,quality_json,generated_at")
    .eq("tenant_id", entry.tenantId)
    .eq("workspace_id", entry.workspaceId)
    .eq("app_id", entry.appId)
    .eq("source_type", "ga4")
    .eq("source_id", "ga4_native")
    .eq("property_id", mapping.propertyId)
    .eq("range_key", input.rangeKey)
    .in("pack_key", packKeys)
    .order("generated_at", { ascending: false });

  if (input.latest !== false) {
    query = query.limit(200);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Workspace GA4 report packs lookup failed: ${error.message}`);
  }

  const latestByPack = new Map<ProductLensGa4ReportPackKey, WorkspaceMetricReportPackRow>();

  for (const row of (data ?? []) as WorkspaceMetricReportPackRow[]) {
    if (!latestByPack.has(row.pack_key)) {
      latestByPack.set(row.pack_key, row);
    }
  }

  const rows = packKeys
    .map((packKey) => latestByPack.get(packKey))
    .filter((row): row is WorkspaceMetricReportPackRow => Boolean(row));

  return {
    schema_version: "product.lens_ga4_report_packs.v1",
    status: rows.length === 0 ? "missing" : rows.length === packKeys.length ? "completed" : "partial",
    tenant_id: entry.tenantId,
    workspace_id: entry.workspaceId,
    app_id: entry.appId,
    range_key: input.rangeKey,
    packs: rows.map((row) => ({
      pack_key: row.pack_key,
      date_start: row.date_start,
      date_end: row.date_end,
      timezone: row.timezone ?? "Asia/Saigon",
      rows: queryRows(row.rows_json),
      row_count: row.row_count ?? 0,
      quality: safeRecord(row.quality_json),
      generated_at: row.generated_at,
    })),
    safety: safety(),
  };
}
