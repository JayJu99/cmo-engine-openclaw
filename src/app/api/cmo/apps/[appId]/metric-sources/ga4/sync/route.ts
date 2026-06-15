import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import {
  fetchLensGa4CoreMetrics,
  LensGa4DataError,
  resolveLensGa4DateRange,
} from "@/lib/cmo/lens-ga4-data";
import { LensGoogleAccessTokenError } from "@/lib/cmo/lens-google-oauth";
import { getWorkspaceGa4MetricSourceMapping } from "@/lib/cmo/workspace-metric-sources";
import {
  isWorkspaceGa4MetricRangeKey,
  upsertWorkspaceGa4MetricSnapshot,
  type WorkspaceGa4MetricRangeKey,
} from "@/lib/cmo/workspace-metric-snapshots";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseStatusForCode(code: string): number {
  if (code === "unknown_app_id" || code === "source_mapping_not_found") {
    return 404;
  }

  if (code === "source_not_verified") {
    return 409;
  }

  if (code === "source_auth_failed" || code === "authentication_required") {
    return 401;
  }

  if (code === "ga4_data_api_unavailable") {
    return 502;
  }

  return 500;
}

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "GA4 data sync failed";

  if (message.includes("Unknown workspace app scope")) {
    return Response.json(
      {
        error: "Unknown appId",
        code: "unknown_app_id",
      },
      { status: responseStatusForCode("unknown_app_id") },
    );
  }

  return Response.json(
    {
      error: message.includes("Authentication required") ? "Authentication required." : "GA4 data sync failed",
      code: message.includes("Authentication required") ? "authentication_required" : "ga4_data_sync_failed",
    },
    { status: responseStatusForCode(message.includes("Authentication required") ? "authentication_required" : "ga4_data_sync_failed") },
  );
}

function rangeKeyFromRequest(request: Request): WorkspaceGa4MetricRangeKey {
  const url = new URL(request.url);
  const value = url.searchParams.get("rangeKey")?.trim() || "this_week";

  return isWorkspaceGa4MetricRangeKey(value) ? value : "this_week";
}

export async function POST(request: Request, context: RouteContext<"/api/cmo/apps/[appId]/metric-sources/ga4/sync">) {
  try {
    await requireRequestUserIfAuthRequired();

    const { appId } = await context.params;
    const entry = requireWorkspaceRegistryEntry(appId);
    const rangeKey = rangeKeyFromRequest(request);
    const mapping = await getWorkspaceGa4MetricSourceMapping({
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      appId: entry.appId,
    });

    if (!mapping?.enabled || !mapping.propertyId || !mapping.oauthAccountId) {
      return Response.json(
        {
          error: "GA4 source mapping not found",
          code: "source_mapping_not_found",
        },
        { status: responseStatusForCode("source_mapping_not_found") },
      );
    }

    if (mapping.verificationStatus !== "verified") {
      return Response.json(
        {
          error: "GA4 source must be verified before sync",
          code: "source_not_verified",
        },
        { status: responseStatusForCode("source_not_verified") },
      );
    }

    try {
      const result = await fetchLensGa4CoreMetrics({
        tenantId: entry.tenantId,
        rangeKey,
        mapping,
      });
      const snapshot = await upsertWorkspaceGa4MetricSnapshot({
        tenantId: entry.tenantId,
        workspaceId: entry.workspaceId,
        appId: entry.appId,
        rangeKey,
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

      return Response.json({ data: snapshot });
    } catch (error) {
      const range = resolveLensGa4DateRange({
        rangeKey,
        timezone: mapping.timezone,
      });
      const code = error instanceof LensGoogleAccessTokenError
        ? "source_auth_failed"
        : error instanceof LensGa4DataError
          ? error.code
          : "ga4_data_api_failed";
      const snapshot = await upsertWorkspaceGa4MetricSnapshot({
        tenantId: entry.tenantId,
        workspaceId: entry.workspaceId,
        appId: entry.appId,
        rangeKey,
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
        lastError: code,
        syncedAt: new Date().toISOString(),
      });

      return Response.json(
        {
          error: code,
          code,
          data: snapshot,
        },
        { status: responseStatusForCode(code) },
      );
    }
  } catch (error) {
    return routeErrorResponse(error);
  }
}
