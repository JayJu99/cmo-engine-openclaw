import "server-only";

import {
  productLensGa4ErrorCode,
  resolveProductLensGa4QueryRange,
  runProductLensGa4AdHocQuery,
  type ProductLensGa4QueryRangeKey,
} from "@/lib/cmo/lens-ga4-catalog";
import {
  getWorkspaceGa4MetricSourceMapping,
  type WorkspaceGa4MetricSourceMapping,
} from "@/lib/cmo/workspace-metric-sources";
import {
  requireWorkspaceRegistryEntry,
  workspaceRegistry,
  type WorkspaceRegistryEntry,
} from "@/lib/cmo/workspace-registry";

export type ProductMetricDefinitionType = "activation" | "retention";
export type ProductMetricDefinitionStatus =
  | "computed"
  | "definition_needed"
  | "configured_but_unavailable"
  | "not_matured"
  | "no_data"
  | "no_denominator"
  | "failed";
export type ProductMetricDefinitionRangeKey = Extract<
  ProductLensGa4QueryRangeKey,
  "yesterday" | "this_week" | "last_7_days" | "last_30_days"
>;
export type ProductMetricDefinitionComputeMode = "refresh_if_stale" | "refresh_all" | "dryRun";

export interface ActivationMetricDefinition {
  activation_events: string[];
  activation_logic: "any_event";
  denominator: "active_users" | "new_users" | "total_users";
  activation_window: "same_range";
}

export interface RetentionMetricDefinition {
  retention_return_events: string[];
  retention_days: number[];
  retention_method: "ga4_cohort" | "status_only";
}

