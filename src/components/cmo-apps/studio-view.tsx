"use client";

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
  getStudioVideoModel,
  isStudioResolutionSupported,
  type StudioAspectRatio,
  type StudioBitrate,
  type StudioResolution,
  type StudioVideoModel,
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
  };
  provider_status?: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface CostEstimate {
  estimateAvailable: boolean;
  credits?: number;
  label?: string;
  mode?: "mock" | "hermes";
  reason?: string;
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
    ...(typeof body.label === "string" ? { label: body.label } : {}),
    ...(body.mode === "mock" || body.mode === "hermes" ? { mode: body.mode } : {}),
    ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
  };
}

function ModelHeroCard({
  model,
  agentConnected,
  realAvailable,
}: {
  model: StudioVideoModel;
  agentConnected: boolean;
  realAvailable: boolean;
}) {
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
        <Badge variant="slate">Mock catalog</Badge>
        {realAvailable ? <Badge variant="green">Real enabled</Badge> : agentConnected ? <Badge variant="orange">Unavailable in v1</Badge> : null}
      </div>
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
        ) : jobs.map((job) => (
          <button
            key={job.id}
            type="button"
            className={cn(
              "grid w-full grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-slate-50/70 p-2 text-left transition hover:border-violet-200 hover:bg-violet-50/40",
              activeJobId === job.id ? "border-violet-300 ring-2 ring-violet-100" : "border-slate-200",
            )}
            onClick={() => onSelect(job)}
          >
            <span className="grid aspect-video place-items-center rounded-md bg-[linear-gradient(135deg,#eef2ff,#f5f3ff_45%,#e0f2fe)] text-violet-700">
              <icons.Play className="size-5" />
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
        ))}
      </div>
    </Card>
  );
}

