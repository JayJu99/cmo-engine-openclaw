import "server-only";

import { CmoAdapterError } from "@/lib/cmo/errors";
import {
  STUDIO_ASPECT_RATIOS,
  STUDIO_VIDEO_MODELS,
  disabledReasonForEnablement,
  enablementLabel,
  normalizeStudioAspectRatio,
  normalizeStudioBitrate,
  normalizeStudioResolution,
  normalizeStudioVideoMode,
  type StudioVideoEnablement,
} from "@/lib/cmo/studio-model-catalog";

const STATUS_PATH = "/agents/video/status";
const MODELS_PATH = "/agents/video/models";
const COST_PATH = "/agents/video/cost";
const EXECUTE_PATH = "/agents/video/execute";
const DEFAULT_TIMEOUT_MS = 120000;
const IMAGE_TO_VIDEO_INPUTS = new Set(["prompt", "text", "start_image", "image", "image_references", "end_image"]);

export type HermesVideoAgentErrorCode =
  | "video_agent_not_configured"
  | "video_agent_unreachable"
  | "video_agent_auth_failed"
  | "video_agent_invalid_response"
  | "video_agent_execution_failed";

export interface HermesVideoCostRequest {
  request_id?: string;
  prompt?: string;
  operation: "generate_video";
  workflow?: "text_to_video" | "image_to_video";
  backend?: "higgsfield";
  model: {
    ui_id: string;
    provider_model_id: string;
  };
  settings: {
    duration_seconds: number;
    aspect_ratio: string;
    resolution: string;
    variants: number;
    bitrate?: string;
    mode?: string;
  };
  inputs?: {
    images: HermesVideoInputImage[];
    videos: unknown[];
    audio: unknown[];
  };
  context?: Record<string, unknown>;
}

export interface HermesVideoInputImage {
  asset_id: string;
  role: "start_image" | "end_image" | "image_reference";
  download_url: string;
  mime_type: string;
  bytes: number;
  sha256?: string;
  filename?: string;
}

