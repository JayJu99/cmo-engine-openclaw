import { mockStudioCostEstimate } from "@/lib/cmo/studio-job-service";
import { readJsonObject, stringValue, studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";
import type { StudioResolution } from "@/lib/cmo/studio-model-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);

    if (process.env.CMO_STUDIO_MOCK_RUNNER_ENABLED === "false") {
      return Response.json({
        estimateAvailable: false,
        reason: "Studio real provider pricing is not configured.",
      });
    }

    const durationSeconds = body.durationSeconds ?? body.duration_seconds;

    return Response.json(mockStudioCostEstimate({
      modelId: stringValue(body.modelId ?? body.model_id),
      durationSeconds: typeof durationSeconds === "number"
        ? durationSeconds
        : undefined,
      resolution: stringValue(body.resolution) as StudioResolution | undefined,
    }));
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
