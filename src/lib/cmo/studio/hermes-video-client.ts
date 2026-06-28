import "server-only";

import { CmoAdapterError } from "@/lib/cmo/errors";

const STATUS_PATH = "/agents/video/status";
const MODELS_PATH = "/agents/video/models";
const COST_PATH = "/agents/video/cost";
const EXECUTE_PATH = "/agents/video/execute";
const DEFAULT_TIMEOUT_MS = 120000;

export type HermesVideoAgentErrorCode =
  | "video_agent_not_configured"
  | "video_agent_unreachable"
  | "video_agent_auth_failed"
  | "video_agent_invalid_response"
  | "video_agent_execution_failed";

export interface HermesVideoCostRequest {
  operation: "generate_video";
  model?: string;
  provider_model_id: string;
  settings: {
    duration_seconds: number;
    aspect_ratio: string;
    resolution: string;
    bitrate: string;
    variants: number;
  };
  context?: Record<string, unknown>;
}

export interface HermesVideoExecuteRequest extends HermesVideoCostRequest {
  job_id: string;
  prompt: string;
  model_ui_id: string;
  artifact_transport: {
    mode: "product_upload";
    upload_endpoint: null;
    headers: Record<string, never>;
  };
}

export interface HermesVideoExecuteResult {
  status: "completed" | "failed" | "running" | "queued";
  provider_job_id?: string | null;
  provider_status?: string;
  estimated_credits?: number;
  render_url?: string | null;
  thumbnail_url?: string | null;
  duration_seconds?: number;
  aspect_ratio?: string;
  resolution?: string;
  error?: Record<string, unknown> | null;
  raw?: Record<string, unknown>;
}

export interface HermesVideoAgentSetupState {
  configured: boolean;
  connected: boolean;
  setupRequired: boolean;
  cli_available: null;
  authenticated: null;
  backend: "higgsfield";
  message: string;
  code: HermesVideoAgentErrorCode;
}

interface HermesConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hermesConfig(): HermesConfig | null {
  const baseUrl = stringValue(process.env.CMO_HERMES_VIDEO_AGENT_BASE_URL);
  const apiKey = stringValue(process.env.CMO_HERMES_VIDEO_AGENT_API_KEY);

  if (!baseUrl || !apiKey) {
    return null;
  }

  const timeout = Number.parseInt(process.env.CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS ?? "", 10);

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

export function isHermesVideoAgentConfigured(): boolean {
  return hermesConfig() !== null;
}

export function getHermesVideoAgentSetupState(): HermesVideoAgentSetupState {
  return {
    configured: false,
    connected: false,
    setupRequired: true,
    cli_available: null,
    authenticated: null,
    backend: "higgsfield",
    message: "Set the Hermes Video Agent base URL and API key on the Product server to enable real Studio video generation.",
    code: "video_agent_not_configured",
  };
}

function hermesUrl(config: HermesConfig, path: string): string {
  try {
    return new URL(path, `${config.baseUrl}/`).toString();
  } catch {
    throw new CmoAdapterError("Hermes Video Agent base URL is invalid.", 500, "video_agent_not_configured");
  }
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }

  if (!isRecord(value)) {
    return typeof value === "string" ? safeString(value) : value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /api[_-]?key|authorization|bearer|token|secret/i.test(key) ? "[redacted]" : redactSensitive(item),
    ]),
  );
}

function safeString(value: string): string {
  if (
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith("file:") ||
    /^\/(?:tmp|var|Users|home|mnt|Volumes|private)(?:\/|$)/.test(value)
  ) {
    return "[local-path-redacted]";
  }

  return value;
}

function safeUrl(value: unknown): string | null {
  const raw = stringValue(value);

  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

async function parseJsonResponse(response: Response, execute = false): Promise<Record<string, unknown>> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new CmoAdapterError("Hermes Video Agent returned invalid JSON.", 502, "video_agent_invalid_response");
  }

  const data = isRecord(body) ? body : {};

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new CmoAdapterError("Hermes Video Agent authentication failed.", 502, "video_agent_auth_failed");
    }

    const message = stringValue(data.error) ?? stringValue(data.message) ?? "Hermes Video Agent request failed.";
    throw new CmoAdapterError(
      message,
      502,
      execute ? "video_agent_execution_failed" : "video_agent_unreachable",
    );
  }

  return data;
}

async function hermesRequest(path: string, init?: RequestInit, options?: { execute?: boolean }): Promise<Record<string, unknown>> {
  const config = hermesConfig();

  if (!config) {
    throw new CmoAdapterError("Hermes Video Agent is not configured.", 503, "video_agent_not_configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(hermesUrl(config, path), {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
        authorization: `Bearer ${config.apiKey}`,
      },
    });

    return parseJsonResponse(response, options?.execute === true);
  } catch (error) {
    if (error instanceof CmoAdapterError) {
      throw error;
    }

    throw new CmoAdapterError("Hermes Video Agent is unreachable.", 502, "video_agent_unreachable");
  } finally {
    clearTimeout(timer);
  }
}

export async function getVideoAgentStatus(): Promise<Record<string, unknown>> {
  const body = await hermesRequest(STATUS_PATH);
  const sanitized = redactSensitive(body);

  if (!isRecord(sanitized)) {
    throw new CmoAdapterError("Hermes Video Agent status response is invalid.", 502, "video_agent_invalid_response");
  }

  return {
    configured: true,
    connected: sanitized.connected !== false,
    setupRequired: false,
    cli_available: typeof sanitized.cli_available === "boolean" ? sanitized.cli_available : null,
    authenticated: typeof sanitized.authenticated === "boolean" ? sanitized.authenticated : null,
    backend: stringValue(sanitized.backend) ?? "higgsfield",
    message: stringValue(sanitized.message) ?? "Hermes Video Agent is reachable.",
  };
}

