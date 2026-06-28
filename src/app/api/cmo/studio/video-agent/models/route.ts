import { CmoAdapterError } from "@/lib/cmo/errors";
import { getVideoAgentModels } from "@/lib/cmo/studio/hermes-video-client";
import { STUDIO_VIDEO_MODELS } from "@/lib/cmo/studio-model-catalog";
import { studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fallbackModels(reason: string) {
  return STUDIO_VIDEO_MODELS.map((model) => ({
    id: model.id,
    provider_model_id: model.providerModelId ?? null,
    name: model.name,
    available: false,
    productFallback: true,
    reason,
    max_resolution: model.maxResolution,
    min_duration_seconds: model.minDurationSeconds,
    max_duration_seconds: model.maxDurationSeconds,
    supports_audio: model.supportsAudio,
    real_video_supported: model.realVideoSupported === true,
  }));
}

export async function GET() {
  try {
    return Response.json({
      connected: true,
      source: "hermes_video_agent",
      models: await getVideoAgentModels(),
    });
  } catch (error) {
    if (error instanceof CmoAdapterError) {
      return Response.json({
        connected: false,
        source: "product_mock_catalog",
        reason: error.code,
        models: fallbackModels(error.code),
      });
    }

    return studioRouteErrorResponse(error);
  }
}
