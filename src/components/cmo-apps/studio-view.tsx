"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import {
  STUDIO_ASPECT_RATIOS,
  STUDIO_BITRATES,
  STUDIO_RESOLUTIONS,
  STUDIO_VIDEO_MODELS,
  clampStudioDuration,
  disabledReasonForEnablement,
  enablementLabel,
  getStudioVideoModel,
  isStudioResolutionSupported,
  normalizeStudioAspectRatio,
  normalizeStudioBitrate,
  normalizeStudioResolution,
  studioModelSupportsWorkflowOperation,
  supportsStudioWorkflow,
  unsupportedStudioWorkflowInputStatus,
  validateStudioVideoSettings,
  type StudioAspectRatio,
  type StudioBitrate,
  type StudioResolution,
  type StudioVideoModel,
  type StudioVideoWorkflow,
} from "@/lib/cmo/studio-model-catalog";
import { cn } from "@/lib/utils";

type StudioJobStatus = "draft" | "queued" | "running" | "completed" | "failed" | "cancelled";
const REAL_STUDIO_VIDEO_PROVIDER_MODEL_ID = "seedance_2_0";

interface StudioJob {
  id: string;
  status: StudioJobStatus;
  prompt: string;
  model_json: {
    product_model_id?: string;
    provider_model_id?: string;
    name?: string;
  };
  settings_json: {
    aspectRatio?: StudioAspectRatio;
    durationSeconds?: number;
    resolution?: StudioResolution;
    bitrate?: StudioBitrate;
    variants?: number;
  };
  cost_json?: {
    label?: string;
    credits?: number;
    estimateAvailable?: boolean;
    mode?: "mock" | "hermes";
  };
  diagnostics_json?: {
    mock_output?: {
      asset_id?: string;
      placeholder?: boolean;
    };
    remote_result?: {
      render_url?: string | null;
      thumbnail_url?: string | null;
      duration_seconds?: number;
      aspect_ratio?: string;
      resolution?: string;
    };
    artifact_transport_status?: string;
    product_asset_id?: string;
    product_asset_url?: string;
    thumbnail_asset_url?: string;
    thumbnail_upload_status?: string;
    provider_original_render_url?: string;
    provider_original_thumbnail_url?: string;
  };
  input_asset_ids?: string[];
  output_asset_ids?: string[];
  provider_status?: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface StudioInputAsset {
  id: string;
  media_kind?: "image" | "video";
  mime_type?: string;
  bytes?: number;
  preview_url?: string | null;
  render_url?: string | null;
  thumbnail_url?: string | null;
  metadata_json?: {
    original_filename?: string;
  };
}

interface CostEstimate {
  estimateAvailable: boolean;
  credits?: number;
  estimatedCredits?: number;
  label?: string;
  mode?: "mock" | "hermes";
  reason?: string;
  warning?: string;
  highCostWarning?: boolean;
  backend?: string;
  model?: string;
}

type StudioReadinessState =
  | "empty_prompt"
  | "missing_image"
  | "uploading_input"
  | "loading_catalog"
  | "checking_cost"
  | "cost_unavailable"
  | "settings_invalid"
  | "unsupported_workflow"
  | "ready"
  | "creating_job"
  | "job_running"
  | "completed"
  | "failed";

type StudioCostRequestState = "idle" | "checking" | "ready" | "unavailable";

interface StudioReadiness {
  state: StudioReadinessState;
  message: string;
  blockedReason: string | null;
  costHelper: string;
  buttonLabel: string;
  canGenerate: boolean;
  badgeLabel: string;
  badgeVariant: "green" | "orange" | "slate" | "blue";
}

interface StudioVideoAgentStatus {
  configured: boolean;
  connected: boolean;
  realVideoEnabled?: boolean;
  setupRequired?: boolean;
  cli_available?: boolean | null;
  authenticated?: boolean | null;
  backend?: string;
  message?: string;
  code?: string;
}

function Field({ label, children, helper }: { label: string; children: ReactNode; helper?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
      {helper ? <span className="mt-1 block text-xs font-semibold text-slate-500">{helper}</span> : null}
    </label>
  );
}

function ConsoleTab({ active, disabled, label }: { active?: boolean; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "relative h-10 whitespace-nowrap text-sm font-bold transition",
        active ? "text-slate-950" : "text-slate-500 hover:text-slate-800",
        disabled && "cursor-not-allowed text-slate-300 hover:text-slate-300",
      )}
    >
      {label}
      {active ? <span className="absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-slate-950" /> : null}
    </button>
  );
}

function shortPrompt(prompt: string): string {
  return prompt.length > 74 ? `${prompt.slice(0, 74).trim()}...` : prompt;
}

function jobModelName(job: StudioJob): string {
  return job.model_json.name ?? getStudioVideoModel(job.model_json.product_model_id).name;
}

function jobThumbnailUrl(job: StudioJob): string | null {
  return job.diagnostics_json?.thumbnail_asset_url
    ?? job.diagnostics_json?.remote_result?.thumbnail_url
    ?? null;
}

function statusBadgeVariant(status: StudioJobStatus): "green" | "orange" | "slate" | "blue" {
  if (status === "completed") {
    return "green";
  }

  if (status === "running" || status === "queued") {
    return "orange";
  }

  if (status === "failed" || status === "cancelled") {
    return "slate";
  }

  return "blue";
}

function aspectRatioCss(aspectRatio: StudioAspectRatio): string {
  const [w, h] = aspectRatio.split(":").map(Number);

  return `${w} / ${h}`;
}

