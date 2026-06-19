import "server-only";

import {
  getMetaAppId,
  getMetaAppSecret,
  getMetaRedirectUri,
  isCmoFacebookNativeEnabled,
} from "@/lib/cmo/config";
import { encryptLensOAuthToken, decryptLensOAuthToken } from "@/lib/cmo/lens-oauth-crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireWorkspaceRegistryEntry, type WorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";
import type {
  CmoChannelMetric,
  CmoChannelMetricDateRangePreset,
  CmoChannelMetricsSnapshot,
  CmoTopContentItem,
} from "@/lib/cmo/app-workspace-types";

const GRAPH_API_BASE_URL = "https://graph.facebook.com/v20.0";
const DEFAULT_TIMEZONE = process.env.CMO_VAULT_TIME_ZONE ?? "Asia/Saigon";
const FACEBOOK_SOURCE_TYPE = "facebook_page";
const FACEBOOK_SOURCE_ID = "facebook_native";
const FACEBOOK_PROVIDER = "meta";
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const REQUIRED_META_CONFIG = ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI", "LENS_OAUTH_TOKEN_ENCRYPTION_KEY"] as const;
const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "read_insights",
  "pages_read_user_content",
] as const;

export type FacebookChannelSyncMode = "refresh_all" | "refresh_if_stale" | "cache_only";
export type FacebookChannelSnapshotStatus = "connected" | "partial" | "missing" | "stale" | "failed";
export type FacebookChannelSyncStatus = "completed" | "partial" | "failed" | "missing";
export type FacebookConnectorSafeErrorCode =
  | "token_exchange_error"
  | "token_encryption_error"
  | "supabase_oauth_account_write_error"
  | "page_list_error"
  | "page_mapping_write_error"
  | "invalid_state";

export class FacebookConnectorError extends Error {
  safeCode: FacebookConnectorSafeErrorCode;
  stage: string;
  tableName?: string;
  supabaseCode?: string;
  supabaseMessage?: string;

  constructor(input: {
    safeCode: FacebookConnectorSafeErrorCode;
    stage: string;
    message: string;
    tableName?: string;
    supabaseCode?: string | null;
    supabaseMessage?: string | null;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "FacebookConnectorError";
    this.safeCode = input.safeCode;
    this.stage = input.stage;
    this.tableName = input.tableName;
    this.supabaseCode = input.supabaseCode ?? undefined;
    this.supabaseMessage = input.supabaseMessage ?? undefined;
  }
}

export interface FacebookChannelSafety {
  no_tokens_returned: true;
  raw_meta_response_included: false;
  vault_write_performed: false;
  gbrain_used: false;
  hermes_called: false;
}

export const FACEBOOK_CHANNEL_SAFETY: FacebookChannelSafety = {
  no_tokens_returned: true,
  raw_meta_response_included: false,
  vault_write_performed: false,
  gbrain_used: false,
  hermes_called: false,
};

interface SocialOAuthAccountRow {
  id: string;
  tenant_id: string;
  provider: "meta";
  provider_user_id: string | null;
  account_name: string | null;
  encrypted_access_token: string;
  token_expires_at: string | null;
  scopes_json: unknown;
  metadata_json: unknown;
  created_at: string;
  updated_at: string;
}

interface ChannelSourceRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  source_type: "facebook_page";
  source_id: "facebook_native";
  provider: "meta";
  page_id: string;
  page_name: string | null;
  auth_ref: string | null;
  enabled: boolean;
  verified_at: string | null;
  config_json: unknown;
  quality_json: unknown;
  created_at: string;
  updated_at: string;
}

interface SocialMetricSnapshotRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  source_type: "facebook_page";
  source_id: "facebook_native";
  provider: "meta";
  page_id: string;
  range_key: CmoChannelMetricDateRangePreset | null;
  date_start: string | null;
  date_end: string | null;
  timezone: string | null;
  status: FacebookChannelSnapshotStatus;
  metrics_json: unknown;
  series_json: unknown;
  posts_json: unknown;
  diagnostics_json: unknown;
  provenance_json: unknown;
  synced_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface FacebookChannelSource {
  tenantId: string;
  workspaceId: string;
  appId: string;
  sourceType: "facebook_page";
  sourceId: "facebook_native";
  provider: "meta";
  pageId: string;
  pageName: string | null;
  authRef: string | null;
  enabled: boolean;
  verifiedAt: string | null;
  quality: {
    status?: string;
    warnings?: string[];
    lastError?: string | null;
  };
  config: {
    hasEncryptedPageAccessToken: boolean;
  };
}

export interface NativeFacebookChannelSnapshot {
  tenantId: string;
  workspaceId: string;
  appId: string;
  sourceType: "facebook_page";
  sourceId: "facebook_native";
  provider: "meta";
  pageId: string;
  pageName: string | null;
  rangeKey: CmoChannelMetricDateRangePreset;
  dateStart: string;
  dateEnd: string;
  timezone: string;
  status: FacebookChannelSnapshotStatus;
  metrics: CmoChannelMetric[];
  series: Array<{ id: string; points: Record<string, unknown>[] }>;
  posts: CmoTopContentItem[];
  diagnostics: {
    availableMetrics: string[];
    missingMetrics: string[];
    warnings: string[];
    notes: string[];
    sourceRows: number;
    qualityStatus: FacebookChannelSnapshotStatus;
  };
  provenance: Record<string, unknown>;
  syncedAt: string | null;
}

export interface FacebookPageSummary {
  id: string;
  name: string | null;
  category?: string | null;
  accessTokenAvailable: boolean;
}

interface GraphTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; code?: number; type?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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

function numberOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = numberValue(value);

    if (numeric !== null) {
      return numeric;
    }
  }

  return null;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function safeErrorText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.replace(/\s+/g, " ").trim();

  if (!text || /\b(access_token|client_secret|META_APP_SECRET|Bearer|Authorization)\b/i.test(text)) {
    return null;
  }

  return text.slice(0, 240);
}

function supabaseErrorCode(error: unknown): string | null {
  return isRecord(error) ? safeErrorText(error.code) : null;
}

function supabaseErrorMessage(error: unknown): string | null {
  return isRecord(error) ? safeErrorText(error.message) : null;
}

