import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";
import {
  getLatestProductMetricDefinitionSnapshots,
  normalizeProductMetricDefinitionTypes,
  type ProductMetricDefinitionRangeKey,
} from "@/lib/cmo/lens-metric-definitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rangeKeyFromRequest(request: Request): ProductMetricDefinitionRangeKey {
  const url = new URL(request.url);
  const value = url.searchParams.get("rangeKey")?.trim();

  return value === "yesterday" || value === "last_7_days" || value === "last_30_days" ? value : "this_week";
}

function definitionTypesFromRequest(request: Request): string[] {
  const url = new URL(request.url);
  const csv = url.searchParams.get("definitionTypes") ?? "";

  return csv.split(",").map((item) => item.trim()).filter(Boolean);
}

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Metric definition snapshots request failed";

  if (message.includes("Unknown workspace app scope")) {
    return Response.json({ error: "Unknown appId", code: "unknown_app_id" }, { status: 404 });
  }

  return Response.json(
    {
      error: "Metric definition snapshots request failed",
      code: "metric_definition_snapshots_request_failed",
    },
    { status: 500 },
  );
}

export async function GET(request: Request, context: { params: Promise<{ appId: string }> }) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  try {
    const { appId } = await context.params;

    return Response.json(await getLatestProductMetricDefinitionSnapshots({
      appId,
      rangeKey: rangeKeyFromRequest(request),
      definitionTypes: normalizeProductMetricDefinitionTypes(definitionTypesFromRequest(request)),
    }));
  } catch (error) {
    return routeErrorResponse(error);
  }
}
