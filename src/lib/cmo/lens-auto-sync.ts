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
  type WorkspaceGa4MetricRangeKey,
  type WorkspaceGa4MetricSnapshot,
} from "@/lib/cmo/workspace-metric-snapshots";
import {
  getWorkspaceGa4MetricSourceMapping,
  type WorkspaceGa4MetricSourceMapping,
} from "@/lib/cmo/workspace-metric-sources";
import {
  requireWorkspaceRegistryEntry,
  workspaceRegistry,
  type WorkspaceRegistryEntry,
} from "@/lib/cmo/workspace-registry";

export type ProductLensAutoSyncMode = "refresh_if_stale" | "refresh_all" | "dryRun";
export type ProductLensAutoSyncTrigger = "hourly" | "manual" | string;
export type ProductLensAutoSyncStatus = "completed" | "partial" | "failed";
export type ProductLensAutoSyncWorkspaceStatus = "synced" | "partial" | "failed" | "skipped";
export type ProductLensAutoSyncRangeStatus = "synced" | "failed" | "skipped";

export interface ProductLensAutoSyncRangeResult {
  status: ProductLensAutoSyncRangeStatus;
  snapshot_id?: string;
  synced_at?: string | null;
  date_start?: string;
  date_end?: string;
  reason?: string;
  would_sync?: boolean;
  error?: string;
}

export interface ProductLensAutoSyncWorkspaceResult {
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  source_type: "ga4";
  source_id: "ga4_native";
  status: ProductLensAutoSyncWorkspaceStatus;
  ranges: Partial<Record<WorkspaceGa4MetricRangeKey, ProductLensAutoSyncRangeResult>>;
  errors: string[];
}

export interface ProductLensAutoSyncResult {
  schema_version: "product.lens_auto_sync_result.v1";
  trigger: ProductLensAutoSyncTrigger;
  mode: ProductLensAutoSyncMode;
  status: ProductLensAutoSyncStatus;
  started_at: string;
  completed_at: string;
  range_keys: WorkspaceGa4MetricRangeKey[];
  workspaces: ProductLensAutoSyncWorkspaceResult[];
  summary: {
    workspace_count: number;
    range_count: number;
    synced_count: number;
    failed_count: number;
    skipped_count: number;
  };
  safety: {
    no_tokens_returned: true;
    raw_ga4_response_included: false;
    vault_write_performed: false;
    gbrain_used: false;
    hermes_called: false;
  };
}

function autoSyncStaleThresholdHours(rangeKey: WorkspaceGa4MetricRangeKey): number {
  return rangeKey === "last_30_days" || rangeKey === "this_month" ? 2 : 1;
}

function snapshotIsFresh(snapshot: WorkspaceGa4MetricSnapshot | null, rangeKey: WorkspaceGa4MetricRangeKey, nowIso: string): boolean {
  if (!snapshot?.syncedAt || snapshot.status !== "synced") {
    return false;
  }

  const syncedAt = Date.parse(snapshot.syncedAt);
  const now = Date.parse(nowIso);

  return Number.isFinite(syncedAt)
    && Number.isFinite(now)
    && now - syncedAt <= autoSyncStaleThresholdHours(rangeKey) * 60 * 60 * 1000;
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
  if (error instanceof LensGoogleAccessTokenError) {
    return "source_auth_failed";
  }

  if (error instanceof LensGa4DataError) {
    return error.code;
  }

  return error instanceof Error ? error.message : "ga4_auto_sync_failed";
}

function rangeFromSnapshotOrMapping(input: {
  snapshot: WorkspaceGa4MetricSnapshot | null;
  mapping: WorkspaceGa4MetricSourceMapping | null;
  rangeKey: WorkspaceGa4MetricRangeKey;
}): Pick<ProductLensAutoSyncRangeResult, "date_start" | "date_end"> {
  if (input.snapshot) {
    return {
      date_start: input.snapshot.dateStart,
      date_end: input.snapshot.dateEnd,
    };
  }

  const range = resolveLensGa4DateRange({
    rangeKey: input.rangeKey,
    timezone: input.mapping?.timezone,
  });

  return {
    date_start: range.dateStart,
    date_end: range.dateEnd,
  };
}