function displayCount(value: number | null): string {
  return value === null ? "No data" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function metric(input: {
  id: string;
  label: string;
  value: number | null;
  unit?: CmoChannelMetric["unit"];
  description: string;
  caveat?: string;
}): CmoChannelMetric {
  return {
    id: input.id,
    label: input.label,
    value: input.value,
    displayValue: input.unit === "percent"
      ? input.value === null ? "No data" : `${Number(input.value.toFixed(2)).toLocaleString("en-US")}%`
      : displayCount(input.value),
    ...(input.unit ? { unit: input.unit } : {}),
    status: input.value === null ? "missing" : "connected",
    description: input.description,
    ...(input.caveat ? { caveat: input.caveat } : {}),
  };
}

function availableMetricIds(metrics: CmoChannelMetric[]): string[] {
  return metrics.filter((item) => item.status === "connected" && item.value !== null).map((item) => item.id);
}

function missingMetricIds(metrics: CmoChannelMetric[]): string[] {
  return metrics.filter((item) => item.status !== "connected" || item.value === null).map((item) => item.id);
}

function snapshotStatus(metrics: CmoChannelMetric[], posts: CmoTopContentItem[]): FacebookChannelSnapshotStatus {
  const connectedCount = metrics.filter((item) => item.status === "connected").length;

  if (connectedCount === 0 && posts.length === 0) {
    return "missing";
  }

  return connectedCount === metrics.length ? "connected" : "partial";
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

  return { year: part("year"), month: part("month"), day: part("day") };
}

function dateFromParts(parts: { year: number; month: number; day: number }): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

export function normalizeFacebookRangeKey(value: unknown): CmoChannelMetricDateRangePreset {
  return value === "today" ||
    value === "yesterday" ||
    value === "last_7_days" ||
    value === "last_30_days" ||
    value === "this_week" ||
    value === "this_month" ||
    value === "custom"
    ? value
    : "this_week";
}

export function resolveFacebookChannelDateRange(input: {
  rangeKey: CmoChannelMetricDateRangePreset;
  timezone?: string | null;
  now?: Date;
}): { rangeKey: CmoChannelMetricDateRangePreset; startDate: string; endDate: string; timezone: string } {
  const timezone = input.timezone || DEFAULT_TIMEZONE;
  const today = dateFromParts(zonedDateParts(input.now ?? new Date(), timezone));
  const day = today.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(today);
  const end = new Date(today);

  if (input.rangeKey === "yesterday") {
    start.setUTCDate(today.getUTCDate() - 1);
    end.setUTCDate(today.getUTCDate() - 1);
  } else if (input.rangeKey === "last_7_days") {
    start.setUTCDate(today.getUTCDate() - 6);
  } else if (input.rangeKey === "last_30_days") {
    start.setUTCDate(today.getUTCDate() - 29);
  } else if (input.rangeKey === "this_month") {
    start.setUTCDate(1);
  } else if (input.rangeKey === "this_week") {
    start.setUTCDate(today.getUTCDate() + mondayOffset);
  }

  return { rangeKey: input.rangeKey, startDate: isoDate(start), endDate: isoDate(end), timezone };
}

export function getMetaOAuthConfigStatus(): { configured: boolean; missing: string[] } {
  const missing = REQUIRED_META_CONFIG.filter((name) => !(process.env[name] ?? "").trim());

  return { configured: missing.length === 0, missing };
}

export function buildMetaOAuthAuthorizationUrl(input: {
  state: string;
}): URL {
  const missing = ["META_APP_ID", "META_REDIRECT_URI"].filter((name) => !(process.env[name] ?? "").trim());

  if (missing.length) {
    throw new Error(`Missing Meta OAuth server env: ${missing.join(", ")}`);
  }

  const url = new URL("https://www.facebook.com/v20.0/dialog/oauth");
  url.searchParams.set("client_id", getMetaAppId());
  url.searchParams.set("redirect_uri", getMetaRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_SCOPES.join(","));
  url.searchParams.set("state", input.state);

  return url;
}

async function metaJsonRequest(url: URL, errorCode: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as unknown;

  if (!response.ok) {
    throw new FacebookConnectorError({
      safeCode: errorCode === "facebook_pages_fetch_failed" ? "page_list_error" : "token_exchange_error",
      stage: errorCode === "facebook_pages_fetch_failed" ? "page_list" : "token_exchange",
      message: errorCode,
    });
  }

  return payload;
}

export async function exchangeMetaCodeForToken(code: string): Promise<{
  accessToken: string;
  expiresAt: string | null;
  scopes: string[];
}> {
  const missing = ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"].filter((name) => !(process.env[name] ?? "").trim());

  if (missing.length) {
    throw new Error(`Missing Meta OAuth server env: ${missing.join(", ")}`);
  }

  const url = new URL(`${GRAPH_API_BASE_URL}/oauth/access_token`);
  url.searchParams.set("client_id", getMetaAppId());
  url.searchParams.set("client_secret", getMetaAppSecret());
  url.searchParams.set("redirect_uri", getMetaRedirectUri());
  url.searchParams.set("code", code);

  const data = await metaJsonRequest(url, "meta_token_exchange_failed") as GraphTokenResponse;

  if (!data.access_token) {
    throw new FacebookConnectorError({
      safeCode: "token_exchange_error",
      stage: "token_exchange",
      message: "meta_token_exchange_failed",
    });
  }

  return {
    accessToken: data.access_token,
    expiresAt: typeof data.expires_in === "number" ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
    scopes: [...META_SCOPES],
  };
}

export async function fetchMetaAccountProfile(accessToken: string): Promise<{ id: string | null; name: string | null }> {
  const url = new URL(`${GRAPH_API_BASE_URL}/me`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", accessToken);

  try {
    const payload = await metaJsonRequest(url, "meta_profile_fetch_failed");

    return isRecord(payload)
      ? { id: stringValue(payload.id) || null, name: stringValue(payload.name) || null }
      : { id: null, name: null };
  } catch {
    return { id: null, name: null };
  }
}

async function getSupabase() {
  return createSupabaseAdminClient();
}

function toSafeSource(row: ChannelSourceRow): FacebookChannelSource {
  const config = jsonRecord(row.config_json);
  const quality = jsonRecord(row.quality_json);

  return {
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    appId: row.app_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    provider: row.provider,
    pageId: row.page_id,
    pageName: row.page_name,
    authRef: row.auth_ref,
    enabled: row.enabled,
    verifiedAt: row.verified_at,
    quality: {
      status: stringValue(quality.status) || undefined,
      warnings: jsonStringArray(quality.warnings),
      lastError: stringValue(quality.lastError) || null,
    },
    config: {
      hasEncryptedPageAccessToken: typeof config.encryptedPageAccessToken === "string" && Boolean(config.encryptedPageAccessToken),
    },
  };
}

export async function upsertMetaOAuthAccount(input: {
  tenantId: string;
  providerUserId?: string | null;
  accountName?: string | null;
  accessToken: string;
  tokenExpiresAt?: string | null;
  scopes: string[];
  metadata?: Record<string, unknown>;
}): Promise<{ id: string; tenantId: string; provider: "meta"; accountName: string | null; scopes: string[] }> {
  const supabase = await getSupabase();
  let encryptedAccessToken: string;

  try {
    encryptedAccessToken = encryptLensOAuthToken(input.accessToken);
  } catch (error) {
    throw new FacebookConnectorError({
      safeCode: "token_encryption_error",
      stage: "token_encryption",
      message: "facebook_oauth_token_encryption_failed",
      cause: error,
    });
  }

  const row = {
    tenant_id: input.tenantId,
    provider: "meta",
    provider_user_id: input.providerUserId ?? null,
    account_name: input.accountName ?? null,
    encrypted_access_token: encryptedAccessToken,
    token_expires_at: input.tokenExpiresAt ?? null,
    scopes_json: input.scopes,
    metadata_json: input.metadata ?? {},
  };
  let existingId: string | null = null;

  if (input.providerUserId) {
    const { data: existing, error: lookupError } = await supabase
      .from("workspace_social_oauth_accounts")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("provider", "meta")
      .eq("provider_user_id", input.providerUserId)
      .maybeSingle();

    if (lookupError) {
      throw new FacebookConnectorError({
        safeCode: "supabase_oauth_account_write_error",
        stage: "oauth_account_lookup_before_write",
        tableName: "workspace_social_oauth_accounts",
        message: "facebook_oauth_account_lookup_before_write_failed",
        supabaseCode: supabaseErrorCode(lookupError),
        supabaseMessage: supabaseErrorMessage(lookupError),
        cause: lookupError,
      });
    }

    existingId = isRecord(existing) && typeof existing.id === "string" ? existing.id : null;
  }

  const query = existingId
    ? supabase
      .from("workspace_social_oauth_accounts")
      .update(row)
      .eq("id", existingId)
      .select("id,tenant_id,provider,account_name,scopes_json")
      .single()
    : supabase
      .from("workspace_social_oauth_accounts")
      .insert(row)
      .select("id,tenant_id,provider,account_name,scopes_json")
      .single();
  const { data, error } = await query;

  if (error) {
    throw new FacebookConnectorError({
      safeCode: "supabase_oauth_account_write_error",
      stage: existingId ? "oauth_account_update" : "oauth_account_insert",
      tableName: "workspace_social_oauth_accounts",
      message: "facebook_oauth_account_write_failed",
      supabaseCode: supabaseErrorCode(error),
      supabaseMessage: supabaseErrorMessage(error),
      cause: error,
    });
  }

  const saved = data as Pick<SocialOAuthAccountRow, "id" | "tenant_id" | "provider" | "account_name" | "scopes_json">;

  return {
    id: saved.id,
    tenantId: saved.tenant_id,
    provider: "meta",
    accountName: saved.account_name,
    scopes: jsonStringArray(saved.scopes_json),
  };
}

async function getMetaOAuthAccount(authRef: string): Promise<SocialOAuthAccountRow | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workspace_social_oauth_accounts")
    .select("id,tenant_id,provider,provider_user_id,account_name,encrypted_access_token,token_expires_at,scopes_json,metadata_json,created_at,updated_at")
    .eq("id", authRef)
    .eq("provider", "meta")
    .maybeSingle();

  if (error) {
    throw new Error(`facebook_oauth_account_lookup_failed:${error.message}`);
  }

  return data ? data as SocialOAuthAccountRow : null;
}

async function getFacebookChannelSource(appId: string): Promise<ChannelSourceRow | null> {
  const entry = requireWorkspaceRegistryEntry(appId);
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workspace_channel_sources")
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,page_id,page_name,auth_ref,enabled,verified_at,config_json,quality_json,created_at,updated_at")
    .eq("tenant_id", entry.tenantId)
    .eq("workspace_id", entry.workspaceId)
    .eq("app_id", entry.appId)
    .eq("source_type", FACEBOOK_SOURCE_TYPE)
    .eq("source_id", FACEBOOK_SOURCE_ID)
    .maybeSingle();

  if (error) {
    throw new Error(`facebook_channel_source_lookup_failed:${error.message}`);
  }

  return data ? data as ChannelSourceRow : null;
}

export async function getSafeFacebookChannelSource(appId: string): Promise<FacebookChannelSource | null> {
  const row = await getFacebookChannelSource(appId);

  return row ? toSafeSource(row) : null;
}

async function pageAccessTokenForSource(source: ChannelSourceRow): Promise<string> {
  const config = jsonRecord(source.config_json);
  const encryptedPageAccessToken = stringValue(config.encryptedPageAccessToken);

  if (encryptedPageAccessToken) {
    return decryptLensOAuthToken(encryptedPageAccessToken);
  }

  if (!source.auth_ref) {
    throw new Error("facebook_source_missing_auth_ref");
  }

  const account = await getMetaOAuthAccount(source.auth_ref);

  if (!account || account.tenant_id !== source.tenant_id) {
    throw new Error("facebook_oauth_account_unavailable");
  }

  return decryptLensOAuthToken(account.encrypted_access_token);
}

export async function listAccessibleFacebookPages(input: {
  appId: string;
  authRef?: string | null;
}): Promise<{ status: "completed" | "missing"; pages: FacebookPageSummary[]; warnings: string[]; safety: FacebookChannelSafety }> {
  if (!getMetaOAuthConfigStatus().configured) {
    return { status: "missing", pages: [], warnings: ["not_configured"], safety: FACEBOOK_CHANNEL_SAFETY };
  }

  const source = await getFacebookChannelSource(input.appId);
  const authRef = input.authRef ?? source?.auth_ref ?? null;

  if (!authRef) {
    return { status: "missing", pages: [], warnings: ["oauth_account_missing"], safety: FACEBOOK_CHANNEL_SAFETY };
  }

  const account = await getMetaOAuthAccount(authRef);

  if (!account) {
    return { status: "missing", pages: [], warnings: ["oauth_account_missing"], safety: FACEBOOK_CHANNEL_SAFETY };
  }

  const token = decryptLensOAuthToken(account.encrypted_access_token);
  const url = new URL(`${GRAPH_API_BASE_URL}/me/accounts`);
  url.searchParams.set("fields", "id,name,category,access_token");
  url.searchParams.set("access_token", token);

  try {
    const payload = await metaJsonRequest(url, "facebook_pages_fetch_failed");
    const pages = arrayRecords(isRecord(payload) ? payload.data : [])
      .map((page): FacebookPageSummary | null => {
        const id = stringValue(page.id);

        return id
          ? {
            id,
            name: stringValue(page.name) || null,
            category: stringValue(page.category) || null,
            accessTokenAvailable: Boolean(stringValue(page.access_token)),
          }
          : null;
      })
      .filter((page): page is FacebookPageSummary => Boolean(page));

    return { status: "completed", pages, warnings: [], safety: FACEBOOK_CHANNEL_SAFETY };
  } catch {
    return { status: "missing", pages: [], warnings: ["permission_missing"], safety: FACEBOOK_CHANNEL_SAFETY };
  }
}

export async function saveFacebookPageMapping(input: {
  appId: string;
  authRef: string;
  pageId: string;
  pageName?: string | null;
  pageAccessToken?: string | null;
}): Promise<FacebookChannelSource> {
  const entry = requireWorkspaceRegistryEntry(input.appId);
  const account = await getMetaOAuthAccount(input.authRef);

  if (!account || account.tenant_id !== entry.tenantId) {
    throw new Error("facebook_oauth_account_unavailable");
  }

  let pageAccessToken = input.pageAccessToken ?? null;
  let pageName = input.pageName ?? null;

  if (!pageAccessToken) {
    const token = decryptLensOAuthToken(account.encrypted_access_token);
    const url = new URL(`${GRAPH_API_BASE_URL}/me/accounts`);
    url.searchParams.set("fields", "id,name,access_token");
    url.searchParams.set("access_token", token);
    const payload = await metaJsonRequest(url, "facebook_pages_fetch_failed");
    const page = arrayRecords(isRecord(payload) ? payload.data : []).find((item) => stringValue(item.id) === input.pageId);

    pageAccessToken = stringValue(page?.access_token) || null;
    pageName = pageName ?? (stringValue(page?.name) || null);
  }

  const row = {
    tenant_id: entry.tenantId,
    workspace_id: entry.workspaceId,
    app_id: entry.appId,
    source_type: FACEBOOK_SOURCE_TYPE,
    source_id: FACEBOOK_SOURCE_ID,
    provider: FACEBOOK_PROVIDER,
    page_id: input.pageId,
    page_name: pageName,
    auth_ref: input.authRef,
    enabled: true,
    config_json: {},
    quality_json: {
      status: "pending_verification",
      warnings: [],
    },
  };
  if (pageAccessToken) {
    try {
      row.config_json = { encryptedPageAccessToken: encryptLensOAuthToken(pageAccessToken) };
    } catch (error) {
      throw new FacebookConnectorError({
        safeCode: "token_encryption_error",
        stage: "page_token_encryption",
        message: "facebook_page_token_encryption_failed",
        cause: error,
      });
    }
  }
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workspace_channel_sources")
    .upsert(row, { onConflict: "tenant_id,workspace_id,app_id,source_type,source_id" })
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,page_id,page_name,auth_ref,enabled,verified_at,config_json,quality_json,created_at,updated_at")
    .single();

  if (error) {
    throw new FacebookConnectorError({
      safeCode: "page_mapping_write_error",
      stage: "page_mapping_write",
      tableName: "workspace_channel_sources",
      message: "facebook_page_mapping_write_failed",
      supabaseCode: supabaseErrorCode(error),
      supabaseMessage: supabaseErrorMessage(error),
      cause: error,
    });
  }

  return toSafeSource(data as ChannelSourceRow);
}

async function updateFacebookSourceQuality(source: ChannelSourceRow, input: {
  verifiedAt?: string | null;
  quality: Record<string, unknown>;
}): Promise<FacebookChannelSource> {
  const supabase = await getSupabase();
  const row: Record<string, unknown> = {
    quality_json: input.quality,
  };

  if ("verifiedAt" in input) {
    row.verified_at = input.verifiedAt;
  }

  const { data, error } = await supabase
    .from("workspace_channel_sources")
    .update(row)
    .eq("id", source.id)
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,page_id,page_name,auth_ref,enabled,verified_at,config_json,quality_json,created_at,updated_at")
    .single();

  if (error) {
    throw new Error(`facebook_page_mapping_update_failed:${error.message}`);
  }

  return toSafeSource(data as ChannelSourceRow);
}

export async function verifyFacebookPageSource(appId: string): Promise<{
  status: "connected" | "missing" | "failed";
  source: FacebookChannelSource | null;
  warnings: string[];
  safety: FacebookChannelSafety;
}> {
  const source = await getFacebookChannelSource(appId);

  if (!source || !source.enabled) {
    return { status: "missing", source: null, warnings: ["facebook_page_source_missing"], safety: FACEBOOK_CHANNEL_SAFETY };
  }

  try {
    const token = await pageAccessTokenForSource(source);
    const url = new URL(`${GRAPH_API_BASE_URL}/${encodeURIComponent(source.page_id)}`);
    url.searchParams.set("fields", "id,name");
    url.searchParams.set("access_token", token);
    const payload = await metaJsonRequest(url, "facebook_page_verify_failed");
    const pageName = isRecord(payload) ? stringValue(payload.name) || source.page_name : source.page_name;
    const updated = await updateFacebookSourceQuality({ ...source, page_name: pageName } as ChannelSourceRow, {
      verifiedAt: new Date().toISOString(),
      quality: { status: "connected", warnings: [] },
    });

    return { status: "connected", source: updated, warnings: [], safety: FACEBOOK_CHANNEL_SAFETY };
  } catch {
    const updated = await updateFacebookSourceQuality(source, {
      verifiedAt: null,
      quality: { status: "failed", warnings: ["permission_missing"], lastError: "permission_missing" },
    });

    return { status: "failed", source: updated, warnings: ["permission_missing"], safety: FACEBOOK_CHANNEL_SAFETY };
  }
}

function metricValueFromInsights(payload: unknown, metricName: string): number | null {
  const rows = arrayRecords(isRecord(payload) ? payload.data : []);
  const row = rows.find((item) => item.name === metricName);
  const values = arrayRecords(row?.values);
  const latest = values[values.length - 1];
  const value = latest?.value;

  if (isRecord(value)) {
    return Object.values(value).reduce<number>((sum, item) => sum + (numberValue(item) ?? 0), 0);
  }

  return numberValue(value);
}

async function fetchPageInsights(input: {
  pageId: string;
  pageAccessToken: string;
  range: { startDate: string; endDate: string };
}): Promise<Record<string, number | null>> {
  const metrics = [
    "page_impressions",
    "page_impressions_unique",
    "page_post_engagements",
    "page_fans",
    "page_video_views",
    "page_fan_adds_unique",
  ];
  const url = new URL(`${GRAPH_API_BASE_URL}/${encodeURIComponent(input.pageId)}/insights`);
  url.searchParams.set("metric", metrics.join(","));
  url.searchParams.set("since", input.range.startDate);
  url.searchParams.set("until", input.range.endDate);
  url.searchParams.set("access_token", input.pageAccessToken);
  const payload = await metaJsonRequest(url, "facebook_page_insights_fetch_failed");

  return Object.fromEntries(metrics.map((name) => [name, metricValueFromInsights(payload, name)]));
}

function postMetricValue(insights: unknown, metricName: string): number | null {
  return metricValueFromInsights(insights, metricName);
}

async function fetchTopPosts(input: {
  pageId: string;
  pageAccessToken: string;
  range: { startDate: string; endDate: string };
}): Promise<CmoTopContentItem[]> {
  const url = new URL(`${GRAPH_API_BASE_URL}/${encodeURIComponent(input.pageId)}/posts`);
  url.searchParams.set("fields", "id,created_time,message,permalink_url,insights.metric(post_impressions,post_impressions_unique,post_engaged_users,post_reactions_by_type_total,post_video_views)");
  url.searchParams.set("since", input.range.startDate);
  url.searchParams.set("until", input.range.endDate);
  url.searchParams.set("limit", "25");
  url.searchParams.set("access_token", input.pageAccessToken);
  const payload = await metaJsonRequest(url, "facebook_posts_fetch_failed");
  const posts = arrayRecords(isRecord(payload) ? payload.data : []);

  return posts
    .map((post, index): CmoTopContentItem => {
      const insights = post.insights;
      const views = numberOrNull(postMetricValue(insights, "post_impressions"), postMetricValue(insights, "post_impressions_unique"));
      const visibleEngagement = postMetricValue(insights, "post_engaged_users");
      const engagementRate = views && visibleEngagement !== null ? visibleEngagement / views * 100 : null;
      const message = stringValue(post.message);

      return {
        id: stringValue(post.id) || `facebook-post-${index + 1}`,
        postId: stringValue(post.id) || undefined,
        createdTime: stringValue(post.created_time) || undefined,
        permalinkUrl: stringValue(post.permalink_url) || undefined,
        messagePreview: message ? message.slice(0, 180) : undefined,
        inferredContentType: "facebook_post",
        views,
        visibleEngagement,
        engagementRate,
        bucket: views === null ? "unknown" : views > 10000 ? "strong" : "normal",
      };
    })
    .sort((left, right) => (right.views ?? 0) - (left.views ?? 0))
    .slice(0, 10);
}

function snapshotFromNativeData(input: {
  entry: WorkspaceRegistryEntry;
  source: ChannelSourceRow;
  range: { rangeKey: CmoChannelMetricDateRangePreset; startDate: string; endDate: string; timezone: string };
  insights: Record<string, number | null>;
  posts: CmoTopContentItem[];
  syncedAt: string;
  warnings: string[];
}): NativeFacebookChannelSnapshot {
  const metrics = [
    metric({
      id: "facebook_views",
      label: "Facebook Views",
      value: numberOrNull(input.insights.page_impressions),
      unit: "count",
      description: "Page impressions from Product native Meta Page Insights when available.",
      caveat: "Views may use Meta impressions proxy.",
    }),
    metric({
      id: "facebook_unique_views",
      label: "Unique Views Proxy",
      value: numberOrNull(input.insights.page_impressions_unique),
      unit: "count",
      description: "Unique Page impressions proxy from Product native Meta Page Insights when available.",
      caveat: "This is a unique views proxy, not confirmed classic reach.",
    }),
    metric({
      id: "facebook_engagement",
      label: "Engagement",
      value: numberOrNull(input.insights.page_post_engagements, input.posts.reduce((sum, post) => sum + (post.visibleEngagement ?? 0), 0) || null),
      unit: "count",
      description: "Page post engagement from Product native Meta Page Insights when available.",
    }),
    metric({
      id: "facebook_post_count",
      label: "Post Count",
      value: input.posts.length || null,
      unit: "count",
      description: "Facebook Page posts returned by Product native Meta connector for the selected range.",
    }),
    metric({
      id: "facebook_video_views",
      label: "Video Views",
      value: numberOrNull(input.insights.page_video_views),
      unit: "count",
      description: "Page video views from Product native Meta Page Insights when available.",
    }),
    metric({
      id: "facebook_follower_count",
      label: "Followers",
      value: numberOrNull(input.insights.page_fans),
      unit: "count",
      description: "Facebook Page follower count from Product native Meta Page Insights when available.",
    }),
    metric({
      id: "facebook_follower_growth",
      label: "Follower Growth",
      value: numberOrNull(input.insights.page_fan_adds_unique),
      unit: "count",
      description: "Follower growth from Product native Meta Page Insights when available.",
    }),
    metric({
      id: "facebook_link_clicks",
      label: "Link Clicks",
      value: null,
      unit: "count",
      description: "Facebook link clicks remain unavailable until a confirmed source is connected.",
    }),
    metric({
      id: "facebook_ctr",
      label: "CTR",
      value: null,
      unit: "percent",
      description: "Facebook CTR remains unavailable until confirmed link click and impression sources are connected.",
    }),
  ];
  const status = snapshotStatus(metrics, input.posts);

  return {
    tenantId: input.entry.tenantId,
    workspaceId: input.entry.workspaceId,
    appId: input.entry.appId,
    sourceType: FACEBOOK_SOURCE_TYPE,
    sourceId: FACEBOOK_SOURCE_ID,
    provider: FACEBOOK_PROVIDER,
    pageId: input.source.page_id,
    pageName: input.source.page_name,
    rangeKey: input.range.rangeKey,
    dateStart: input.range.startDate,
    dateEnd: input.range.endDate,
    timezone: input.range.timezone,
    status,
    metrics,
    series: [{
      id: "facebook_page_summary",
      points: [{
        date_start: input.range.startDate,
        date_end: input.range.endDate,
        views: metrics.find((item) => item.id === "facebook_views")?.value,
        unique_views_proxy: metrics.find((item) => item.id === "facebook_unique_views")?.value,
        engagement: metrics.find((item) => item.id === "facebook_engagement")?.value,
        followers: metrics.find((item) => item.id === "facebook_follower_count")?.value,
        posts: metrics.find((item) => item.id === "facebook_post_count")?.value,
        video_views: metrics.find((item) => item.id === "facebook_video_views")?.value,
      }],
    }],
    posts: input.posts,
    diagnostics: {
      availableMetrics: availableMetricIds(metrics),
      missingMetrics: missingMetricIds(metrics),
      warnings: ["link_clicks_unavailable", "ctr_unavailable", ...input.warnings],
      notes: ["Loaded from Product native Facebook connector.", "Raw Meta API response is not stored or returned."],
      sourceRows: input.posts.length,
      qualityStatus: status,
    },
    provenance: {
      sourceWorkflow: "product_native_facebook_connector",
      provider: FACEBOOK_PROVIDER,
      pageId: input.source.page_id,
      pageName: input.source.page_name,
      nativeConnector: true,
      rawMetaResponseStored: false,
      vaultWritePerformed: false,
      gbrainUsed: false,
      hermesCalled: false,
    },
    syncedAt: input.syncedAt,
  };
}

function toSnapshotRow(snapshot: NativeFacebookChannelSnapshot): Record<string, unknown> {
  return {
    tenant_id: snapshot.tenantId,
    workspace_id: snapshot.workspaceId,
    app_id: snapshot.appId,
    source_type: snapshot.sourceType,
    source_id: snapshot.sourceId,
    provider: snapshot.provider,
    page_id: snapshot.pageId,
    range_key: snapshot.rangeKey,
    date_start: snapshot.dateStart,
    date_end: snapshot.dateEnd,
    timezone: snapshot.timezone,
    status: snapshot.status,
    metrics_json: snapshot.metrics,
    series_json: snapshot.series,
    posts_json: snapshot.posts,
    diagnostics_json: snapshot.diagnostics,
    provenance_json: snapshot.provenance,
    synced_at: snapshot.syncedAt ?? new Date().toISOString(),
  };
}

function toNativeSnapshot(row: SocialMetricSnapshotRow, source?: ChannelSourceRow | null): NativeFacebookChannelSnapshot {
  const diagnostics = jsonRecord(row.diagnostics_json);

  return {
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    appId: row.app_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    provider: row.provider,
    pageId: row.page_id,
    pageName: source?.page_name ?? null,
    rangeKey: normalizeFacebookRangeKey(row.range_key),
    dateStart: row.date_start ?? "",
    dateEnd: row.date_end ?? "",
    timezone: row.timezone ?? DEFAULT_TIMEZONE,
    status: row.status,
    metrics: arrayRecords(row.metrics_json) as unknown as CmoChannelMetric[],
    series: arrayRecords(row.series_json) as Array<{ id: string; points: Record<string, unknown>[] }>,
    posts: arrayRecords(row.posts_json) as unknown as CmoTopContentItem[],
    diagnostics: {
      availableMetrics: jsonStringArray(diagnostics.availableMetrics),
      missingMetrics: jsonStringArray(diagnostics.missingMetrics),
      warnings: jsonStringArray(diagnostics.warnings),
      notes: jsonStringArray(diagnostics.notes),
      sourceRows: numberValue(diagnostics.sourceRows) ?? 0,
      qualityStatus: row.status,
    },
    provenance: jsonRecord(row.provenance_json),
    syncedAt: row.synced_at ?? row.updated_at ?? row.created_at ?? null,
  };
}

export async function upsertNativeFacebookChannelSnapshot(snapshot: NativeFacebookChannelSnapshot): Promise<NativeFacebookChannelSnapshot> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workspace_social_metric_snapshots")
    .upsert(toSnapshotRow(snapshot), { onConflict: "tenant_id,workspace_id,app_id,source_type,source_id,range_key" })
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,page_id,range_key,date_start,date_end,timezone,status,metrics_json,series_json,posts_json,diagnostics_json,provenance_json,synced_at,created_at,updated_at")
    .single();

  if (error) {
    throw new Error(`facebook_channel_snapshot_upsert_failed:${error.message}`);
  }

  return toNativeSnapshot(data as SocialMetricSnapshotRow);
}

