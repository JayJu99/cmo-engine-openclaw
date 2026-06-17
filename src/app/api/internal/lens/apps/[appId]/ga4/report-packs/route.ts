import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";
import {
  getProductLensGa4ReportPacks,
  normalizeProductLensDeepSyncPackKeys,
  normalizeProductLensDeepSyncRangeKeys,
} from "@/lib/cmo/lens-ga4-deep-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "GA4 report packs request failed";

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
      error: "GA4 report packs request failed",
      code: "ga4_report_packs_request_failed",
    },
    { status: 500 },
  );
}

function packKeysFromParams(searchParams: URLSearchParams) {
  const value = searchParams.get("packKeys");

  return value
    ? normalizeProductLensDeepSyncPackKeys(value.split(",").map((item) => item.trim()))
    : undefined;
}

export async function GET(request: Request, context: RouteContext<"/api/internal/lens/apps/[appId]/ga4/report-packs">) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  try {
    const { appId } = await context.params;
    const url = new URL(request.url);
    const [rangeKey] = normalizeProductLensDeepSyncRangeKeys([url.searchParams.get("rangeKey") ?? "yesterday"]);
    const payload = await getProductLensGa4ReportPacks({
      appId,
      rangeKey,
      packKeys: packKeysFromParams(url.searchParams),
      latest: url.searchParams.get("latest") !== "false",
    });

    return Response.json(payload);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
