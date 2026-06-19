import {
  DUNE_BUSINESS_QUERY_REGISTRY,
  DUNE_BUSINESS_SAFETY,
  getNativeDuneBusinessSnapshots,
  snapshotsStatus,
} from "@/lib/cmo/dune-business-metrics";
import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NativeDuneBusinessSnapshot = Awaited<ReturnType<typeof getNativeDuneBusinessSnapshots>>[number];

const EXPECTED_DUNE_BUSINESS_PACK_KEYS = Object.values(DUNE_BUSINESS_QUERY_REGISTRY).map((config) => config.metricGroup);

function selectedRangeFromRequest(request: Request) {
  const url = new URL(request.url);
  const rangeKey = url.searchParams.get("rangeKey")?.trim() || null;
  const mode = url.searchParams.get("mode")?.trim() || null;

  return rangeKey || mode
    ? {
      ...(rangeKey ? { rangeKey, range_key: rangeKey } : {}),
      ...(mode ? { mode } : {}),
      note: "Selection context only. Dune report packs include full native snapshot metrics, series, and tables.",
    }
    : null;
}

function orderedSnapshots(snapshots: NativeDuneBusinessSnapshot[]): NativeDuneBusinessSnapshot[] {
  const byGroup = new Map(snapshots.map((snapshot) => [snapshot.metricGroup, snapshot]));

  return EXPECTED_DUNE_BUSINESS_PACK_KEYS
    .map((packKey) => byGroup.get(packKey))
    .filter((snapshot): snapshot is NativeDuneBusinessSnapshot => Boolean(snapshot));
}

function packFromSnapshot(snapshot: NativeDuneBusinessSnapshot, selectedRange: ReturnType<typeof selectedRangeFromRequest>) {
  const dateRange = {
    preset: snapshot.rangePreset,
    dateStart: snapshot.dateStart,
    dateEnd: snapshot.dateEnd,
    startDate: snapshot.dateStart,
    endDate: snapshot.dateEnd,
    start_date: snapshot.dateStart,
    end_date: snapshot.dateEnd,
    timezone: snapshot.timezone,
  };

  return {
    pack_key: snapshot.metricGroup,
    status: snapshot.status,
    syncedAt: snapshot.syncedAt,
    synced_at: snapshot.syncedAt,
    ...(selectedRange ? { selected_range: selectedRange } : {}),
    source: {
      type: snapshot.sourceType,
      sourceId: snapshot.sourceId,
      provider: snapshot.provider,
      queryId: snapshot.queryId,
      queryName: snapshot.queryName,
      syncedAt: snapshot.syncedAt,
      synced_at: snapshot.syncedAt,
    },
    date_range: dateRange,
    range: dateRange,
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
    const selectedRange = selectedRangeFromRequest(request);
    const snapshots = await getNativeDuneBusinessSnapshots(appId);
    const packs = orderedSnapshots(snapshots).map((snapshot) => packFromSnapshot(snapshot, selectedRange));

    return Response.json({
      schema_version: "product.lens_dune_business_pack.v1",
      status: snapshotsStatus(snapshots),
      app_id: appId,
      ...(selectedRange ? { selected_range: selectedRange } : {}),
      packs,
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
