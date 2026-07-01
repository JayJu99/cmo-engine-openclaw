import "server-only";

import { randomUUID } from "crypto";

import { CmoAdapterError } from "@/lib/cmo/errors";
import type { CmoRequestUserContext } from "@/lib/cmo/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  STUDIO_VIDEO_MODELS,
  clampStudioDuration,
  getStudioVideoModel,
  isStudioResolutionSupported,
  type StudioAgent,
  type StudioAspectRatio,
  type StudioBackend,
  type StudioBitrate,
  type StudioMediaKind,
  type StudioOperation,
  type StudioResolution,
  type StudioVideoWorkflow,
  type StudioVideoModel,
} from "@/lib/cmo/studio-model-catalog";

export type StudioJobStatus = "draft" | "queued" | "running" | "completed" | "failed" | "cancelled";

export interface StudioJobRecord {
  id: string;
  tenant_id: string;
  created_by: string | null;
  status: StudioJobStatus;
  media_kind: StudioMediaKind;
  agent: StudioAgent;
  backend: StudioBackend;
  operation: StudioOperation;
  context_json: Record<string, unknown>;
  prompt: string;
  negative_prompt: string | null;
  model_json: Record<string, unknown>;
  settings_json: StudioJobSettings;
  input_asset_ids: string[];
  output_asset_ids: string[];
  cost_json: Record<string, unknown>;
  provider_job_id: string | null;
  provider_status: string | null;
  error_json: Record<string, unknown> | null;
  diagnostics_json: Record<string, unknown>;
  request_id: string | null;
  dispatch_attempts: number;
  dispatch_started_at: string | null;
  locked_until: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface StudioJobSettings {
  aspectRatio: StudioAspectRatio;
  durationSeconds: number;
  resolution: StudioResolution;
  bitrate: StudioBitrate;
  variants: number;
  workflow?: StudioVideoWorkflow;
}

export interface StudioCreateJobInput {
  prompt: string;
  negativePrompt?: string;
  modelId?: string;
  settings?: Partial<StudioJobSettings>;
  context?: Record<string, unknown>;
  workflow?: StudioVideoWorkflow;
  inputAssetIds?: string[];
  costEstimate?: Record<string, unknown>;
  modelOverride?: StudioVideoModel;
  requestId?: string;
}

const VALID_STATUS_TRANSITIONS: Record<StudioJobStatus, StudioJobStatus[]> = {
  draft: ["queued"],
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["queued"],
  cancelled: [],
};

const DEFAULT_SETTINGS: StudioJobSettings = {
  aspectRatio: "16:9",
  durationSeconds: 8,
  resolution: "720p",
  bitrate: "standard",
  variants: 1,
};

const MOCK_RUNNING_AFTER_MS = 1200;
const MOCK_COMPLETED_AFTER_MS = 4200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function studioActor(context: CmoRequestUserContext): { tenantId: string; createdBy: string | null } {
  if (context.mode === "supabase") {
    return {
      tenantId: context.userId,
      createdBy: context.userId,
    };
  }

  return {
    tenantId: "legacy_admin",
    createdBy: context.mode,
  };
}

function normalizePrompt(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRequestId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeHermesCostEstimate(value: unknown, providerModelId: string | null | undefined): Record<string, unknown> | null {
  if (!isRecord(value) || value.mode !== "hermes") {
    return null;
  }

  const credits = numberValue(value.credits ?? value.estimatedCredits ?? value.estimated_credits);
  const estimateAvailable = value.estimateAvailable === true || value.estimate_available === true || credits !== undefined;

  if (!estimateAvailable || credits === undefined) {
    return {
      mode: "hermes",
      estimateAvailable: false,
      reason: stringValue(value.reason) ?? "Hermes cost estimate unavailable.",
      ...(stringValue(value.code) ? { code: stringValue(value.code) } : {}),
      backend: "higgsfield",
      model: providerModelId ?? stringValue(value.model) ?? null,
    };
  }

  return {
    mode: "hermes",
    estimateAvailable: true,
    credits,
    estimatedCredits: credits,
    label: stringValue(value.label) ?? `~${credits} credits`,
    backend: stringValue(value.backend) ?? "higgsfield",
    model: providerModelId ?? stringValue(value.model) ?? null,
  };
}

function initialStudioCost(input: {
  modelId: string;
  providerModelId: string | null | undefined;
  durationSeconds: number;
  resolution: StudioResolution;
  costEstimate?: Record<string, unknown>;
}): Record<string, unknown> {
  if (process.env.CMO_STUDIO_REAL_VIDEO_ENABLED === "true" && input.providerModelId) {
    return normalizeHermesCostEstimate(input.costEstimate, input.providerModelId) ?? {
      mode: "hermes",
      estimateAvailable: false,
      reason: "Hermes cost estimate has not been attached to this Studio job yet.",
      backend: "higgsfield",
      model: input.providerModelId,
    };
  }

  return mockStudioCostEstimate({
    modelId: input.modelId,
    durationSeconds: input.durationSeconds,
    resolution: input.resolution,
  });
}

function normalizeSettings(input: StudioCreateJobInput): { model: ReturnType<typeof getStudioVideoModel>; settings: StudioJobSettings } {
  const model = input.modelOverride ?? getStudioVideoModel(input.modelId);
  const requestedResolution = input.settings?.resolution ?? DEFAULT_SETTINGS.resolution;
  const resolution = isStudioResolutionSupported(model, requestedResolution) ? requestedResolution : model.maxResolution;
  const variants = typeof input.settings?.variants === "number" && Number.isFinite(input.settings.variants)
    ? Math.max(1, Math.min(4, Math.floor(input.settings.variants)))
    : DEFAULT_SETTINGS.variants;

  return {
    model,
    settings: {
      aspectRatio: input.settings?.aspectRatio ?? DEFAULT_SETTINGS.aspectRatio,
      durationSeconds: clampStudioDuration(model, input.settings?.durationSeconds ?? DEFAULT_SETTINGS.durationSeconds),
      resolution,
      bitrate: input.settings?.bitrate ?? DEFAULT_SETTINGS.bitrate,
      variants,
      workflow: input.workflow ?? input.settings?.workflow ?? "text_to_video",
    },
  };
}

export function isValidStudioStatusTransition(from: StudioJobStatus, to: StudioJobStatus): boolean {
  return VALID_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

function assertValidStudioStatusTransition(from: StudioJobStatus, to: StudioJobStatus) {
  if (from === to) {
    return;
  }

  if (!isValidStudioStatusTransition(from, to)) {
    throw new CmoAdapterError(`Invalid Studio job status transition: ${from} -> ${to}.`, 409, "studio_invalid_status_transition");
  }
}

function rowToStudioJob(row: Record<string, unknown>): StudioJobRecord {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    created_by: typeof row.created_by === "string" ? row.created_by : null,
    status: row.status as StudioJobStatus,
    media_kind: row.media_kind as StudioMediaKind,
    agent: row.agent as StudioAgent,
    backend: row.backend as StudioBackend,
    operation: row.operation as StudioOperation,
    context_json: jsonRecord(row.context_json),
    prompt: String(row.prompt ?? ""),
    negative_prompt: typeof row.negative_prompt === "string" ? row.negative_prompt : null,
    model_json: jsonRecord(row.model_json),
    settings_json: jsonRecord(row.settings_json) as unknown as StudioJobSettings,
    input_asset_ids: stringArray(row.input_asset_ids),
    output_asset_ids: stringArray(row.output_asset_ids),
    cost_json: jsonRecord(row.cost_json),
    provider_job_id: typeof row.provider_job_id === "string" ? row.provider_job_id : null,
    provider_status: typeof row.provider_status === "string" ? row.provider_status : null,
    error_json: isRecord(row.error_json) ? row.error_json : null,
    diagnostics_json: jsonRecord(row.diagnostics_json),
    request_id: typeof row.request_id === "string" ? row.request_id : null,
    dispatch_attempts: typeof row.dispatch_attempts === "number" ? row.dispatch_attempts : 0,
    dispatch_started_at: typeof row.dispatch_started_at === "string" ? row.dispatch_started_at : null,
    locked_until: typeof row.locked_until === "string" ? row.locked_until : null,
    created_at: String(row.created_at),
    started_at: typeof row.started_at === "string" ? row.started_at : null,
    completed_at: typeof row.completed_at === "string" ? row.completed_at : null,
    updated_at: String(row.updated_at),
  };
}

export function mockStudioCostEstimate(input: {
  modelId?: string;
  durationSeconds?: number;
  resolution?: StudioResolution;
}): { estimateAvailable: true; credits: number; label: string; mode: "mock" } {
  const model = getStudioVideoModel(input.modelId);
  const duration = clampStudioDuration(model, input.durationSeconds ?? 8);
  const resolutionMultiplier =
    input.resolution === "4K" ? 3 :
      input.resolution === "1080p" ? 2 :
        input.resolution === "720p" ? 1.5 :
          1;
  const audioMultiplier = model.supportsAudio ? 1.15 : 1;
  const credits = Math.max(1, Math.round(duration * resolutionMultiplier * audioMultiplier * 2));

  return {
    estimateAvailable: true,
    credits,
    label: `~${credits} credits`,
    mode: "mock",
  };
}

async function transitionStudioJob(input: {
  job: StudioJobRecord;
  status: StudioJobStatus;
  patch?: Record<string, unknown>;
}): Promise<StudioJobRecord> {
  if (input.job.status === input.status) {
    return input.job;
  }

  assertValidStudioStatusTransition(input.job.status, input.status);

  const now = new Date().toISOString();
  const patch = {
    status: input.status,
    updated_at: now,
    ...(input.status === "running" ? { started_at: input.job.started_at ?? now, dispatch_started_at: input.job.dispatch_started_at ?? now } : {}),
    ...(["completed", "failed", "cancelled"].includes(input.status) ? { completed_at: now } : {}),
    ...input.patch,
  };
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("studio_generation_jobs")
    .update(patch)
    .eq("id", input.job.id)
    .select("*")
    .single();

  if (error || !data) {
    throw new CmoAdapterError("Studio job status update failed.", 500, "studio_job_status_update_failed");
  }

  return rowToStudioJob(data);
}

async function progressMockJob(job: StudioJobRecord): Promise<StudioJobRecord> {
  if (process.env.CMO_STUDIO_MOCK_RUNNER_ENABLED === "false" || process.env.CMO_STUDIO_REAL_VIDEO_ENABLED === "true") {
    return job;
  }

  const now = Date.now();

  if (job.status === "queued") {
    const queuedFor = now - new Date(job.created_at).getTime();

    if (queuedFor >= MOCK_RUNNING_AFTER_MS) {
      return transitionStudioJob({
        job,
        status: "running",
        patch: {
          provider_status: "mock_running",
          dispatch_attempts: job.dispatch_attempts + 1,
          diagnostics_json: {
            ...job.diagnostics_json,
            runner: "product_mock",
            note: "Mock runner progressed queued job to running.",
          },
        },
      });
    }
  }

  if (job.status === "running") {
    const startedAt = job.started_at ?? job.created_at;
    const runningFor = now - new Date(startedAt).getTime();

    if (runningFor >= MOCK_COMPLETED_AFTER_MS) {
      const mockAssetId = `mock_asset_${job.id.slice(0, 12)}`;

      return transitionStudioJob({
        job,
        status: "completed",
        patch: {
          output_asset_ids: [mockAssetId],
          provider_status: "mock_completed",
          diagnostics_json: {
            ...job.diagnostics_json,
            runner: "product_mock",
            mock_output: {
              asset_id: mockAssetId,
              preview_url: null,
              placeholder: true,
            },
          },
        },
      });
    }
  }

  return job;
}

export async function markStudioJobRunning(input: {
  job: StudioJobRecord;
  providerStatus?: string;
  diagnostics?: Record<string, unknown>;
}): Promise<StudioJobRecord> {
  return transitionStudioJob({
    job: input.job,
    status: "running",
    patch: {
      provider_status: input.providerStatus ?? "dispatching",
      dispatch_attempts: input.job.dispatch_attempts + 1,
      diagnostics_json: {
        ...input.job.diagnostics_json,
        ...(input.diagnostics ?? {}),
      },
    },
  });
}

export async function completeStudioJob(input: {
  job: StudioJobRecord;
  providerJobId?: string | null;
  providerStatus?: string;
  outputAssetIds?: string[];
  cost?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
}): Promise<StudioJobRecord> {
  return transitionStudioJob({
    job: input.job,
    status: "completed",
    patch: {
      provider_job_id: input.providerJobId ?? input.job.provider_job_id,
      provider_status: input.providerStatus ?? "completed",
      output_asset_ids: input.outputAssetIds ?? input.job.output_asset_ids,
      cost_json: {
        ...input.job.cost_json,
        ...(input.cost ?? {}),
      },
      diagnostics_json: {
        ...input.job.diagnostics_json,
        ...(input.diagnostics ?? {}),
      },
    },
  });
}

export async function failStudioJob(input: {
  job: StudioJobRecord;
  providerJobId?: string | null;
  providerStatus?: string;
  error: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
}): Promise<StudioJobRecord> {
  return transitionStudioJob({
    job: input.job,
    status: "failed",
    patch: {
      provider_job_id: input.providerJobId ?? input.job.provider_job_id,
      provider_status: input.providerStatus ?? "failed",
      error_json: input.error,
      diagnostics_json: {
        ...input.job.diagnostics_json,
        ...(input.diagnostics ?? {}),
      },
    },
  });
}

export async function listStudioJobs(context: CmoRequestUserContext, limit = 20): Promise<StudioJobRecord[]> {
  const { tenantId } = studioActor(context);
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("studio_generation_jobs")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));

