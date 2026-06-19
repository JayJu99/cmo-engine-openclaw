import { DUNE_BUSINESS_SAFETY, getNativeDuneBusinessSnapshots, snapshotsStatus } from "@/lib/cmo/dune-business-metrics";
import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeSnapshot(snapshot: Awaited<ReturnType<typeof getNativeDuneBusinessSnapshots>>[number]) {
  return {
    metric_group: snapshot.metricGroup,
    status: snapshot.status,
    syncedAt: snapshot.syncedAt,
    synced_at: snapshot.syncedAt,
    metrics: snapshot.metrics,
    series: snapshot.series,
    tables: snapshot.tables,
    date_range: {
      preset: snapshot.rangePreset,
      startDate: snapshot.dateStart,
      endDate: snapshot.dateEnd,
      start_date: snapshot.dateStart,
      end_date: snapshot.dateEnd,
      timezone: snapshot.timezone,
    },
    source: {
      type: snapshot.sourceType,
      sourceId: snapshot.sourceId,
      provider: snapshot.provider,
      queryId: snapshot.queryId,
      queryName: snapshot.queryName,
      syncedAt: snapshot.syncedAt,
      synced_at: snapshot.syncedAt,
    },
    diagnostics: snapshot.diagnostics,
  };
}

function missingResponse(appId: string, warning: string, status = 200): Response {
  return Response.json(
    {
      schema_version: "product.dune_business_snapshots.v1",
      status: "missing",
      app_id: appId,
      snapshots: [],
      warnings: [warning],
      safety: DUNE_BUSINESS_SAFETY,
    },
    { status },
  );
}

export async function GET(request: Request, context: RouteContext<"/api/internal/lens/apps/[appId]/business/dune/snapshots">) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  const { appId } = await context.params;

  try {
    const snapshots = await getNativeDuneBusinessSnapshots(appId);

    return Response.json({
      schema_version: "product.dune_business_snapshots.v1",
      status: snapshotsStatus(snapshots),
      app_id: appId,
      snapshots: snapshots.map(safeSnapshot),
      safety: DUNE_BUSINESS_SAFETY,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "native_dune_snapshots_unavailable";

    if (message.includes("Unknown workspace app scope")) {
      return missingResponse(appId, "unknown_app_id", 404);
    }

    return missingResponse(appId, "native_dune_snapshots_unavailable");
  }
}