export async function getNativeFacebookChannelSnapshots(appId: string): Promise<NativeFacebookChannelSnapshot[]> {
  const entry = requireWorkspaceRegistryEntry(appId);
  const source = await getFacebookChannelSource(appId);
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workspace_social_metric_snapshots")
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,page_id,range_key,date_start,date_end,timezone,status,metrics_json,series_json,posts_json,diagnostics_json,provenance_json,synced_at,created_at,updated_at")
    .eq("tenant_id", entry.tenantId)
    .eq("workspace_id", entry.workspaceId)
    .eq("app_id", entry.appId)
    .eq("source_type", FACEBOOK_SOURCE_TYPE)
    .eq("source_id", FACEBOOK_SOURCE_ID)
    .order("synced_at", { ascending: false });

  if (error) {
    throw new Error(`facebook_channel_snapshot_lookup_failed:${error.message}`);
  }

  return (data ?? []).map((row) => toNativeSnapshot(row as SocialMetricSnapshotRow, source));
}

export async function getNativeFacebookChannelSnapshot(input: {
  appId: string;
  rangeKey: CmoChannelMetricDateRangePreset;
}): Promise<NativeFacebookChannelSnapshot | null> {
  const entry = requireWorkspaceRegistryEntry(input.appId);
  const source = await getFacebookChannelSource(input.appId);
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workspace_social_metric_snapshots")
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,page_id,range_key,date_start,date_end,timezone,status,metrics_json,series_json,posts_json,diagnostics_json,provenance_json,synced_at,created_at,updated_at")
    .eq("tenant_id", entry.tenantId)
    .eq("workspace_id", entry.workspaceId)
    .eq("app_id", entry.appId)
    .eq("source_type", FACEBOOK_SOURCE_TYPE)
    .eq("source_id", FACEBOOK_SOURCE_ID)
    .eq("range_key", input.rangeKey)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`facebook_channel_snapshot_lookup_failed:${error.message}`);
  }

  return data ? toNativeSnapshot(data as SocialMetricSnapshotRow, source) : null;
}

