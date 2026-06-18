import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import {
  getProductMetricDefinitions,
  setProductMetricDefinitions,
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
  const message = error instanceof Error ? error.message : "Metric definitions request failed";

  if (message.includes("Unknown workspace app scope")) {
    return Response.json({ error: "Unknown appId", code: "unknown_app_id" }, { status: 404 });
  }

  if (message.includes("Authentication required")) {
    return Response.json({ error: "Authentication required.", code: "authentication_required" }, { status: 401 });
  }

  if (message === "definitions_required" || message === "invalid_definition_type") {
    return Response.json({ error: message, code: message }, { status: 400 });
  }

  return Response.json({ error: "Metric definitions request failed", code: "metric_definitions_request_failed" }, { status: 500 });
}

export async function GET(_request: Request, context: { params: Promise<{ appId: string }> }) {
  try {
    await requireRequestUserIfAuthRequired();

    const { appId } = await context.params;

    return Response.json(await getProductMetricDefinitions({ appId }));
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ appId: string }> }) {
  try {
    const user = await requireRequestUserIfAuthRequired();
    const { appId } = await context.params;
    const body = await requestBody(request);

    return Response.json(await setProductMetricDefinitions({
      appId,
      definitions: body.definitions,
      updatedBy: user.mode === "supabase" ? user.userId : user.mode,
    }));
  } catch (error) {
    return routeErrorResponse(error);
  }
}
