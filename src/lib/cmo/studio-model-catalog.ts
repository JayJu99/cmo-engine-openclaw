export type StudioMediaKind = "video" | "image";
export type StudioAgent = "video" | "image";
export type StudioBackend = "higgsfield" | "codex-imagen";
export type StudioOperation = "generate_video" | "generate_image" | "edit_video" | "motion_control";
export type StudioBitrate = "standard" | "high";
export type StudioAspectRatio = "1:1" | "4:5" | "9:16" | "16:9" | "4:3" | "3:4" | "21:9";
export type StudioResolution = "480p" | "720p" | "1080p" | "4K";
export type StudioVideoEnablement = "safe_now" | "guarded" | "needs_smoke" | "disabled_until_upload" | "unavailable";
export type StudioVideoMode = "fast" | "std";
export type StudioVideoWorkflow = "text_to_video" | "image_to_video";

export interface StudioVideoModel {
  id: string;
  uiId?: string;
  providerModelId?: string;
  name: string;
  providerLabel: string;
  maxResolution: StudioResolution;
  supportedResolutions: StudioResolution[];
  supportedAspectRatios?: StudioAspectRatio[];
  supportedBitrates?: StudioBitrate[];
  supportedModes?: StudioVideoMode[];
  defaultDurationSeconds?: number;
  defaultAspectRatio?: StudioAspectRatio;
  defaultResolution?: StudioResolution;
  defaultBitrate?: StudioBitrate;
  defaultMode?: StudioVideoMode;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  supportsAudio: boolean;
  generateAudioDefault?: boolean;
  badges: string[];
  realVideoSupported?: boolean;
  costSupported?: boolean;
  workflowSupported?: boolean;
  enablement?: StudioVideoEnablement;
  enablementLabel?: string;
  disabledReason?: string | null;
  operations?: string[];
  inputsRequired?: string[];
  canGenerateTextToVideo?: boolean;
  canGenerateImageToVideo?: boolean;
  requiredInputStatus?: string | null;
  unsupportedInputStatus?: string | null;
  constraints?: string[];
  warnings?: string[];
  catalogSource?: string;
  catalogMode?: "product_static" | "hermes_v1" | "hermes_v2" | "product_fallback";
}

export const STUDIO_ASPECT_RATIOS: StudioAspectRatio[] = ["1:1", "4:5", "9:16", "16:9", "4:3", "3:4", "21:9"];
export const STUDIO_RESOLUTIONS: StudioResolution[] = ["480p", "720p", "1080p", "4K"];

export const STUDIO_BITRATES: Array<{
  id: StudioBitrate;
  label: string;
  description: string;
}> = [
  { id: "standard", label: "Standard", description: "More compression, smaller size" },
  { id: "high", label: "High", description: "Less compression, larger size" },
];