function isSnapshotStale(snapshot: NativeFacebookChannelSnapshot | null): boolean {
  if (!snapshot?.syncedAt) {
    return true;
  }

  const syncedAt = Date.parse(snapshot.syncedAt);

  return !Number.isFinite(syncedAt) || Date.now() - syncedAt > STALE_AFTER_MS;
}

export function nativeFacebookSnapshotToChannelMetrics(snapshot: NativeFacebookChannelSnapshot): CmoChannelMetricsSnapshot {
  return {
    schemaVersion: "cmo.channel-metrics.v1",
    workspaceId: snapshot.workspaceId,
    appId: snapshot.appId,
    sourceId: snapshot.sourceId,
    channel: "facebook",
    source: "facebook_native",
    sourceMeta: {
      provider: "meta/facebook",
      pageName: snapshot.pageName,
      nativeStatus: snapshot.status,
      syncedAt: snapshot.syncedAt,
    },
    dateRange: {
      preset: snapshot.rangeKey,
      startDate: snapshot.dateStart,
      endDate: snapshot.dateEnd,
      timezone: snapshot.timezone,
    },
    status: snapshot.status === "connected" ? "connected" : snapshot.status === "missing" || snapshot.status === "failed" ? "missing" : "partial",
    lastUpdatedAt: snapshot.syncedAt,
    metrics: snapshot.metrics,
    topPosts: snapshot.posts,
    diagnostics: {
      availableMetrics: snapshot.diagnostics.availableMetrics,
      missingMetrics: snapshot.diagnostics.missingMetrics,
      notes: snapshot.diagnostics.notes,
    },
  };
}

