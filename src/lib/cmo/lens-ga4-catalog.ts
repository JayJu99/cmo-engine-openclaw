import "server-only";

import { createHash } from "crypto";

import { LensGa4DataError } from "@/lib/cmo/lens-ga4-data";
import { getLensGoogleAccessToken, LensGoogleAccessTokenError } from "@/lib/cmo/lens-google-oauth";
import {
  getWorkspaceGa4MetricSourceMapping,
  type WorkspaceGa4MetricSourceMapping,
} from "@/lib/cmo/workspace-metric-sources";
import { requireWorkspaceRegistryEntry, type WorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export type ProductLensGa4CatalogStatus = "synced" | "cached" | "missing" | "failed";
export type ProductLensGa4QueryStatus = "completed" | "cached" | "failed";
export type ProductLensGa4QueryRangeKey =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_7_days"
  | "last_30_days"
  | "this_month"
  | "previous_7_days"
  | "previous_week_same_days";
export type ProductLensGa4QueryOrderByType = "metric" | "dimension";

export interface ProductLensGa4CatalogItem {
  api_name: string;
  ui_name: string;
  description: string;
  type?: string;
  allowed_in_ad_hoc: boolean;
}

export interface ProductLensGa4CatalogResponse {
  schema_version: "product.lens_ga4_catalog.v1";
  status: ProductLensGa4CatalogStatus;
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  source: {
    provider: "ga4";
    source_type: "ga4";
    source_id: "ga4_native";
    property_id?: string;
    property_display_name?: string;
  };
  catalog: {
    metrics: ProductLensGa4CatalogItem[];
    dimensions: ProductLensGa4CatalogItem[];
  };
  synced_at: string | null;
  safety: ProductLensGa4Safety;
}

export interface ProductLensGa4QueryOrderBy {
  type: ProductLensGa4QueryOrderByType;
  name: string;
  desc: boolean;
}

export interface ProductLensGa4QueryFilter {
  type: "dimension";
  name: string;
  value: string;
}

export interface ProductLensGa4QueryRequest {
  rangeKey: ProductLensGa4QueryRangeKey;
  metrics: string[];
  dimensions: string[];
  filters: ProductLensGa4QueryFilter[];
  orderBy: ProductLensGa4QueryOrderBy[];
  limit: number;
  cacheTtlMinutes: number;
  reason?: string;
  refresh: boolean;
}

export interface ProductLensGa4QueryResultResponse {
  schema_version: "product.lens_ga4_query_result.v1";
  status: ProductLensGa4QueryStatus;
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  range: {
    key: ProductLensGa4QueryRangeKey;
    date_start: string;
    date_end: string;
    timezone: string;
  };
  query: {
    metrics: string[];
    dimensions: string[];
    filters: ProductLensGa4QueryFilter[];
    orderBy: ProductLensGa4QueryOrderBy[];
    limit: number;
    reason?: string;
  };
  rows: Array<Record<string, string | number | null>>;
  totals: Record<string, number | null>;
  row_count: number;
  source: {
    provider: "ga4";
    source_type: "ga4";
    source_id: "ga4_native";
    property_id: string;
    property_display_name?: string;
    cache: "hit" | "miss";
    query_result_id?: string;
  };
  quality: {
    confidence: "high" | "medium" | "low";
    warnings: string[];
  };
  safety: ProductLensGa4Safety;
}

interface ProductLensGa4Safety {
  no_tokens_returned: true;
  raw_ga4_response_included: false;
  vault_write_performed: false;
  gbrain_used: false;
  hermes_called: false;
}

interface WorkspaceMetricCatalogRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  source_type: "ga4";
  source_id: "ga4_native";
  provider: string;
  property_id: string;
  property_display_name: string | null;
  dimensions_json: unknown;
  metrics_json: unknown;
  custom_dimensions_json: unknown;
  custom_metrics_json: unknown;
  synced_at: string | null;
}

interface WorkspaceMetricQueryResultRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  source_type: "ga4";
  source_id: "ga4_native";
  provider: string;
  property_id: string;
  query_hash: string;
  range_key: ProductLensGa4QueryRangeKey;
  date_start: string;
  date_end: string;
  timezone: string | null;
  metrics_json: unknown;
  dimensions_json: unknown;
  filters_json: unknown;
  order_bys_json: unknown;
  limit_rows: number | null;
  rows_json: unknown;
  totals_json: unknown;
  row_count: number | null;
  cache_ttl_minutes: number | null;
  expires_at: string | null;
  generated_at: string | null;
  quality_json: unknown;
}

interface GoogleMetadataResponse {
  dimensions?: Array<{
    apiName?: string;
    uiName?: string;
    description?: string;
    customDefinition?: boolean;
    category?: string;
  }>;
  metrics?: Array<{
    apiName?: string;
    uiName?: string;
    description?: string;
    type?: string;
    customDefinition?: boolean;
    category?: string;
  }>;
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

interface GoogleAnalyticsErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export class ProductLensGa4ValidationError extends Error {
  code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "ProductLensGa4ValidationError";
    this.code = code;
  }
}

const DEFAULT_TIMEZONE = "Asia/Saigon";
const CATALOG_STALE_MS = 24 * 60 * 60 * 1000;

export const LENS_GA4_AD_HOC_ALLOWED_METRICS = [
  "activeUsers",
  "newUsers",
  "totalUsers",
  "sessions",
  "engagedSessions",
  "eventCount",
  "engagementRate",
  "averageSessionDuration",
  "userEngagementDuration",
  "screenPageViews",
  "keyEvents",
  "conversions",
  "bounceRate",
] as const;

export const LENS_GA4_AD_HOC_ALLOWED_DIMENSIONS = [
  "date",
  "country",
  "city",
  "deviceCategory",
  "browser",
  "platform",
  "operatingSystem",
  "sessionDefaultChannelGroup",
  "sessionSource",
  "sessionMedium",
  "sessionSourceMedium",
  "sessionCampaignName",
  "eventName",
  "pagePath",
  "pageTitle",
  "unifiedPagePathScreen",
] as const;

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

function catalogItems(value: unknown): ProductLensGa4CatalogItem[] {
  return Array.isArray(value)
    ? value.filter(isRecord).map((item) => ({
        api_name: typeof item.api_name === "string" ? item.api_name : "",
        ui_name: typeof item.ui_name === "string" ? item.ui_name : "",
        description: typeof item.description === "string" ? item.description : "",
        type: typeof item.type === "string" ? item.type : undefined,
        allowed_in_ad_hoc: item.allowed_in_ad_hoc === true,
      })).filter((item) => Boolean(item.api_name))
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

function totalsRecord(value: unknown): Record<string, number | null> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => typeof item === "number" || item === null),
  ) as Record<string, number | null>;
}

function cleanJson(value: Record<string, unknown> | unknown[]): Record<string, unknown> | unknown[] {
  const clone = Array.isArray(value) ? [...value] : { ...value };

  if (!Array.isArray(clone)) {
    delete clone.access_token;
    delete clone.refresh_token;
    delete clone.encrypted_refresh_token;
    delete clone.id_token;
    delete clone.rawGa4Response;
    delete clone.rawGoogleResponse;
  }

  return clone;
}

function normalizeTimezone(value: string | null | undefined): string {
  const timezone = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function timezoneParts(date: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  weekday: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";

  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    weekday: part("weekday"),
  };
}

function dateString(parts: { year: number; month: number; day: number }): string {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));

  return dateString({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
}

function weekdayIndex(weekday: string): number {
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);

  return index >= 0 ? index + 1 : 1;
}

function daysInclusive(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
}