export interface ProductMetricDefinitionRow {
  id?: string;
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  source_type: "ga4";
  source_id: "ga4_native";
  provider: "google_analytics";
  definition_type: ProductMetricDefinitionType;
  definition_json: unknown;
  enabled: boolean;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ProductMetricDefinitionSnapshotRow {
  id?: string;
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  source_type: "ga4";
  source_id: "ga4_native";
  provider: "google_analytics";
  property_id: string;
  property_display_name?: string | null;
  definition_type: ProductMetricDefinitionType;
  range_key: ProductMetricDefinitionRangeKey;
  date_start: string;
  date_end: string;
  timezone?: string | null;
  status: ProductMetricDefinitionStatus;
  metrics_json: unknown;
  definition_json: unknown;
  evidence_json: unknown;
  quality_json: unknown;
  generated_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ProductMetricDefinitionContract {
  definition_type: ProductMetricDefinitionType;
  enabled: boolean;
  definition: ActivationMetricDefinition | RetentionMetricDefinition;
  updated_at?: string | null;
}

export interface ProductMetricDefinitionSnapshotContract {
  definition_type: ProductMetricDefinitionType;
  range_key: ProductMetricDefinitionRangeKey;
  date_start: string;
  date_end: string;
  timezone: string | null;
  status: ProductMetricDefinitionStatus;
  metrics: Record<string, unknown>;
  definition: Record<string, unknown>;
  evidence: Record<string, unknown>;
  quality: Record<string, unknown>;
  generated_at: string | null;
}

interface ProductMetricDefinitionSafety {
  no_tokens_returned: true;
  raw_ga4_response_included: false;
  vault_write_performed: false;
  gbrain_used: false;
  hermes_called: false;
}

export interface ProductMetricDefinitionsResponse {
  schema_version: "product.metric_definitions.v1";
  status: "saved" | "completed" | "failed";
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  definitions: ProductMetricDefinitionContract[];
  safety: ProductMetricDefinitionSafety;
}

export interface ProductMetricDefinitionComputeResult {
  schema_version: "product.metric_definition_compute_result.v1";
  status: "completed" | "partial" | "failed";
  range_keys: ProductMetricDefinitionRangeKey[];
  definition_types: ProductMetricDefinitionType[];
  workspaces: Array<{
    tenant_id: string;
    workspace_id: string;
    app_id: string;
    ranges: Partial<Record<ProductMetricDefinitionRangeKey, Partial<Record<ProductMetricDefinitionType, Record<string, unknown>>>>>;
    errors: string[];
  }>;
  summary: {
    workspace_count: number;
    computed_count: number;
    failed_count: number;
    skipped_count: number;
  };
  safety: ProductMetricDefinitionSafety;
}

export interface ProductMetricDefinitionSnapshotsResponse {
  schema_version: "product.metric_definition_snapshots.v1";
  status: "completed" | "missing" | "partial";
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  range_key: ProductMetricDefinitionRangeKey;
  snapshots: ProductMetricDefinitionSnapshotContract[];
  safety: ProductMetricDefinitionSafety;
}

const DEFAULT_RANGE_KEYS: ProductMetricDefinitionRangeKey[] = ["this_week", "last_7_days", "last_30_days"];
const DEFAULT_DEFINITION_TYPES: ProductMetricDefinitionType[] = ["activation", "retention"];
const DEFAULT_TIMEZONE = "Asia/Saigon";
const SOURCE_TYPE = "ga4" as const;
const SOURCE_ID = "ga4_native" as const;
const PROVIDER = "google_analytics" as const;

function safety(): ProductMetricDefinitionSafety {
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

function safeRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const output = { ...value };

  delete output.rawGa4Response;
  delete output.rawGoogleResponse;

  return output;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isMissingDefinitionTableError(error: unknown): boolean {
  const text = error instanceof Error ? error.message.toLowerCase() : JSON.stringify(error).toLowerCase();

  return text.includes("workspace_metric_definitions")
    || text.includes("workspace_metric_definition_snapshots")
    || text.includes("relation")
    && text.includes("does not exist")
    || text.includes("could not find the table");
}

function isRangeKey(value: string): value is ProductMetricDefinitionRangeKey {
  return value === "yesterday" || value === "this_week" || value === "last_7_days" || value === "last_30_days";
}

function isDefinitionType(value: string): value is ProductMetricDefinitionType {
  return value === "activation" || value === "retention";
}

export function normalizeProductMetricDefinitionRangeKeys(value: unknown): ProductMetricDefinitionRangeKey[] {
  const requested = Array.isArray(value) ? value : [];
  const rangeKeys = requested.filter((item): item is ProductMetricDefinitionRangeKey => typeof item === "string" && isRangeKey(item));

  return Array.from(new Set(rangeKeys.length ? rangeKeys : DEFAULT_RANGE_KEYS));
}

export function normalizeProductMetricDefinitionTypes(value: unknown): ProductMetricDefinitionType[] {
  const requested = Array.isArray(value) ? value : [];
  const definitionTypes = requested.filter((item): item is ProductMetricDefinitionType => typeof item === "string" && isDefinitionType(item));

  return Array.from(new Set(definitionTypes.length ? definitionTypes : DEFAULT_DEFINITION_TYPES));
}

export function normalizeProductMetricDefinitionComputeMode(body: Record<string, unknown>): ProductMetricDefinitionComputeMode {
  if (body.dryRun === true) {
    return "dryRun";
  }

  const value = typeof body.mode === "string" ? body.mode.trim() : "";

  return value === "refresh_all" || value === "dryRun" ? value : "refresh_if_stale";
}

function normalizeActivationDefinition(value: unknown): ActivationMetricDefinition {
  const input = safeRecord(value);
  const denominator = input.denominator === "new_users" || input.denominator === "total_users"
    ? input.denominator
    : "active_users";

  return {
    activation_events: uniqueStrings(stringArray(input.activation_events)),
    activation_logic: "any_event",
    denominator,
    activation_window: "same_range",
  };
}

function normalizeRetentionDefinition(value: unknown): RetentionMetricDefinition {
  const input = safeRecord(value);
  const days = Array.isArray(input.retention_days)
    ? input.retention_days.map(numberOrNull).filter((item): item is number => item !== null && Number.isInteger(item) && item > 0 && item <= 90)
    : [];

  return {
    retention_return_events: uniqueStrings(stringArray(input.retention_return_events)),
    retention_days: Array.from(new Set(days.length ? days : [1, 7])),
    retention_method: input.retention_method === "status_only" ? "status_only" : "ga4_cohort",
  };
}

export function validateMetricDefinitionPayload(input: {
  definition_type: unknown;
  enabled?: unknown;
  definition?: unknown;
}): ProductMetricDefinitionContract {
  if (input.definition_type !== "activation" && input.definition_type !== "retention") {
    throw new Error("invalid_definition_type");
  }

  return {
    definition_type: input.definition_type,
    enabled: input.enabled !== false,
    definition: input.definition_type === "activation"
      ? normalizeActivationDefinition(input.definition)
      : normalizeRetentionDefinition(input.definition),
  };
}

function definitionContract(row: ProductMetricDefinitionRow): ProductMetricDefinitionContract {
  return {
    definition_type: row.definition_type,
    enabled: row.enabled !== false,
    definition: row.definition_type === "activation"
      ? normalizeActivationDefinition(row.definition_json)
      : normalizeRetentionDefinition(row.definition_json),
    updated_at: row.updated_at,
  };
}

function snapshotContract(row: ProductMetricDefinitionSnapshotRow): ProductMetricDefinitionSnapshotContract {
  return {
    definition_type: row.definition_type,
    range_key: row.range_key,
    date_start: row.date_start,
    date_end: row.date_end,
    timezone: row.timezone ?? null,
    status: row.status,
    metrics: safeRecord(row.metrics_json),
    definition: safeRecord(row.definition_json),
    evidence: safeRecord(row.evidence_json),
    quality: safeRecord(row.quality_json),
    generated_at: row.generated_at ?? null,
  };
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

async function listDefinitions(entry: WorkspaceRegistryEntry): Promise<ProductMetricDefinitionRow[]> {
  try {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from("workspace_metric_definitions")
      .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,definition_type,definition_json,enabled,created_by,updated_by,created_at,updated_at")
      .eq("tenant_id", entry.tenantId)
      .eq("workspace_id", entry.workspaceId)
      .eq("app_id", entry.appId)
      .eq("source_type", SOURCE_TYPE)
      .eq("source_id", SOURCE_ID);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as ProductMetricDefinitionRow[];
  } catch (error) {
    if (isMissingDefinitionTableError(error)) {
      return [];
    }

    throw error;
  }
}

async function getDefinition(entry: WorkspaceRegistryEntry, definitionType: ProductMetricDefinitionType): Promise<ProductMetricDefinitionContract | null> {
  const rows = await listDefinitions(entry);
  const row = rows.find((item) => item.definition_type === definitionType);

  return row ? definitionContract(row) : null;
}

export async function getProductMetricDefinitions(input: {
  appId: string;
}): Promise<ProductMetricDefinitionsResponse> {
  const entry = requireWorkspaceRegistryEntry(input.appId);
  const definitions = (await listDefinitions(entry)).map(definitionContract);

  return {
    schema_version: "product.metric_definitions.v1",
    status: "completed",
    tenant_id: entry.tenantId,
    workspace_id: entry.workspaceId,
    app_id: entry.appId,
    definitions,
    safety: safety(),
  };
}

export async function setProductMetricDefinitions(input: {
  appId: string;
  definitions: unknown;
  updatedBy?: string | null;
}): Promise<ProductMetricDefinitionsResponse> {
  const entry = requireWorkspaceRegistryEntry(input.appId);
  const requested = Array.isArray(input.definitions) ? input.definitions : [];
  const definitions = requested
    .filter(isRecord)
    .map((item) => validateMetricDefinitionPayload({
      definition_type: item.definition_type,
      enabled: item.enabled,
      definition: item.definition,
    }));

  if (definitions.length === 0) {
    throw new Error("definitions_required");
  }

  const supabase = await getSupabaseClient();
  const rows = definitions.map((definition) => ({
    tenant_id: entry.tenantId,
    workspace_id: entry.workspaceId,
    app_id: entry.appId,
    source_type: SOURCE_TYPE,
    source_id: SOURCE_ID,
    provider: PROVIDER,
    definition_type: definition.definition_type,
    definition_json: definition.definition as unknown as Record<string, unknown>,
    enabled: definition.enabled,
    updated_by: input.updatedBy ?? null,
  }));
  const { data, error } = await supabase
    .from("workspace_metric_definitions")
    .upsert(rows, {
      onConflict: "tenant_id,workspace_id,app_id,source_type,source_id,definition_type",
    })
    .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,definition_type,definition_json,enabled,created_by,updated_by,created_at,updated_at");

  if (error) {
    throw new Error(`Workspace metric definition write failed: ${error.message}`);
  }

  return {
    schema_version: "product.metric_definitions.v1",
    status: "saved",
    tenant_id: entry.tenantId,
    workspace_id: entry.workspaceId,
    app_id: entry.appId,
    definitions: ((data ?? []) as ProductMetricDefinitionRow[]).map(definitionContract),
    safety: safety(),
  };
}

function denominatorMetricName(denominator: ActivationMetricDefinition["denominator"]): "activeUsers" | "newUsers" | "totalUsers" {
  if (denominator === "new_users") {
    return "newUsers";
  }

  if (denominator === "total_users") {
    return "totalUsers";
  }

  return "activeUsers";
}

function denominatorOutputName(denominator: ActivationMetricDefinition["denominator"]): "active_users" | "new_users" | "total_users" {
  return denominator;
}

function activationEvidence(input: {
  activationEvents: string[];
  denominator: ActivationMetricDefinition["denominator"];
  rangeKey: ProductMetricDefinitionRangeKey;
  activationQueryResultId: string | null | undefined;
  denominatorQueryResultId: string | null | undefined;
}): Record<string, unknown> {
  return {
    activation_events: input.activationEvents,
    activation_query_dimension: "eventName",
    activation_query_result_id: input.activationQueryResultId,
    denominator_query_result_id: input.denominatorQueryResultId,
    ga4_query_summary: {
      activation: {
        metric: "activeUsers",
        dimension_filter: {
          field: "eventName",
          match_type: "in_list",
          values: input.activationEvents,
        },
        range_key: input.rangeKey,
      },
      denominator: {
        metric: denominatorMetricName(input.denominator),
        range_key: input.rangeKey,
      },
    },
  };
}

function denominatorValueFromQuery(input: {
  denominator: ActivationMetricDefinition["denominator"];
  totals: Record<string, number | null>;
  rows: Array<Record<string, string | number | null>>;
}): number | null {
  const metricName = denominatorMetricName(input.denominator);

  return numberOrNull(input.totals[metricName]) ?? numberOrNull(input.rows[0]?.[metricName]);
}

async function computeActivation(input: {
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping;
  definition: ActivationMetricDefinition;
  rangeKey: ProductMetricDefinitionRangeKey;
  dryRun: boolean;
}): Promise<{
  status: ProductMetricDefinitionStatus;
  range: ReturnType<typeof resolveProductLensGa4QueryRange>;
  metrics: Record<string, unknown>;
  evidence: Record<string, unknown>;
  quality: Record<string, unknown>;
}> {
  const range = resolveProductLensGa4QueryRange({
    rangeKey: input.rangeKey,
    timezone: input.mapping.timezone,
  });

  if (input.definition.activation_events.length === 0) {
    return {
      status: "definition_needed",
      range,
      metrics: {},
      evidence: { reason: "activation_events_empty" },
      quality: { confidence: "none", warnings: ["activation_events_empty"] },
    };
  }

  if (input.dryRun) {
    return {
      status: "configured_but_unavailable",
      range,
      metrics: {},
      evidence: { reason: "dry_run_no_ga4_call" },
      quality: { confidence: "none", warnings: ["dry_run_no_ga4_call"] },
    };
  }

  const activationQuery = await runProductLensGa4AdHocQuery({
    appId: input.entry.appId,
    body: {
      rangeKey: input.rangeKey,
      metrics: ["activeUsers"],
      dimensions: [],
      filters: [
        {
          type: "dimension",
          name: "eventName",
          values: input.definition.activation_events,
        },
      ],
      limit: 1,
      cacheTtlMinutes: 60,
      reason: "Workspace activation metric definition compute using eventName filter",
      refresh: true,
    },
  });
  const denominatorMetric = denominatorMetricName(input.definition.denominator);
  const denominatorQuery = await runProductLensGa4AdHocQuery({
    appId: input.entry.appId,
    body: {
      rangeKey: input.rangeKey,
      metrics: [denominatorMetric],
      dimensions: [],
      filters: [],
      limit: 1,
      cacheTtlMinutes: 60,
      reason: `Workspace activation denominator compute: ${input.definition.denominator}`,
      refresh: true,
    },
  });
  const activatedUsers = numberOrNull(activationQuery.totals.activeUsers) ?? numberOrNull(activationQuery.rows[0]?.activeUsers);
  const denominatorValue = denominatorValueFromQuery({
    denominator: input.definition.denominator,
    totals: denominatorQuery.totals,
    rows: denominatorQuery.rows,
  });
  const warnings: string[] = [];

  if (activationQuery.row_count === 0 || activatedUsers === null) {
    return {
      status: "no_data",
      range,
      metrics: {
        events: input.definition.activation_events,
        denominator: denominatorOutputName(input.definition.denominator),
        denominator_value: denominatorValue,
      },
      evidence: activationEvidence({
        activationEvents: input.definition.activation_events,
        denominator: input.definition.denominator,
        rangeKey: input.rangeKey,
        activationQueryResultId: activationQuery.source.query_result_id,
        denominatorQueryResultId: denominatorQuery.source.query_result_id,
      }),
      quality: { confidence: "low", warnings: ["no_matching_event_rows"] },
    };
  }

  if (!denominatorValue || denominatorValue <= 0) {
    return {
      status: "no_denominator",
      range,
      metrics: {
        activated_users: activatedUsers,
        denominator: denominatorOutputName(input.definition.denominator),
        denominator_value: denominatorValue,
        events: input.definition.activation_events,
      },
      evidence: activationEvidence({
        activationEvents: input.definition.activation_events,
        denominator: input.definition.denominator,
        rangeKey: input.rangeKey,
        activationQueryResultId: activationQuery.source.query_result_id,
        denominatorQueryResultId: denominatorQuery.source.query_result_id,
      }),
      quality: { confidence: "low", warnings: ["denominator_missing_or_zero"] },
    };
  }

  if (input.definition.denominator === "new_users" && activatedUsers > denominatorValue) {
    warnings.push("new_users_denominator_not_cohort_safe");
  }

  return {
    status: "computed",
    range,
    metrics: {
      activated_users: activatedUsers,
      denominator: denominatorOutputName(input.definition.denominator),
      denominator_value: denominatorValue,
      activation_rate: activatedUsers / denominatorValue,
      events: input.definition.activation_events,
    },
    evidence: activationEvidence({
      activationEvents: input.definition.activation_events,
      denominator: input.definition.denominator,
      rangeKey: input.rangeKey,
      activationQueryResultId: activationQuery.source.query_result_id,
      denominatorQueryResultId: denominatorQuery.source.query_result_id,
    }),
    quality: { confidence: "medium", warnings },
  };
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));

  return [
    String(next.getUTCFullYear()).padStart(4, "0"),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function todayInTimezone(timezone: string | null | undefined): string {
  const safeTimezone = timezone || DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return [value("year"), value("month"), value("day")].join("-");
}

function retentionMaturityStatus(input: {
  definition: RetentionMetricDefinition;
  range: ReturnType<typeof resolveProductLensGa4QueryRange>;
}): ProductMetricDefinitionStatus | null {
  const maxDay = Math.max(...input.definition.retention_days);
  const maturedDate = addDays(input.range.date_end, maxDay);
  const today = todayInTimezone(input.range.timezone);

  return maturedDate >= today ? "not_matured" : null;
}

async function computeRetention(input: {
  mapping: WorkspaceGa4MetricSourceMapping;
  definition: RetentionMetricDefinition;
  rangeKey: ProductMetricDefinitionRangeKey;
}): Promise<{
  status: ProductMetricDefinitionStatus;
  range: ReturnType<typeof resolveProductLensGa4QueryRange>;
  metrics: Record<string, unknown>;
  evidence: Record<string, unknown>;
  quality: Record<string, unknown>;
}> {
  const range = resolveProductLensGa4QueryRange({
    rangeKey: input.rangeKey,
    timezone: input.mapping.timezone,
  });

  if (input.definition.retention_return_events.length === 0) {
    return {
      status: "definition_needed",
      range,
      metrics: {},
      evidence: { reason: "retention_return_events_empty" },
      quality: { confidence: "none", warnings: ["retention_return_events_empty"] },
    };
  }

  const maturityStatus = retentionMaturityStatus({
    definition: input.definition,
    range,
  });

  if (maturityStatus) {
    return {
      status: maturityStatus,
      range,
      metrics: {
        retention_days: input.definition.retention_days,
      },
      evidence: {
        reason: "range_not_matured_for_requested_retention_days",
      },
      quality: { confidence: "none", warnings: ["range_not_matured_for_requested_retention_days"] },
    };
  }

  return {
    status: "configured_but_unavailable",
    range,
    metrics: {
      retention_days: input.definition.retention_days,
    },
    evidence: {
      reason: "cohort_query_not_implemented",
      required_ga4_fields: ["cohortActiveUsers", "cohortTotalUsers", "cohortNthDay"],
    },
    quality: { confidence: "none", warnings: ["cohort_query_not_implemented"] },
  };
}

async function upsertDefinitionSnapshot(input: {
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping;
  definitionType: ProductMetricDefinitionType;
  range: ReturnType<typeof resolveProductLensGa4QueryRange>;
  status: ProductMetricDefinitionStatus;
  metrics: Record<string, unknown>;
  definition: ActivationMetricDefinition | RetentionMetricDefinition | Record<string, never>;
  evidence: Record<string, unknown>;
  quality: Record<string, unknown>;
}): Promise<ProductMetricDefinitionSnapshotRow | null> {
  try {
    const supabase = await getSupabaseClient();
    const generatedAt = new Date().toISOString();
    const row = {
      tenant_id: input.entry.tenantId,
      workspace_id: input.entry.workspaceId,
      app_id: input.entry.appId,
      source_type: SOURCE_TYPE,
      source_id: SOURCE_ID,
      provider: PROVIDER,
      property_id: input.mapping.propertyId,
      property_display_name: input.mapping.propertyDisplayName ?? null,
      definition_type: input.definitionType,
      range_key: input.range.key,
      date_start: input.range.date_start,
      date_end: input.range.date_end,
      timezone: input.range.timezone,
      status: input.status,
      metrics_json: input.metrics,
      definition_json: input.definition as Record<string, unknown>,
      evidence_json: input.evidence,
      quality_json: input.quality,
      generated_at: generatedAt,
    };
    const { data, error } = await supabase
      .from("workspace_metric_definition_snapshots")
      .upsert(row, {
        onConflict: "tenant_id,workspace_id,app_id,source_type,source_id,definition_type,range_key,date_start,date_end",
      })
      .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,property_id,property_display_name,definition_type,range_key,date_start,date_end,timezone,status,metrics_json,definition_json,evidence_json,quality_json,generated_at,created_at,updated_at")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data as ProductMetricDefinitionSnapshotRow;
  } catch (error) {
    if (isMissingDefinitionTableError(error)) {
      return null;
    }

    throw error;
  }
}

function mappingReady(mapping: WorkspaceGa4MetricSourceMapping | null): mapping is WorkspaceGa4MetricSourceMapping {
  return Boolean(mapping?.enabled && mapping.oauthAccountId && mapping.propertyId && mapping.verificationStatus === "verified");
}

function errorCode(error: unknown): string {
  return productLensGa4ErrorCode(error);
}

async function computeWorkspace(input: {
  entry: WorkspaceRegistryEntry;
  rangeKeys: ProductMetricDefinitionRangeKey[];
  definitionTypes: ProductMetricDefinitionType[];
  mode: ProductMetricDefinitionComputeMode;
}): Promise<ProductMetricDefinitionComputeResult["workspaces"][number]> {
  const mapping = await getWorkspaceGa4MetricSourceMapping({
    tenantId: input.entry.tenantId,
    workspaceId: input.entry.workspaceId,
    appId: input.entry.appId,
  });
  const ranges: ProductMetricDefinitionComputeResult["workspaces"][number]["ranges"] = {};
  const errors: string[] = [];

  if (!mappingReady(mapping)) {
    for (const rangeKey of input.rangeKeys) {
      const range = resolveProductLensGa4QueryRange({ rangeKey, timezone: null });

      ranges[rangeKey] = Object.fromEntries(input.definitionTypes.map((definitionType) => [
        definitionType,
        {
          status: "failed",
          reason: "ga4_source_not_ready",
          date_start: range.date_start,
          date_end: range.date_end,
        },
      ]));
    }
    errors.push("ga4_source_not_ready");

    return {
      tenant_id: input.entry.tenantId,
      workspace_id: input.entry.workspaceId,
      app_id: input.entry.appId,
      ranges,
      errors,
    };
  }

  for (const rangeKey of input.rangeKeys) {
    ranges[rangeKey] = {};

    for (const definitionType of input.definitionTypes) {
      try {
        const definition = await getDefinition(input.entry, definitionType);
        const fallbackRange = resolveProductLensGa4QueryRange({ rangeKey, timezone: mapping.timezone });

        if (!definition?.enabled) {
          const payload = {
            status: "definition_needed",
            reason: "definition_missing_or_disabled",
            date_start: fallbackRange.date_start,
            date_end: fallbackRange.date_end,
          };

          ranges[rangeKey]![definitionType] = payload;

          if (input.mode !== "dryRun") {
            await upsertDefinitionSnapshot({
              entry: input.entry,
              mapping,
              definitionType,
              range: fallbackRange,
              status: "definition_needed",
              metrics: {},
              definition: {},
              evidence: { reason: "definition_missing_or_disabled" },
              quality: { confidence: "none", warnings: ["definition_missing_or_disabled"] },
            });
          }
          continue;
        }

        const computed = definitionType === "activation"
          ? await computeActivation({
              entry: input.entry,
              mapping,
              definition: definition.definition as ActivationMetricDefinition,
              rangeKey,
              dryRun: input.mode === "dryRun",
            })
          : await computeRetention({
              mapping,
              definition: definition.definition as RetentionMetricDefinition,
              rangeKey,
            });
        const row = input.mode === "dryRun"
          ? null
          : await upsertDefinitionSnapshot({
              entry: input.entry,
              mapping,
              definitionType,
              range: computed.range,
              status: computed.status,
              metrics: computed.metrics,
              definition: definition.definition,
              evidence: computed.evidence,
              quality: computed.quality,
            });
        const result = {
          status: computed.status,
          ...computed.metrics,
          reason: typeof computed.evidence.reason === "string" ? computed.evidence.reason : undefined,
          date_start: computed.range.date_start,
          date_end: computed.range.date_end,
          snapshot_id: row?.id,
          generated_at: row?.generated_at ?? null,
        };

        ranges[rangeKey]![definitionType] = result;

        if (computed.status === "failed") {
          errors.push(`${rangeKey}:${definitionType}:failed`);
        }
      } catch (error) {
        const code = errorCode(error);
        const range = resolveProductLensGa4QueryRange({ rangeKey, timezone: mapping.timezone });

        errors.push(`${rangeKey}:${definitionType}:${code}`);
        ranges[rangeKey]![definitionType] = {
          status: "failed",
          reason: code,
          date_start: range.date_start,
          date_end: range.date_end,
        };

        if (input.mode !== "dryRun") {
          await upsertDefinitionSnapshot({
            entry: input.entry,
            mapping,
            definitionType,
            range,
            status: "failed",
            metrics: {},
            definition: {},
            evidence: { reason: code },
            quality: { confidence: "none", warnings: [code] },
          });
        }
      }
    }
  }

  return {
    tenant_id: input.entry.tenantId,
    workspace_id: input.entry.workspaceId,
    app_id: input.entry.appId,
    ranges,
    errors,
  };
}

function computeStatus(workspaces: ProductMetricDefinitionComputeResult["workspaces"]): ProductMetricDefinitionComputeResult["status"] {
  const results = workspaces.flatMap((workspace) =>
    Object.values(workspace.ranges).flatMap((range) => Object.values(range)),
  );

  if (results.length === 0) {
    return "completed";
  }

  if (results.every((result) => result.status === "failed")) {
    return "failed";
  }

  return results.some((result) => result.status === "failed") ? "partial" : "completed";
}

export async function runProductMetricDefinitionCompute(input: {
  appIds?: string[];
  rangeKeys?: ProductMetricDefinitionRangeKey[];
  definitionTypes?: ProductMetricDefinitionType[];
  mode: ProductMetricDefinitionComputeMode;
  trigger: string;
  dryRun?: boolean;
}): Promise<ProductMetricDefinitionComputeResult> {
  const rangeKeys = input.rangeKeys?.length ? input.rangeKeys : DEFAULT_RANGE_KEYS;
  const definitionTypes = input.definitionTypes?.length ? input.definitionTypes : DEFAULT_DEFINITION_TYPES;
  const entries = requestedEntries(input.appIds);
  const workspaces: ProductMetricDefinitionComputeResult["workspaces"] = [];

  for (const entry of entries) {
    workspaces.push(await computeWorkspace({
      entry,
      rangeKeys,
      definitionTypes,
      mode: input.dryRun ? "dryRun" : input.mode,
    }));
  }

  const results = workspaces.flatMap((workspace) =>
    Object.values(workspace.ranges).flatMap((range) => Object.values(range)),
  );

  return {
    schema_version: "product.metric_definition_compute_result.v1",
    status: computeStatus(workspaces),
    range_keys: rangeKeys,
    definition_types: definitionTypes,
    workspaces,
    summary: {
      workspace_count: workspaces.length,
      computed_count: results.filter((result) => result.status === "computed").length,
      failed_count: results.filter((result) => result.status === "failed").length,
      skipped_count: results.filter((result) => result.status !== "computed" && result.status !== "failed").length,
    },
    safety: safety(),
  };
}

export async function getLatestProductMetricDefinitionSnapshots(input: {
  appId: string;
  rangeKey: ProductMetricDefinitionRangeKey;
  definitionTypes?: ProductMetricDefinitionType[];
}): Promise<ProductMetricDefinitionSnapshotsResponse> {
  const entry = requireWorkspaceRegistryEntry(input.appId);
  const definitionTypes = input.definitionTypes?.length ? input.definitionTypes : DEFAULT_DEFINITION_TYPES;

  try {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from("workspace_metric_definition_snapshots")
      .select("id,tenant_id,workspace_id,app_id,source_type,source_id,provider,property_id,property_display_name,definition_type,range_key,date_start,date_end,timezone,status,metrics_json,definition_json,evidence_json,quality_json,generated_at,created_at,updated_at")
      .eq("tenant_id", entry.tenantId)
      .eq("workspace_id", entry.workspaceId)
      .eq("app_id", entry.appId)
      .eq("source_type", SOURCE_TYPE)
      .eq("source_id", SOURCE_ID)
      .eq("range_key", input.rangeKey)
      .in("definition_type", definitionTypes)
      .order("generated_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error) {
      throw new Error(error.message);
    }

    const latest = new Map<ProductMetricDefinitionType, ProductMetricDefinitionSnapshotRow>();

    for (const row of (data ?? []) as ProductMetricDefinitionSnapshotRow[]) {
      if (!latest.has(row.definition_type)) {
        latest.set(row.definition_type, row);
      }
    }

    const snapshots = definitionTypes
      .map((definitionType) => latest.get(definitionType))
      .filter((row): row is ProductMetricDefinitionSnapshotRow => Boolean(row))
      .map(snapshotContract);

    return {
      schema_version: "product.metric_definition_snapshots.v1",
      status: snapshots.length === 0 ? "missing" : snapshots.length === definitionTypes.length ? "completed" : "partial",
      tenant_id: entry.tenantId,
      workspace_id: entry.workspaceId,
      app_id: entry.appId,
      range_key: input.rangeKey,
      snapshots,
      safety: safety(),
    };
  } catch (error) {
    if (!isMissingDefinitionTableError(error)) {
      throw error;
    }

    return {
      schema_version: "product.metric_definition_snapshots.v1",
      status: "missing",
      tenant_id: entry.tenantId,
      workspace_id: entry.workspaceId,
      app_id: entry.appId,
      range_key: input.rangeKey,
      snapshots: [],
      safety: safety(),
    };
  }
}
