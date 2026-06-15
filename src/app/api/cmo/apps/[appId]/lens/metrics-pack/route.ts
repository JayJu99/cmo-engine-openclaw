import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { getLensMetricsPackForApp } from "@/lib/cmo/lens-metrics-pack";
import {
  isWorkspaceGa4MetricRangeKey,
  type WorkspaceGa4MetricRangeKey,
} from "@/lib/cmo/workspace-metric-snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rangeKeyFromRequest(request: Request): WorkspaceGa4MetricRangeKey {
  const url = new URL(request.url);
  const value = url.searchParams.get("rangeKey")?.trim() || "this_week";

  return isWorkspaceGa4MetricRangeKey(value) ? value : "this_week";
}

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Lens metrics pack request failed";

  if (message.includes("Unknown workspace app scope")) {
    return Response.json(
      {
        error: "Unknown appId",
        code: "unknown_app_id",
      },
      { status: 404 },
    );
  }

  return Response.json(
    {
      error: message.includes("Authentication required") ? "Authentication required." : "Lens metrics pack request failed",
      code: message.includes("Authentication required") ? "authentication_required" : "lens_metrics_pack_request_failed",
    },
    { status: message.includes("Authentication required") ? 401 : 500 },
  );
}

export async function GET(request: Request, context: RouteContext<"/api/cmo/apps/[appId]/lens/metrics-pack">) {
  try {
    await requireRequestUserIfAuthRequired();

    const { appId } = await context.params;
    const rangeKey = rangeKeyFromRequest(request);
    const pack = await getLensMetricsPackForApp({
      appId,
      rangeKey,
    });

    return Response.json(pack);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