export function resolveProductLensGa4QueryRange(input: {
  rangeKey: ProductLensGa4QueryRangeKey;
  timezone?: string | null;
  now?: Date;
}): ProductLensGa4QueryResultResponse["range"] {
  const timezone = normalizeTimezone(input.timezone);
  const todayParts = timezoneParts(input.now ?? new Date(), timezone);
  const today = dateString(todayParts);
  const weekOffset = weekdayIndex(todayParts.weekday) - 1;
  const thisWeekStart = addDays(today, -weekOffset);

  if (input.rangeKey === "today") {
    return { key: input.rangeKey, date_start: today, date_end: today, timezone };
  }

  if (input.rangeKey === "yesterday") {
    const yesterday = addDays(today, -1);

    return { key: input.rangeKey, date_start: yesterday, date_end: yesterday, timezone };
  }

  if (input.rangeKey === "this_week") {
    return { key: input.rangeKey, date_start: thisWeekStart, date_end: today, timezone };
  }

  if (input.rangeKey === "this_month") {
    return {
      key: input.rangeKey,
      date_start: dateString({ year: todayParts.year, month: todayParts.month, day: 1 }),
      date_end: today,
      timezone,
    };
  }

  if (input.rangeKey === "previous_7_days") {
    return {
      key: input.rangeKey,
      date_start: addDays(today, -13),
      date_end: addDays(today, -7),
      timezone,
    };
  }

  if (input.rangeKey === "previous_week_same_days") {
    return {
      key: input.rangeKey,
      date_start: addDays(thisWeekStart, -7),
      date_end: addDays(today, -7),
      timezone,
    };
  }

  const days = input.rangeKey === "last_30_days" ? 30 : 7;

  return {
    key: input.rangeKey,
    date_start: addDays(today, -(days - 1)),
    date_end: today,
    timezone,
  };
}

function isProductLensGa4QueryRangeKey(value: string): value is ProductLensGa4QueryRangeKey {
  return value === "today"
    || value === "yesterday"
    || value === "this_week"
    || value === "last_7_days"
    || value === "last_30_days"
    || value === "this_month"
    || value === "previous_7_days"
    || value === "previous_week_same_days";
}

function parseMetricValue(value: string | undefined): number | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function metadataErrorCode(status: number, payload: GoogleAnalyticsErrorPayload): string {
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

  return "ga4_metadata_api_failed";
}

