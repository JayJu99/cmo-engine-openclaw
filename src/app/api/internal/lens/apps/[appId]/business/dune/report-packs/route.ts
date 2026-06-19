import { DUNE_BUSINESS_SAFETY, getNativeDuneBusinessSnapshots, snapshotsStatus } from "@/lib/cmo/dune-business-metrics";
import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function packFromSnapshot(snapshot: Awaited<ReturnType<typeof getNativeDuneBusinessSnapshots>>[number]) {
  return {
    pack_key: snapshot.metricGroup,
    source: {
      type: snapshot.sourceType,
      sourceId: snapshot.sourceId,
      provider: snapshot.provider,
      queryId: snapshot.queryId,
      queryName: snapshot.queryName,
      syncedAt: snapshot.syncedAt,
    },
    range: {
      preset: snapshot.rangePreset,
      dateStart: snapshot.dateStart,
      dateEnd: snapshot.dateEnd,
      timezone: snapshot.timezone,
    },
    metrics: snapshot.metrics,
    series: snapshot.series,
    tables: snapshot.tables,
    quality: {
      status: snapshot.status,
      warnings: snapshot.diagnostics.notes,
      sourceRows: snapshot.diagnostics.sourceRows,
    },
  };
}

function missingResponse(appId: string, warning: string, status = 200): Response {
  return Response.json(
    {
      schema_version: "product.lens_dune_business_pack.v1",
      status: "missing",
      app_id: appId,
      packs: [],
      warnings: [warning],
      safety: DUNE_BUSINESS_SAFETY,
    },
    { status },
  );
}

export async function GET(request: Request, context: RouteContext<"/api/internal/lens/apps/[appId]/business/dune/report-packs">) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  const { appId } = await context.params;

  try {
    const snapshots = await getNativeDuneBusinessSnapshots(appId);

    return Response.json({
      schema_version: "product.lens_dune_business_pack.v1",
      status: snapshotsStatus(snapshots),
      app_id: appId,
      packs: snapshots.map(packFromSnapshot),
      safety: DUNE_BUSINESS_SAFETY,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "native_dune_report_packs_unavailable";

    if (message.includes("Unknown workspace app scope")) {
      return missingResponse(appId, "unknown_app_id", 404);
    }

    return missingResponse(appId, "native_dune_report_packs_unavailable");
  }
}
