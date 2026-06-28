export type StudioMediaKind = "video" | "image";
export type StudioAgent = "video" | "image";
export type StudioBackend = "higgsfield" | "codex-imagen";
export type StudioOperation = "generate_video" | "generate_image" | "edit_video" | "motion_control";
export type StudioBitrate = "standard" | "high";
export type StudioAspectRatio = "1:1" | "4:5" | "9:16" | "16:9" | "4:3" | "3:4" | "21:9";
export type StudioResolution = "480p" | "720p" | "1080p" | "4K";

export interface StudioVideoModel {
  id: string;
  providerModelId?: string;
  name: string;
  providerLabel: string;
  maxResolution: StudioResolution;
  supportedResolutions: StudioResolution[];
  minDurationSeconds: number;
  maxDurationSeconds: number;
  supportsAudio: boolean;
  badges: string[];
  realVideoSupported?: boolean;
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