function costEstimateFromBody(body: Record<string, unknown>): CostEstimate {
  return {
    estimateAvailable: body.estimateAvailable === true,
    ...(typeof body.credits === "number" ? { credits: body.credits } : {}),
    ...(typeof body.estimatedCredits === "number" ? { estimatedCredits: body.estimatedCredits } : {}),
    ...(typeof body.label === "string" ? { label: body.label } : {}),
    ...(body.mode === "mock" || body.mode === "hermes" ? { mode: body.mode } : {}),
    ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
    ...(typeof body.warning === "string" ? { warning: body.warning } : {}),
    ...(body.highCostWarning === true ? { highCostWarning: true } : {}),
    ...(typeof body.backend === "string" ? { backend: body.backend } : {}),
    ...(typeof body.model === "string" ? { model: body.model } : {}),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function selectedImageAsset(assets: StudioInputAsset[]): StudioInputAsset | null {
  return assets.find((asset) => asset.media_kind === "image") ?? null;
}

function modelFromApi(value: unknown): StudioVideoModel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : typeof record.uiId === "string" ? record.uiId : typeof record.providerModelId === "string" ? record.providerModelId : null;
  const supportedResolutions = stringArray(record.supportedResolutions).map(normalizeStudioResolution).filter((item): item is StudioResolution => Boolean(item));
  const supportedAspectRatios = stringArray(record.supportedAspectRatios).map(normalizeStudioAspectRatio).filter((item): item is StudioAspectRatio => Boolean(item));
  const supportedBitrates = stringArray(record.supportedBitrates).map(normalizeStudioBitrate).filter((item): item is StudioBitrate => Boolean(item));

  if (!id) {
    return null;
  }

  return {
    id,
    uiId: typeof record.uiId === "string" ? record.uiId : id,
    providerModelId: typeof record.providerModelId === "string" ? record.providerModelId : typeof record.provider_model_id === "string" ? record.provider_model_id : undefined,
    name: typeof record.name === "string" ? record.name : typeof record.label === "string" ? record.label : id,
    providerLabel: typeof record.provider === "string" ? record.provider : "Higgsfield",
    maxResolution: normalizeStudioResolution(record.maxResolution ?? record.max_resolution) ?? supportedResolutions.at(-1) ?? "720p",
    supportedResolutions: supportedResolutions.length ? supportedResolutions : ["720p"],
    supportedAspectRatios,
    supportedBitrates,
    supportedModes: stringArray(record.supportedModes).filter((item): item is "fast" | "std" => item === "fast" || item === "std"),
    defaultDurationSeconds: numberValue(record.defaultDurationSeconds ?? record.default_duration_seconds),
    defaultAspectRatio: normalizeStudioAspectRatio(record.defaultAspectRatio ?? record.default_aspect_ratio) ?? undefined,
    defaultResolution: normalizeStudioResolution(record.defaultResolution ?? record.default_resolution) ?? undefined,
    defaultBitrate: normalizeStudioBitrate(record.defaultBitrate ?? record.default_bitrate) ?? undefined,
    defaultMode: record.defaultMode === "fast" || record.defaultMode === "std" ? record.defaultMode : undefined,
    minDurationSeconds: numberValue(record.minDurationSeconds ?? record.min_duration_seconds) ?? 4,
    maxDurationSeconds: numberValue(record.maxDurationSeconds ?? record.max_duration_seconds) ?? 15,
    supportsAudio: record.supportsAudio === true || record.supports_audio === true,
    badges: stringArray(record.badges),
    realVideoSupported: record.realVideoSupported === true || record.real_video_supported === true,
    costSupported: record.costSupported !== false && record.cost_supported !== false,
    workflowSupported: record.workflowSupported === true || record.workflow_supported === true,
    enablement: record.enablement === "safe_now" || record.enablement === "guarded" || record.enablement === "needs_smoke" || record.enablement === "disabled_until_upload" ? record.enablement : "unavailable",
    enablementLabel: typeof record.enablementLabel === "string" ? record.enablementLabel : undefined,
    disabledReason: typeof record.disabledReason === "string" ? record.disabledReason : null,
    operations: stringArray(record.operations),
    inputsRequired: stringArray(record.inputsRequired ?? record.inputs_required),
    inputsOptional: stringArray(record.inputsOptional ?? record.inputs_optional),
    canGenerateTextToVideo: optionalBoolean(record.canGenerateTextToVideo ?? record.can_generate_text_to_video),
    canGenerateImageToVideo: optionalBoolean(record.canGenerateImageToVideo ?? record.can_generate_image_to_video),
    requiredInputStatus: typeof record.requiredInputStatus === "string" ? record.requiredInputStatus : typeof record.required_input_status === "string" ? record.required_input_status : null,
    unsupportedInputStatus: typeof record.unsupportedInputStatus === "string" ? record.unsupportedInputStatus : typeof record.unsupported_input_status === "string" ? record.unsupported_input_status : null,
    constraints: stringArray(record.constraints),
    warnings: stringArray(record.warnings),
    catalogSource: typeof record.catalogSource === "string" ? record.catalogSource : undefined,
    catalogMode: record.catalogMode === "hermes_v2" || record.catalogMode === "hermes_v1" || record.catalogMode === "product_fallback" ? record.catalogMode : undefined,
  };
}

function workflowModelStatusLabel(model: StudioVideoModel, workflow: StudioVideoWorkflow, hasImageInput: boolean): string {
  if (workflow === "image_to_video") {
    if (!studioModelSupportsWorkflowOperation(model, "image_to_video")) {
      return "Not image-to-video";
    }

    if (unsupportedStudioWorkflowInputStatus(model, "image_to_video")) {
      return model.requiredInputStatus ?? "Requires unsupported input";
    }

    if (!hasImageInput) {
      return "Upload image required";
    }

    return model.enablement === "needs_smoke" ? "Needs smoke" : "Image-to-video ready";
  }

  if (!studioModelSupportsWorkflowOperation(model, "text_to_video")) {
    return "Not text-to-video";
  }

  if (unsupportedStudioWorkflowInputStatus(model, "text_to_video")) {
    return model.requiredInputStatus ?? "Requires unsupported input";
  }

  if (model.enablement === "needs_smoke") {
    return "Needs smoke";
  }

  if (model.enablement === "disabled_until_upload") {
    return "Requires upload";
  }

  if (model.enablement === "unavailable") {
    return "Unavailable";
  }

  return "Text-to-video ready";
}

function workflowModelStatusVariant(model: StudioVideoModel, workflow: StudioVideoWorkflow, hasImageInput: boolean): "green" | "orange" | "slate" {
  if (workflow === "image_to_video" && supportsStudioWorkflow(model, "image_to_video", { hasImageInput })) {
    return model.enablement === "needs_smoke" ? "orange" : "green";
  }

  if (workflow === "text_to_video" && supportsStudioWorkflow(model, "text_to_video")) {
    return model.enablement === "needs_smoke" ? "orange" : "green";
  }

  if (workflow === "image_to_video" && studioModelSupportsWorkflowOperation(model, "image_to_video") && !hasImageInput) {
    return "orange";
  }

  return "slate";
}

function modelSelectorRank(model: StudioVideoModel, workflow: StudioVideoWorkflow, hasImageInput: boolean): number {
  if (supportsStudioWorkflow(model, workflow, { hasImageInput })) {
    return 0;
  }

  if (workflow === "image_to_video" && studioModelSupportsWorkflowOperation(model, "image_to_video") && !unsupportedStudioWorkflowInputStatus(model, "image_to_video")) {
    return 1;
  }

  if (unsupportedStudioWorkflowInputStatus(model, workflow)) {
    return 2;
  }

  return 3;
}

function modelSelectorLabel(model: StudioVideoModel, workflow: StudioVideoWorkflow, hasImageInput: boolean): string {
  const readiness = workflowModelStatusLabel(model, workflow, hasImageInput);
  const enablement = model.enablement === "needs_smoke" ? "Not smoke-tested" : model.enablementLabel ?? enablementLabel(model.enablement);
  const cost = model.costSupported === false ? "Cost unavailable" : "Cost supported";

  if (workflow === "image_to_video") {
    return `${model.name} · ${readiness} · ${enablement} · ${cost} · up to ${model.maxResolution}`;
  }

  return `${model.name} · ${enablement} · ${cost} · up to ${model.maxResolution} · ${model.minDurationSeconds}s-${model.maxDurationSeconds}s`;
}

function canUseRealTextToVideoModel(model: StudioVideoModel): boolean {
  return supportsStudioWorkflow(model, "text_to_video");
}

function canUseImageToVideoModel(model: StudioVideoModel, hasImageInput: boolean): boolean {
  return supportsStudioWorkflow(model, "image_to_video", { hasImageInput });
}

function modelAvailableForWorkflow(model: StudioVideoModel, workflow: StudioVideoWorkflow, hasImageInput: boolean): boolean {
  return workflow === "image_to_video"
    ? canUseImageToVideoModel(model, hasImageInput)
    : canUseRealTextToVideoModel(model);
}

function validationModelForWorkflow(model: StudioVideoModel, workflow: StudioVideoWorkflow, hasImageInput: boolean): StudioVideoModel {
  return workflow === "image_to_video" && hasImageInput && model.enablement === "disabled_until_upload"
    ? { ...model, enablement: "guarded" }
    : model;
}

function findStudioVideoModel(models: StudioVideoModel[], id: string): StudioVideoModel {
  return models.find((item) => item.id === id || item.providerModelId === id || item.uiId === id) ?? models[0] ?? getStudioVideoModel(id);
}

function ModelHeroCard({
  model,
  agentConnected,
  realAvailable,
  workflow,
  hasImageInput,
  catalogSource,
}: {
  model: StudioVideoModel;
  agentConnected: boolean;
  realAvailable: boolean;
  workflow: StudioVideoWorkflow;
  hasImageInput: boolean;
  catalogSource: string;
}) {
  const statusLabel = workflowModelStatusLabel(model, workflow, hasImageInput);
  const statusVariant = workflowModelStatusVariant(model, workflow, hasImageInput);

  return (
    <div className="relative overflow-hidden rounded-lg border border-violet-200 bg-[linear-gradient(135deg,#ffffff_0%,#f5f3ff_54%,#eef2ff_100%)] p-4 shadow-sm">
      <div className="absolute right-4 top-4 grid size-12 place-items-center rounded-lg border border-white/80 bg-white/70 text-violet-700 shadow-sm">
        <icons.Sparkles className="size-5" />
      </div>
      <div className="max-w-[78%]">
        <div className="text-[11px] font-black uppercase text-violet-700">{agentConnected ? "Hermes video model" : "Desired video model"}</div>
        <div className="mt-2 text-2xl font-black leading-tight text-slate-950">{model.name}</div>
        <div className="mt-2 text-sm font-semibold text-slate-600">
          Up to {model.maxResolution} · {model.minDurationSeconds}s-{model.maxDurationSeconds}s
          {model.supportsAudio ? " · audio" : ""}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {model.badges.map((badge) => (
          <Badge key={badge} variant={badge === "NEW" ? "green" : "blue"}>
            {badge}
          </Badge>
        ))}
        <Badge variant="slate">{catalogSource}</Badge>
        <Badge variant={model.enablement === "safe_now" ? "green" : model.enablement === "guarded" || model.enablement === "needs_smoke" ? "orange" : "slate"}>
          {model.enablement === "needs_smoke" ? "Needs smoke" : model.enablementLabel ?? enablementLabel(model.enablement)}
        </Badge>
        <Badge variant={statusVariant}>{statusLabel}</Badge>
        {!realAvailable && agentConnected && statusVariant === "slate" ? <Badge variant="orange">Unavailable</Badge> : null}
      </div>
      {[...(model.constraints ?? []), ...(model.warnings ?? [])].length ? (
        <div className="mt-3 space-y-1 text-xs font-semibold text-slate-600">
          {[...(model.constraints ?? []), ...(model.warnings ?? [])].map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HistoryPanel({
  jobs,
  activeJobId,
  onSelect,
}: {
  jobs: StudioJob[];
  activeJobId: string | null;
  onSelect: (job: StudioJob) => void;
}) {
  return (
    <Card className="relative z-0 rounded-lg border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <icons.Folder className="size-5 text-slate-500" />
          <CardTitle>Studio job history</CardTitle>
        </div>
        <Badge variant="slate">{jobs.length} jobs</Badge>
      </div>
      <div className="mt-4 space-y-3">
        {jobs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-500">
            No Studio jobs yet.
          </div>
        ) : jobs.map((job) => {
          const thumbnailUrl = jobThumbnailUrl(job);

          return (
          <button
            key={job.id}
            type="button"
            className={cn(
              "grid w-full grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-slate-50/70 p-2 text-left transition hover:border-violet-200 hover:bg-violet-50/40",
              activeJobId === job.id ? "border-violet-300 ring-2 ring-violet-100" : "border-slate-200",
            )}
            onClick={() => onSelect(job)}
          >
            <span className="grid aspect-video place-items-center overflow-hidden rounded-md bg-[linear-gradient(135deg,#eef2ff,#f5f3ff_45%,#e0f2fe)] text-violet-700">
              {thumbnailUrl ? (
                <Image src={thumbnailUrl} alt="" width={96} height={54} unoptimized className="h-full w-full object-cover" />
              ) : (
                <icons.Play className="size-5" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-slate-950">{shortPrompt(job.prompt)}</span>
              <span className="mt-1 block text-xs font-semibold text-slate-500">
                {jobModelName(job)} · {job.settings_json.durationSeconds ?? 8}s · {job.settings_json.aspectRatio ?? "16:9"} · {job.settings_json.resolution ?? "720p"} · {job.settings_json.bitrate ?? "standard"}
              </span>
              <span className="mt-2 flex flex-wrap gap-1">
                <Badge variant={statusBadgeVariant(job.status)}>{job.status}</Badge>
                {job.cost_json?.label ? <Badge variant="slate">{job.cost_json.label}</Badge> : <Badge variant="slate">Cost estimate unavailable</Badge>}
              </span>
            </span>
            <icons.ChevronRight className="size-4 text-slate-400" />
          </button>
          );
        })}
      </div>
    </Card>
  );
}

function CanvasPreview({
  aspectRatio,
  activeJob,
  agentConnected,
  workflow,
  selectedInputAssets,
}: {
  aspectRatio: StudioAspectRatio;
  activeJob: StudioJob | null;
  agentConnected: boolean;
  workflow: StudioVideoWorkflow;
  selectedInputAssets: StudioInputAsset[];
}) {
  const status = activeJob?.status ?? "draft";
  const complete = status === "completed";
  const running = status === "queued" || status === "running";
  const remoteResult = activeJob?.diagnostics_json?.remote_result;
  const productAssetId = activeJob?.output_asset_ids?.[0] ?? activeJob?.diagnostics_json?.product_asset_id;
  const productAssetUrl = typeof activeJob?.diagnostics_json?.product_asset_url === "string"
    ? activeJob.diagnostics_json.product_asset_url
    : productAssetId
      ? `/api/cmo/studio/assets/${encodeURIComponent(productAssetId)}/preview`
      : null;
  const remoteRenderUrl = typeof remoteResult?.render_url === "string" ? remoteResult.render_url : null;
  const renderUrl = productAssetUrl ?? remoteRenderUrl;
  const productThumbnailUrl = typeof activeJob?.diagnostics_json?.thumbnail_asset_url === "string"
    ? activeJob.diagnostics_json.thumbnail_asset_url
    : null;
  const thumbnailUrl = productThumbnailUrl ?? (typeof remoteResult?.thumbnail_url === "string" ? remoteResult.thumbnail_url : undefined);
  const uploadFailed = activeJob?.diagnostics_json?.artifact_transport_status === "upload_failed";
  const thumbnailUploaded = activeJob?.diagnostics_json?.thumbnail_upload_status === "product_uploaded";
  const inputAsset = workflow === "image_to_video" ? selectedImageAsset(selectedInputAssets) : null;
  const inputPreviewUrl = inputAsset
    ? inputAsset.preview_url ?? inputAsset.render_url ?? `/api/cmo/studio/assets/${encodeURIComponent(inputAsset.id)}/preview`
    : null;
  const imageToVideoJob = Boolean(activeJob?.input_asset_ids?.length);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardTitle>Canvas</CardTitle>
          <CardDescription className="mt-1">Product preview for the active Studio job.</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="slate">Product API</Badge>
          <Badge variant={agentConnected ? "green" : "blue"}>{agentConnected ? "Hermes Video Agent" : "Mock video runner"}</Badge>
        </div>
      </div>

      <div className="mt-4 grid min-h-[420px] place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-5">
        <div
          className={cn(
            "relative w-full max-w-[920px] overflow-hidden rounded-lg border border-slate-200 shadow-sm",
            aspectRatio === "9:16" || aspectRatio === "3:4" ? "max-w-[360px]" : "",
          )}
          style={{ aspectRatio: aspectRatioCss(aspectRatio) }}
        >
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#f8fafc_0%,#eef2ff_42%,#faf5ff_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(124,58,237,0.18),transparent_28%),radial-gradient(circle_at_82%_72%,rgba(14,165,233,0.16),transparent_28%)]" />
          <div className="absolute inset-6 rounded-lg border border-white/80 bg-white/52 shadow-sm backdrop-blur-sm" />
          <div className="absolute left-5 top-5 flex flex-wrap gap-2">
            <Badge variant="blue">Video</Badge>
            <Badge variant={statusBadgeVariant(status)}>{status === "draft" ? "empty" : status}</Badge>
            {imageToVideoJob ? <Badge variant="blue">Image-to-video</Badge> : null}
            {productAssetUrl ? <Badge variant="green">Product-owned asset</Badge> : renderUrl ? <Badge variant="green">Remote Higgsfield result</Badge> : null}
            {thumbnailUploaded ? <Badge variant="green">Product-owned thumbnail</Badge> : null}
            {uploadFailed ? <Badge variant="orange">Upload failed fallback</Badge> : null}
          </div>
          {renderUrl ? (
            <video
              src={renderUrl}
              poster={thumbnailUrl}
              controls
              playsInline
              className="absolute inset-0 h-full w-full bg-slate-950 object-contain"
            />
          ) : null}
          <div className={cn("absolute inset-0 grid place-items-center p-8 text-center", renderUrl && "pointer-events-none hidden")}>
            {activeJob ? (
              <div className="max-w-md">
                <div className={cn("mx-auto grid size-16 place-items-center rounded-full shadow-sm", complete ? "bg-emerald-500 text-white" : "bg-white text-violet-700")}>
                  {complete ? <icons.Check className="size-7" /> : <icons.Sparkles className={cn("size-7", running && "animate-pulse")} />}
                </div>
                <div className="mt-5 text-xl font-black text-slate-950">{complete ? "Video result ready" : "Studio job in progress"}</div>
                <div className="mt-2 text-sm font-semibold leading-6 text-slate-600">{shortPrompt(activeJob.prompt)}</div>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Badge variant="slate">{jobModelName(activeJob)}</Badge>
                  <Badge variant="slate">{activeJob.settings_json.durationSeconds ?? 8}s</Badge>
                  <Badge variant="slate">{activeJob.settings_json.aspectRatio ?? "16:9"}</Badge>
                  <Badge variant="slate">{activeJob.settings_json.resolution ?? "720p"}</Badge>
                  <Badge variant="slate">{activeJob.settings_json.bitrate ?? "standard"}</Badge>
                  {productAssetUrl ? <Badge variant="green">Product-owned asset</Badge> : null}
                  {thumbnailUploaded ? <Badge variant="green">Product-owned thumbnail</Badge> : null}
                </div>
              </div>
            ) : inputPreviewUrl ? (
              <div className="max-w-sm">
                <div className="mx-auto overflow-hidden rounded-lg border border-white bg-white shadow-sm">
                  <Image src={inputPreviewUrl} alt="" width={220} height={220} unoptimized className="aspect-square w-44 object-cover" />
                </div>
                <div className="mt-5 text-xl font-black text-slate-950">Input image ready</div>
                <div className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                  Selected Product input is ready for image-to-video generation.
                </div>
              </div>
            ) : (
              <div className="max-w-sm">
                <div className="mx-auto grid size-16 place-items-center rounded-full bg-white text-violet-700 shadow-sm">
                  <icons.Play className="size-7" />
                </div>
                <div className="mt-5 text-xl font-black text-slate-950">No active render</div>
                <div className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                  Create a video job to see queued, running, and completed mock states here.
                </div>
              </div>
            )}
          </div>
          {running ? (
            <div className="absolute inset-x-5 bottom-5 overflow-hidden rounded-full bg-white/70">
              <div className={cn("h-2 rounded-full bg-violet-600", status === "queued" ? "w-[28%]" : "w-[68%]")} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StudioConsole({
  imageModeEnabled,
  videoAgentStatus,
  modelRealAvailable,
  readiness,
  workflow,
  prompt,
  model,
  models,
  catalogSource,
  aspectRatio,
  duration,
  resolution,
  bitrate,
  costEstimate,
  selectedInputAssets,
  isUploadingInput,
  uploadStatus,
  error,
  onPromptChange,
  onWorkflowChange,
  onModelChange,
  onAspectRatioChange,
  onDurationChange,
  onResolutionChange,
  onBitrateChange,
  onUploadInput,
  onRemoveInputAsset,
  onGenerate,
}: {
  imageModeEnabled: boolean;
  videoAgentStatus: StudioVideoAgentStatus | null;
  modelRealAvailable: boolean;
  readiness: StudioReadiness;
  workflow: StudioVideoWorkflow;
  prompt: string;
  model: StudioVideoModel;
  models: StudioVideoModel[];
  catalogSource: string;
  aspectRatio: StudioAspectRatio;
  duration: number;
  resolution: StudioResolution;
  bitrate: StudioBitrate;
  costEstimate: CostEstimate | null;
  selectedInputAssets: StudioInputAsset[];
  isUploadingInput: boolean;
  uploadStatus: string | null;
  error: string | null;
  onPromptChange: (value: string) => void;
  onWorkflowChange: (value: StudioVideoWorkflow) => void;
  onModelChange: (value: string) => void;
  onAspectRatioChange: (value: StudioAspectRatio) => void;
  onDurationChange: (value: number) => void;
  onResolutionChange: (value: StudioResolution) => void;
  onBitrateChange: (value: StudioBitrate) => void;
  onUploadInput: (file: File) => void;
  onRemoveInputAsset: (assetId: string) => void;
  onGenerate: () => void;
}) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const agentConnected = videoAgentStatus?.connected === true;
  const isImageWorkflow = workflow === "image_to_video";
  const inputAsset = selectedImageAsset(selectedInputAssets);
  const hasImageInput = Boolean(inputAsset);
  const modelOptions = useMemo(
    () => [...models].sort((left, right) => {
      const rankDelta = modelSelectorRank(left, workflow, hasImageInput) - modelSelectorRank(right, workflow, hasImageInput);

      return rankDelta || left.name.localeCompare(right.name);
    }),
    [hasImageInput, models, workflow],
  );
  const aspectRatioOptions = model.supportedAspectRatios?.length ? model.supportedAspectRatios : STUDIO_ASPECT_RATIOS;
  const resolutionOptions = model.supportedResolutions.length ? model.supportedResolutions : STUDIO_RESOLUTIONS;
  const bitrateOptions = model.supportedBitrates?.length
    ? STUDIO_BITRATES.filter((item) => model.supportedBitrates?.includes(item.id))
    : STUDIO_BITRATES;

  return (
    <Card className="relative z-20 overflow-visible rounded-lg border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-6">
            <ConsoleTab active label="Create Video" />
            <ConsoleTab disabled label="Edit Video" />
            <ConsoleTab disabled label="Motion Control" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={agentConnected ? "green" : "orange"}>
              {agentConnected ? "Hermes connected" : videoAgentStatus?.setupRequired ? "Hermes setup needed" : "Hermes offline"}
            </Badge>
            {imageModeEnabled ? <Badge variant="slate">Image · Coming Soon</Badge> : null}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {([
            ["text_to_video", "Text to Video"],
            ["image_to_video", "Image to Video"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={cn(
                "h-10 rounded-md text-sm font-black transition",
                workflow === id ? "bg-white text-violet-700 shadow-sm ring-1 ring-violet-100" : "text-slate-500 hover:text-slate-900",
              )}
              onClick={() => onWorkflowChange(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <ModelHeroCard
          model={model}
          agentConnected={agentConnected}
          realAvailable={modelRealAvailable}
          workflow={workflow}
          hasImageInput={hasImageInput}
          catalogSource={catalogSource}
        />
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <span className="text-xs font-bold uppercase text-slate-500">Generation readiness</span>
          <Badge variant={readiness.badgeVariant}>{readiness.badgeLabel}</Badge>
        </div>

        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5">
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];

              event.currentTarget.value = "";
              if (file) {
                onUploadInput(file);
              }
            }}
          />
          <button
            type="button"
            disabled={!isImageWorkflow || isUploadingInput}
            className={cn(
              "grid w-full place-items-center text-center transition",
              !isImageWorkflow || isUploadingInput ? "cursor-not-allowed opacity-60" : "hover:text-violet-700",
            )}
            onClick={() => uploadInputRef.current?.click()}
          >
          <span className="flex -space-x-2">
            <span className="grid size-11 place-items-center rounded-full border border-white bg-slate-200 text-slate-600 shadow-sm">
              <icons.Sparkles className="size-4" />
            </span>
            <span className="grid size-11 place-items-center rounded-full border border-white bg-slate-200 text-slate-600 shadow-sm">
              <icons.Play className="size-4" />
            </span>
            <span className="grid size-11 place-items-center rounded-full border border-white bg-slate-200 text-slate-600 shadow-sm">
              <icons.Upload className="size-4" />
            </span>
          </span>
            <span className="mt-4 text-lg font-bold text-slate-500">{isUploadingInput ? "Uploading image..." : inputAsset ? "Replace image" : "Upload image"}</span>
            <span className="mt-1 text-sm font-bold text-slate-500">
              {isImageWorkflow ? "Product input image for image-to-video" : "Switch to Image to Video to upload an input image"}
            </span>
          </button>
          {uploadStatus ? <div className="mt-3 text-center text-xs font-bold text-slate-500">{uploadStatus}</div> : null}
          {inputAsset ? (
            <div className="mt-4 grid gap-2">
              {[inputAsset].map((asset) => {
                const previewUrl = asset.preview_url ?? asset.render_url ?? `/api/cmo/studio/assets/${encodeURIComponent(asset.id)}/preview`;
                const name = asset.metadata_json?.original_filename ?? asset.mime_type ?? asset.id;
                return (
                  <div key={asset.id} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200 bg-white p-2">
                    <span className="grid aspect-square place-items-center overflow-hidden rounded bg-slate-100 text-slate-500">
                      {asset.media_kind === "image" ? (
                        <Image src={previewUrl} alt="" width={52} height={52} unoptimized className="h-full w-full object-cover" />
                      ) : (
                        <icons.Play className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-slate-800">{name}</span>
                      <span className="block truncate text-xs font-semibold text-slate-500">
                        {asset.media_kind ?? "asset"} {typeof asset.bytes === "number" ? `· ${Math.round(asset.bytes / 1024)} KB` : ""}
                      </span>
                    </span>
                    <span className="flex gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => uploadInputRef.current?.click()}>
                        Replace
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveInputAsset(asset.id)}>
                        Remove
                      </Button>
                    </span>
                  </div>
                );
              })}
              <div className="text-xs font-semibold text-slate-500">
                Pre-job input image is stored in Product storage and linked when you generate.
              </div>
            </div>
          ) : null}
        </div>

        <Field label="Prompt">
          <textarea
            rows={6}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Describe your campaign scene, motion, product, and end frame."
            className="min-h-36 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-medium leading-6 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
          />
        </Field>

        <Field label="Model selector">
          <select
            value={model.id}
            onChange={(event) => onModelChange(event.target.value)}
            className="h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-950 outline-none transition focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
          >
            {modelOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {modelSelectorLabel(item, workflow, hasImageInput)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Aspect ratio">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {aspectRatioOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={cn(
                  "h-10 rounded-md border text-sm font-bold transition",
                  option === aspectRatio
                    ? "border-violet-500 bg-violet-50 text-violet-700 ring-2 ring-violet-100"
                    : "border-slate-200 bg-white text-slate-600 hover:border-violet-200 hover:text-slate-950",
                )}
                onClick={() => onAspectRatioChange(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Duration" helper={`Min ${model.minDurationSeconds}s, max ${model.maxDurationSeconds}s`}>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-950">Choose duration</div>
              <Badge variant="slate">{duration}s</Badge>
            </div>
            <input
              type="range"
              min={model.minDurationSeconds}
              max={model.maxDurationSeconds}
              step={1}
              value={duration}
              onChange={(event) => onDurationChange(Number(event.target.value))}
              onInput={(event) => onDurationChange(Number(event.currentTarget.value))}
              className="mt-4 h-2 w-full accent-violet-600"
            />
            <div className="mt-2 flex justify-between text-xs font-bold text-slate-400">
              <span>{model.minDurationSeconds}s</span>
              <span>{model.maxDurationSeconds}s</span>
            </div>
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Resolution">
            <select
              value={resolution}
              onChange={(event) => onResolutionChange(event.target.value as StudioResolution)}
              className="h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-950 outline-none transition focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
            >
              {resolutionOptions.map((option) => (
                <option key={option} value={option} disabled={!isStudioResolutionSupported(model, option)}>
                  {option}{isStudioResolutionSupported(model, option) ? "" : " · unavailable"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bitrate">
            <select
              value={bitrate}
              onChange={(event) => onBitrateChange(event.target.value as StudioBitrate)}
              className="h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-950 outline-none transition focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
            >
              {bitrateOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {option.description}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-600">
          <div className="flex items-center justify-between gap-3">
            <span>
              {costEstimate?.estimateAvailable && costEstimate.label && readiness.state !== "checking_cost"
                ? `${costEstimate.mode === "hermes" ? "Hermes cost estimate" : "Mock cost estimate"}: ${costEstimate.label}`
                : readiness.costHelper}
            </span>
            {readiness.state === "checking_cost" ? (
              <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                <span className="block h-full w-2/3 animate-pulse rounded-full bg-violet-500" />
              </span>
            ) : null}
          </div>
          <div className="mt-2 text-xs font-bold text-slate-500">{readiness.message}</div>
        </div>

        {(model.enablement === "needs_smoke" || costEstimate?.warning) ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-700">
            {costEstimate?.warning ?? "Not smoke-tested yet. Review cost before generating."}
          </div>
        ) : null}

        {readiness.blockedReason ? (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-700">
            {readiness.blockedReason}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}

        <Button className="h-14 w-full rounded-lg text-base" size="lg" disabled={!readiness.canGenerate} onClick={onGenerate}>
          <icons.Sparkles />
          {readiness.buttonLabel}
        </Button>
      </div>
    </Card>
  );
}

function clientErrorMessage(body: Record<string, unknown>, fallback: string): string {
  const code = typeof body.code === "string" ? body.code : "";
  const error = typeof body.error === "string" ? body.error : fallback;

  if (code === "video_agent_unreachable" || code === "video_agent_not_configured") {
    return "Hermes Video Agent is offline. Check gateway status.";
  }

  if (code === "video_agent_cost_unavailable" || code === "video_agent_invalid_response") {
    return "Hermes could not estimate this configuration. Try another model or shorter duration.";
  }

  if (code === "studio_asset_handoff_failed" || code === "video_agent_input_required") {
    return "Could not prepare input image for Hermes. Re-upload the image and try again.";
  }

  if (code === "video_agent_execution_failed") {
    return "Higgsfield generation failed. Try another model or prompt.";
  }

  return error.replace(/[a-zA-Z]:[\\/][^\s"'<>]+/g, "[local path]").replace(/file:\/\/[^\s"'<>]+/g, "[local path]");
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as unknown;

  if (!response.ok) {
    const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};

    throw new Error(clientErrorMessage(record, "Studio request failed."));
  }

  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function studioReadiness(input: {
  workflow: StudioVideoWorkflow;
  prompt: string;
  model: StudioVideoModel;
  hasImageInput: boolean;
  isUploadingInput: boolean;
  isGenerating: boolean;
  catalogLoading: boolean;
  settingsBlockedReason: string | null;
  workflowBlockedReason: string | null;
  enablementBlockedReason: string | null;
  modelRealAvailable: boolean;
  realVideoEnabled: boolean;
  costRequestState: StudioCostRequestState;
  costEstimate: CostEstimate | null;
  costFresh: boolean;
  activeJob: StudioJob | null;
}): StudioReadiness {
  const costLabel = input.costEstimate?.estimateAvailable && input.costEstimate.label
    ? input.costEstimate.label
    : null;
  const runningJob = input.activeJob?.status === "queued" || input.activeJob?.status === "running";
  const failedJob = input.activeJob?.status === "failed";
  const completedJob = input.activeJob?.status === "completed";

  if (input.isGenerating) {
    return {
      state: "creating_job",
      message: input.workflow === "image_to_video" ? "Creating image-to-video job..." : "Creating Studio job...",
      blockedReason: null,
      costHelper: costLabel ? `Refreshing estimate... ${costLabel}` : "Refreshing estimate...",
      buttonLabel: "Creating job...",
      canGenerate: false,
      badgeLabel: "Creating job",
      badgeVariant: "orange",
    };
  }

  if (input.workflow === "image_to_video" && input.isUploadingInput) {
    return {
      state: "uploading_input",
      message: "Uploading image to Product storage...",
      blockedReason: "Uploading image to Product storage...",
      costHelper: "Uploading image to Product storage...",
      buttonLabel: "Generate",
      canGenerate: false,
      badgeLabel: "Uploading image",
      badgeVariant: "orange",
    };
  }

  if (input.workflow === "image_to_video" && !input.hasImageInput) {
    return {
      state: "missing_image",
      message: "Upload an image to generate image-to-video.",
      blockedReason: "Upload an image to generate image-to-video.",
      costHelper: "Upload an image to generate image-to-video.",
      buttonLabel: "Generate",
      canGenerate: false,
      badgeLabel: "Image required",
      badgeVariant: "orange",
    };
  }

  if (!input.prompt.trim()) {
    return {
      state: "empty_prompt",
      message: "Enter a prompt to estimate cost.",
      blockedReason: "Enter a prompt to estimate cost.",
      costHelper: "Enter a prompt to estimate cost.",
      buttonLabel: "Generate",
      canGenerate: false,
      badgeLabel: "Prompt required",
      badgeVariant: "slate",
    };
  }

  if (input.catalogLoading) {
    return {
      state: "loading_catalog",
      message: "Loading Hermes model catalog...",
      blockedReason: "Loading Hermes model catalog...",
      costHelper: "Loading Hermes model catalog...",
      buttonLabel: "Generate",
      canGenerate: false,
      badgeLabel: "Loading catalog",
      badgeVariant: "orange",
    };
  }

  if (input.realVideoEnabled && (input.workflowBlockedReason || input.enablementBlockedReason || !input.modelRealAvailable)) {
    const blockedReason = input.workflowBlockedReason ?? input.enablementBlockedReason ?? "Selected model is not available for real Studio video generation.";

    return {
      state: "unsupported_workflow",
      message: blockedReason,
      blockedReason,
      costHelper: blockedReason,
      buttonLabel: "Generate",
      canGenerate: false,
      badgeLabel: input.workflow === "image_to_video" ? "Not image-to-video" : "Unavailable",
      badgeVariant: "slate",
    };
  }

  if (input.settingsBlockedReason) {
    return {
      state: "settings_invalid",
      message: input.settingsBlockedReason,
      blockedReason: input.settingsBlockedReason,
      costHelper: input.settingsBlockedReason,
      buttonLabel: "Generate",
      canGenerate: false,
      badgeLabel: "Settings invalid",
      badgeVariant: "orange",
    };
  }

  if (input.costRequestState === "checking") {
    const message = input.workflow === "image_to_video" && input.hasImageInput
      ? "Image uploaded. Checking Hermes cost estimate..."
      : "Checking Hermes cost estimate...";

    return {
      state: "checking_cost",
      message,
      blockedReason: message,
      costHelper: costLabel ? `Refreshing estimate... ${costLabel}` : message,
      buttonLabel: "Checking cost...",
      canGenerate: false,
      badgeLabel: "Checking cost",
      badgeVariant: "orange",
    };
  }

  if (!input.costFresh) {
    const message = input.workflow === "image_to_video"
      ? "Cost estimate unavailable for this image-to-video setup."
      : "Cost estimate unavailable. Adjust model/settings or try again.";

    return {
      state: "cost_unavailable",
      message,
      blockedReason: message,
      costHelper: message,
      buttonLabel: "Generate",
      canGenerate: false,
      badgeLabel: "Cost unavailable",
      badgeVariant: "orange",
    };
  }

  if (runningJob) {
    return {
      state: "job_running",
      message: "Generating with Hermes Video Agent...",
      blockedReason: "Generating with Hermes Video Agent...",
      costHelper: costLabel ? `Hermes cost estimate: ${costLabel}` : "Hermes cost estimate ready.",
      buttonLabel: "Generating...",
      canGenerate: false,
      badgeLabel: "Job running",
      badgeVariant: "orange",
    };
  }

  if (failedJob) {
    return {
      state: "failed",
      message: "Generation failed. Adjust the prompt or model and try again.",
      blockedReason: null,
      costHelper: costLabel ? `Hermes cost estimate: ${costLabel}` : "Hermes cost estimate ready.",
      buttonLabel: costLabel ? `Generate · ${costLabel}` : "Generate",
      canGenerate: true,
      badgeLabel: "Ready after failure",
      badgeVariant: "orange",
    };
  }

  if (completedJob) {
    return {
      state: "completed",
      message: input.workflow === "image_to_video" ? "Ready to generate from selected image." : "Ready to generate.",
      blockedReason: null,
      costHelper: costLabel ? `Hermes cost estimate: ${costLabel}` : "Hermes cost estimate ready.",
      buttonLabel: costLabel ? `Generate · ${costLabel}` : "Generate",
      canGenerate: true,
      badgeLabel: "Ready",
      badgeVariant: "green",
    };
  }

  return {
    state: "ready",
    message: input.workflow === "image_to_video" ? "Ready to generate from selected image." : "Ready to generate.",
    blockedReason: null,
    costHelper: costLabel ? `Hermes cost estimate: ${costLabel}` : "Hermes cost estimate ready.",
    buttonLabel: costLabel ? `Generate · ${costLabel}` : "Generate",
    canGenerate: true,
    badgeLabel: "Ready",
    badgeVariant: "green",
  };
}

export function StudioView({ imageModeEnabled = false }: { imageModeEnabled?: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [workflow, setWorkflow] = useState<StudioVideoWorkflow>("text_to_video");
  const [modelId, setModelId] = useState(STUDIO_VIDEO_MODELS[0].id);
  const [aspectRatio, setAspectRatio] = useState<StudioAspectRatio>("16:9");
  const [duration, setDuration] = useState(8);
  const [resolution, setResolution] = useState<StudioResolution>("720p");
  const [bitrate, setBitrate] = useState<StudioBitrate>("standard");
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [costRequestState, setCostRequestState] = useState<StudioCostRequestState>("idle");
  const [costEstimateKey, setCostEstimateKey] = useState<string | null>(null);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [activeJob, setActiveJob] = useState<StudioJob | null>(null);
  const [videoAgentStatus, setVideoAgentStatus] = useState<StudioVideoAgentStatus | null>(null);
  const [hermesModelIds, setHermesModelIds] = useState<Set<string>>(new Set());
  const [videoModels, setVideoModels] = useState<StudioVideoModel[]>(STUDIO_VIDEO_MODELS);
  const [catalogSource, setCatalogSource] = useState("Product fallback catalog");
  const [selectedInputAssets, setSelectedInputAssets] = useState<StudioInputAsset[]>([]);
  const [isUploadingInput, setIsUploadingInput] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userSelectedModelRef = useRef(false);
  const costRequestSequenceRef = useRef(0);

  const model = useMemo(() => findStudioVideoModel(videoModels, modelId), [modelId, videoModels]);
  const agentConnected = videoAgentStatus?.connected === true;
  const realVideoEnabled = videoAgentStatus?.realVideoEnabled === true;
  const inputAsset = selectedImageAsset(selectedInputAssets);
  const hasImageInput = Boolean(inputAsset);
  const costInputKey = useMemo(() => JSON.stringify({
    workflow,
    prompt: prompt.trim(),
    modelId: model.id,
    providerModelId: model.providerModelId ?? null,
    duration,
    aspectRatio,
    resolution,
    bitrate,
    inputImageId: workflow === "image_to_video" ? inputAsset?.id ?? null : null,
  }), [aspectRatio, bitrate, duration, inputAsset?.id, model.id, model.providerModelId, prompt, resolution, workflow]);
  const costFresh = costRequestState === "ready" && costEstimateKey === costInputKey && costEstimate?.estimateAvailable === true;
  const modelRealAvailable = agentConnected && modelAvailableForWorkflow(model, workflow, hasImageInput) && Boolean(model.providerModelId && hermesModelIds.has(model.providerModelId));
  const settingsBlockedReason = validateStudioVideoSettings({ model: validationModelForWorkflow(model, workflow, hasImageInput), durationSeconds: duration, aspectRatio, resolution, bitrate });
  const workflowBlockedReason = realVideoEnabled && workflow === "image_to_video" && hasImageInput && !studioModelSupportsWorkflowOperation(model, "image_to_video")
    ? "This model does not support image-to-video."
    : realVideoEnabled && workflow === "image_to_video" && hasImageInput
      ? unsupportedStudioWorkflowInputStatus(model, "image_to_video")
      : null;
  const enablementBlockedReason = realVideoEnabled && workflow === "text_to_video" && (model.enablement === "disabled_until_upload" || model.enablement === "unavailable")
    ? model.disabledReason ?? disabledReasonForEnablement(model.enablement)
    : null;
  const canAttemptCostEstimate = Boolean(prompt.trim())
    && (workflow !== "image_to_video" || hasImageInput)
    && !isUploadingInput
    && videoAgentStatus !== null
    && !settingsBlockedReason
    && !workflowBlockedReason
    && !enablementBlockedReason
    && (!realVideoEnabled || modelRealAvailable);
  const effectiveCostRequestState: StudioCostRequestState = !canAttemptCostEstimate
    ? "idle"
    : costEstimateKey !== costInputKey
      ? "checking"
      : costRequestState;
  const readiness = studioReadiness({
    workflow,
    prompt,
    model,
    hasImageInput,
    isUploadingInput,
    isGenerating,
    catalogLoading: videoAgentStatus === null,
    settingsBlockedReason,
    workflowBlockedReason,
    enablementBlockedReason,
    modelRealAvailable,
    realVideoEnabled,
    costRequestState: effectiveCostRequestState,
    costEstimate,
    costFresh,
    activeJob,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadVideoAgentState() {
      try {
        const [statusResponse, modelsResponse] = await Promise.all([
          fetch("/api/cmo/studio/video-agent/status", { cache: "no-store" }),
          fetch("/api/cmo/studio/video-agent/models", { cache: "no-store" }),
        ]);
        const statusBody = await parseJsonResponse(statusResponse);
        const modelsBody = await parseJsonResponse(modelsResponse);
        const modelIds = new Set<string>();
        const nextModels = Array.isArray(modelsBody.models)
          ? modelsBody.models.map(modelFromApi).filter((item): item is StudioVideoModel => Boolean(item))
          : [];

        if (Array.isArray(modelsBody.models)) {
          for (const item of nextModels) {
            if ((canUseRealTextToVideoModel(item) || canUseImageToVideoModel(item, true)) && item.providerModelId) {
              modelIds.add(item.providerModelId);
            }
          }
        }

        if (!cancelled) {
          setVideoAgentStatus(statusBody as unknown as StudioVideoAgentStatus);
          if (nextModels.length) {
            setVideoModels(nextModels);
            setCatalogSource(typeof modelsBody.source === "string" ? modelsBody.source : "Hermes catalog");
          }
          setHermesModelIds(modelIds);
          if (
            statusBody.realVideoEnabled === true &&
            statusBody.connected === true &&
            modelIds.has(REAL_STUDIO_VIDEO_PROVIDER_MODEL_ID) &&
            !userSelectedModelRef.current
          ) {
            const realDefaultModel = nextModels.find((item) => item.providerModelId === REAL_STUDIO_VIDEO_PROVIDER_MODEL_ID || item.id === REAL_STUDIO_VIDEO_PROVIDER_MODEL_ID)
              ?? getStudioVideoModel(REAL_STUDIO_VIDEO_PROVIDER_MODEL_ID);

            setModelId(realDefaultModel.id);
            setDuration((current) => clampStudioDuration(realDefaultModel, realDefaultModel.defaultDurationSeconds ?? current));
            setAspectRatio(realDefaultModel.defaultAspectRatio ?? "16:9");
            setResolution(realDefaultModel.defaultResolution ?? realDefaultModel.maxResolution);
            setBitrate(realDefaultModel.defaultBitrate ?? "standard");
          }
        }
      } catch {
        if (!cancelled) {
          setVideoAgentStatus({
            configured: false,
            connected: false,
            setupRequired: true,
            message: "Hermes Video Agent status unavailable.",
          });
          setHermesModelIds(new Set());
        }
      }
    }

    void loadVideoAgentState();
    const timer = window.setInterval(loadVideoAgentState, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const requestSequence = costRequestSequenceRef.current + 1;
    const currentCostKey = costInputKey;
    costRequestSequenceRef.current = requestSequence;

    if (!canAttemptCostEstimate) {
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/cmo/studio/cost/estimate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mediaKind: "video",
            agent: "video",
            backend: "higgsfield",
            operation: "generate_video",
            workflow,
            requestId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
            prompt,
            model: {
              uiId: model.id,
              providerModelId: model.providerModelId,
              provider_model_id: model.providerModelId,
              label: model.name,
            },
            inputAssetIds: workflow === "image_to_video" && inputAsset ? [inputAsset.id] : [],
            settings: {
              durationSeconds: duration,
              aspectRatio,
              resolution,
              bitrate,
              variants: 1,
            },
          }),
        });
        const body = await parseJsonResponse(response);
        const estimate = costEstimateFromBody(body);

        if (costRequestSequenceRef.current === requestSequence) {
          setCostEstimate(estimate);
          setCostEstimateKey(currentCostKey);
          setCostRequestState(estimate.estimateAvailable ? "ready" : "unavailable");
        }
      } catch (costError) {
        if (costRequestSequenceRef.current === requestSequence) {
          setCostEstimate({
            estimateAvailable: false,
            reason: costError instanceof Error ? costError.message : undefined,
          });
          setCostEstimateKey(currentCostKey);
          setCostRequestState("unavailable");
        }
      }
    }, 400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    aspectRatio,
    bitrate,
    costInputKey,
    canAttemptCostEstimate,
    duration,
    enablementBlockedReason,
    hasImageInput,
    inputAsset,
    isUploadingInput,
    model.id,
    model.name,
    model.providerModelId,
    modelRealAvailable,
    prompt,
    realVideoEnabled,
    resolution,
    settingsBlockedReason,
    videoAgentStatus,
    workflow,
    workflowBlockedReason,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadJobs() {
      try {
        const response = await fetch("/api/cmo/studio/jobs?limit=12", { cache: "no-store" });
        const body = await parseJsonResponse(response);
        const nextJobs = Array.isArray(body.jobs) ? body.jobs as StudioJob[] : [];

        if (!cancelled) {
          setJobs(nextJobs);
          setActiveJob((current) => {
            if (!current) {
              return nextJobs[0] ?? null;
            }

            return nextJobs.find((job) => job.id === current.id) ?? current;
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load Studio jobs.");
        }
      }
    }

    void loadJobs();
    const timer = window.setInterval(loadJobs, 1800);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!activeJob || !["queued", "running"].includes(activeJob.status)) {
      return;
    }

    let cancelled = false;

    async function pollJob() {
      try {
        const response = await fetch(`/api/cmo/studio/jobs/${activeJob?.id}`, { cache: "no-store" });
        const body = await parseJsonResponse(response);
        const nextJob = body.job as StudioJob | undefined;

        if (!cancelled && nextJob) {
          setActiveJob(nextJob);
          setJobs((current) => current.map((job) => job.id === nextJob.id ? nextJob : job));
        }
      } catch {
        // The history poll will surface durable API errors.
      }
    }

    const timer = window.setInterval(pollJob, 1400);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJob]);

  async function generateJob() {
    if (!readiness.canGenerate) {
      setError(null);
      return;
    }

    setError(null);
    setIsGenerating(true);

    try {
      const response = await fetch("/api/cmo/studio/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
        },
        body: JSON.stringify({
          mediaKind: "video",
          agent: "video",
          backend: "higgsfield",
          operation: "generate_video",
          workflow,
          prompt,
          model: {
            uiId: model.id,
            providerModelId: model.providerModelId,
            provider_model_id: model.providerModelId,
            label: model.name,
          },
          settings: {
            aspectRatio,
            durationSeconds: duration,
            resolution,
            bitrate,
            variants: 1,
          },
          inputAssetIds: workflow === "image_to_video" && inputAsset ? [inputAsset.id] : [],
          ...(costFresh && costEstimate?.mode === "hermes" ? { costEstimate } : {}),
        }),
      });
      const body = await parseJsonResponse(response);
      const job = body.job as StudioJob;

      setActiveJob(job);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      if (workflow === "text_to_video") {
        setSelectedInputAssets([]);
      }
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Unable to create Studio job.");
    } finally {
      setIsGenerating(false);
    }
  }

  function handleModelChange(value: string) {
    const nextModel = findStudioVideoModel(videoModels, value);

    userSelectedModelRef.current = true;
    setModelId(nextModel.id);
    setDuration((current) => clampStudioDuration(nextModel, current));
    setAspectRatio((current) => nextModel.supportedAspectRatios?.includes(current) ? current : nextModel.defaultAspectRatio ?? nextModel.supportedAspectRatios?.[0] ?? "16:9");
    setResolution((current) => isStudioResolutionSupported(nextModel, current) ? current : nextModel.maxResolution);
    setBitrate((current) => nextModel.supportedBitrates?.includes(current) ? current : nextModel.defaultBitrate ?? nextModel.supportedBitrates?.[0] ?? "standard");
  }

  async function uploadInputAsset(file: File) {
    if (!file.type.startsWith("image/")) {
      setUploadStatus("Upload an image to generate image-to-video.");
      return;
    }

    const replacingImage = Boolean(selectedImageAsset(selectedInputAssets));

    setError(null);
    setIsUploadingInput(true);
    setUploadStatus("Preparing Product upload session...");

    try {
      const mediaKind = file.type.startsWith("image/") ? "image" : "video";
      const initResponse = await fetch("/api/cmo/studio/assets/ingest/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mediaKind,
          purpose: "studio_input",
          expectedMimeType: file.type,
        }),
      });
      const initBody = await parseJsonResponse(initResponse);
      const uploadTarget = typeof initBody.upload_target === "string" ? initBody.upload_target : null;
      const sessionId = typeof initBody.session_id === "string" ? initBody.session_id : null;

      if (!uploadTarget || !sessionId) {
        throw new Error("Studio upload session response was incomplete.");
      }

      setUploadStatus("Uploading image to Product storage...");
      const uploadResponse = await fetch(uploadTarget, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });

      await parseJsonResponse(uploadResponse);
      setUploadStatus("Finalizing input asset...");

      const completeResponse = await fetch("/api/cmo/studio/assets/ingest/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          metadata: {
            original_filename: file.name,
            source: "studio_ui_input",
          },
        }),
      });
      const completeBody = await parseJsonResponse(completeResponse);
      const asset = completeBody.asset as StudioInputAsset | undefined;

      if (!asset?.id) {
        throw new Error("Studio input asset response was incomplete.");
      }

      setSelectedInputAssets([asset]);
      setCostEstimateKey(null);
      setCostRequestState("checking");
      setUploadStatus(replacingImage ? "Image replaced. Checking Hermes cost estimate..." : "Image uploaded. Checking Hermes cost estimate...");
    } catch (uploadError) {
      setUploadStatus(uploadError instanceof Error ? uploadError.message : "Input media upload failed.");
    } finally {
      setIsUploadingInput(false);
    }
  }

  function handleDurationChange(value: number) {
    setDuration(clampStudioDuration(model, value));
  }

  function handleResolutionChange(eventValue: StudioResolution) {
    if (isStudioResolutionSupported(model, eventValue)) {
      setResolution(eventValue);
    }
  }

  function handlePromptChange(eventValue: string) {
    setPrompt(eventValue);
    if (error) {
      setError(null);
    }
  }

  return (
    <PageChrome
      title="Studio"
      description="Generate campaign images and videos through specialized creative agents."
      actions={<></>}
    >
      <div className="grid gap-5 xl:grid-cols-[500px_minmax(0,1fr)]">
        <div className="space-y-5">
          <StudioConsole
            imageModeEnabled={imageModeEnabled}
            videoAgentStatus={videoAgentStatus}
            modelRealAvailable={modelRealAvailable}
            readiness={readiness}
            workflow={workflow}
            prompt={prompt}
            model={model}
            models={videoModels}
            catalogSource={catalogSource}
            aspectRatio={aspectRatio}
            duration={duration}
            resolution={resolution}
            bitrate={bitrate}
            costEstimate={costEstimate}
            selectedInputAssets={selectedInputAssets}
            isUploadingInput={isUploadingInput}
            uploadStatus={uploadStatus}
            error={error}
            onPromptChange={handlePromptChange}
            onWorkflowChange={setWorkflow}
            onModelChange={handleModelChange}
            onAspectRatioChange={setAspectRatio}
            onDurationChange={handleDurationChange}
            onResolutionChange={handleResolutionChange}
            onBitrateChange={setBitrate}
            onUploadInput={uploadInputAsset}
            onRemoveInputAsset={(assetId) => {
              setSelectedInputAssets((current) => current.filter((asset) => asset.id !== assetId));
              setCostEstimateKey(null);
              setCostRequestState("idle");
            }}
            onGenerate={generateJob}
          />
          <HistoryPanel jobs={jobs} activeJobId={activeJob?.id ?? null} onSelect={setActiveJob} />
        </div>

        <main className="min-w-0 space-y-5">
          <CanvasPreview
            aspectRatio={aspectRatio}
            activeJob={activeJob}
            agentConnected={agentConnected}
            workflow={workflow}
            selectedInputAssets={selectedInputAssets}
          />

          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-950">Render state</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  {agentConnected ? "Async Product job shell dispatching server-side to Hermes Video Agent." : "Async Product job shell with timestamp-based mock progression."}
                </div>
              </div>
              <Badge variant="slate">{activeJob ? activeJob.id.slice(0, 22) : "No active job"}</Badge>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              {[
                ["Queued", activeJob ? ["queued", "running", "completed"].includes(activeJob.status) : false],
                ["Running", activeJob ? ["running", "completed"].includes(activeJob.status) : false],
                ["Artifact metadata", activeJob?.status === "completed"],
              ].map(([label, complete]) => (
                <div key={String(label)} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                  <div className="text-sm font-bold text-slate-700">{label}</div>
                  <Badge className="mt-2" variant={complete ? "green" : "slate"}>{complete ? "Done" : "Waiting"}</Badge>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </PageChrome>
  );
}