async function fetchGa4Metadata(input: {
  accessToken: string;
  propertyId: string;
}): Promise<GoogleMetadataResponse> {
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(input.propertyId)}/metadata`, {
    headers: {
      authorization: `Bearer ${input.accessToken}`,
    },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleMetadataResponse & GoogleAnalyticsErrorPayload;

  if (!response.ok) {
    const code = metadataErrorCode(response.status, payload);
    throw new LensGa4DataError(code === "source_auth_failed" ? "source_auth_failed" : "ga4_data_api_failed", code);
  }

  return payload;
}

function normalizeCatalogItem(input: {
  apiName?: string;
  uiName?: string;
  description?: string;
  type?: string;
  customDefinition?: boolean;
  allowedSet: Set<string>;
}): ProductLensGa4CatalogItem | null {
  const apiName = input.apiName?.trim();

  if (!apiName) {
    return null;
  }

  return {
    api_name: apiName,
    ui_name: input.uiName?.trim() || apiName,
    description: input.description?.trim() || "",
    type: input.type?.trim() || undefined,
    allowed_in_ad_hoc: input.allowedSet.has(apiName),
  };
}

function normalizeMetadata(payload: GoogleMetadataResponse): {
  metrics: ProductLensGa4CatalogItem[];
  dimensions: ProductLensGa4CatalogItem[];
  customMetrics: ProductLensGa4CatalogItem[];
  customDimensions: ProductLensGa4CatalogItem[];
} {
  const metrics = (payload.metrics ?? [])
    .map((item) => normalizeCatalogItem({
      ...item,
      allowedSet: allowedMetricSet,
    }))
    .filter((item): item is ProductLensGa4CatalogItem => Boolean(item));
  const dimensions = (payload.dimensions ?? [])
    .map((item) => normalizeCatalogItem({
      ...item,
      allowedSet: allowedDimensionSet,
    }))
    .filter((item): item is ProductLensGa4CatalogItem => Boolean(item));

  return {
    metrics,
    dimensions,
    customMetrics: metrics.filter((item) => Boolean((payload.metrics ?? []).find((metric) => metric.apiName === item.api_name)?.customDefinition)),
    customDimensions: dimensions.filter((item) => Boolean((payload.dimensions ?? []).find((dimension) => dimension.apiName === item.api_name)?.customDefinition)),
  };
}

function catalogResponse(input: {
  status: ProductLensGa4CatalogStatus;
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping | null;
  row: WorkspaceMetricCatalogRow | null;
}): ProductLensGa4CatalogResponse {
  return {
    schema_version: "product.lens_ga4_catalog.v1",
    status: input.status,
    tenant_id: input.entry.tenantId,
    workspace_id: input.entry.workspaceId,
    app_id: input.entry.appId,
    source: {
      provider: "ga4",
      source_type: "ga4",
      source_id: "ga4_native",
      property_id: input.mapping?.propertyId || input.row?.property_id,
      property_display_name: input.mapping?.propertyDisplayName || input.row?.property_display_name || undefined,
    },
    catalog: {
      metrics: catalogItems(input.row?.metrics_json),
      dimensions: catalogItems(input.row?.dimensions_json),
    },
    synced_at: input.row?.synced_at ?? null,
    safety: safety(),
  };
}

function mappingReady(mapping: WorkspaceGa4MetricSourceMapping | null): mapping is WorkspaceGa4MetricSourceMapping {
  return Boolean(
    mapping?.enabled
    && mapping.oauthAccountId
    && mapping.propertyId
    && mapping.verificationStatus === "verified",
  );
}

async function sourceForApp(appId: string): Promise<{
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping | null;
}> {
  const entry = requireWorkspaceRegistryEntry(appId);
  const mapping = await getWorkspaceGa4MetricSourceMapping({
    tenantId: entry.tenantId,
    workspaceId: entry.workspaceId,
    appId: entry.appId,
  });

  return { entry, mapping };
}

async function getCachedCatalog(input: {
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping | null;
}): Promise<WorkspaceMetricCatalogRow | null> {
  if (!input.mapping?.propertyId) {
    return null;
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("workspace_metric_catalogs")
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,property_id,property_display_name,dimensions_json,metrics_json,custom_dimensions_json,custom_metrics_json,synced_at")
    .eq("tenant_id", input.entry.tenantId)
    .eq("workspace_id", input.entry.workspaceId)
    .eq("app_id", input.entry.appId)
    .eq("source_type", "ga4")
    .eq("source_id", "ga4_native")
    .eq("property_id", input.mapping.propertyId)
    .maybeSingle();

  if (error) {
    throw new Error(`Workspace GA4 catalog lookup failed: ${error.message}`);
  }

  return data ? data as WorkspaceMetricCatalogRow : null;
}

function catalogIsStale(row: WorkspaceMetricCatalogRow | null): boolean {
  if (!row?.synced_at) {
    return true;
  }

  const syncedAt = Date.parse(row.synced_at);

  return !Number.isFinite(syncedAt) || Date.now() - syncedAt > CATALOG_STALE_MS;
}

async function upsertCatalog(input: {
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping;
  metadata: ReturnType<typeof normalizeMetadata>;
}): Promise<WorkspaceMetricCatalogRow> {
  const supabase = await getSupabaseClient();
  const syncedAt = new Date().toISOString();
  const row = {
    tenant_id: input.entry.tenantId,
    workspace_id: input.entry.workspaceId,
    app_id: input.entry.appId,
    source_type: "ga4",
    source_id: "ga4_native",
    provider: "google_analytics",
    property_id: input.mapping.propertyId,
    property_display_name: input.mapping.propertyDisplayName ?? null,
    dimensions_json: cleanJson(input.metadata.dimensions),
    metrics_json: cleanJson(input.metadata.metrics),
    custom_dimensions_json: cleanJson(input.metadata.customDimensions),
    custom_metrics_json: cleanJson(input.metadata.customMetrics),
    synced_at: syncedAt,
  };
  const { data, error } = await supabase
    .from("workspace_metric_catalogs")
    .upsert(row, {
      onConflict: "tenant_id,workspace_id,app_id,source_type,source_id,property_id",
    })
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,property_id,property_display_name,dimensions_json,metrics_json,custom_dimensions_json,custom_metrics_json,synced_at")
    .single();

  if (error) {
    throw new Error(`Workspace GA4 catalog write failed: ${error.message}`);
  }

  return data as WorkspaceMetricCatalogRow;
}

export async function getProductLensGa4Catalog(input: {
  appId: string;
  refreshIfMissing?: boolean;
}): Promise<ProductLensGa4CatalogResponse> {
  const { entry, mapping } = await sourceForApp(input.appId);
  const cached = await getCachedCatalog({ entry, mapping });

  if (cached) {
    return catalogResponse({
      status: "cached",
      entry,
      mapping,
      row: cached,
    });
  }

  if (input.refreshIfMissing) {
    return syncProductLensGa4Catalog({ appId: entry.appId });
  }

  return catalogResponse({
    status: "missing",
    entry,
    mapping,
    row: null,
  });
}

export async function syncProductLensGa4Catalog(input: {
  appId: string;
}): Promise<ProductLensGa4CatalogResponse> {
  const { entry, mapping } = await sourceForApp(input.appId);

  if (!mappingReady(mapping)) {
    return catalogResponse({
      status: "failed",
      entry,
      mapping,
      row: null,
    });
  }

  const token = await getLensGoogleAccessToken({
    oauthAccountId: mapping.oauthAccountId!,
    tenantId: entry.tenantId,
  });
  const payload = await fetchGa4Metadata({
    accessToken: token.accessToken,
    propertyId: mapping.propertyId,
  });
  const row = await upsertCatalog({
    entry,
    mapping,
    metadata: normalizeMetadata(payload),
  });

  return catalogResponse({
    status: "synced",
    entry,
    mapping,
    row,
  });
}

function normalizeQueryRequest(body: Record<string, unknown>): ProductLensGa4QueryRequest {
  const rangeKey = typeof body.rangeKey === "string" && isProductLensGa4QueryRangeKey(body.rangeKey)
    ? body.rangeKey
    : "this_week";
  const metrics = Array.from(new Set(stringArray(body.metrics)));
  const dimensions = Array.from(new Set(stringArray(body.dimensions)));
  const limit = body.limit === undefined ? 10 : Number(body.limit);
  const cacheTtlMinutes = body.cacheTtlMinutes === undefined ? 60 : Number(body.cacheTtlMinutes);
  const filters = Array.isArray(body.filters)
    ? body.filters.filter(isRecord).map((filter) => ({
        type: "dimension" as const,
        name: typeof filter.name === "string" ? filter.name.trim() : "",
        value: typeof filter.value === "string" ? filter.value.trim() : "",
      })).filter((filter) => Boolean(filter.name && filter.value))
    : [];
  const orderBy = Array.isArray(body.orderBy)
    ? body.orderBy.filter(isRecord).map((item) => ({
        type: item.type === "dimension" ? "dimension" as const : "metric" as const,
        name: typeof item.name === "string" ? item.name.trim() : "",
        desc: item.desc !== false,
      })).filter((item) => Boolean(item.name))
    : [];
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : undefined;

  if (metrics.length < 1 || metrics.length > 5) {
    throw new ProductLensGa4ValidationError("invalid_metric_count", "Metrics are required and limited to 5.");
  }

  if (dimensions.length > 2) {
    throw new ProductLensGa4ValidationError("too_many_dimensions", "Dimensions are limited to 2.");
  }

  for (const metric of metrics) {
    if (!allowedMetricSet.has(metric)) {
      throw new ProductLensGa4ValidationError("unsupported_metric", `Unsupported metric: ${metric}`);
    }
  }

  for (const dimension of dimensions) {
    if (!allowedDimensionSet.has(dimension)) {
      throw new ProductLensGa4ValidationError("unsupported_dimension", `Unsupported dimension: ${dimension}`);
    }
  }

  for (const filter of filters) {
    if (!allowedDimensionSet.has(filter.name)) {
      throw new ProductLensGa4ValidationError("unsupported_filter_dimension", `Unsupported filter dimension: ${filter.name}`);
    }
  }

  for (const order of orderBy) {
    const requested = order.type === "metric"
      ? metrics.includes(order.name)
      : dimensions.includes(order.name);

    if (!requested) {
      throw new ProductLensGa4ValidationError("unsupported_order_by", `orderBy field must be requested: ${order.name}`);
    }
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ProductLensGa4ValidationError("invalid_limit", "Limit must be between 1 and 100.");
  }

  if (!Number.isInteger(cacheTtlMinutes) || cacheTtlMinutes < 1 || cacheTtlMinutes > 1440) {
    throw new ProductLensGa4ValidationError("invalid_cache_ttl", "cacheTtlMinutes must be between 1 and 1440.");
  }

  return {
    rangeKey,
    metrics,
    dimensions,
    filters,
    orderBy,
    limit,
    cacheTtlMinutes,
    reason,
    refresh: body.refresh === true,
  };
}

async function ensureCatalog(input: {
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping;
}): Promise<WorkspaceMetricCatalogRow> {
  const cached = await getCachedCatalog(input);

  if (cached && !catalogIsStale(cached)) {
    return cached;
  }

  const token = await getLensGoogleAccessToken({
    oauthAccountId: input.mapping.oauthAccountId!,
    tenantId: input.entry.tenantId,
  });
  const payload = await fetchGa4Metadata({
    accessToken: token.accessToken,
    propertyId: input.mapping.propertyId,
  });

  return upsertCatalog({
    entry: input.entry,
    mapping: input.mapping,
    metadata: normalizeMetadata(payload),
  });
}

function validateAgainstCatalog(input: {
  request: ProductLensGa4QueryRequest;
  catalog: WorkspaceMetricCatalogRow;
}): void {
  const catalogMetrics = new Map(catalogItems(input.catalog.metrics_json).map((item) => [item.api_name, item]));
  const catalogDimensions = new Map(catalogItems(input.catalog.dimensions_json).map((item) => [item.api_name, item]));

  for (const metric of input.request.metrics) {
    if (!allowedMetricSet.has(metric)) {
      throw new ProductLensGa4ValidationError("unsupported_metric", `Unsupported metric: ${metric}`);
    }

    if (catalogMetrics.get(metric)?.allowed_in_ad_hoc !== true) {
      throw new ProductLensGa4ValidationError("metric_unavailable", `Metric is unavailable in GA4 catalog: ${metric}`);
    }
  }

  for (const dimension of input.request.dimensions) {
    if (!allowedDimensionSet.has(dimension)) {
      throw new ProductLensGa4ValidationError("unsupported_dimension", `Unsupported dimension: ${dimension}`);
    }

    if (catalogDimensions.get(dimension)?.allowed_in_ad_hoc !== true) {
      throw new ProductLensGa4ValidationError("dimension_unavailable", `Dimension is unavailable in GA4 catalog: ${dimension}`);
    }
  }

  for (const filter of input.request.filters) {
    if (catalogDimensions.get(filter.name)?.allowed_in_ad_hoc !== true) {
      throw new ProductLensGa4ValidationError("filter_dimension_unavailable", `Filter dimension is unavailable in GA4 catalog: ${filter.name}`);
    }
  }
}

function stableQueryHash(input: {
  appId: string;
  propertyId: string;
  range: ProductLensGa4QueryResultResponse["range"];
  request: ProductLensGa4QueryRequest;
}): string {
  const payload = {
    appId: input.appId,
    propertyId: input.propertyId,
    range: input.range,
    metrics: input.request.metrics,
    dimensions: input.request.dimensions,
    filters: input.request.filters,
    orderBy: input.request.orderBy,
    limit: input.request.limit,
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function getCachedQueryResult(input: {
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping;
  queryHash: string;
}): Promise<WorkspaceMetricQueryResultRow | null> {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("workspace_metric_query_results")
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,property_id,query_hash,range_key,date_start,date_end,timezone,metrics_json,dimensions_json,filters_json,order_bys_json,limit_rows,rows_json,totals_json,row_count,cache_ttl_minutes,expires_at,generated_at,quality_json")
    .eq("tenant_id", input.entry.tenantId)
    .eq("workspace_id", input.entry.workspaceId)
    .eq("app_id", input.entry.appId)
    .eq("source_type", "ga4")
    .eq("source_id", "ga4_native")
    .eq("query_hash", input.queryHash)
    .maybeSingle();

  if (error) {
    throw new Error(`Workspace GA4 query cache lookup failed: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const row = data as WorkspaceMetricQueryResultRow;
  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : 0;

  return Number.isFinite(expiresAt) && expiresAt > Date.now() ? row : null;
}