export async function readNativeFacebookChannelMetricsSnapshot(input: {
  appId: string;
  rangeKey: CmoChannelMetricDateRangePreset;
}): Promise<CmoChannelMetricsSnapshot | null> {
  const snapshot = await getNativeFacebookChannelSnapshot(input);

  if (!snapshot || snapshot.status === "missing" || snapshot.status === "failed" || !snapshot.metrics.length) {
    return null;
  }

  return nativeFacebookSnapshotToChannelMetrics(snapshot);
}

function syncMissingResponse(input: {
  status?: FacebookChannelSyncStatus;
  code: string;
  appId: string;
  rangeKey: CmoChannelMetricDateRangePreset;
  page?: FacebookChannelSource | null;
}) {
  return {
    schema_version: "product.facebook_channel_sync_result.v1" as const,
    status: input.status ?? "missing",
    app_id: input.appId,
    source: input.page,
    range_key: input.rangeKey,
    synced_groups: [],
    metric_count: 0,
    post_count: 0,
    freshness: { stale: true, synced_at: null },
    warnings: [input.code],
    safety: FACEBOOK_CHANNEL_SAFETY,
  };
}

export async function runNativeFacebookChannelSync(input: {
  appId: string;
  rangeKey?: string | null;
  mode?: FacebookChannelSyncMode;
  trigger?: string | null;
  dryRun?: boolean;
}) {
  const entry = requireWorkspaceRegistryEntry(input.appId);
  const rangeKey = normalizeFacebookRangeKey(input.rangeKey);
  const range = resolveFacebookChannelDateRange({ rangeKey });
  const mode = input.dryRun === true ? "cache_only" : input.mode ?? "refresh_if_stale";
  const source = await getFacebookChannelSource(entry.appId);
  const safeSource = source ? toSafeSource(source) : null;

  if (input.dryRun === true) {
    return {
      ...syncMissingResponse({
        status: safeSource ? "completed" : "missing",
        code: safeSource ? "dry_run_no_meta_call" : "facebook_page_source_missing",
        appId: entry.appId,
        rangeKey,
        page: safeSource,
      }),
      mode: "dryRun",
      plan: {
        would_call_meta: false,
        native_enabled: isCmoFacebookNativeEnabled(),
        has_page_mapping: Boolean(safeSource),
      },
    };
  }

  if (!safeSource || !source?.enabled) {
    return syncMissingResponse({ code: "facebook_page_source_missing", appId: entry.appId, rangeKey, page: safeSource });
  }

  const existing = await getNativeFacebookChannelSnapshot({ appId: entry.appId, rangeKey });

  if (mode === "cache_only") {
    return {
      ...syncMissingResponse({
        status: existing ? "completed" : "missing",
        code: existing ? "cache_only" : "snapshot_missing",
        appId: entry.appId,
        rangeKey,
        page: safeSource,
      }),
      synced_groups: existing ? ["page_summary", "top_posts", "followers"] : [],
      metric_count: existing?.metrics.length ?? 0,
      post_count: existing?.posts.length ?? 0,
      freshness: { stale: isSnapshotStale(existing), synced_at: existing?.syncedAt ?? null },
    };
  }

  if (!isCmoFacebookNativeEnabled()) {
    return syncMissingResponse({ code: "facebook_native_disabled", appId: entry.appId, rangeKey, page: safeSource });
  }

  if (mode === "refresh_if_stale" && existing && !isSnapshotStale(existing)) {
    return {
      ...syncMissingResponse({ status: "completed", code: "skipped_fresh_snapshot", appId: entry.appId, rangeKey, page: safeSource }),
      synced_groups: ["page_summary", "top_posts", "followers"],
      metric_count: existing.metrics.length,
      post_count: existing.posts.length,
      freshness: { stale: false, synced_at: existing.syncedAt },
    };
  }

  try {
    const pageAccessToken = await pageAccessTokenForSource(source);
    const [insightsResult, postsResult] = await Promise.allSettled([
      fetchPageInsights({ pageId: source.page_id, pageAccessToken, range }),
      fetchTopPosts({ pageId: source.page_id, pageAccessToken, range }),
    ]);
    const warnings = [
      ...(insightsResult.status === "rejected" ? ["page_insights_permission_missing"] : []),
      ...(postsResult.status === "rejected" ? ["top_posts_permission_missing"] : []),
    ];
    const snapshot = snapshotFromNativeData({
      entry,
      source,
      range,
      insights: insightsResult.status === "fulfilled" ? insightsResult.value : {},
      posts: postsResult.status === "fulfilled" ? postsResult.value : [],
      syncedAt: new Date().toISOString(),
      warnings,
    });
    const persisted = await upsertNativeFacebookChannelSnapshot(snapshot);
    const status: FacebookChannelSyncStatus = persisted.status === "connected" ? "completed" : persisted.status === "partial" ? "partial" : "missing";

    return {
      schema_version: "product.facebook_channel_sync_result.v1" as const,
      status,
      app_id: entry.appId,
      source: safeSource,
      page: { page_id: source.page_id, page_name: source.page_name },
      range_key: rangeKey,
      date_range: { startDate: range.startDate, endDate: range.endDate, start_date: range.startDate, end_date: range.endDate, timezone: range.timezone },
      synced_groups: ["page_summary", "top_posts", "followers"],
      metric_count: persisted.metrics.length,
      post_count: persisted.posts.length,
      freshness: { stale: false, synced_at: persisted.syncedAt },
      warnings: persisted.diagnostics.warnings,
      safety: FACEBOOK_CHANNEL_SAFETY,
    };
  } catch {
    return syncMissingResponse({ status: "failed", code: "permission_missing", appId: entry.appId, rangeKey, page: safeSource });
  }
}

