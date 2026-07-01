import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { CmoAdapterError } from "@/lib/cmo/errors";
import { createStudioInputImageHandoffs } from "@/lib/cmo/studio-asset-ingest";
import {
  estimateVideoCost,
  getVideoAgentModels,
  hermesVideoErrorDiagnostics,
  isHermesVideoAgentConfigured,
  type HermesVideoCostRequest,
} from "@/lib/cmo/studio/hermes-video-client";
import { mockStudioCostEstimate } from "@/lib/cmo/studio-job-service";
import {
  chooseStudioVideoMode,
  getStudioVideoModel,
  normalizeStudioAspectRatio,
  normalizeStudioBitrate,
  normalizeStudioResolution,
  providerResolutionValue,
  supportsStudioWorkflow,
  unsupportedStudioWorkflowInputStatus,
  validateStudioVideoSettings,
  type StudioVideoModel,
} from "@/lib/cmo/studio-model-catalog";
import { isRecord, readJsonObject, stringValue, studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";
import type { StudioAspectRatio, StudioBitrate, StudioResolution, StudioVideoWorkflow } from "@/lib/cmo/studio-model-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function modelIdFromBody(body: Record<string, unknown>): string | undefined {
  if (isRecord(body.model)) {
    return stringValue(body.model.providerModelId ?? body.model.provider_model_id ?? body.model.uiId ?? body.model.ui_id ?? body.model.product_model_id ?? body.model.id);
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

function workflowFromBody(body: Record<string, unknown>): StudioVideoWorkflow {
  return stringValue(body.workflow) === "image_to_video" ? "image_to_video" : "text_to_video";
}

function inputAssetIdsFromBody(body: Record<string, unknown>): string[] {
  const value = body.inputAssetIds ?? body.input_asset_ids;

  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function modelFromRecord(record: Record<string, unknown>): StudioVideoModel {
  const supportedResolutions = Array.isArray(record.supportedResolutions)
    ? record.supportedResolutions.map(normalizeStudioResolution).filter((item): item is StudioResolution => Boolean(item))
    : [];
  const supportedAspectRatios = Array.isArray(record.supportedAspectRatios)
    ? record.supportedAspectRatios.map(normalizeStudioAspectRatio).filter((item): item is StudioAspectRatio => Boolean(item))
    : [];
  const supportedBitrates = Array.isArray(record.supportedBitrates)
    ? record.supportedBitrates.map(normalizeStudioBitrate).filter((item): item is StudioBitrate => Boolean(item))
    : [];
  const supportedModes = Array.isArray(record.supportedModes)
    ? record.supportedModes.filter((item): item is "fast" | "std" => item === "fast" || item === "std")
    : [];
  const defaultResolution = normalizeStudioResolution(record.defaultResolution ?? record.default_resolution) ?? supportedResolutions[0] ?? "720p";
  const inputsRequired = record.inputsRequired ?? record.inputs_required;
  const inputsOptional = record.inputsOptional ?? record.inputs_optional;

  return {
    id: stringValue(record.id) ?? stringValue(record.uiId) ?? stringValue(record.providerModelId) ?? "video-model",
    uiId: stringValue(record.uiId) ?? stringValue(record.id),
    providerModelId: stringValue(record.providerModelId ?? record.provider_model_id),
    name: stringValue(record.name ?? record.label) ?? "Video model",
    providerLabel: stringValue(record.provider) ?? "Higgsfield",
    maxResolution: normalizeStudioResolution(record.maxResolution ?? record.max_resolution) ?? supportedResolutions.at(-1) ?? defaultResolution,
    supportedResolutions: supportedResolutions.length ? supportedResolutions : [defaultResolution],
    supportedAspectRatios,
    supportedBitrates,
    supportedModes,
    defaultDurationSeconds: numberValue(record.defaultDurationSeconds ?? record.default_duration_seconds),
    defaultAspectRatio: normalizeStudioAspectRatio(record.defaultAspectRatio ?? record.default_aspect_ratio) ?? undefined,
    defaultResolution,
    defaultBitrate: normalizeStudioBitrate(record.defaultBitrate ?? record.default_bitrate) ?? undefined,
    defaultMode: record.defaultMode === "fast" || record.defaultMode === "std" ? record.defaultMode : undefined,
    minDurationSeconds: numberValue(record.minDurationSeconds ?? record.min_duration_seconds) ?? 4,
    maxDurationSeconds: numberValue(record.maxDurationSeconds ?? record.max_duration_seconds) ?? 15,
    supportsAudio: record.supportsAudio === true || record.supports_audio === true,
    badges: [],
    realVideoSupported: record.realVideoSupported === true || record.real_video_supported === true,
    costSupported: record.costSupported !== false && record.cost_supported !== false,
    enablement: record.enablement === "safe_now" || record.enablement === "guarded" || record.enablement === "needs_smoke" || record.enablement === "disabled_until_upload" ? record.enablement : "unavailable",
    operations: Array.isArray(record.operations) ? record.operations.filter((item): item is string => typeof item === "string") : [],
    inputsRequired: Array.isArray(inputsRequired) ? inputsRequired.filter((item): item is string => typeof item === "string") : [],
    inputsOptional: Array.isArray(inputsOptional) ? inputsOptional.filter((item): item is string => typeof item === "string") : [],
    canGenerateTextToVideo: optionalBoolean(record.canGenerateTextToVideo ?? record.can_generate_text_to_video),
    canGenerateImageToVideo: optionalBoolean(record.canGenerateImageToVideo ?? record.can_generate_image_to_video),
    requiredInputStatus: typeof record.requiredInputStatus === "string" ? record.requiredInputStatus : typeof record.required_input_status === "string" ? record.required_input_status : null,
    unsupportedInputStatus: typeof record.unsupportedInputStatus === "string" ? record.unsupportedInputStatus : typeof record.unsupported_input_status === "string" ? record.unsupported_input_status : null,
    constraints: Array.isArray(record.constraints) ? record.constraints.filter((item): item is string => typeof item === "string") : [],
  };
}

function isCostFirstTextToVideoModel(model: StudioVideoModel | null | undefined): model is StudioVideoModel & { providerModelId: string } {
  return Boolean(model && supportsStudioWorkflow(model, "text_to_video"));
}

function isImageToVideoModel(model: StudioVideoModel | null | undefined, hasImage: boolean): model is StudioVideoModel & { providerModelId: string } {
  return Boolean(model && supportsStudioWorkflow(model, "image_to_video", { hasImageInput: hasImage }));
}

function validationModelForWorkflow(model: StudioVideoModel, workflow: StudioVideoWorkflow): StudioVideoModel {
  return workflow === "image_to_video" && model.enablement === "disabled_until_upload"
    ? { ...model, enablement: "guarded" }
    : model;
}

async function realCatalogModel(body: Record<string, unknown>): Promise<StudioVideoModel | null> {
  const selectedModelId = modelIdFromBody(body);
  const catalog = await getVideoAgentModels();
  const match = catalog.find((item) => {
    const provider = stringValue(item.providerModelId ?? item.provider_model_id);
    const uiId = stringValue(item.uiId ?? item.ui_id ?? item.id);

    return provider === selectedModelId || uiId === selectedModelId;
  });

  return match ? modelFromRecord(match) : null;
}

async function hermesCostRequest(body: Record<string, unknown>): Promise<HermesVideoCostRequest | null> {
  const model = process.env.CMO_STUDIO_REAL_VIDEO_ENABLED === "true"
    ? await realCatalogModel(body)
    : getStudioVideoModel(modelIdFromBody(body));
  const workflow = workflowFromBody(body);
  const inputAssetIds = inputAssetIdsFromBody(body);
  const hasImageInput = inputAssetIds.length > 0;

  if (workflow === "text_to_video" && !isCostFirstTextToVideoModel(model)) {
    return null;
  }

  if (workflow === "image_to_video" && !hasImageInput) {
    throw new CmoAdapterError("Upload an image to use this image-to-video model.", 400, "video_agent_input_required");
  }

  if (workflow === "image_to_video" && !isImageToVideoModel(model, hasImageInput)) {
    throw new CmoAdapterError(unsupportedStudioWorkflowInputStatus(model ?? getStudioVideoModel(modelIdFromBody(body)), "image_to_video") ?? "This model does not support image-to-video.", 400, "video_agent_model_unavailable");
  }

  if (!model?.providerModelId) {
    return null;
  }

  const settings = settingsFromBody(body);
  const settingsError = validateStudioVideoSettings({
    model: validationModelForWorkflow(model, workflow),
    durationSeconds: settings.durationSeconds,
    aspectRatio: settings.aspectRatio,
    resolution: settings.resolution,
    bitrate: settings.bitrate,
  });

  if (settingsError) {
    throw new CmoAdapterError(settingsError, 400, "video_agent_settings_unsupported");
  }

  const providerModelId = model.providerModelId;
  const mode = chooseStudioVideoMode(model, settings.resolution);
  const handoffImages = workflow === "image_to_video"
    ? await createStudioInputImageHandoffs({
      context: await requireRequestUserIfAuthRequired(),
      assetIds: inputAssetIds,
    })
    : [];

  return {
    request_id: stringValue(body.requestId ?? body.request_id) ?? undefined,
    prompt: stringValue(body.prompt),
    operation: "generate_video",
    workflow,
    backend: "higgsfield",
    model: {
      ui_id: providerModelId,
      provider_model_id: providerModelId,
    },
    settings: {
      duration_seconds: settings.durationSeconds,
      aspect_ratio: settings.aspectRatio,
      resolution: providerResolutionValue(settings.resolution),
      variants: settings.variants,
      ...(model.supportedBitrates?.length ? { bitrate: settings.bitrate } : {}),
      ...(mode ? { mode } : {}),
    },
    ...(workflow === "image_to_video" ? {
      inputs: {
        images: handoffImages,
        videos: [],
        audio: [],
      },
    } : {}),
    context: {
      source: "studio",
    },
  };
}

function highCostWarningThreshold(): number {
  const parsed = Number.parseFloat(process.env.CMO_STUDIO_HIGH_COST_WARNING_CREDITS ?? "");

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

function withHighCostWarning(estimate: Record<string, unknown>): Record<string, unknown> {
  const credits = numberValue(estimate.credits ?? estimate.estimatedCredits ?? estimate.estimated_credits);

  if (estimate.estimateAvailable === true && credits !== undefined && credits >= highCostWarningThreshold()) {
    return {
      ...estimate,
      warning: "High credit estimate. Review before generating.",
      highCostWarning: true,
    };
  }

  return estimate;
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
          mode: "hermes",
          reason: "Studio real provider pricing is only available for video generation through Higgsfield.",
          code: "video_agent_unsupported_request",
        });
      }

      if (!isHermesVideoAgentConfigured()) {
        return Response.json({
          estimateAvailable: false,
          mode: "hermes",
          reason: "Hermes Video Agent is not configured.",
          code: "video_agent_not_configured",
          diagnostics: {
            code: "video_agent_not_configured",
            target_path: "/agents/video/cost",
            hermes_dispatched: false,
          },
        });
      }

      let hermesRequest: HermesVideoCostRequest | null;

      try {
        hermesRequest = await hermesCostRequest(body);
      } catch (error) {
        if (error instanceof CmoAdapterError) {
          return Response.json({
            estimateAvailable: false,
            mode: "hermes",
            reason: error.message,
            code: error.code,
            diagnostics: hermesVideoErrorDiagnostics(error, {
              targetPath: "/agents/video/cost",
              hermesDispatched: false,
            }),
          });
        }

        throw error;
      }

      if (!hermesRequest) {
        return Response.json({
          estimateAvailable: false,
          mode: "hermes",
          reason: "Selected model is not available for real Studio video generation.",
          code: "video_agent_model_unavailable",
        });
      }

      try {
        return Response.json(withHighCostWarning(await estimateVideoCost(hermesRequest)));
      } catch (error) {
        if (error instanceof CmoAdapterError) {
          return Response.json({
            estimateAvailable: false,
            mode: "hermes",
            reason: error.message,
            code: error.code,
            diagnostics: hermesVideoErrorDiagnostics(error, {
              targetPath: "/agents/video/cost",
              hermesDispatched: true,
            }),
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
