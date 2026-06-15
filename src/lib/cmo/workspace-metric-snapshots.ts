import "server-only";

export type WorkspaceMetricSnapshotStatus = "synced" | "error";
export type WorkspaceGa4MetricRangeKey = "this_week" | "last_7_days" | "last_30_days" | "this_month";

export interface WorkspaceGa4CoreMetrics {
  activeUsers?: number | null;
  newUsers?: number | null;
  totalUsers?: number | null;
  sessions?: number | null;
  engagedSessions?: number | null;
  engagementRate?: number | null;
  eventCount?: number | null;
  userEngagementDuration?: number | null;
}

interface WorkspaceMetricSnapshotRow {
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  source_type: "ga4";
  source_id: "ga4_native";
  range_key: WorkspaceGa4MetricRangeKey;
  date_start: string;
  date_end: string;
  timezone: string | null;
  metrics_json: unknown;
  source_meta_json: unknown;
  status: WorkspaceMetricSnapshotStatus;
  last_error: string | null;
  synced_at: string | null;
}

export interface WorkspaceGa4MetricSnapshot {
  sourceType: "ga4";
  sourceId: "ga4_native";
  rangeKey: WorkspaceGa4MetricRangeKey;
  dateStart: string;
  dateEnd: string;
  timezone: string | null;
  status: WorkspaceMetricSnapshotStatus;
  syncedAt: string | null;
  lastError?: string | null;
  metrics: WorkspaceGa4CoreMetrics;
  sourceMeta?: {
    propertyId?: string;
    propertyDisplayName?: string;
    accountDisplayName?: string;
    metricNames?: string[];
  };
}

export interface UpsertWorkspaceGa4MetricSnapshotInput {
  tenantId: string;
  workspaceId: string;
  appId: string;
  rangeKey: WorkspaceGa4MetricRangeKey;
  dateStart: string;
  dateEnd: string;
  timezone?: string | null;
  status: WorkspaceMetricSnapshotStatus;
  metrics: WorkspaceGa4CoreMetrics;
  sourceMeta?: WorkspaceGa4MetricSnapshot["sourceMeta"];
  lastError?: string | null;
  syncedAt?: string | null;
}

async function getWorkspaceMetricSnapshotsClient() {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");

  return createSupabaseAdminClient();
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;

      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanMetricNames(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : undefined;
}

function cleanMetrics(value: unknown): WorkspaceGa4CoreMetrics {
  const input = record(value);

  return {
    activeUsers: cleanNumber(input.activeUsers),
    newUsers: cleanNumber(input.newUsers),
    totalUsers: cleanNumber(input.totalUsers),
    sessions: cleanNumber(input.sessions),
    engagedSessions: cleanNumber(input.engagedSessions),
    engagementRate: cleanNumber(input.engagementRate),
    eventCount: cleanNumber(input.eventCount),
    userEngagementDuration: cleanNumber(input.userEngagementDuration),
  };
}

function cleanSourceMeta(value: unknown): WorkspaceGa4MetricSnapshot["sourceMeta"] {
  const input = record(value);

  return {
    propertyId: cleanOptionalString(input.propertyId),
    propertyDisplayName: cleanOptionalString(input.propertyDisplayName),
    accountDisplayName: cleanOptionalString(input.accountDisplayName),
    metricNames: cleanMetricNames(input.metricNames),
  };
}

function cleanJson(value: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...value };

  delete cleaned.access_token;
  delete cleaned.accessToken;
  delete cleaned.refresh_token;
  delete cleaned.refreshToken;
  delete cleaned.encrypted_refresh_token;
  delete cleaned.encryptedRefreshToken;
  delete cleaned.id_token;
  delete cleaned.idToken;
  delete cleaned.rawGoogleResponse;

  return cleaned;
}

export function toSafeWorkspaceGa4MetricSnapshot(row: WorkspaceMetricSnapshotRow): WorkspaceGa4MetricSnapshot {
  return {
    sourceType: "ga4",
    sourceId: "ga4_native",
    rangeKey: row.range_key,
    dateStart: row.date_start,
    dateEnd: row.date_end,
    timezone: row.timezone,
    status: row.status,
    syncedAt: row.synced_at,
    lastError: row.last_error,
    metrics: cleanMetrics(row.metrics_json),
    sourceMeta: cleanSourceMeta(row.source_meta_json),
  };
}

export function isWorkspaceGa4MetricRangeKey(value: string | null | undefined): value is WorkspaceGa4MetricRangeKey {
  return value === "this_week" || value === "last_7_days" || value === "last_30_days" || value === "this_month";
}

export async function upsertWorkspaceGa4MetricSnapshot(input: UpsertWorkspaceGa4MetricSnapshotInput): Promise<WorkspaceGa4MetricSnapshot> {
  const supabase = await getWorkspaceMetricSnapshotsClient();
  const row = {
    tenant_id: input.tenantId,
    workspace_id: input.workspaceId,
    app_id: input.appId,
    source_type: "ga4",
    source_id: "ga4_native",
    range_key: input.rangeKey,
    date_start: input.dateStart,
    date_end: input.dateEnd,
    timezone: input.timezone ?? null,
    metrics_json: cleanJson(input.metrics as Record<string, unknown>),
    source_meta_json: cleanJson((input.sourceMeta ?? {}) as Record<string, unknown>),
    status: input.status,
    last_error: input.lastError ?? null,
    synced_at: input.syncedAt ?? new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("workspace_metric_snapshots")
    .upsert(row, {
      onConflict: "tenant_id,workspace_id,app_id,source_type,source_id,range_key,date_start,date_end",
    })
    .select("tenant_id,workspace_id,app_id,source_type,source_id,range_key,date_start,date_end,timezone,metrics_json,source_meta_json,status,last_error,synced_at")
    .single();

  if (error) {
    throw new Error(`Workspace metric snapshot write failed: ${error.message}`);
  }

  return toSafeWorkspaceGa4MetricSnapshot(data as WorkspaceMetricSnapshotRow);
}

export async function getLatestWorkspaceGa4MetricSnapshot(input: {
  tenantId: string;
  workspaceId: string;
  appId: string;
  rangeKey: WorkspaceGa4MetricRangeKey;
}): Promise<WorkspaceGa4MetricSnapshot | null> {
  const supabase = await getWorkspaceMetricSnapshotsClient();
  const { data, error } = await supabase
    .from("workspace_metric_snapshots")
    .select("tenant_id,workspace_id,app_id,source_type,source_id,range_key,date_start,date_end,timezone,metrics_json,source_meta_json,status,last_error,synced_at")
    .eq("tenant_id", input.tenantId)
    .eq("workspace_id", input.workspaceId)
    .eq("app_id", input.appId)
    .eq("source_type", "ga4")
    .eq("source_id", "ga4_native")
    .eq("range_key", input.rangeKey)
    .order("synced_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Workspace metric snapshot lookup failed: ${error.message}`);
  }

  return data ? toSafeWorkspaceGa4MetricSnapshot(data as WorkspaceMetricSnapshotRow) : null;
}
