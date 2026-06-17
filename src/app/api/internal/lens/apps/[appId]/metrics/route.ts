import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";
import {
  getProductLensConnectorMetrics,
  type ProductLensConnectorMode,
} from "@/lib/cmo/lens-product-connector";
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

function modeFromRequest(request: Request): ProductLensConnectorMode {
  const url = new URL(request.url);
  const value = url.searchParams.get("mode")?.trim();

  return value === "refresh_if_missing" || value === "refresh_if_stale" ? value : "cache_only";
}

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Lens connector metrics request failed";

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
      error: "Lens connector metrics request failed",
      code: "lens_connector_metrics_request_failed",
    },
    { status: 500 },
  );
}

export async function GET(request: Request, context: RouteContext<"/api/internal/lens/apps/[appId]/metrics">) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  try {
    const { appId } = await context.params;
    const payload = await getProductLensConnectorMetrics({
      appId,
      rangeKey: rangeKeyFromRequest(request),
      mode: modeFromRequest(request),
    });

    return Response.json(payload);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
