import "server-only";

import { CmoAdapterError } from "@/lib/cmo/errors";
import { uploadCompletedStudioVideoFromRemote } from "@/lib/cmo/studio-asset-ingest";
import {
  estimateVideoCost,
  executeVideoJob,
  hermesVideoErrorDiagnostics,
  isHermesVideoAgentConfigured,
  type HermesVideoExecuteRequest,
} from "@/lib/cmo/studio/hermes-video-client";
import {
  completeStudioJob,
  failStudioJob,
  markStudioJobRunning,
  type StudioJobRecord,
} from "@/lib/cmo/studio-job-service";
import {
  chooseStudioVideoMode,
  normalizeStudioAspectRatio,
  normalizeStudioBitrate,
  normalizeStudioResolution,
  providerResolutionValue,
  validateStudioVideoSettings,
  type StudioAspectRatio,
  type StudioBitrate,
  type StudioResolution,
  type StudioVideoModel,
} from "@/lib/cmo/studio-model-catalog";

export interface StudioDispatchResult {
  mode: "mock" | "hermes";
  hermesDispatched: boolean;
  nextAgentRoute: "/agents/video/execute";
  providerStatus?: string;
}

export function isStudioRealVideoEnabled(): boolean {
  return process.env.CMO_STUDIO_REAL_VIDEO_ENABLED === "true";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorPayload(error: unknown, hermesDispatched: boolean): Record<string, unknown> {
  return hermesVideoErrorDiagnostics(error, {
    targetPath: "/agents/video/execute",
    hermesDispatched,
  });
}

function safeUploadError(error: unknown): Record<string, unknown> {
  if (error instanceof CmoAdapterError) {
    return {
      code: error.code,
      message: error.message,
      http_status: error.status,
    };
  }

  return {
    code: "studio_artifact_upload_failed",
    message: error instanceof Error ? error.message : "Studio artifact upload failed.",
  };
}

function realVideoProviderModelId(job: StudioJobRecord): string {
  const providerModelId = stringValue(job.model_json.provider_model_id ?? job.model_json.providerModelId);

  if (providerModelId) {
    return providerModelId;
  }

  throw new CmoAdapterError("Selected model is not available for real Studio video generation.", 400, "video_agent_execution_failed");
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function configuredMaxCredits(): number {
  const parsed = Number.parseFloat(process.env.CMO_STUDIO_MAX_ESTIMATED_CREDITS ?? "");

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

function modelFromJob(job: StudioJobRecord, providerModelId: string): StudioVideoModel {
  const settingsSchema = job.model_json.settings_schema && typeof job.model_json.settings_schema === "object" && !Array.isArray(job.model_json.settings_schema)
    ? job.model_json.settings_schema as Record<string, unknown>
    : {};
  const duration = settingsSchema.duration && typeof settingsSchema.duration === "object" && !Array.isArray(settingsSchema.duration)
    ? settingsSchema.duration as Record<string, unknown>
    : {};
  const aspect = settingsSchema.aspect_ratio && typeof settingsSchema.aspect_ratio === "object" && !Array.isArray(settingsSchema.aspect_ratio)
    ? settingsSchema.aspect_ratio as Record<string, unknown>
    : {};
  const resolution = settingsSchema.resolution && typeof settingsSchema.resolution === "object" && !Array.isArray(settingsSchema.resolution)
    ? settingsSchema.resolution as Record<string, unknown>
    : {};
  const mode = settingsSchema.mode && typeof settingsSchema.mode === "object" && !Array.isArray(settingsSchema.mode)
    ? settingsSchema.mode as Record<string, unknown>
    : {};
  const bitrate = settingsSchema.bitrate_mode && typeof settingsSchema.bitrate_mode === "object" && !Array.isArray(settingsSchema.bitrate_mode)
    ? settingsSchema.bitrate_mode as Record<string, unknown>
    : {};
  const supportedResolutions = Array.isArray(resolution.values)
    ? resolution.values.map(normalizeStudioResolution).filter((item): item is StudioResolution => Boolean(item))
    : [job.settings_json.resolution];
  const supportedAspectRatios = Array.isArray(aspect.values)
    ? aspect.values.map(normalizeStudioAspectRatio).filter((item): item is StudioAspectRatio => Boolean(item))
    : [job.settings_json.aspectRatio];
  const supportedBitrates = Array.isArray(bitrate.values)
    ? bitrate.values.map(normalizeStudioBitrate).filter((item): item is StudioBitrate => Boolean(item))
    : [job.settings_json.bitrate];
  const supportedModes = Array.isArray(mode.values)
    ? mode.values.filter((item): item is "fast" | "std" => item === "fast" || item === "std")
    : ["fast" as const];

  return {
    id: stringValue(job.model_json.product_model_id) ?? providerModelId,
    uiId: stringValue(job.model_json.ui_id) ?? providerModelId,
    providerModelId,
    name: stringValue(job.model_json.name) ?? providerModelId,
    providerLabel: "Higgsfield",
    maxResolution: supportedResolutions.at(-1) ?? job.settings_json.resolution,
    supportedResolutions,
    supportedAspectRatios,
    supportedBitrates,
    supportedModes,
    defaultDurationSeconds: numberValue(duration.default),
    defaultAspectRatio: normalizeStudioAspectRatio(aspect.default) ?? undefined,
    defaultResolution: normalizeStudioResolution(resolution.default) ?? undefined,
    defaultBitrate: normalizeStudioBitrate(bitrate.default) ?? undefined,
    defaultMode: mode.default === "fast" || mode.default === "std" ? mode.default : undefined,
    minDurationSeconds: numberValue(duration.min) ?? job.settings_json.durationSeconds,
    maxDurationSeconds: numberValue(duration.max) ?? job.settings_json.durationSeconds,
    supportsAudio: job.model_json.supports_audio === true,
    badges: Array.isArray(job.model_json.badges) ? job.model_json.badges.filter((item): item is string => typeof item === "string") : [],
    realVideoSupported: true,
    costSupported: true,
    enablement: job.model_json.enablement === "safe_now" || job.model_json.enablement === "guarded" ? job.model_json.enablement : "unavailable",
    constraints: Array.isArray(job.model_json.constraints) ? job.model_json.constraints.filter((item): item is string => typeof item === "string") : [],
  };
}

async function assertFreshCostGuard(job: StudioJobRecord, providerModelId: string, model: StudioVideoModel) {
  const estimate = await estimateVideoCost({
    prompt: job.prompt,
    operation: "generate_video",
    backend: "higgsfield",
    model: {
      ui_id: providerModelId,
      provider_model_id: providerModelId,
    },
    settings: {
      duration_seconds: job.settings_json.durationSeconds,
      aspect_ratio: job.settings_json.aspectRatio,
      resolution: providerResolutionValue(job.settings_json.resolution),
      bitrate: job.settings_json.bitrate,
      variants: job.settings_json.variants ?? 1,
      ...(chooseStudioVideoMode(model, job.settings_json.resolution) ? { mode: chooseStudioVideoMode(model, job.settings_json.resolution) } : {}),
    },
    context: {
      source: "studio",
    },
  });
  const credits = numberValue(estimate.credits ?? estimate.estimatedCredits ?? estimate.estimated_credits);

  if (estimate.estimateAvailable !== true || credits === undefined) {
    throw new CmoAdapterError("Cost estimate must complete before real Studio video generation.", 400, "video_agent_cost_required");
  }

  if (credits > configuredMaxCredits()) {
    throw new CmoAdapterError("Estimated cost exceeds current safety limit.", 400, "video_agent_cost_limit_exceeded");
  }
}

export function buildHermesVideoExecuteRequest(job: StudioJobRecord): HermesVideoExecuteRequest {
  const providerModelId = realVideoProviderModelId(job);
  const model = modelFromJob(job, providerModelId);
  const settingsError = validateStudioVideoSettings({
    model,
    durationSeconds: job.settings_json.durationSeconds,
    aspectRatio: job.settings_json.aspectRatio,
    resolution: job.settings_json.resolution,
    bitrate: job.settings_json.bitrate,
  });

  if (job.operation !== "generate_video") {
    throw new CmoAdapterError("Only generate_video is supported for Studio Video v1.", 400, "video_agent_execution_failed");
  }

  if (settingsError) {
    throw new CmoAdapterError(settingsError, 400, "video_agent_settings_unsupported");
  }

  const mode = chooseStudioVideoMode(model, job.settings_json.resolution);

  return {
    schema_version: "video.generation.request.v1",
    request_id: job.request_id ?? job.id,
    job_id: job.id,
    prompt: job.prompt,
    operation: "generate_video",
    backend: "higgsfield",
    model: {
      ui_id: providerModelId,
      provider_model_id: providerModelId,
    },
    settings: {
      duration_seconds: job.settings_json.durationSeconds,
      aspect_ratio: job.settings_json.aspectRatio as StudioAspectRatio,
      resolution: providerResolutionValue(job.settings_json.resolution as StudioResolution),
      bitrate: job.settings_json.bitrate as StudioBitrate,
      variants: job.settings_json.variants ?? 1,
      ...(mode ? { mode } : {}),
    },
    context: {
      source: "studio",
      app_id: stringValue(job.context_json.app_id) ?? null,
      workspace_id: stringValue(job.context_json.workspace_id) ?? null,
      campaign_id: stringValue(job.context_json.campaign_id) ?? null,
      brand_id: stringValue(job.context_json.brand_id) ?? null,
    },
    inputs: {
      images: [],
      videos: [],
      audio: [],
    },
    cost: {
      include_estimate: true,
      require_estimate: false,
    },
    artifact_transport: {
      mode: "product_upload",
      upload_endpoint: null,
      headers: {},
    },
  };
}

export async function dispatchStudioJob(job: StudioJobRecord): Promise<StudioDispatchResult> {
  if (!isStudioRealVideoEnabled()) {
    return {
      mode: "mock",
      hermesDispatched: false,
      nextAgentRoute: "/agents/video/execute",
      providerStatus: "mock_runner_enabled",
    };
  }

  let runningJob = job;
  let hermesDispatched = false;

  try {
    runningJob = await markStudioJobRunning({
      job,
      providerStatus: isHermesVideoAgentConfigured() ? "dispatching_to_hermes" : "video_agent_not_configured",
      diagnostics: {
        runner: "hermes_video_agent",
        hermes_dispatched: false,
      },
    });

    if (!isHermesVideoAgentConfigured()) {
      throw new CmoAdapterError("Hermes Video Agent is not configured.", 503, "video_agent_not_configured");
    }

    hermesDispatched = true;
    const providerModelId = realVideoProviderModelId(runningJob);
    const model = modelFromJob(runningJob, providerModelId);

    await assertFreshCostGuard(runningJob, providerModelId, model);

    const executeResult = await executeVideoJob(buildHermesVideoExecuteRequest(runningJob));

    if (executeResult.status === "queued" || executeResult.status === "running") {
      return {
        mode: "hermes",
        hermesDispatched: true,
        nextAgentRoute: "/agents/video/execute",
        providerStatus: executeResult.provider_status,
      };
    }

    if (executeResult.status === "failed") {
      await failStudioJob({
        job: runningJob,
        providerJobId: executeResult.provider_job_id,
        providerStatus: executeResult.provider_status,
        error: executeResult.error ?? {
          code: "video_agent_execution_failed",
          message: "Hermes Video Agent returned a failed status.",
        },
        diagnostics: {
          runner: "hermes_video_agent",
          hermes_dispatched: true,
          artifact_transport_status: "not_uploaded",
          ...(executeResult.diagnostics ?? {}),
          hermes_response: executeResult.raw ?? {},
        },
      });

      return {
        mode: "hermes",
        hermesDispatched: true,
        nextAgentRoute: "/agents/video/execute",
        providerStatus: executeResult.provider_status,
      };
    }

    let uploadedAsset: Awaited<ReturnType<typeof uploadCompletedStudioVideoFromRemote>> | null = null;
    let uploadError: Record<string, unknown> | null = null;

    if (executeResult.render_url) {
      try {
        uploadedAsset = await uploadCompletedStudioVideoFromRemote({
          job: {
            id: runningJob.id,
            tenant_id: runningJob.tenant_id,
          },
          renderUrl: executeResult.render_url,
          thumbnailUrl: executeResult.thumbnail_url,
          providerJobId: executeResult.provider_job_id,
          durationSeconds: executeResult.duration_seconds ?? runningJob.settings_json.durationSeconds,
          aspectRatio: executeResult.aspect_ratio ?? runningJob.settings_json.aspectRatio,
          resolution: executeResult.resolution ?? runningJob.settings_json.resolution,
          metadata: {
            backend: executeResult.backend ?? "higgsfield",
            model: executeResult.model ?? runningJob.model_json.provider_model_id ?? null,
          },
        });
      } catch (error) {
        uploadError = safeUploadError(error);
      }
    }

    await completeStudioJob({
      job: runningJob,
      providerJobId: executeResult.provider_job_id,
      providerStatus: executeResult.provider_status,
      outputAssetIds: uploadedAsset ? Array.from(new Set([...runningJob.output_asset_ids, uploadedAsset.id])) : runningJob.output_asset_ids,
      cost: {
        ...(executeResult.estimated_credits !== undefined ? { credits: executeResult.estimated_credits, estimatedCredits: executeResult.estimated_credits, label: `~${executeResult.estimated_credits} credits` } : {}),
        ...(executeResult.backend ? { backend: executeResult.backend } : {}),
        ...(executeResult.model ? { model: executeResult.model } : {}),
        mode: "hermes",
      },
      diagnostics: {
        runner: "hermes_video_agent",
        hermes_dispatched: true,
        ...(executeResult.diagnostics ?? {}),
        artifact_transport_status: uploadedAsset ? "product_uploaded" : uploadError ? "upload_failed" : stringValue(executeResult.diagnostics?.artifact_transport_status) ?? "not_uploaded",
        ...(uploadedAsset ? {
          product_asset_id: uploadedAsset.id,
          product_asset_url: uploadedAsset.render_url ?? `/api/cmo/studio/assets/${encodeURIComponent(uploadedAsset.id)}/preview`,
          storage_key: uploadedAsset.storage_key,
          bytes: uploadedAsset.bytes,
          sha256: uploadedAsset.sha256,
        } : {}),
        ...(uploadError ? { upload_error: uploadError } : {}),
        ...(executeResult.render_url ? { render_url: executeResult.render_url } : {}),
        ...(executeResult.thumbnail_url ? { thumbnail_url: executeResult.thumbnail_url } : {}),
        ...(executeResult.render_url ? { provider_original_render_url: executeResult.render_url } : {}),
        ...(executeResult.thumbnail_url ? { provider_original_thumbnail_url: executeResult.thumbnail_url } : {}),
        remote_result: {
          render_url: executeResult.render_url,
          thumbnail_url: executeResult.thumbnail_url,
          duration_seconds: executeResult.duration_seconds ?? runningJob.settings_json.durationSeconds,
          aspect_ratio: executeResult.aspect_ratio ?? runningJob.settings_json.aspectRatio,
          resolution: executeResult.resolution ?? runningJob.settings_json.resolution,
        },
        hermes_response: executeResult.raw ?? {},
      },
    });

    return {
      mode: "hermes",
      hermesDispatched: true,
      nextAgentRoute: "/agents/video/execute",
      providerStatus: executeResult.provider_status,
    };
  } catch (error) {
    await failStudioJob({
      job: runningJob,
      providerStatus: error instanceof CmoAdapterError ? error.code : "video_agent_execution_failed",
      error: errorPayload(error, hermesDispatched),
      diagnostics: {
        runner: "hermes_video_agent",
        ...hermesVideoErrorDiagnostics(error, {
          targetPath: "/agents/video/execute",
          hermesDispatched,
        }),
      },
    }).catch(() => undefined);

    return {
      mode: "hermes",
      hermesDispatched,
      nextAgentRoute: "/agents/video/execute",
      providerStatus: error instanceof CmoAdapterError ? error.code : "video_agent_execution_failed",
    };
  };
}
