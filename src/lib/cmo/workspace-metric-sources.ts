import "server-only";

interface WorkspaceMetricSourceRow {
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  source_type: "ga4";
  source_id: "ga4_native";
  auth_ref: string | null;
  config_json: unknown;
  enabled: boolean | null;
}

export interface WorkspaceGa4MetricSourceMapping {
  sourceType: "ga4";
  provider: "ga4_native";
  oauthAccountId: string | null;
  propertyId: string;
  propertyDisplayName?: string;
  accountId?: string;
  accountDisplayName?: string;
  timezone?: string | null;
  enabled: boolean;
}

export interface UpsertWorkspaceGa4MetricSourceInput {
  tenantId: string;
  workspaceId: string;
  appId: string;
  oauthAccountId: string;
  propertyId: string;
  propertyDisplayName?: string | null;
  accountId?: string | null;
  accountDisplayName?: string | null;
  timezone?: string | null;
}

async function getWorkspaceMetricSourcesClient() {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");

  return createSupabaseAdminClient();
}

function cleanOptionalString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function configRecord(value: unknown): Record<string, unknown> {
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

function configString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function toSafeWorkspaceGa4MetricSourceMapping(row: WorkspaceMetricSourceRow): WorkspaceGa4MetricSourceMapping {
  const config = configRecord(row.config_json);

  return {
    sourceType: "ga4",
    provider: "ga4_native",
    oauthAccountId: row.auth_ref,
    propertyId: configString(config, "propertyId") ?? "",
    propertyDisplayName: configString(config, "propertyDisplayName"),
    accountId: configString(config, "accountId"),
    accountDisplayName: configString(config, "accountDisplayName"),
    timezone: configString(config, "timezone") ?? null,
    enabled: row.enabled !== false,
  };
}

export async function getWorkspaceGa4MetricSourceMapping(input: {
  tenantId: string;
  workspaceId: string;
}): Promise<WorkspaceGa4MetricSourceMapping | null> {
  const supabase = await getWorkspaceMetricSourcesClient();
  const { data, error } = await supabase
    .from("workspace_metric_sources")
    .select("tenant_id,workspace_id,app_id,source_type,source_id,auth_ref,config_json,enabled")
    .eq("tenant_id", input.tenantId)
    .eq("workspace_id", input.workspaceId)
    .eq("source_type", "ga4")
    .eq("source_id", "ga4_native")
    .maybeSingle();

  if (error) {
    throw new Error(`Workspace metric source lookup failed: ${error.message}`);
  }

  return data ? toSafeWorkspaceGa4MetricSourceMapping(data as WorkspaceMetricSourceRow) : null;
}

export async function upsertWorkspaceGa4MetricSourceMapping(input: UpsertWorkspaceGa4MetricSourceInput): Promise<WorkspaceGa4MetricSourceMapping> {
  const supabase = await getWorkspaceMetricSourcesClient();
  const row = {
    tenant_id: input.tenantId,
    workspace_id: input.workspaceId,
    app_id: input.appId,
    source_type: "ga4",
    source_id: "ga4_native",
    auth_ref: input.oauthAccountId,
    config_json: {
      provider: "ga4_native",
      propertyId: input.propertyId.trim(),
      propertyDisplayName: cleanOptionalString(input.propertyDisplayName),
      accountId: cleanOptionalString(input.accountId),
      accountDisplayName: cleanOptionalString(input.accountDisplayName),
      timezone: cleanOptionalString(input.timezone),
    },
    enabled: true,
  };
  const { data, error } = await supabase
    .from("workspace_metric_sources")
    .upsert(row, {
      onConflict: "tenant_id,workspace_id,source_type,source_id",
    })
    .select("tenant_id,workspace_id,app_id,source_type,source_id,auth_ref,config_json,enabled")
    .single();

  if (error) {
    throw new Error(`Workspace metric source write failed: ${error.message}`);
  }

  return toSafeWorkspaceGa4MetricSourceMapping(data as WorkspaceMetricSourceRow);
}
