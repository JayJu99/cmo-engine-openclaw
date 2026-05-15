import type {
  CMOAppChatRequest,
  CMOAppChatResponse,
  CMOChatMessage,
  CMOContextPackage,
  CMORuntimeStatus,
  CmoRuntimeMode,
  ContextPack,
  VaultNoteRef,
} from "@/lib/cmo/app-workspace-types";
import { summarizeContextQuality } from "@/lib/cmo/context-quality";
import { CmoAdapterError } from "@/lib/cmo/errors";
import {
  callOpenClawCmoRuntime,
  getOpenClawCmoRuntimeAvailability,
  type OpenClawCmoRuntimeAvailability,
} from "@/lib/cmo/openclaw-client";

export interface CmoRuntimeHealth {
  status: CMORuntimeStatus;
  mode: CmoRuntimeMode;
  healthy: boolean;
  label: string;
  reason?: string;
}

export interface CmoRuntimeTurnInput {
  contextPack: ContextPack;
  contextPackage: CMOContextPackage;
  message: string;
  history: CMOChatMessage[];
  request: CMOAppChatRequest;
  contextUsed: VaultNoteRef[];
  missingContext: VaultNoteRef[];
}

export interface CmoRuntimeTurnResult {
  answer: string;
  assumptions: string[];
  suggestedActions: CMOAppChatResponse["suggestedActions"];
  runtimeStatus: CMORuntimeStatus;
  runtimeMode: CmoRuntimeMode;
  runtimeLabel: string;
  runtimeError?: string;
  isDevelopmentFallback: boolean;
}

export interface CmoRuntime {
  id: string;
  mode: CmoRuntimeMode;
  healthCheck(): Promise<CmoRuntimeHealth>;
  runTurn(input: CmoRuntimeTurnInput): Promise<CmoRuntimeTurnResult>;
}

const DEFAULT_FALLBACK_ACTIONS: CMOAppChatResponse["suggestedActions"] = [
  {
    type: "capture_to_raw_vault",
    label: "Capture this session",
  },
];

function runtimeModeFromStatus(status: CMORuntimeStatus): CmoRuntimeMode {
  if (status === "connected") {
    return "live";
  }

  if (status === "configured_but_unreachable" || status === "runtime_error") {
    return "configured_but_unreachable";
  }

  return "fallback";
}

function fallbackAnswer(input: CmoRuntimeTurnInput, reason: string): string {
  const contextList = input.contextUsed.length ? input.contextUsed.map((note) => note.title).join(", ") : "no context pack items were available";
  const missingList = input.missingContext.length ? input.missingContext.map((note) => note.title).join(", ") : "none";
  const qualitySummary = summarizeContextQuality([...input.contextUsed, ...input.missingContext]);
  const placeholderOrDraft = [...input.contextUsed, ...input.missingContext]
    .filter((note) => note.contextQuality === "placeholder" || note.contextQuality === "draft")
    .map((note) => `${note.title}: ${note.contextQuality}`)
    .join(", ");

  return [
    "Development fallback: OpenClaw CMO runtime is not connected.",
    reason,
    `CMO context pack was built automatically for ${input.request.appName}.`,
    `Context actually included: ${contextList}.`,
    `Unavailable context pack items: ${missingList}.`,
    `Context quality: ${qualitySummary.confirmedCount} confirmed, ${qualitySummary.placeholderOrDraftCount} placeholder/draft, ${qualitySummary.missingCount} missing.`,
    placeholderOrDraft ? `Draft or placeholder notes: ${placeholderOrDraft}.` : "No draft or placeholder notes were flagged.",
    "Connect this route to the OpenClaw CMO runtime before treating the answer as operator judgment.",
  ].join("\n");
}

function classifyRuntimeCallError(error: unknown): CMORuntimeStatus {
  if (error instanceof CmoAdapterError && (error.status === 503 || error.status === 504 || error.code.includes("unavailable") || error.code.includes("timeout"))) {
    return "configured_but_unreachable";
  }

  return "runtime_error";
}

function runtimeErrorAnswer(errorMessage: string): string {
  return [
    "Runtime connection error: OpenClaw CMO did not return a usable answer.",
    errorMessage,
    "No development fallback was substituted because runtime configuration is present.",
  ].join("\n");
}

export class FallbackRuntime implements CmoRuntime {
  id = "fallback-runtime";
  mode: CmoRuntimeMode;
  private readonly status: CMORuntimeStatus;
  private readonly label: string;
  private readonly reason: string;