export const STUDIO_VIDEO_MODELS: StudioVideoModel[] = [
  {
    id: "seedance-2-mini",
    name: "Seedance 2.0 Mini",
    providerLabel: "Desired Higgsfield model",
    maxResolution: "720p",
    supportedResolutions: ["480p", "720p"],
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    supportsAudio: false,
    badges: ["UNLIMITED", "EXCLUSIVE"],
    enablement: "unavailable",
    catalogMode: "product_static",
  },
  {
    id: "enhanced-seedance-2-fast",
    name: "Enhanced Seedance 2.0 Fast",
    providerLabel: "Desired Higgsfield model",
    maxResolution: "720p",
    supportedResolutions: ["480p", "720p"],
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    supportsAudio: false,
    badges: ["UNLIMITED"],
    enablement: "unavailable",
    catalogMode: "product_static",
  },
  {
    id: "seedance-2",
    providerModelId: "seedance_2_0",
    name: "Seedance 2.0",
    providerLabel: "Desired Higgsfield model",
    maxResolution: "4K",
    supportedResolutions: ["480p", "720p", "1080p", "4K"],
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    supportsAudio: false,
    badges: [],
    realVideoSupported: true,
    costSupported: true,
    enablement: "safe_now",
    catalogMode: "product_static",
  },
  {
    id: "seedance-2-fast",
    name: "Seedance 2.0 Fast",
    providerLabel: "Desired Higgsfield model",
    maxResolution: "720p",
    supportedResolutions: ["480p", "720p"],
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    supportsAudio: false,
    badges: [],
    enablement: "unavailable",
    catalogMode: "product_static",
  },
  {
    id: "kling-3",
    name: "Kling 3.0",
    providerLabel: "Desired Higgsfield model",
    maxResolution: "4K",
    supportedResolutions: ["480p", "720p", "1080p", "4K"],
    minDurationSeconds: 3,
    maxDurationSeconds: 15,
    supportsAudio: true,
    badges: [],
    enablement: "unavailable",
    catalogMode: "product_static",
  },
  {
    id: "kling-3-turbo",
    name: "Kling 3.0 Turbo",
    providerLabel: "Desired Higgsfield model",
    maxResolution: "1080p",
    supportedResolutions: ["480p", "720p", "1080p"],
    minDurationSeconds: 3,
    maxDurationSeconds: 15,
    supportsAudio: true,
    badges: ["NEW"],
    enablement: "unavailable",
    catalogMode: "product_static",
  },
  {
    id: "kling-3-motion-control",
    name: "Kling 3.0 Motion Control",
    providerLabel: "Desired Higgsfield model",
    maxResolution: "1080p",
    supportedResolutions: ["480p", "720p", "1080p"],
    minDurationSeconds: 3,
    maxDurationSeconds: 30,
    supportsAudio: false,
    badges: [],
    enablement: "unavailable",
    catalogMode: "product_static",
  },
  {
    id: "happyhorse",
    name: "HappyHorse",
    providerLabel: "Desired Higgsfield model",
    maxResolution: "1080p",
    supportedResolutions: ["480p", "720p", "1080p"],
    minDurationSeconds: 3,
    maxDurationSeconds: 15,
    supportsAudio: true,
    badges: ["NEW"],
    enablement: "unavailable",
    catalogMode: "product_static",
  },
  {
    id: "grok-imagine",
    name: "Grok Imagine",
    providerLabel: "Desired Higgsfield model",
    maxResolution: "720p",
    supportedResolutions: ["480p", "720p"],
    minDurationSeconds: 1,
    maxDurationSeconds: 15,
    supportsAudio: false,
    badges: [],
    enablement: "unavailable",
    catalogMode: "product_static",
  },
  {
    id: "grok-imagine-1-5",
    name: "Grok Imagine 1.5",
    providerLabel: "Desired Higgsfield model",
    maxResolution: "720p",
    supportedResolutions: ["480p", "720p"],
    minDurationSeconds: 1,
    maxDurationSeconds: 15,
    supportsAudio: false,
    badges: ["NEW"],
    enablement: "unavailable",
    catalogMode: "product_static",
  },
  {
    id: "google-veo-3-1-lite",
    name: "Google Veo 3.1 Lite",
    providerLabel: "Desired Higgsfield model",
    maxResolution: "1080p",
    supportedResolutions: ["480p", "720p", "1080p"],
    minDurationSeconds: 4,
    maxDurationSeconds: 8,
    supportsAudio: true,
    badges: ["NEW"],
    enablement: "unavailable",
    catalogMode: "product_static",
  },
  {
    id: "wan-2-7",
    name: "Wan 2.7",
    providerLabel: "Desired Higgsfield model",
    maxResolution: "1080p",
    supportedResolutions: ["480p", "720p", "1080p"],
    minDurationSeconds: 2,
    maxDurationSeconds: 15,
    supportsAudio: false,
    badges: ["NEW"],
    enablement: "unavailable",
    catalogMode: "product_static",
  },
];

export function getStudioVideoModel(modelId: string | null | undefined): StudioVideoModel {
  return STUDIO_VIDEO_MODELS.find((model) => model.id === modelId || model.providerModelId === modelId) ?? STUDIO_VIDEO_MODELS[0];
}

export function isStudioResolutionSupported(model: StudioVideoModel, resolution: StudioResolution): boolean {
  return model.supportedResolutions.includes(resolution);
}