export interface HermesVideoExecuteRequest extends HermesVideoCostRequest {
  schema_version: "video.generation.request.v1";
  request_id: string;
  job_id: string;
  prompt: string;
  backend: "higgsfield";
  context: {
    source: "studio";
    app_id: string | null;
    workspace_id: string | null;
    campaign_id: string | null;
    brand_id: string | null;
    [key: string]: unknown;
  };
  inputs: {
    images: HermesVideoInputImage[];
    videos: unknown[];
    audio: unknown[];
  };
  cost: {
    include_estimate: true;
    require_estimate: false;
  };
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
  estimatedCredits?: number;
  backend?: string;
  model?: string;
  render_url?: string | null;
  thumbnail_url?: string | null;
  duration_seconds?: number;
  aspect_ratio?: string;
  resolution?: string;
  error?: Record<string, unknown> | null;
  diagnostics?: Record<string, unknown>;
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

const hermesErrorDiagnostics = new WeakMap<CmoAdapterError, Record<string, unknown>>();

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

function studioEnablement(value: unknown): StudioVideoEnablement {
  if (value === "safe_now" || value === "guarded" || value === "needs_smoke" || value === "disabled_until_upload") {
    return value;
  }

  return "unavailable";
}

function uniqueValues<T extends string>(values: Array<T | null>): T[] {
  return Array.from(new Set(values.filter((item): item is T => Boolean(item))));
}

function requiredInputStatus(inputsRequired: string[]): string | null {
  const unsupported = inputsRequired.find((item) => item !== "prompt" && item !== "text");

  if (!unsupported) {
    return null;
  }

  if (/image|frame|reference/.test(unsupported)) {
    return "Requires image upload";
  }

  if (/video|clip/.test(unsupported)) {
    return "Requires video upload";
  }

  if (/audio|sound/.test(unsupported)) {
    return "Requires audio input";
  }

  if (/url|link/.test(unsupported)) {
    return "Requires URL input";
  }

  return "Requires input media support.";
}

function supportsTextToVideo(operations: string[]): boolean {
  return operations.length === 0 || operations.includes("text_to_video") || operations.includes("generate_video");
}

function supportsImageToVideo(operations: string[]): boolean {
  return operations.includes("image_to_video");
}

function unsupportedImageInputStatus(inputsRequired: string[]): string | null {
  const unsupported = inputsRequired.find((item) => !IMAGE_TO_VIDEO_INPUTS.has(item));

  return unsupported ? `This model requires unsupported input: ${unsupported}.` : null;
}

function productEnablementPolicy(input: {
  enablement: StudioVideoEnablement;
  providerModelId?: string;
  inputsRequired: string[];
  operations: string[];
  costSupported: boolean;
}): StudioVideoEnablement {
  const requiresUnsupportedMedia = requiredInputStatus(input.inputsRequired) !== null;
  const imageToVideoCapable = supportsImageToVideo(input.operations) && !unsupportedImageInputStatus(input.inputsRequired);

  if (requiresUnsupportedMedia) {
    return imageToVideoCapable ? "disabled_until_upload" : "unavailable";
  }

  if (!input.costSupported || !input.providerModelId || (!supportsTextToVideo(input.operations) && !imageToVideoCapable)) {
    return "unavailable";
  }

  return input.enablement;
}

function canGenerateImageToVideo(input: {
  providerModelId?: string;
  inputsRequired: string[];
  operations: string[];
  costSupported: boolean;
  enablement: StudioVideoEnablement;
}): boolean {
  return Boolean(
    input.providerModelId
    && input.costSupported
    && supportsImageToVideo(input.operations)
    && !unsupportedImageInputStatus(input.inputsRequired)
    && (input.enablement === "safe_now" || input.enablement === "guarded" || input.enablement === "needs_smoke" || input.enablement === "disabled_until_upload"),
  );
}

function fallbackModels(reason: string): Record<string, unknown>[] {
  return STUDIO_VIDEO_MODELS.map((model) => ({
    ...model,
    id: model.providerModelId ?? model.id,
    uiId: model.providerModelId ?? model.id,
    provider_model_id: model.providerModelId ?? null,
    providerModelId: model.providerModelId ?? null,
    label: model.name,
    name: model.name,
    available: false,
    productFallback: true,
    reason,
    enablement: "unavailable",
    enablementLabel: "Unavailable",
    disabledReason: reason,
    max_resolution: model.maxResolution,
    maxResolution: model.maxResolution,
    supported_resolutions: model.supportedResolutions,
    supportedResolutions: model.supportedResolutions,
    min_duration_seconds: model.minDurationSeconds,
    minDurationSeconds: model.minDurationSeconds,
    max_duration_seconds: model.maxDurationSeconds,
    maxDurationSeconds: model.maxDurationSeconds,
    supports_audio: model.supportsAudio,
    supportsAudio: model.supportsAudio,
    real_video_supported: model.realVideoSupported === true,
    realVideoSupported: model.realVideoSupported === true,
    catalogMode: "product_fallback",
  }));
}

export function hermesVideoErrorDiagnostics(error: unknown, input: {
  targetPath: string;
  hermesDispatched?: boolean;
}): Record<string, unknown> {
  if (error instanceof CmoAdapterError) {
    const upstreamDiagnostics = hermesErrorDiagnostics.get(error) ?? {};

    return {
      code: error.code,
      message: error.message,
      http_status: error.status,
      target_path: input.targetPath,
      ...upstreamDiagnostics,
      ...(input.hermesDispatched !== undefined ? { hermes_dispatched: input.hermesDispatched } : {}),
    };
  }

  return {
    code: "video_agent_execution_failed",
    message: error instanceof Error ? error.message : "Studio video request failed.",
    target_path: input.targetPath,
    ...(input.hermesDispatched !== undefined ? { hermes_dispatched: input.hermesDispatched } : {}),
  };
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
  const localPathRedacted = value
    .replace(/[a-zA-Z]:[\\/][^\s"'<>]+/g, "[local-path-redacted]")
    .replace(/file:\/\/[^\s"'<>]+/g, "[local-path-redacted]")
    .replace(/\/(?:tmp|var|Users|home|mnt|Volumes|private)(?:\/[^\s"'<>]+)*/g, "[local-path-redacted]");

  if (
    localPathRedacted === "[local-path-redacted]" ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith("file:") ||
    /^\/(?:tmp|var|Users|home|mnt|Volumes|private)(?:\/|$)/.test(value)
  ) {
    return "[local-path-redacted]";
  }

  return localPathRedacted;
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

function safeUpstreamError(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const error = isRecord(data.error) ? data.error : {};
  const type = stringValue(error.type ?? error.code ?? data.type ?? data.code);
  const message = stringValue(error.message ?? data.message ?? (typeof data.error === "string" ? data.error : undefined));
  const retryable = typeof error.retryable === "boolean"
    ? error.retryable
    : typeof data.retryable === "boolean"
      ? data.retryable
      : undefined;

  if (!type && !message && retryable === undefined) {
    return undefined;
  }

  return {
    ...(type ? { type: safeString(type) } : {}),
    ...(message ? { message: safeString(message) } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
  };
}

function hermesNonOkError(response: Response, path: string, data: Record<string, unknown>, execute: boolean): CmoAdapterError {
  const upstreamError = safeUpstreamError(data);
  const message = stringValue(upstreamError?.message) ?? "Hermes Video Agent request failed.";
  const code = response.status === 401 || response.status === 403
    ? "video_agent_auth_failed"
    : execute
      ? "video_agent_execution_failed"
      : "video_agent_unreachable";
  const error = new CmoAdapterError(
    response.status === 401 || response.status === 403 ? "Hermes Video Agent authentication failed." : message,
    response.status,
    code,
  );
  const diagnostics = {
    http_status: response.status,
    target_path: path,
    ...(upstreamError ? { upstream_error: upstreamError } : {}),
    ...(stringValue(data.schema_version) ? { upstream_schema_version: stringValue(data.schema_version) } : {}),
  };

  hermesErrorDiagnostics.set(error, redactSensitive(diagnostics) as Record<string, unknown>);

  return error;
}

async function parseJsonResponse(response: Response, path: string, execute = false): Promise<Record<string, unknown>> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    if (!response.ok) {
      const error = new CmoAdapterError("Hermes Video Agent request failed.", response.status, execute ? "video_agent_execution_failed" : "video_agent_unreachable");
      hermesErrorDiagnostics.set(error, {
        http_status: response.status,
        target_path: path,
      });
      throw error;
    }

    throw new CmoAdapterError("Hermes Video Agent returned invalid JSON.", 502, "video_agent_invalid_response");
  }

  const data = isRecord(body) ? body : {};

  if (!response.ok) {
    throw hermesNonOkError(response, path, data, execute);
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

    return parseJsonResponse(response, path, options?.execute === true);
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
  const catalogMode = body.schema_version === "video.models.response.v2" ? "hermes_v2" : "hermes_v1";
  const catalogSource = stringValue(body.source) ?? stringValue(body.provider) ?? stringValue(body.backend) ?? "hermes_video_agent";

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
      const settingsSchema = isRecord(item.settings_schema) ? item.settings_schema : {};
      const durationSchema = isRecord(settingsSchema.duration) ? settingsSchema.duration : {};
      const aspectRatioSchema = isRecord(settingsSchema.aspect_ratio) ? settingsSchema.aspect_ratio : {};
      const resolutionSchema = isRecord(settingsSchema.resolution) ? settingsSchema.resolution : {};
      const modeSchema = isRecord(settingsSchema.mode) ? settingsSchema.mode : {};
      const rawBitrateSchema = settingsSchema.bitrate_mode ?? settingsSchema.bitrate;
      const bitrateSchema = isRecord(rawBitrateSchema) ? rawBitrateSchema : {};
      const generateAudioSchema = isRecord(settingsSchema.generate_audio) ? settingsSchema.generate_audio : {};
      const supportedResolutions = uniqueValues([
        ...stringArray(resolutionSchema.values).map(normalizeStudioResolution),
        ...stringArray(item.resolutions ?? item.supported_resolutions ?? item.supportedResolutions).map(normalizeStudioResolution),
      ]);
      const supportedAspectRatios = uniqueValues([
        ...stringArray(aspectRatioSchema.values).map(normalizeStudioAspectRatio),
        ...STUDIO_ASPECT_RATIOS.map((ratio) => ratio),
      ]);
      const supportedModes = uniqueValues(stringArray(modeSchema.values).map(normalizeStudioVideoMode));
      const supportedBitrates = uniqueValues(stringArray(bitrateSchema.values).map(normalizeStudioBitrate));
      const defaultResolution = normalizeStudioResolution(resolutionSchema.default ?? item.default_resolution ?? item.defaultResolution)
        ?? supportedResolutions[0]
        ?? "720p";
      const defaultAspectRatio = normalizeStudioAspectRatio(aspectRatioSchema.default) ?? "16:9";
      const defaultBitrate = normalizeStudioBitrate(bitrateSchema.default) ?? "standard";
      const defaultMode = normalizeStudioVideoMode(modeSchema.default) ?? supportedModes[0];
      const operations = stringArray(item.operations);
      const enablement = studioEnablement(item.enablement ?? (item.available === false ? "unavailable" : "safe_now"));
      const inputsRequired = stringArray(item.inputs_required ?? item.inputsRequired);
      const inputsOptional = stringArray(item.inputs_optional ?? item.inputsOptional);
      const costSupported = item.cost_supported !== false;
      const inputStatus = requiredInputStatus(inputsRequired);
      const unsupportedInputStatus = unsupportedImageInputStatus(inputsRequired);
      const productEnablement = productEnablementPolicy({
        enablement,
        providerModelId,
        inputsRequired,
        operations,
        costSupported,
      });
      const canGenerateTextToVideo = Boolean(providerModelId && costSupported && supportsTextToVideo(operations) && !inputStatus && productEnablement !== "unavailable");
      const imageToVideoCapable = canGenerateImageToVideo({
        providerModelId,
        inputsRequired,
        operations,
        costSupported,
        enablement,
      });
      const minDuration = numberValue(item.min_duration_seconds ?? item.minDurationSeconds ?? duration.min_seconds ?? duration.minSeconds ?? durationSchema.min) ?? 4;
      const maxDuration = numberValue(item.max_duration_seconds ?? item.maxDurationSeconds ?? duration.max_seconds ?? duration.maxSeconds ?? durationSchema.max) ?? 15;
      const defaultDuration = numberValue(item.default_duration_seconds ?? item.defaultDurationSeconds ?? duration.default_seconds ?? duration.defaultSeconds ?? durationSchema.default) ?? minDuration;

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
        provider: stringValue(item.provider) ?? stringValue(body.provider) ?? "higgsfield",
        type: stringValue(item.type) ?? "video",
        family: stringValue(item.family) ?? null,
        operations,
        inputs_required: inputsRequired,
        inputsRequired,
        inputs_optional: inputsOptional,
        inputsOptional,
        settings_schema: settingsSchema,
        supported_aspect_ratios: supportedAspectRatios,
        supportedAspectRatios,
        supported_resolutions: supportedResolutions,
        supportedResolutions,
        supported_modes: supportedModes,
        supportedModes,
        supported_bitrates: supportedBitrates,
        supportedBitrates,
        default_aspect_ratio: defaultAspectRatio,
        defaultAspectRatio,
        default_resolution: defaultResolution,
        defaultResolution,
        default_bitrate: defaultBitrate,
        defaultBitrate,
        default_mode: defaultMode,
        defaultMode,
        available: canGenerateTextToVideo,
        enablement: productEnablement,
        enablementLabel: enablementLabel(productEnablement),
        disabledReason: inputStatus ?? (productEnablement === "needs_smoke" ? null : disabledReasonForEnablement(productEnablement)),
        can_generate_text_to_video: canGenerateTextToVideo,
        canGenerateTextToVideo,
        can_generate_image_to_video: imageToVideoCapable,
        canGenerateImageToVideo: imageToVideoCapable,
        required_input_status: inputStatus,
        requiredInputStatus: inputStatus,
        unsupported_input_status: unsupportedInputStatus,
        unsupportedInputStatus,
        real_video_supported: item.real_video_supported === true || item.realVideoSupported === true || providerModelId === "seedance_2_0",
        realVideoSupported: item.real_video_supported === true || item.realVideoSupported === true || providerModelId === "seedance_2_0",
        cost_supported: costSupported,
        costSupported,
        workflow_supported: item.workflow_supported === true,
        workflowSupported: item.workflow_supported === true,
        max_resolution: supportedResolutions.at(-1) ?? defaultResolution,
        maxResolution: supportedResolutions.at(-1) ?? defaultResolution,
        min_duration_seconds: minDuration,
        minDurationSeconds: minDuration,
        max_duration_seconds: maxDuration,
        maxDurationSeconds: maxDuration,
        default_duration_seconds: defaultDuration,
        defaultDurationSeconds: defaultDuration,
        supports_bitrate: supportedBitrates.length > 0 || typeof item.supports_bitrate === "boolean" ? item.supports_bitrate !== false : item.supportsBitrate === true,
        supports_audio: typeof generateAudioSchema.default === "boolean" ? generateAudioSchema.default : typeof item.supports_audio === "boolean" ? item.supports_audio : item.supportsAudio === true,
        supportsAudio: typeof generateAudioSchema.default === "boolean" ? generateAudioSchema.default : typeof item.supports_audio === "boolean" ? item.supports_audio : item.supportsAudio === true,
        generateAudioDefault: typeof generateAudioSchema.default === "boolean" ? generateAudioSchema.default : undefined,
        constraints: stringArray(item.constraints),
        warnings: stringArray(item.warnings),
        badges: stringArray(item.badges),
        catalogSource,
        catalogMode,
      };
    });
}

export async function getVideoAgentModelsCatalog(): Promise<Record<string, unknown>> {
  try {
    const models = await getVideoAgentModels();

    return {
      connected: true,
      schema_version: "product.video.models.normalized.v1",
      source: models[0]?.catalogSource ?? "hermes_video_agent",
      catalogMode: models[0]?.catalogMode ?? "hermes_v1",
      models,
    };
  } catch (error) {
    if (error instanceof CmoAdapterError) {
      return {
        connected: false,
        schema_version: "product.video.models.normalized.v1",
        source: "product_mock_catalog",
        catalogMode: "product_fallback",
        reason: error.code,
        models: fallbackModels(error.code),
      };
    }

    throw error;
  }
}

export async function estimateVideoCost(request: HermesVideoCostRequest): Promise<Record<string, unknown>> {
  const body = await hermesRequest(COST_PATH, {
    method: "POST",
    body: JSON.stringify(request),
  });
  const estimateFlag = body.estimateAvailable ?? body.estimate_available;
  const credits = numberValue(body.credits ?? body.estimatedCredits ?? body.estimated_credits);
  const label = stringValue(body.label) ?? (credits !== undefined ? `~${credits} credits` : undefined);
  const estimateAvailable = estimateFlag === false ? false : estimateFlag === true || credits !== undefined;
  const reason = stringValue(body.reason ?? body.message ?? body.error);
  const code = stringValue(body.code);
  const backend = stringValue(body.backend);
  const model = stringValue(body.model);
  const diagnostics = redactSensitive({
    ...(stringValue(body.schema_version) ? { upstream_schema_version: stringValue(body.schema_version) } : {}),
    ...(stringValue(body.request_id) ? { upstream_request_id: stringValue(body.request_id) } : {}),
    ...(backend ? { backend } : {}),
    ...(model ? { model } : {}),
    ...(reason ? { reason } : {}),
    ...(code ? { code } : {}),
  }) as Record<string, unknown>;

  if (estimateFlag !== true && estimateFlag !== false && credits === undefined) {
    const error = new CmoAdapterError("Hermes Video Agent cost response is invalid.", 502, "video_agent_invalid_response");
    hermesErrorDiagnostics.set(error, {
      target_path: COST_PATH,
      ...diagnostics,
    });
    throw error;
  }

  return {
    estimateAvailable,
    mode: "hermes",
    ...(credits !== undefined ? { credits } : {}),
    ...(credits !== undefined ? { estimatedCredits: credits } : {}),
    ...(label ? { label } : {}),
    ...(backend ? { backend } : {}),
    ...(model ? { model } : {}),
    ...(!estimateAvailable && reason ? { reason } : {}),
    ...(!estimateAvailable && code ? { code } : {}),
    ...(!estimateAvailable && Object.keys(diagnostics).length ? { diagnostics } : {}),
  };
}

export async function executeVideoJob(request: HermesVideoExecuteRequest): Promise<HermesVideoExecuteResult> {
  const body = await hermesRequest(EXECUTE_PATH, {
    method: "POST",
    body: JSON.stringify(request),
  }, { execute: true });

  const video = isRecord(body.video) ? body.video : {};
  const cost = isRecord(body.cost) ? body.cost : {};
  const diagnostics = isRecord(body.diagnostics) ? redactSensitive(body.diagnostics) as Record<string, unknown> : {};
  const renderUrl = safeUrl(video.render_url ?? video.renderUrl ?? body.render_url ?? body.renderUrl ?? body.video_url ?? body.videoUrl);
  const thumbnailUrl = safeUrl(video.thumbnail_url ?? video.thumbnailUrl ?? video.preview_url ?? video.previewUrl ?? body.thumbnail_url ?? body.thumbnailUrl ?? body.preview_url ?? body.previewUrl);
  const status = stringValue(body.status ?? body.provider_status) ?? "completed";
  const normalizedStatus = status === "failed" ? "failed" : status === "running" ? "running" : status === "queued" ? "queued" : "completed";
  const estimatedCredits = numberValue(cost.estimated_credits ?? cost.estimatedCredits ?? cost.credits ?? body.estimated_credits ?? body.estimatedCredits ?? body.credits);

  if (normalizedStatus === "completed" && !renderUrl) {
    throw new CmoAdapterError("Hermes Video Agent completed without a safe render URL.", 502, "video_agent_invalid_response");
  }

  return {
    status: normalizedStatus,
    provider_job_id: stringValue(diagnostics.higgsfield_job_id ?? diagnostics.provider_job_id ?? body.provider_job_id ?? body.providerJobId ?? body.job_id ?? body.id) ?? null,
    provider_status: status,
    estimated_credits: estimatedCredits,
    estimatedCredits,
    backend: stringValue(body.backend),
    model: stringValue(body.model),
    render_url: renderUrl,
    thumbnail_url: thumbnailUrl,
    duration_seconds: numberValue(video.duration_seconds ?? video.durationSeconds ?? body.duration_seconds ?? body.durationSeconds),
    aspect_ratio: stringValue(video.aspect_ratio ?? video.aspectRatio ?? body.aspect_ratio ?? body.aspectRatio),
    resolution: stringValue(video.resolution ?? body.resolution),
    error: isRecord(body.error) ? redactSensitive(body.error) as Record<string, unknown> : null,
    diagnostics,
    raw: redactSensitive(body) as Record<string, unknown>,
  };
}
