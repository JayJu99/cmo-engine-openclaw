import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import {
  getLatestWorkspaceGa4MetricSnapshot,
  isWorkspaceGa4MetricRangeKey,
  type WorkspaceGa4MetricRangeKey,
} from "@/lib/cmo/workspace-metric-snapshots";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rangeKeyFromRequest(request: Request): WorkspaceGa4MetricRangeKey {
  const url = new URL(request.url);
  const value = url.searchParams.get("rangeKey")?.trim() || "this_week";

  return isWorkspaceGa4MetricRangeKey(value) ? value : "this_week";
}

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "GA4 metric snapshot request failed";

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
      error: message.includes("Authentication required") ? "Authentication required." : "GA4 metric snapshot request failed",
      code: message.includes("Authentication required") ? "authentication_required" : "ga4_metric_snapshot_request_failed",
    },
    { status: message.includes("Authentication required") ? 401 : 500 },
  );
}

export async function GET(request: Request, context: RouteContext<"/api/cmo/apps/[appId]/metric-sources/ga4/snapshots">) {
  try {
    await requireRequestUserIfAuthRequired();

    const { appId } = await context.params;
    const entry = requireWorkspaceRegistryEntry(appId);
    const rangeKey = rangeKeyFromRequest(request);
    const snapshot = await getLatestWorkspaceGa4MetricSnapshot({
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      appId: entry.appId,
      rangeKey,
    });

    return Response.json({ data: snapshot });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