async function syncRange(input: {
  entry: WorkspaceRegistryEntry;
  mapping: WorkspaceGa4MetricSourceMapping;
  rangeKey: WorkspaceGa4MetricRangeKey;
}): Promise<ProductLensAutoSyncRangeResult> {
  try {
    const result = await fetchLensGa4CoreMetrics({
      tenantId: input.entry.tenantId,
      rangeKey: input.rangeKey,
      mapping: input.mapping,
    });
    const snapshot = await upsertWorkspaceGa4MetricSnapshot({
      tenantId: input.entry.tenantId,
      workspaceId: input.entry.workspaceId,
      appId: input.entry.appId,
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

    return {
      status: "synced",
      snapshot_id: snapshot.snapshotId,
      synced_at: snapshot.syncedAt,
      date_start: snapshot.dateStart,
      date_end: snapshot.dateEnd,
    };
  } catch (error) {
    const code = errorCode(error);
    const range = resolveLensGa4DateRange({
      rangeKey: input.rangeKey,
      timezone: input.mapping.timezone,
    });
    const snapshot = await upsertWorkspaceGa4MetricSnapshot({
      tenantId: input.entry.tenantId,
      workspaceId: input.entry.workspaceId,
      appId: input.entry.appId,
      rangeKey: input.rangeKey,
      dateStart: range.dateStart,
      dateEnd: range.dateEnd,
      timezone: range.timezone,
      status: "error",
      metrics: {},
      sourceMeta: {
        propertyId: input.mapping.propertyId,
        propertyDisplayName: input.mapping.propertyDisplayName,
        accountDisplayName: input.mapping.accountDisplayName,
      },
      lastError: code,
      syncedAt: new Date().toISOString(),
    });

    return {
      status: "failed",
      snapshot_id: snapshot.snapshotId,
      synced_at: snapshot.syncedAt,
      date_start: snapshot.dateStart,
      date_end: snapshot.dateEnd,
      error: code,
    };
  }
}

function workspaceStatus(ranges: Partial<Record<WorkspaceGa4MetricRangeKey, ProductLensAutoSyncRangeResult>>): ProductLensAutoSyncWorkspaceStatus {
  const values = Object.values(ranges);

  if (values.length === 0 || values.every((range) => range.status === "skipped")) {
    return "skipped";
  }

  if (values.every((range) => range.status === "failed")) {
    return "failed";
  }

  if (values.some((range) => range.status === "failed")) {
    return "partial";
  }

  return values.some((range) => range.status === "synced") ? "synced" : "skipped";
}

function jobStatus(workspaces: ProductLensAutoSyncWorkspaceResult[]): ProductLensAutoSyncStatus {
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

async function syncWorkspace(input: {
  entry: WorkspaceRegistryEntry;
  rangeKeys: WorkspaceGa4MetricRangeKey[];
  mode: ProductLensAutoSyncMode;
  includeUnmapped: boolean;
  nowIso: string;
}): Promise<ProductLensAutoSyncWorkspaceResult | null> {
  const mapping = await getWorkspaceGa4MetricSourceMapping({
    tenantId: input.entry.tenantId,
    workspaceId: input.entry.workspaceId,
    appId: input.entry.appId,
  });

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
      ranges: Object.fromEntries(input.rangeKeys.map((rangeKey) => [
        rangeKey,
        {
          status: "skipped",
          reason,
          would_sync: false,
          ...rangeFromSnapshotOrMapping({ snapshot: null, mapping, rangeKey }),
        },
      ])) as Partial<Record<WorkspaceGa4MetricRangeKey, ProductLensAutoSyncRangeResult>>,
      errors: [],
    };
  }

  const ranges: Partial<Record<WorkspaceGa4MetricRangeKey, ProductLensAutoSyncRangeResult>> = {};
  const errors: string[] = [];

  for (const rangeKey of input.rangeKeys) {
    try {
      const snapshot = await getLatestWorkspaceGa4MetricSnapshot({
        tenantId: input.entry.tenantId,
        workspaceId: input.entry.workspaceId,
        appId: input.entry.appId,
        rangeKey,
      });
      const fresh = snapshotIsFresh(snapshot, rangeKey, input.nowIso);
      const shouldSync = input.mode === "refresh_all" || (input.mode === "refresh_if_stale" && !fresh);

      if (input.mode === "dryRun") {
        ranges[rangeKey] = {
          status: "skipped",
          reason: fresh ? "fresh_snapshot" : "dry_run_would_sync",
          would_sync: !fresh,
          snapshot_id: snapshot?.snapshotId,
          synced_at: snapshot?.syncedAt,
          ...rangeFromSnapshotOrMapping({ snapshot, mapping, rangeKey }),
        };
      } else if (!shouldSync) {
        ranges[rangeKey] = {
          status: "skipped",
          reason: "fresh_snapshot",
          would_sync: false,
          snapshot_id: snapshot?.snapshotId,
          synced_at: snapshot?.syncedAt,
          ...rangeFromSnapshotOrMapping({ snapshot, mapping, rangeKey }),
        };
      } else {
        const result = await syncRange({
          entry: input.entry,
          mapping,
          rangeKey,
        });

        ranges[rangeKey] = result;

        if (result.status === "failed" && result.error) {
          errors.push(`${rangeKey}:${result.error}`);
        }
      }
    } catch (error) {
      const code = errorCode(error);

      ranges[rangeKey] = {
        status: "failed",
        error: code,
        ...rangeFromSnapshotOrMapping({ snapshot: null, mapping, rangeKey }),
      };
      errors.push(`${rangeKey}:${code}`);
    }
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

async function recordAutoSyncRun(result: ProductLensAutoSyncResult): Promise<void> {
  try {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createSupabaseAdminClient();
    const rows = result.workspaces.map((workspace) => ({
      tenant_id: workspace.tenant_id,
      workspace_id: workspace.workspace_id,
      app_id: workspace.app_id,
      source_type: workspace.source_type,
      source_id: workspace.source_id,
      trigger: result.trigger,
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
    // The sync run table is optional; lack of the migration must not break metrics sync.
  }
}

export async function runProductLensAutoSync(input: {
  appIds?: string[];
  rangeKeys: WorkspaceGa4MetricRangeKey[];
  mode: ProductLensAutoSyncMode;
  trigger: ProductLensAutoSyncTrigger;
  recordRun?: boolean;
}): Promise<ProductLensAutoSyncResult> {
  const startedAt = new Date().toISOString();
  const workspaces: ProductLensAutoSyncWorkspaceResult[] = [];
  const entries = requestedEntries(input.appIds);
  const includeUnmapped = Boolean(input.appIds?.length);

  for (const entry of entries) {
    try {
      const workspace = await syncWorkspace({
        entry,
        rangeKeys: input.rangeKeys,
        mode: input.mode,
        includeUnmapped,
        nowIso: startedAt,
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

  const ranges = workspaces.flatMap((workspace) => Object.values(workspace.ranges));
  const result: ProductLensAutoSyncResult = {
    schema_version: "product.lens_auto_sync_result.v1",
    trigger: input.trigger,
    mode: input.mode,
    status: jobStatus(workspaces),
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    range_keys: input.rangeKeys,
    workspaces,
    summary: {
      workspace_count: workspaces.length,
      range_count: input.rangeKeys.length,
      synced_count: ranges.filter((range) => range.status === "synced").length,
      failed_count: ranges.filter((range) => range.status === "failed").length,
      skipped_count: ranges.filter((range) => range.status === "skipped").length,
    },
    safety: {
      no_tokens_returned: true,
      raw_ga4_response_included: false,
      vault_write_performed: false,
      gbrain_used: false,
      hermes_called: false,
    },
  };

  if (input.recordRun !== false) {
    await recordAutoSyncRun(result);
  }

  return result;
}