  constructor(health?: Partial<CmoRuntimeHealth>) {
    this.status = health?.status ?? "development_fallback";
    this.mode = health?.mode ?? runtimeModeFromStatus(this.status);
    this.label = health?.label ?? "Development fallback";
    this.reason = health?.reason ?? "OpenClaw CMO runtime is not available for this environment.";
  }

  async healthCheck(): Promise<CmoRuntimeHealth> {
    return {
      status: this.status,
      mode: this.mode,
      healthy: true,
      label: this.label,
      reason: this.reason,
    };
  }

  async runTurn(input: CmoRuntimeTurnInput): Promise<CmoRuntimeTurnResult> {
    return {
      answer: fallbackAnswer(input, this.reason),
      assumptions: [],
      suggestedActions: DEFAULT_FALLBACK_ACTIONS,
      runtimeStatus: this.status,
      runtimeMode: this.mode,
      runtimeLabel: this.label,
      isDevelopmentFallback: true,
    };
  }
}

export class LiveOpenClawRuntime implements CmoRuntime {
  id = "openclaw-live-runtime";
  mode: CmoRuntimeMode = "live";
  private availability: OpenClawCmoRuntimeAvailability | null = null;

  async healthCheck(): Promise<CmoRuntimeHealth> {
    this.availability = await getOpenClawCmoRuntimeAvailability();
    const healthy = this.availability.status === "connected" && Boolean(this.availability.config);

    return {
      status: this.availability.status,
      mode: healthy ? "live" : runtimeModeFromStatus(this.availability.status),
      healthy,
      label: this.availability.label,
      reason: this.availability.reason,
    };
  }

  async runTurn(input: CmoRuntimeTurnInput): Promise<CmoRuntimeTurnResult> {
    const availability = this.availability ?? (await getOpenClawCmoRuntimeAvailability());

    if (availability.status !== "connected" || !availability.config) {
      return new FallbackRuntime({
        status: availability.status,
        mode: runtimeModeFromStatus(availability.status),
        label: availability.label,
        reason: availability.reason ?? "OpenClaw CMO runtime is configured but not reachable.",
      }).runTurn(input);
    }

    try {
      const result = await callOpenClawCmoRuntime(input.contextPackage, availability.config);

      return {
        answer: result.answer,
        assumptions: result.assumptions,
        suggestedActions: result.suggestedActions.length ? result.suggestedActions : DEFAULT_FALLBACK_ACTIONS,
        runtimeStatus: "connected",
        runtimeMode: "live",
        runtimeLabel: result.runtimeLabel,
        isDevelopmentFallback: false,
      };
    } catch (error) {
      const runtimeStatus = classifyRuntimeCallError(error);
      const runtimeError = error instanceof Error ? error.message : "OpenClaw CMO runtime failed";

      return {
        answer: runtimeErrorAnswer(runtimeError),
        assumptions: [],
        suggestedActions: DEFAULT_FALLBACK_ACTIONS,
        runtimeStatus,
        runtimeMode: runtimeModeFromStatus(runtimeStatus),
        runtimeLabel: availability.label,
        runtimeError,
        isDevelopmentFallback: false,
      };
    }
  }
}

export class RuntimeRegistry {
  private readonly liveRuntime: CmoRuntime;
  private cachedHealth: CmoRuntimeHealth | null = null;
  private cachedAt = 0;
  private readonly ttlMs: number;

  constructor(liveRuntime: CmoRuntime = new LiveOpenClawRuntime(), ttlMs = 10_000) {
    this.liveRuntime = liveRuntime;
    this.ttlMs = ttlMs;
  }

  private async liveHealth(): Promise<CmoRuntimeHealth> {
    const now = Date.now();

    if (this.cachedHealth && now - this.cachedAt < this.ttlMs) {
      return this.cachedHealth;
    }

    this.cachedHealth = await this.liveRuntime.healthCheck();
    this.cachedAt = now;

    return this.cachedHealth;
  }

  async selectRuntime(): Promise<CmoRuntime> {
    const health = await this.liveHealth();

    if (health.healthy) {
      return this.liveRuntime;
    }

    return new FallbackRuntime(health);
  }

  async healthCheck(): Promise<CmoRuntimeHealth> {
    return this.liveHealth();
  }
}

const runtimeRegistry = new RuntimeRegistry();

export function getRuntimeRegistry(): RuntimeRegistry {
  return runtimeRegistry;
}

