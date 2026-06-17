import { timingSafeEqual } from "crypto";

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

  return value === "refresh_if_stale" ? "refresh_if_stale" : "cache_only";
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() || null;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function authorizeInternalRequest(request: Request): Response | null {
  const configuredKey = process.env.CMO_LENS_INTERNAL_API_KEY?.trim();

  if (!configuredKey) {
    return Response.json(
      {
        error: "CMO_LENS_INTERNAL_API_KEY is not configured.",
        code: "internal_api_key_not_configured",
      },
      { status: 503 },
    );
  }

  const token = bearerToken(request);

  if (!token || !constantTimeEquals(token, configuredKey)) {
    return Response.json(
      {
        error: "Unauthorized.",
        code: "unauthorized",
      },
      { status: 401 },
    );
  }

  return null;
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
  const authFailure = authorizeInternalRequest(request);

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
