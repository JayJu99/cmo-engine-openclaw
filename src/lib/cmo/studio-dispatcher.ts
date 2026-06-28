import "server-only";

import { CmoAdapterError } from "@/lib/cmo/errors";
import {
  executeVideoJob,
  isHermesVideoAgentConfigured,
  type HermesVideoExecuteRequest,
} from "@/lib/cmo/studio/hermes-video-client";
import {
  completeStudioJob,
  failStudioJob,
  markStudioJobRunning,
  type StudioJobRecord,
} from "@/lib/cmo/studio-job-service";
import type { StudioAspectRatio, StudioBitrate, StudioResolution } from "@/lib/cmo/studio-model-catalog";

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

function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof CmoAdapterError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      code: "video_agent_execution_failed",
      message: error.message,
    };
  }

  return {
    code: "video_agent_execution_failed",
    message: "Studio video dispatch failed.",
  };
}

function realVideoProviderModelId(job: StudioJobRecord): string {
  const providerModelId = stringValue(job.model_json.provider_model_id ?? job.model_json.providerModelId);

  if (providerModelId === "seedance_2_0") {
    return providerModelId;
  }

  throw new CmoAdapterError("Selected model is not available for real Studio video generation.", 400, "video_agent_execution_failed");
}

function hermesExecuteRequest(job: StudioJobRecord): HermesVideoExecuteRequest {
  const providerModelId = realVideoProviderModelId(job);

  if (job.operation !== "generate_video") {
    throw new CmoAdapterError("Only generate_video is supported for Studio Video v1.", 400, "video_agent_execution_failed");
  }

  return {
    job_id: job.id,
    prompt: job.prompt,
    operation: "generate_video",
    model: providerModelId,
    model_ui_id: stringValue(job.model_json.product_model_id) ?? providerModelId,
    provider_model_id: providerModelId,
    settings: {
      duration_seconds: job.settings_json.durationSeconds,
      aspect_ratio: job.settings_json.aspectRatio as StudioAspectRatio,
      resolution: job.settings_json.resolution as StudioResolution,
      bitrate: job.settings_json.bitrate as StudioBitrate,
      variants: job.settings_json.variants ?? 1,
    },
    context: {
      ...job.context_json,
      source: "studio",
      product_job_id: job.id,
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

    const executeResult = await executeVideoJob(hermesExecuteRequest(runningJob));

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

    await completeStudioJob({
      job: runningJob,
      providerJobId: executeResult.provider_job_id,
      providerStatus: executeResult.provider_status,
      cost: {
        ...(executeResult.estimated_credits !== undefined ? { credits: executeResult.estimated_credits, label: `~${executeResult.estimated_credits} credits` } : {}),
        mode: "hermes",
      },
      diagnostics: {
        runner: "hermes_video_agent",
        hermes_dispatched: true,
        artifact_transport_status: "not_uploaded",
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
      error: errorPayload(error),
      diagnostics: {
        runner: "hermes_video_agent",
        hermes_dispatched: false,
      },
    }).catch(() => undefined);

    return {
      mode: "hermes",
      hermesDispatched: false,
      nextAgentRoute: "/agents/video/execute",
      providerStatus: error instanceof CmoAdapterError ? error.code : "video_agent_execution_failed",
    };
  };
}