export async function getVideoAgentModels(): Promise<Record<string, unknown>[]> {
  const body = await hermesRequest(MODELS_PATH);
  const source = body.models ?? body.data;

  if (!Array.isArray(source)) {
    throw new CmoAdapterError("Hermes Video Agent models response is invalid.", 502, "video_agent_invalid_response");
  }

  return source
    .filter(isRecord)
    .map((item) => {
      const uiId = stringValue(item.ui_id ?? item.uiId ?? item.id ?? item.model);
      const explicitProviderModelId = stringValue(item.provider_model_id ?? item.providerModelId);
      const providerModelId = explicitProviderModelId ?? (uiId === "seedance_2_0" ? uiId : undefined);
      const duration = isRecord(item.duration) ? item.duration : {};
      const resolutions = stringArray(item.resolutions ?? item.supported_resolutions ?? item.supportedResolutions);

      if (!uiId) {
        throw new CmoAdapterError("Hermes Video Agent models response is invalid.", 502, "video_agent_invalid_response");
      }

      return {
        id: uiId,
        uiId,
        provider_model_id: providerModelId ?? null,
        providerModelId: providerModelId ?? null,
        name: stringValue(item.name ?? item.label) ?? uiId,
        label: stringValue(item.label ?? item.name) ?? uiId,
        family: stringValue(item.family) ?? null,
        operations: stringArray(item.operations),
        resolutions,
        default_resolution: stringValue(item.default_resolution ?? item.defaultResolution) ?? null,
        defaultResolution: stringValue(item.default_resolution ?? item.defaultResolution) ?? null,
        available: item.available !== false,
        real_video_supported: uiId === "seedance_2_0",
        max_resolution: stringValue(item.max_resolution ?? item.maxResolution) ?? resolutions.at(-1) ?? null,
        min_duration_seconds: numberValue(item.min_duration_seconds ?? item.minDurationSeconds ?? duration.min_seconds ?? duration.minSeconds) ?? null,
        minDurationSeconds: numberValue(item.min_duration_seconds ?? item.minDurationSeconds ?? duration.min_seconds ?? duration.minSeconds) ?? null,
        max_duration_seconds: numberValue(item.max_duration_seconds ?? item.maxDurationSeconds ?? duration.max_seconds ?? duration.maxSeconds) ?? null,
        maxDurationSeconds: numberValue(item.max_duration_seconds ?? item.maxDurationSeconds ?? duration.max_seconds ?? duration.maxSeconds) ?? null,
        default_duration_seconds: numberValue(item.default_duration_seconds ?? item.defaultDurationSeconds ?? duration.default_seconds ?? duration.defaultSeconds) ?? null,
        defaultDurationSeconds: numberValue(item.default_duration_seconds ?? item.defaultDurationSeconds ?? duration.default_seconds ?? duration.defaultSeconds) ?? null,
        supports_bitrate: typeof item.supports_bitrate === "boolean" ? item.supports_bitrate : item.supportsBitrate === true,
        supports_audio: typeof item.supports_audio === "boolean" ? item.supports_audio : item.supportsAudio === true,
        badges: stringArray(item.badges),
      };
    });
}

export async function estimateVideoCost(request: HermesVideoCostRequest): Promise<Record<string, unknown>> {
  const body = await hermesRequest(COST_PATH, {
    method: "POST",
    body: JSON.stringify(request),
  });
  const credits = numberValue(body.credits ?? body.estimated_credits);
  const label = stringValue(body.label) ?? (credits !== undefined ? `~${credits} credits` : undefined);

  return {
    estimateAvailable: body.estimateAvailable === true || body.estimate_available === true || credits !== undefined,
    ...(credits !== undefined ? { credits } : {}),
    ...(label ? { label } : {}),
    mode: "hermes",
  };
}

export async function executeVideoJob(request: HermesVideoExecuteRequest): Promise<HermesVideoExecuteResult> {
  const body = await hermesRequest(EXECUTE_PATH, {
    method: "POST",
    body: JSON.stringify(request),
  }, { execute: true });

  const renderUrl = safeUrl(body.render_url ?? body.renderUrl ?? body.video_url ?? body.videoUrl);
  const thumbnailUrl = safeUrl(body.thumbnail_url ?? body.thumbnailUrl ?? body.preview_url ?? body.previewUrl);
  const status = stringValue(body.status ?? body.provider_status) ?? "completed";
  const normalizedStatus = status === "failed" ? "failed" : status === "running" ? "running" : status === "queued" ? "queued" : "completed";

  if (normalizedStatus === "completed" && !renderUrl) {
    throw new CmoAdapterError("Hermes Video Agent completed without a safe render URL.", 502, "video_agent_invalid_response");
  }

  return {
    status: normalizedStatus,
    provider_job_id: stringValue(body.provider_job_id ?? body.providerJobId ?? body.job_id ?? body.id) ?? null,
    provider_status: status,
    estimated_credits: numberValue(body.estimated_credits ?? body.credits),
    render_url: renderUrl,
    thumbnail_url: thumbnailUrl,
    duration_seconds: numberValue(body.duration_seconds ?? body.durationSeconds),
    aspect_ratio: stringValue(body.aspect_ratio ?? body.aspectRatio),
    resolution: stringValue(body.resolution),
    error: isRecord(body.error) ? redactSensitive(body.error) as Record<string, unknown> : null,
    raw: redactSensitive(body) as Record<string, unknown>,
  };
}