export function clampStudioDuration(model: StudioVideoModel, durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds)) {
    return 8;
  }

  return Math.min(model.maxDurationSeconds, Math.max(model.minDurationSeconds, Math.floor(durationSeconds)));
}

export function normalizeStudioResolution(value: unknown): StudioResolution | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "480p" || normalized === "720p" || normalized === "1080p") {
    return normalized as StudioResolution;
  }

  if (normalized === "4k") {
    return "4K";
  }

  return null;
}

export function providerResolutionValue(value: StudioResolution): string {
  return value === "4K" ? "4k" : value;
}

export function normalizeStudioAspectRatio(value: unknown): StudioAspectRatio | null {
  return typeof value === "string" && STUDIO_ASPECT_RATIOS.includes(value as StudioAspectRatio)
    ? value as StudioAspectRatio
    : null;
}

export function normalizeStudioBitrate(value: unknown): StudioBitrate | null {
  return value === "standard" || value === "high" ? value : null;
}

export function normalizeStudioVideoMode(value: unknown): StudioVideoMode | null {
  return value === "fast" || value === "std" ? value : null;
}

export function enablementLabel(enablement: StudioVideoEnablement | undefined): string {
  if (enablement === "safe_now") {
    return "Safe";
  }

  if (enablement === "guarded") {
    return "Guarded";
  }

  if (enablement === "needs_smoke") {
    return "Needs smoke";
  }

  if (enablement === "disabled_until_upload") {
    return "Requires upload";
  }

  return "Unavailable";
}

export function disabledReasonForEnablement(enablement: StudioVideoEnablement | undefined): string | null {
  if (enablement === "needs_smoke") {
    return "Not smoke-tested yet. Review cost before generating.";
  }

  if (enablement === "disabled_until_upload") {
    return "Requires input media support.";
  }

  if (enablement === "unavailable") {
    return "Selected model is not available for real Studio video generation.";
  }

  return null;
}

export function chooseStudioVideoMode(model: StudioVideoModel, resolution: StudioResolution): StudioVideoMode | undefined {
  if (model.supportedModes && model.supportedModes.length === 0) {
    return undefined;
  }

  const modes = model.supportedModes?.length ? model.supportedModes : ["fast"];

  if ((resolution === "1080p" || resolution === "4K") && modes.includes("std")) {
    return "std";
  }

  if ((resolution === "480p" || resolution === "720p") && modes.includes("fast")) {
    return "fast";
  }

  return model.defaultMode && modes.includes(model.defaultMode) ? model.defaultMode : modes[0] as StudioVideoMode | undefined;
}

export function validateStudioVideoSettings(input: {
  model: StudioVideoModel;
  durationSeconds: number;
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  bitrate: StudioBitrate;
}): string | null {
  const enablementReason = disabledReasonForEnablement(input.model.enablement);

  if (enablementReason && input.model.enablement !== "guarded" && input.model.enablement !== "needs_smoke") {
    return enablementReason;
  }

  if (input.durationSeconds < input.model.minDurationSeconds || input.durationSeconds > input.model.maxDurationSeconds) {
    return `Duration must be between ${input.model.minDurationSeconds}s and ${input.model.maxDurationSeconds}s.`;
  }

  if (input.model.supportedAspectRatios?.length && !input.model.supportedAspectRatios.includes(input.aspectRatio)) {
    return "Selected aspect ratio is not supported by this model.";
  }

  if (!input.model.supportedResolutions.includes(input.resolution)) {
    return "Selected resolution is not supported by this model.";
  }

  if (input.model.supportedBitrates?.length && !input.model.supportedBitrates.includes(input.bitrate)) {
    return "Selected bitrate is not supported by this model.";
  }

  const mode = chooseStudioVideoMode(input.model, input.resolution);

  if (!mode && input.model.supportedModes?.length !== 0) {
    return "Selected model does not expose a supported generation mode.";
  }

  if ((input.resolution === "1080p" || input.resolution === "4K") && mode === "fast") {
    return "Fast mode does not support the selected high resolution.";
  }

  return null;
}