function CanvasPreview({
  aspectRatio,
  activeJob,
  agentConnected,
}: {
  aspectRatio: StudioAspectRatio;
  activeJob: StudioJob | null;
  agentConnected: boolean;
}) {
  const status = activeJob?.status ?? "draft";
  const complete = status === "completed";
  const running = status === "queued" || status === "running";
  const remoteResult = activeJob?.diagnostics_json?.remote_result;
  const renderUrl = typeof remoteResult?.render_url === "string" ? remoteResult.render_url : null;
  const thumbnailUrl = typeof remoteResult?.thumbnail_url === "string" ? remoteResult.thumbnail_url : undefined;

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
            {renderUrl ? <Badge variant="green">Remote Higgsfield result</Badge> : null}
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
                  <Badge variant="slate">{activeJob.settings_json.resolution ?? "720p"}</Badge>
                  <Badge variant="slate">{activeJob.settings_json.bitrate ?? "standard"}</Badge>
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
  generateBlockedReason,
  prompt,
  model,
  aspectRatio,
  duration,
  resolution,
  bitrate,
  costEstimate,
  isGenerating,
  error,
  onPromptChange,
  onModelChange,
  onAspectRatioChange,
  onDurationChange,
  onResolutionChange,
  onBitrateChange,
  onGenerate,
}: {
  imageModeEnabled: boolean;
  videoAgentStatus: StudioVideoAgentStatus | null;
  modelRealAvailable: boolean;
  generateBlockedReason: string | null;
  prompt: string;
  model: StudioVideoModel;
  aspectRatio: StudioAspectRatio;
  duration: number;
  resolution: StudioResolution;
  bitrate: StudioBitrate;
  costEstimate: CostEstimate | null;
  isGenerating: boolean;
  error: string | null;
  onPromptChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onAspectRatioChange: (value: StudioAspectRatio) => void;
  onDurationChange: (value: number) => void;
  onResolutionChange: (value: StudioResolution) => void;
  onBitrateChange: (value: StudioBitrate) => void;
  onGenerate: () => void;
}) {
  const generateLabel = costEstimate?.estimateAvailable && costEstimate.label
    ? `Generate · ${costEstimate.label}`
    : "Generate";
  const agentConnected = videoAgentStatus?.connected === true;

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
        <ModelHeroCard model={model} agentConnected={agentConnected} realAvailable={modelRealAvailable} />

        <button
          type="button"
          className="grid min-h-32 w-full place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition hover:border-violet-300 hover:bg-violet-50/30"
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
          <span className="mt-4 text-lg font-bold text-slate-500">Upload media</span>
          <span className="mt-1 text-sm font-bold text-slate-500">Job-scoped Product upload session</span>
        </button>

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
            {STUDIO_VIDEO_MODELS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · up to {item.maxResolution} · {item.minDurationSeconds}s-{item.maxDurationSeconds}s
              </option>
            ))}
          </select>
        </Field>

        <Field label="Aspect ratio">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {STUDIO_ASPECT_RATIOS.map((option) => (
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
              {STUDIO_RESOLUTIONS.map((option) => (
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
              {STUDIO_BITRATES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {option.description}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-600">
          {costEstimate?.estimateAvailable && costEstimate.label
            ? `${costEstimate.mode === "hermes" ? "Hermes cost estimate" : "Mock cost estimate"}: ${costEstimate.label}`
            : costEstimate?.reason ?? "Cost estimate unavailable"}
        </div>

        {generateBlockedReason ? (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-700">
            {generateBlockedReason}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}

        <Button className="h-14 w-full rounded-lg text-base" size="lg" disabled={isGenerating || !prompt.trim() || Boolean(generateBlockedReason)} onClick={onGenerate}>
          <icons.Sparkles />
          {isGenerating ? "Creating job..." : generateLabel}
        </Button>
      </div>
    </Card>
  );
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as unknown;

  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? String((body as { error?: unknown }).error) : "Studio request failed.";
    throw new Error(error);
  }

  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

export function StudioView({ imageModeEnabled = false }: { imageModeEnabled?: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState(STUDIO_VIDEO_MODELS[0].id);
  const [aspectRatio, setAspectRatio] = useState<StudioAspectRatio>("16:9");
  const [duration, setDuration] = useState(8);
  const [resolution, setResolution] = useState<StudioResolution>("720p");
  const [bitrate, setBitrate] = useState<StudioBitrate>("standard");
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [activeJob, setActiveJob] = useState<StudioJob | null>(null);
  const [videoAgentStatus, setVideoAgentStatus] = useState<StudioVideoAgentStatus | null>(null);
  const [hermesModelIds, setHermesModelIds] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userSelectedModelRef = useRef(false);

  const model = useMemo(() => getStudioVideoModel(modelId), [modelId]);
  const agentConnected = videoAgentStatus?.connected === true;
  const realVideoEnabled = videoAgentStatus?.realVideoEnabled === true;
  const modelRealAvailable = agentConnected && Boolean(model.providerModelId && hermesModelIds.has(model.providerModelId));
  const generateBlockedReason = realVideoEnabled && !modelRealAvailable
    ? "Selected model is not available for real Studio video generation."
    : null;

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

        if (Array.isArray(modelsBody.models)) {
          for (const item of modelsBody.models) {
            if (item && typeof item === "object" && "provider_model_id" in item) {
              const providerModelId = (item as { provider_model_id?: unknown }).provider_model_id;
              const available = (item as { available?: unknown }).available;

              if (typeof providerModelId === "string" && available !== false) {
                modelIds.add(providerModelId);
              }
            }
          }
        }

        if (!cancelled) {
          setVideoAgentStatus(statusBody as unknown as StudioVideoAgentStatus);
          setHermesModelIds(modelIds);
          if (
            statusBody.realVideoEnabled === true &&
            statusBody.connected === true &&
            modelIds.has(REAL_STUDIO_VIDEO_PROVIDER_MODEL_ID) &&
            !userSelectedModelRef.current
          ) {
            const realDefaultModel = getStudioVideoModel(REAL_STUDIO_VIDEO_PROVIDER_MODEL_ID);

            setModelId(realDefaultModel.id);
            setDuration((current) => clampStudioDuration(realDefaultModel, current));
            setResolution((current) => isStudioResolutionSupported(realDefaultModel, current) ? current : realDefaultModel.maxResolution);
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
    let cancelled = false;

    async function estimateCost() {
      try {
        const response = await fetch("/api/cmo/studio/cost/estimate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mediaKind: "video",
            agent: "video",
            backend: "higgsfield",
            operation: "generate_video",
            prompt,
            model: {
              uiId: model.id,
              provider_model_id: model.providerModelId,
              label: model.name,
            },
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

        if (!cancelled) {
          setCostEstimate(costEstimateFromBody(body));
        }
      } catch {
        if (!cancelled) {
          setCostEstimate({ estimateAvailable: false });
        }
      }
    }

    void estimateCost();

    return () => {
      cancelled = true;
    };
  }, [model, prompt, duration, aspectRatio, resolution, bitrate]);

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
    if (generateBlockedReason) {
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
          ...(costEstimate?.mode === "hermes" ? { costEstimate } : {}),
        }),
      });
      const body = await parseJsonResponse(response);
      const job = body.job as StudioJob;

      setActiveJob(job);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Unable to create Studio job.");
    } finally {
      setIsGenerating(false);
    }
  }

  function handleModelChange(value: string) {
    const nextModel = getStudioVideoModel(value);

    userSelectedModelRef.current = true;
    setModelId(nextModel.id);
    setDuration((current) => clampStudioDuration(nextModel, current));
    setResolution((current) => isStudioResolutionSupported(nextModel, current) ? current : nextModel.maxResolution);
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
            generateBlockedReason={generateBlockedReason}
            prompt={prompt}
            model={model}
            aspectRatio={aspectRatio}
            duration={duration}
            resolution={resolution}
            bitrate={bitrate}
            costEstimate={costEstimate}
            isGenerating={isGenerating}
            error={error}
            onPromptChange={handlePromptChange}
            onModelChange={handleModelChange}
            onAspectRatioChange={setAspectRatio}
            onDurationChange={handleDurationChange}
            onResolutionChange={handleResolutionChange}
            onBitrateChange={setBitrate}
            onGenerate={generateJob}
          />
          <HistoryPanel jobs={jobs} activeJobId={activeJob?.id ?? null} onSelect={setActiveJob} />
        </div>

        <main className="min-w-0 space-y-5">
          <CanvasPreview aspectRatio={aspectRatio} activeJob={activeJob} agentConnected={agentConnected} />

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