function latestSnapshot(snapshots: NativeFacebookChannelSnapshot[]): NativeFacebookChannelSnapshot | null {
  return snapshots[0] ?? null;
}

export async function buildFacebookChannelSnapshotsResponse(appId: string) {
  const source = await getSafeFacebookChannelSource(appId);
  const snapshots = await getNativeFacebookChannelSnapshots(appId);

  return {
    schema_version: "product.facebook_channel_snapshots.v1" as const,
    status: snapshots.length ? "completed" : "missing",
    app_id: appId,
    source,
    snapshots: snapshots.map((snapshot) => ({
      page: { page_id: snapshot.pageId, page_name: snapshot.pageName },
      source_status: snapshot.status,
      synced_at: snapshot.syncedAt,
      syncedAt: snapshot.syncedAt,
      range_key: snapshot.rangeKey,
      date_range: { startDate: snapshot.dateStart, endDate: snapshot.dateEnd, start_date: snapshot.dateStart, end_date: snapshot.dateEnd, timezone: snapshot.timezone },
      metrics: snapshot.metrics,
      series: snapshot.series,
      posts: snapshot.posts,
      diagnostics: snapshot.diagnostics,
    })),
    warnings: snapshots.length ? ["link_clicks_unavailable", "ctr_unavailable"] : ["snapshot_missing"],
    safety: FACEBOOK_CHANNEL_SAFETY,
  };
}