  if (error) {
    throw new CmoAdapterError("Studio jobs lookup failed.", 500, "studio_jobs_lookup_failed");
  }

  const jobs = (data ?? []).map((row) => rowToStudioJob(row));

  return Promise.all(jobs.map((job) => progressMockJob(job)));
}

export async function getStudioJob(context: CmoRequestUserContext, jobId: string): Promise<StudioJobRecord> {
  const { tenantId } = studioActor(context);
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("studio_generation_jobs")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new CmoAdapterError("Studio job lookup failed.", 500, "studio_job_lookup_failed");
  }

  if (!data) {
    throw new CmoAdapterError("Studio job not found.", 404, "studio_job_not_found");
  }

  return progressMockJob(rowToStudioJob(data));
}

export async function createStudioVideoJob(
  context: CmoRequestUserContext,
  input: StudioCreateJobInput,
): Promise<{ job: StudioJobRecord; idempotent: boolean }> {
  const prompt = normalizePrompt(input.prompt);

  if (!prompt) {
    throw new CmoAdapterError("Prompt is required.", 400, "studio_prompt_required");
  }

  const { tenantId, createdBy } = studioActor(context);
  const requestId = normalizeRequestId(input.requestId);
  const supabase = createSupabaseAdminClient();

  if (requestId) {
    const { data, error } = await supabase
      .from("studio_generation_jobs")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("request_id", requestId)
      .maybeSingle();

    if (error) {
      throw new CmoAdapterError("Studio idempotency lookup failed.", 500, "studio_idempotency_lookup_failed");
    }

    if (data) {
      return { job: await progressMockJob(rowToStudioJob(data)), idempotent: true };
    }
  }

  const { model, settings } = normalizeSettings(input);
  const cost = initialStudioCost({
    modelId: model.id,
    providerModelId: model.providerModelId,
    durationSeconds: settings.durationSeconds,
    resolution: settings.resolution,
    costEstimate: input.costEstimate,
  });
  const createdAt = new Date().toISOString();
  const id = `studio_job_${randomUUID()}`;
  const row = {
    id,
    tenant_id: tenantId,
    created_by: createdBy,
    status: "queued",
    media_kind: "video",
    agent: "video",
    backend: "higgsfield",
    operation: "generate_video",
    context_json: {
      ...(input.context ?? {}),
      product_route: "/studio",
      workflow: input.workflow ?? settings.workflow ?? "text_to_video",
    },
    prompt,
    negative_prompt: normalizePrompt(input.negativePrompt) || null,
    model_json: {
      product_model_id: model.id,
      ui_id: model.uiId ?? model.id,
      provider_model_id: model.providerModelId ?? null,
      name: model.name,
      desired_provider: "higgsfield",
      verified_provider_model_id: null,
      supports_audio: model.supportsAudio,
      badges: model.badges,
      enablement: model.enablement ?? null,
      workflow: input.workflow ?? settings.workflow ?? "text_to_video",
      operations: model.operations ?? [],
      inputs_required: model.inputsRequired ?? [],
      inputs_optional: model.inputsOptional ?? [],
      can_generate_text_to_video: model.canGenerateTextToVideo ?? null,
      can_generate_image_to_video: model.canGenerateImageToVideo ?? null,
      settings_schema: {
        duration: {
          min: model.minDurationSeconds,
          max: model.maxDurationSeconds,
          default: model.defaultDurationSeconds ?? settings.durationSeconds,
        },
        aspect_ratio: {
          default: model.defaultAspectRatio ?? settings.aspectRatio,
          values: model.supportedAspectRatios ?? [],
        },
        resolution: {
          default: model.defaultResolution ?? settings.resolution,
          values: model.supportedResolutions,
        },
        mode: {
          default: model.defaultMode ?? null,
          values: model.supportedModes ?? [],
        },
        bitrate_mode: {
          default: model.defaultBitrate ?? settings.bitrate,
          values: model.supportedBitrates ?? [],
        },
      },
      constraints: model.constraints ?? [],
      warnings: model.warnings ?? [],
      catalog_source: model.catalogSource ?? null,
      catalog_mode: model.catalogMode ?? "mock_desired",
    },
    settings_json: settings,
    input_asset_ids: input.inputAssetIds ?? [],
    output_asset_ids: [],
    cost_json: cost,
    provider_job_id: null,
    provider_status: "mock_queued",
    error_json: null,
    diagnostics_json: {
      runner: "product_mock",
      hermes_dispatched: false,
      workflow: input.workflow ?? settings.workflow ?? "text_to_video",
      catalog_count: STUDIO_VIDEO_MODELS.length,
    },
    request_id: requestId,
    dispatch_attempts: 0,
    dispatch_started_at: null,
    locked_until: null,
    created_at: createdAt,
    started_at: null,
    completed_at: null,
    updated_at: createdAt,
  };
  const { data, error } = await supabase
    .from("studio_generation_jobs")
    .insert(row)
    .select("*")
    .single();

  if (error || !data) {
    throw new CmoAdapterError("Studio job create failed.", 500, "studio_job_create_failed");
  }

  return { job: rowToStudioJob(data), idempotent: false };
}

export async function cancelStudioJob(context: CmoRequestUserContext, jobId: string): Promise<StudioJobRecord> {
  const job = await getStudioJob(context, jobId);

  if (!["queued", "running"].includes(job.status)) {
    throw new CmoAdapterError("Studio job is not cancellable.", 409, "studio_job_not_cancellable");
  }

  return transitionStudioJob({
    job,
    status: "cancelled",
    patch: {
      provider_status: "product_cancelled",
    },
  });
}

export async function assertStudioJobExists(context: CmoRequestUserContext, jobId: string): Promise<StudioJobRecord> {
  return getStudioJob(context, jobId);
}
