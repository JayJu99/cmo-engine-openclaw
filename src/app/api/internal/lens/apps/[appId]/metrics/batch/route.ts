import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";
import {
  getProductLensConnectorMetricsBatch,
  type ProductLensConnectorMode,
} from "@/lib/cmo/lens-product-connector";
import {
  isWorkspaceGa4MetricRangeKey,
  type WorkspaceGa4MetricRangeKey,
} from "@/lib/cmo/workspace-metric-snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RANGE_KEYS: WorkspaceGa4MetricRangeKey[] = ["this_week", "last_7_days", "last_30_days", "this_month"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modeFromBody(body: Record<string, unknown>): ProductLensConnectorMode {
  const value = typeof body.mode === "string" ? body.mode.trim() : "";

  return value === "refresh_if_missing" || value === "refresh_if_stale" ? value : "cache_only";
}

function rangeKeysFromBody(body: Record<string, unknown>): WorkspaceGa4MetricRangeKey[] {
  const requested = Array.isArray(body.rangeKeys) ? body.rangeKeys : [];
  const rangeKeys = requested
    .filter((value): value is WorkspaceGa4MetricRangeKey => typeof value === "string" && isWorkspaceGa4MetricRangeKey(value));

  return Array.from(new Set(rangeKeys.length ? rangeKeys : DEFAULT_RANGE_KEYS));
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json() as unknown;

    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Lens connector metrics batch request failed";

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
      error: "Lens connector metrics batch request failed",
      code: "lens_connector_metrics_batch_request_failed",
    },
    { status: 500 },
  );
}

export async function POST(request: Request, context: RouteContext<"/api/internal/lens/apps/[appId]/metrics/batch">) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  try {
    const { appId } = await context.params;
    const body = await requestBody(request);
    const payload = await getProductLensConnectorMetricsBatch({
      appId,
      rangeKeys: rangeKeysFromBody(body),
      mode: modeFromBody(body),
    });

    return Response.json(payload);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