export async function buildFacebookChannelReportPacks(appId: string, rangeKeyInput?: string | null) {
  const rangeKey = normalizeFacebookRangeKey(rangeKeyInput);
  const source = await getSafeFacebookChannelSource(appId);
  const snapshots = await getNativeFacebookChannelSnapshots(appId);
  const selected = snapshots.find((snapshot) => snapshot.rangeKey === rangeKey) ?? latestSnapshot(snapshots);
  const page = selected
    ? { page_id: selected.pageId, page_name: selected.pageName }
    : source ? { page_id: source.pageId, page_name: source.pageName } : null;
  const dateRange = selected ? {
    startDate: selected.dateStart,
    endDate: selected.dateEnd,
    start_date: selected.dateStart,
    end_date: selected.dateEnd,
    timezone: selected.timezone,
  } : null;
  const topPostsRows = selected?.posts ?? [];
  const followerMetrics = selected?.metrics.filter((metricItem) => metricItem.id === "facebook_follower_count" || metricItem.id === "facebook_follower_growth") ?? [];
  const followerPoints = selected?.series.map((series) => ({
    ...series,
    points: series.points.map((point) => ({
      date_start: point.date_start,
      date_end: point.date_end,
      followers: point.followers,
    })),
  })) ?? [];

  return {
    schema_version: "product.lens_facebook_channel_pack.v1" as const,
    status: selected ? "completed" : "missing",
    app_id: appId,
    page,
    source_status: selected?.status ?? source?.quality.status ?? "missing",
    synced_at: selected?.syncedAt ?? null,
    syncedAt: selected?.syncedAt ?? null,
    range_key: selected?.rangeKey ?? rangeKey,
    request_context: {
      rangeKey,
      range_key: rangeKey,
    },
    selected_range: selected ? {
      rangeKey: selected.rangeKey,
      range_key: selected.rangeKey,
    } : null,
    date_range: dateRange,
    packs: [
      {
        pack_key: "page_summary",
        status: selected?.status ?? "missing",
        synced_at: selected?.syncedAt ?? null,
        syncedAt: selected?.syncedAt ?? null,
        date_range: dateRange,
        metrics: selected?.metrics ?? [],
        series: selected?.series ?? [],
        tables: selected ? [{ id: "page_summary_rows", rows: selected.series.flatMap((series) => series.points) }] : [],
      },
      {
        pack_key: "top_posts",
        status: selected?.posts.length ? "connected" : "missing",
        synced_at: selected?.syncedAt ?? null,
        syncedAt: selected?.syncedAt ?? null,
        date_range: dateRange,
        metrics: [],
        series: [],
        tables: [{ id: "top_posts", rows: topPostsRows }],
        posts: topPostsRows,
      },
      {
        pack_key: "followers",
        status: selected?.metrics.some((metricItem) => metricItem.id === "facebook_follower_count" && metricItem.value !== null) ? "connected" : "missing",
        synced_at: selected?.syncedAt ?? null,
        syncedAt: selected?.syncedAt ?? null,
        date_range: dateRange,
        metrics: followerMetrics,
        series: followerPoints,
        tables: selected ? [{ id: "followers", rows: followerPoints.flatMap((series) => series.points) }] : [],
      },
    ],
    warnings: ["link_clicks_unavailable", "ctr_unavailable", ...(selected?.diagnostics.warnings ?? [])],
    safety: FACEBOOK_CHANNEL_SAFETY,
  };
}
