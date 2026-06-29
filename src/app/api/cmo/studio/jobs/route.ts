import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { CmoAdapterError } from "@/lib/cmo/errors";
import { dispatchStudioJob } from "@/lib/cmo/studio-dispatcher";
import { createStudioVideoJob, listStudioJobs } from "@/lib/cmo/studio-job-service";
import { getVideoAgentModels } from "@/lib/cmo/studio/hermes-video-client";
import { isRecord, readJsonObject, stringValue, studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";
import {
  disabledReasonForEnablement,
  normalizeStudioAspectRatio,
  normalizeStudioBitrate,
  normalizeStudioResolution,
  validateStudioVideoSettings,
  type StudioAspectRatio,
  type StudioBitrate,
  type StudioResolution,
  type StudioVideoModel,
} from "@/lib/cmo/studio-model-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function limitFromRequest(request: Request): number {
  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

  return Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 20;
}

function settingsFromBody(body: Record<string, unknown>) {
  const settings = isRecord(body.settings) ? body.settings : body;
  const durationSeconds = settings.durationSeconds ?? settings.duration_seconds;
  const variants = settings.variants;

  return {
    aspectRatio: stringValue(settings.aspectRatio ?? settings.aspect_ratio) as StudioAspectRatio | undefined,
    durationSeconds: typeof durationSeconds === "number"
      ? durationSeconds
      : undefined,
    resolution: stringValue(settings.resolution) as StudioResolution | undefined,
    bitrate: stringValue(settings.bitrate) as StudioBitrate | undefined,
    variants: typeof variants === "number" ? variants : undefined,
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function configuredMaxCredits(): number {
  const parsed = Number.parseFloat(process.env.CMO_STUDIO_MAX_ESTIMATED_CREDITS ?? "");

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

function normalizedCostEstimate(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const cost = isRecord(body.costEstimate) ? body.costEstimate : isRecord(body.cost_json) ? body.cost_json : undefined;

  return cost;
}

function creditsFromEstimate(value: Record<string, unknown> | undefined): number | undefined {
  return value ? numberValue(value.credits ?? value.estimatedCredits ?? value.estimated_credits) : undefined;
}

function modelFromCatalogRecord(record: Record<string, unknown>): StudioVideoModel {
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
  const resolution = normalizeStudioResolution(record.defaultResolution) ?? supportedResolutions[0] ?? "720p";

  return {
    id: stringValue(record.id) ?? stringValue(record.uiId) ?? stringValue(record.providerModelId) ?? "video-model",
    uiId: stringValue(record.uiId) ?? stringValue(record.id),
    providerModelId: stringValue(record.providerModelId ?? record.provider_model_id),
    name: stringValue(record.name ?? record.label) ?? "Video model",
    providerLabel: stringValue(record.provider) ?? "Higgsfield",
    maxResolution: normalizeStudioResolution(record.maxResolution ?? record.max_resolution) ?? supportedResolutions.at(-1) ?? resolution,
    supportedResolutions: supportedResolutions.length ? supportedResolutions : [resolution],
    supportedAspectRatios,
    supportedBitrates,
    supportedModes,
    defaultDurationSeconds: numberValue(record.defaultDurationSeconds ?? record.default_duration_seconds),
    defaultAspectRatio: normalizeStudioAspectRatio(record.defaultAspectRatio ?? record.default_aspect_ratio) ?? undefined,
    defaultResolution: resolution,
    defaultBitrate: normalizeStudioBitrate(record.defaultBitrate ?? record.default_bitrate) ?? undefined,
    defaultMode: record.defaultMode === "fast" || record.defaultMode === "std" ? record.defaultMode : undefined,
    minDurationSeconds: numberValue(record.minDurationSeconds ?? record.min_duration_seconds) ?? 4,
    maxDurationSeconds: numberValue(record.maxDurationSeconds ?? record.max_duration_seconds) ?? 15,
    supportsAudio: record.supportsAudio === true || record.supports_audio === true,
    badges: Array.isArray(record.badges) ? record.badges.filter((item): item is string => typeof item === "string") : [],
    realVideoSupported: record.realVideoSupported === true || record.real_video_supported === true,
    costSupported: record.costSupported !== false && record.cost_supported !== false,
    workflowSupported: record.workflowSupported === true || record.workflow_supported === true,
    enablement: record.enablement === "safe_now" || record.enablement === "guarded" || record.enablement === "needs_smoke" || record.enablement === "disabled_until_upload" ? record.enablement : "unavailable",
    constraints: Array.isArray(record.constraints) ? record.constraints.filter((item): item is string => typeof item === "string") : [],
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((item): item is string => typeof item === "string") : [],
    catalogSource: stringValue(record.catalogSource),
    catalogMode: record.catalogMode === "hermes_v2" || record.catalogMode === "hermes_v1" ? record.catalogMode : "hermes_v1",
  };
}

async function validatedRealModel(body: Record<string, unknown>, settings: ReturnType<typeof settingsFromBody>): Promise<StudioVideoModel | undefined> {
  if (process.env.CMO_STUDIO_REAL_VIDEO_ENABLED !== "true") {
    return undefined;
  }

  const providerModelId = isRecord(body.model)
    ? stringValue(body.model.providerModelId ?? body.model.provider_model_id ?? body.model.uiId ?? body.model.ui_id)
    : modelIdFromBody(body);
  const catalog = await getVideoAgentModels();
  const match = catalog.find((item) => {
    const provider = stringValue(item.providerModelId ?? item.provider_model_id);
    const uiId = stringValue(item.uiId ?? item.ui_id ?? item.id);

    return provider === providerModelId || uiId === providerModelId;
  });

  if (!match) {
    throw new CmoAdapterError("Selected model is not available for real Studio video generation.", 400, "video_agent_model_unavailable");
  }

  const model = modelFromCatalogRecord(match);
  const enablementReason = disabledReasonForEnablement(model.enablement);

  if (enablementReason) {
    throw new CmoAdapterError(enablementReason, 400, "video_agent_model_unavailable");
  }

  const settingsError = validateStudioVideoSettings({
    model,
    durationSeconds: settings.durationSeconds ?? model.defaultDurationSeconds ?? model.minDurationSeconds,
    aspectRatio: settings.aspectRatio ?? model.defaultAspectRatio ?? "16:9",
    resolution: settings.resolution ?? model.defaultResolution ?? "720p",
    bitrate: settings.bitrate ?? model.defaultBitrate ?? "standard",
  });

  if (settingsError) {
    throw new CmoAdapterError(settingsError, 400, "video_agent_settings_unsupported");
  }

  const costEstimate = normalizedCostEstimate(body);
  const credits = creditsFromEstimate(costEstimate);

  if (!costEstimate || costEstimate.estimateAvailable !== true || credits === undefined) {
    throw new CmoAdapterError("Cost estimate must complete before real Studio video generation.", 400, "video_agent_cost_required");
  }

  if (credits > configuredMaxCredits()) {
    throw new CmoAdapterError("Estimated cost exceeds current safety limit.", 400, "video_agent_cost_limit_exceeded");
  }

  return model;
}

function inputAssetIdsFromBody(body: Record<string, unknown>): string[] {
  const inputAssetIds = body.inputAssetIds ?? body.input_asset_ids;

  return Array.isArray(inputAssetIds)
    ? inputAssetIds.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function modelIdFromBody(body: Record<string, unknown>): string | undefined {
  if (isRecord(body.model)) {
    return stringValue(body.model.uiId ?? body.model.ui_id ?? body.model.product_model_id ?? body.model.providerModelId ?? body.model.provider_model_id ?? body.model.id);
  }

  return stringValue(body.modelId ?? body.model_id);
}

export async function GET(request: Request) {
  try {
    const user = await requireRequestUserIfAuthRequired();

    return Response.json({ jobs: await listStudioJobs(user, limitFromRequest(request)) });
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireRequestUserIfAuthRequired();
    const body = await readJsonObject(request);
    const settings = settingsFromBody(body);
    const modelOverride = await validatedRealModel(body, settings);
    const result = await createStudioVideoJob(user, {
      prompt: stringValue(body.prompt) ?? "",
      negativePrompt: stringValue(body.negativePrompt ?? body.negative_prompt),
      modelId: modelIdFromBody(body),
      settings,
      context: isRecord(body.context) ? body.context : {},
      inputAssetIds: inputAssetIdsFromBody(body),
      costEstimate: normalizedCostEstimate(body),
      modelOverride,
      requestId: stringValue(body.requestId ?? body.request_id) ?? request.headers.get("idempotency-key") ?? undefined,
    });

    if (!result.idempotent) {
      void dispatchStudioJob(result.job).catch((error) => {
        console.warn("[studio] Video job dispatch failed.", {
          jobId: result.job.id,
          reason: error instanceof Error ? error.message : "unknown",
        });
      });
    }

    return Response.json({
      job_id: result.job.id,
      job: result.job,
      idempotent: result.idempotent,
    }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