function metricOrDimensionExpression(input: { type: ProductLensGa4QueryOrderByType; name: string; desc: boolean }): Record<string, unknown> {
  return input.type === "dimension"
    ? { dimension: { dimensionName: input.name }, desc: input.desc }
    : { metric: { metricName: input.name }, desc: input.desc };
}

function filterExpression(filters: ProductLensGa4QueryFilter[]): Record<string, unknown> | undefined {
  if (filters.length === 0) {
    return undefined;
  }

  if (filters.length === 1) {
    return {
      filter: {
        fieldName: filters[0].name,
        stringFilter: {
          matchType: "EXACT",
          value: filters[0].value,
          caseSensitive: false,
        },
      },
    };
  }

  return {
    andGroup: {
      expressions: filters.map((filter) => ({
        filter: {
          fieldName: filter.name,
          stringFilter: {
            matchType: "EXACT",
            value: filter.value,
            caseSensitive: false,
          },
        },
      })),
    },
  };
}

async function runAdHocReport(input: {
  accessToken: string;
  propertyId: string;
  range: ProductLensGa4QueryResultResponse["range"];
  request: ProductLensGa4QueryRequest;
}): Promise<{
  rows: Array<Record<string, string | number | null>>;
  totals: Record<string, number | null>;
  rowCount: number;
}> {
  const body: Record<string, unknown> = {
    dateRanges: [
      {
        startDate: input.range.date_start,
        endDate: input.range.date_end,
      },
    ],
    metrics: input.request.metrics.map((name) => ({ name })),
    dimensions: input.request.dimensions.map((name) => ({ name })),
    orderBys: input.request.orderBy.map(metricOrDimensionExpression),
    limit: input.request.limit,
    keepEmptyRows: false,
    returnPropertyQuota: false,
  };
  const dimensionFilter = filterExpression(input.request.filters);

  if (dimensionFilter) {
    body.dimensionFilter = dimensionFilter;
  }

  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(input.propertyId)}:runReport`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleRunReportResponse & GoogleAnalyticsErrorPayload;

  if (!response.ok) {
    const code = metadataErrorCode(response.status, payload);
    throw new LensGa4DataError(code === "source_auth_failed" ? "source_auth_failed" : "ga4_data_api_failed", code);
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

async function upsertQueryResult(input: {
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping;
  queryHash: string;
  range: ProductLensGa4QueryResultResponse["range"];
  request: ProductLensGa4QueryRequest;
  rows: Array<Record<string, string | number | null>>;
  totals: Record<string, number | null>;
  rowCount: number;
}): Promise<WorkspaceMetricQueryResultRow> {
  const supabase = await getSupabaseClient();
  const generatedAt = new Date();
  const row = {
    tenant_id: input.entry.tenantId,
    workspace_id: input.entry.workspaceId,
    app_id: input.entry.appId,
    source_type: "ga4",
    source_id: "ga4_native",
    provider: "google_analytics",
    property_id: input.mapping.propertyId,
    query_hash: input.queryHash,
    range_key: input.range.key,
    date_start: input.range.date_start,
    date_end: input.range.date_end,
    timezone: input.range.timezone,
    metrics_json: cleanJson(input.request.metrics),
    dimensions_json: cleanJson(input.request.dimensions),
    filters_json: cleanJson(input.request.filters as unknown as Record<string, unknown>[]),
    order_bys_json: cleanJson(input.request.orderBy as unknown as Record<string, unknown>[]),
    limit_rows: input.request.limit,
    rows_json: cleanJson(input.rows),
    totals_json: cleanJson(input.totals),
    row_count: input.rowCount,
    cache_ttl_minutes: input.request.cacheTtlMinutes,
    expires_at: new Date(generatedAt.getTime() + input.request.cacheTtlMinutes * 60 * 1000).toISOString(),
    generated_at: generatedAt.toISOString(),
    quality_json: cleanJson({
      confidence: "high",
      warnings: [],
    }),
  };
  const { data, error } = await supabase
    .from("workspace_metric_query_results")
    .upsert(row, {
      onConflict: "tenant_id,workspace_id,app_id,source_type,source_id,query_hash",
    })
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,property_id,query_hash,range_key,date_start,date_end,timezone,metrics_json,dimensions_json,filters_json,order_bys_json,limit_rows,rows_json,totals_json,row_count,cache_ttl_minutes,expires_at,generated_at,quality_json")
    .single();

  if (error) {
    throw new Error(`Workspace GA4 query cache write failed: ${error.message}`);
  }

  return data as WorkspaceMetricQueryResultRow;
}

function qualityFromRow(row: WorkspaceMetricQueryResultRow | null): ProductLensGa4QueryResultResponse["quality"] {
  const quality = isRecord(row?.quality_json) ? row?.quality_json as Record<string, unknown> : {};
  const confidence = quality.confidence === "medium" || quality.confidence === "low" ? quality.confidence : "high";

  return {
    confidence,
    warnings: stringArray(quality.warnings),
  };
}

function queryResponse(input: {
  status: ProductLensGa4QueryStatus;
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping;
  range: ProductLensGa4QueryResultResponse["range"];
  request: ProductLensGa4QueryRequest;
  row: WorkspaceMetricQueryResultRow;
  cache: "hit" | "miss";
}): ProductLensGa4QueryResultResponse {
  return {
    schema_version: "product.lens_ga4_query_result.v1",
    status: input.status,
    tenant_id: input.entry.tenantId,
    workspace_id: input.entry.workspaceId,
    app_id: input.entry.appId,
    range: input.range,
    query: {
      metrics: input.request.metrics,
      dimensions: input.request.dimensions,
      filters: input.request.filters,
      orderBy: input.request.orderBy,
      limit: input.request.limit,
      reason: input.request.reason,
    },
    rows: queryRows(input.row.rows_json),
    totals: totalsRecord(input.row.totals_json),
    row_count: input.row.row_count ?? 0,
    source: {
      provider: "ga4",
      source_type: "ga4",
      source_id: "ga4_native",
      property_id: input.mapping.propertyId,
      property_display_name: input.mapping.propertyDisplayName,
      cache: input.cache,
      query_result_id: input.row.id,
    },
    quality: qualityFromRow(input.row),
    safety: safety(),
  };
}

export async function runProductLensGa4AdHocQuery(input: {
  appId: string;
  body: Record<string, unknown>;
}): Promise<ProductLensGa4QueryResultResponse> {
  const request = normalizeQueryRequest(input.body);
  const { entry, mapping } = await sourceForApp(input.appId);

  if (!mappingReady(mapping)) {
    throw new ProductLensGa4ValidationError("ga4_source_not_ready", "GA4 source mapping is missing or not verified.");
  }

  const range = resolveProductLensGa4QueryRange({
    rangeKey: request.rangeKey,
    timezone: mapping.timezone,
  });

  if (daysInclusive(range.date_start, range.date_end) > 90) {
    throw new ProductLensGa4ValidationError("date_range_too_large", "Date range cannot exceed 90 days.");
  }

  const catalog = await ensureCatalog({ entry, mapping });
  validateAgainstCatalog({ request, catalog });

  const queryHash = stableQueryHash({
    appId: entry.appId,
    propertyId: mapping.propertyId,
    range,
    request,
  });

  if (!request.refresh) {
    const cached = await getCachedQueryResult({
      entry,
      mapping,
      queryHash,
    });

    if (cached) {
      return queryResponse({
        status: "cached",
        entry,
        mapping,
        range,
        request,
        row: cached,
        cache: "hit",
      });
    }
  }

  const token = await getLensGoogleAccessToken({
    oauthAccountId: mapping.oauthAccountId!,
    tenantId: entry.tenantId,
  });
  const report = await runAdHocReport({
    accessToken: token.accessToken,
    propertyId: mapping.propertyId,
    range,
    request,
  });
  const row = await upsertQueryResult({
    entry,
    mapping,
    queryHash,
    range,
    request,
    rows: report.rows,
    totals: report.totals,
    rowCount: report.rowCount,
  });

  return queryResponse({
    status: "completed",
    entry,
    mapping,
    range,
    request,
    row,
    cache: "miss",
  });
}

export function productLensGa4ErrorCode(error: unknown): string {
  if (error instanceof ProductLensGa4ValidationError) {
    return error.code;
  }

  if (error instanceof LensGoogleAccessTokenError) {
    return error.code;
  }

  if (error instanceof LensGa4DataError) {
    return error.message || error.code;
  }

  return error instanceof Error ? error.message : "ga4_request_failed";
}
