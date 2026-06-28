import { CmoAdapterError } from "@/lib/cmo/errors";
import {
  estimateVideoCost,
  isHermesVideoAgentConfigured,
  type HermesVideoCostRequest,
} from "@/lib/cmo/studio/hermes-video-client";
import { mockStudioCostEstimate } from "@/lib/cmo/studio-job-service";
import { getStudioVideoModel } from "@/lib/cmo/studio-model-catalog";
import { isRecord, readJsonObject, stringValue, studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";
import type { StudioAspectRatio, StudioBitrate, StudioResolution } from "@/lib/cmo/studio-model-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function modelIdFromBody(body: Record<string, unknown>): string | undefined {
  if (isRecord(body.model)) {
    return stringValue(body.model.uiId ?? body.model.ui_id ?? body.model.product_model_id ?? body.model.provider_model_id ?? body.model.id);
  }

  return stringValue(body.modelId ?? body.model_id);
}

function settingsFromBody(body: Record<string, unknown>) {
  const settings = isRecord(body.settings) ? body.settings : body;
  const durationSeconds = settings.durationSeconds ?? settings.duration_seconds;
  const variants = settings.variants;

  return {
    durationSeconds: typeof durationSeconds === "number" ? durationSeconds : 8,
    aspectRatio: (stringValue(settings.aspectRatio ?? settings.aspect_ratio) ?? "16:9") as StudioAspectRatio,
    resolution: (stringValue(settings.resolution) ?? "720p") as StudioResolution,
    bitrate: (stringValue(settings.bitrate) ?? "standard") as StudioBitrate,
    variants: typeof variants === "number" ? variants : 1,
  };
}

function hermesCostRequest(body: Record<string, unknown>): HermesVideoCostRequest | null {
  const model = getStudioVideoModel(modelIdFromBody(body));

  if (!model.realVideoSupported || !model.providerModelId) {
    return null;
  }

  const settings = settingsFromBody(body);

  return {
    operation: "generate_video",
    model: model.providerModelId,
    provider_model_id: model.providerModelId,
    settings: {
      duration_seconds: settings.durationSeconds,
      aspect_ratio: settings.aspectRatio,
      resolution: settings.resolution,
      bitrate: settings.bitrate,
      variants: settings.variants,
    },
    context: {
      source: "studio",
    },
  };
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const modelId = modelIdFromBody(body);
    const settings = settingsFromBody(body);
    const mediaKind = stringValue(body.mediaKind ?? body.media_kind) ?? "video";
    const backend = stringValue(body.backend) ?? "higgsfield";

    if (process.env.CMO_STUDIO_REAL_VIDEO_ENABLED === "true") {
      if (mediaKind !== "video" || backend !== "higgsfield") {
        return Response.json({
          estimateAvailable: false,
          reason: "Studio real provider pricing is only available for video generation through Higgsfield.",
          code: "video_agent_unsupported_request",
        });
      }

      if (!isHermesVideoAgentConfigured()) {
        return Response.json({
          estimateAvailable: false,
          reason: "Hermes Video Agent is not configured.",
          code: "video_agent_not_configured",
        });
      }

      const hermesRequest = hermesCostRequest(body);

      if (!hermesRequest) {
        return Response.json({
          estimateAvailable: false,
          reason: "Selected model is not available for real Studio video generation.",
          code: "video_agent_model_unavailable",
        });
      }

      try {
        return Response.json(await estimateVideoCost(hermesRequest));
      } catch (error) {
        if (error instanceof CmoAdapterError) {
          return Response.json({
            estimateAvailable: false,
            reason: error.message,
            code: error.code,
          });
        }

        throw error;
      }
    }

    if (process.env.CMO_STUDIO_MOCK_RUNNER_ENABLED === "false") {
      return Response.json({
        estimateAvailable: false,
        reason: "Studio real provider pricing is not configured.",
      });
    }

    return Response.json(mockStudioCostEstimate({
      modelId,
      durationSeconds: settings.durationSeconds,
      resolution: settings.resolution,
    }));
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
