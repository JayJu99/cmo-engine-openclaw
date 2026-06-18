import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";
import {
  normalizeProductMetricDefinitionComputeMode,
  normalizeProductMetricDefinitionRangeKeys,
  normalizeProductMetricDefinitionTypes,
  runProductMetricDefinitionCompute,
} from "@/lib/cmo/lens-metric-definitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const message = error instanceof Error ? error.message : "Metric definition compute request failed";

  if (message.includes("Unknown workspace app scope")) {
    return Response.json({ error: "Unknown appId", code: "unknown_app_id" }, { status: 404 });
  }

  return Response.json(
    {
      error: "Metric definition compute request failed",
      code: "metric_definition_compute_request_failed",
    },
    { status: 500 },
  );
}

export async function POST(request: Request, context: { params: Promise<{ appId: string }> }) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  try {
    const { appId } = await context.params;
    const body = await requestBody(request);

    return Response.json(await runProductMetricDefinitionCompute({
      appIds: [appId],
      rangeKeys: normalizeProductMetricDefinitionRangeKeys(body.rangeKeys),
      definitionTypes: normalizeProductMetricDefinitionTypes(body.definitionTypes),
      mode: normalizeProductMetricDefinitionComputeMode(body),
      trigger: typeof body.trigger === "string" && body.trigger.trim() ? body.trigger.trim() : "manual",
      dryRun: body.dryRun === true,
    }));
  } catch (error) {
    return routeErrorResponse(error);
  }
}
