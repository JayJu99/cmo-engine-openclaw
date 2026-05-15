import type {
  CMOAppChatRequest,
  CMOAppChatResponse,
  CMOChatMessage,
  CMOContextPackage,
  CMORuntimeStatus,
  CmoRuntimeErrorReason,
  CmoRuntimeMode,
  ContextPack,
  ContextItem,
  VaultNoteRef,
} from "@/lib/cmo/app-workspace-types";
import { summarizeContextQuality } from "@/lib/cmo/context-quality";
import { CmoAdapterError } from "@/lib/cmo/errors";
import {
  callOpenClawAppTurnRuntime,
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
  attemptedRuntimeMode?: CmoRuntimeMode;
  runtimeLabel: string;
  runtimeError?: string;
  runtimeErrorReason?: CmoRuntimeErrorReason;
  isDevelopmentFallback: boolean;
  isRuntimeFallback?: boolean;
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

interface FallbackComposition {
  answer: string;
  suggestedActions: CMOAppChatResponse["suggestedActions"];
}

function runtimeModeFromStatus(status: CMORuntimeStatus): CmoRuntimeMode {
  if (status === "connected") {
    return "live";
  }

  if (status === "configured_but_unreachable" || status === "runtime_error") {
    return "configured_but_unreachable";
  }

  return "fallback";
}

function contextItem(input: CmoRuntimeTurnInput, kind: ContextItem["kind"]): ContextItem | undefined {
  return input.contextPack.items.find((item) => item.kind === kind && item.exists);
}

function compactLine(value: string, limit = 220): string {
  const compacted = value
    .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return compacted.length > limit ? `${compacted.slice(0, limit - 3)}...` : compacted;
}

function itemBrief(item: ContextItem | undefined, fallback: string): string {
  if (!item) {
    return fallback;
  }

  return compactLine(item.contentPreview || item.content, 260) || fallback;
}

function includedContextLabels(input: CmoRuntimeTurnInput): string[] {
  const labelByKind: Record<ContextItem["kind"], string> = {
    current_priority: "Current Priority",
    app_memory: "App Memory",
    latest_sessions: "Latest Sessions",
    promotion_candidates: "Memory Candidates",
  };

  return input.contextPack.items
    .filter((item) => item.exists)
    .map((item) => labelByKind[item.kind])
    .filter((label, index, list) => list.indexOf(label) === index);
}

function fallbackRecommendations(input: CmoRuntimeTurnInput): CMOAppChatResponse["suggestedActions"] {
  const appName = input.request.appName;

  return [
    {
      type: "fallback_recommendation",
      label: `Define this week's activation event and the simplest evidence check for ${appName}.`,
    },
    {
      type: "fallback_recommendation",
      label: "Turn one concrete product proof point into campaign-ready messaging.",
    },
    {
      type: "fallback_recommendation",
      label: "Create one retention or follow-up loop for users who reach the activation moment.",
    },
  ];
}

function fallbackAnswer(input: CmoRuntimeTurnInput, reason: string): FallbackComposition {
  const contextList = input.contextUsed.length ? input.contextUsed.map((note) => note.title).join(", ") : "no context pack items were available";
  const missingList = input.missingContext.length ? input.missingContext.map((note) => note.title).join(", ") : "none";
  const qualitySummary = summarizeContextQuality([...input.contextUsed, ...input.missingContext]);
  const placeholderOrDraft = [...input.contextUsed, ...input.missingContext]
    .filter((note) => note.contextQuality === "placeholder" || note.contextQuality === "draft")
    .map((note) => `${note.title}: ${note.contextQuality}`)
    .join(", ");
  const priority = itemBrief(contextItem(input, "current_priority"), "No current priority was available.");
  const memory = itemBrief(contextItem(input, "app_memory"), "No durable app memory was available.");
  const latestSessions = itemBrief(contextItem(input, "latest_sessions"), "No recent CMO sessions were available.");
  const memoryCandidates = itemBrief(contextItem(input, "promotion_candidates"), "No open memory candidates were available.");
  const contextLabels = includedContextLabels(input);
  const suggestedActions = fallbackRecommendations(input);
  const contextUsedLine = contextLabels.length ? contextLabels.join(", ") : contextList;

  return {
    answer: [
      `Based on the loaded workspace context for ${input.request.appName}, my recommendation is to focus this turn on practical activation and proof-building work.`,
      "",
      `User question: ${input.message}`,
      "",
      `Action 1: ${suggestedActions[0].label}`,
      "Use the current priority to make the target behavior explicit. Keep it evidence-based: define what the user must do, what product surface proves it happened, and what qualitative signal would make the action worth scaling.",
      "",
      `Action 2: ${suggestedActions[1].label}`,
      "Pull from App Memory and package one specific product truth into a short message, landing-page section, creator prompt, or campaign angle. Do not add performance claims unless they already exist in confirmed context.",
      "",
      `Action 3: ${suggestedActions[2].label}`,
      "After the activation moment, decide the next prompt, reminder, or content touch that brings the user back. Treat this as a retention hypothesis, not a proven metric.",
      "",
      "Why these actions fit:",
      `- Current Priority: ${priority}`,
      `- App Memory: ${memory}`,
      `- Latest Sessions: ${latestSessions}`,
      `- Memory Candidates: ${memoryCandidates}`,
      "",
      `Context used: ${contextUsedLine}.`,
      `Unavailable context: ${missingList}.`,
      `Context quality: ${qualitySummary.confirmedCount} confirmed, ${qualitySummary.placeholderOrDraftCount} placeholder/draft, ${qualitySummary.missingCount} missing.`,
      placeholderOrDraft ? `Context caution: ${placeholderOrDraft}.` : "Context caution: no draft or placeholder notes were flagged.",
      `Runtime note: ${reason}`,
    ].join("\n"),
    suggestedActions: [
      ...suggestedActions,
      ...DEFAULT_FALLBACK_ACTIONS,
    ],
  };
}

function classifyAppTurnErrorReason(error: unknown): CmoRuntimeErrorReason {
  if (!(error instanceof CmoAdapterError)) {
    return "execution_error";
  }

  if (error.status === 404 || error.status === 405 || error.status === 501 || error.code.includes("unsupported")) {
    return "unsupported_chat_turn";
  }

  if (error.status === 504 || error.code.includes("timeout")) {
    return "timeout";
  }

  if (error.code.includes("empty_answer")) {
    return "empty_answer";
  }

  if (
    error.code.includes("dashboard_json") ||
    error.code.includes("invalid") ||
    error.code.includes("validation") ||
    error.code.includes("json")
  ) {
    return "invalid_response";
  }

  return "execution_error";
}

function logAppTurnFailure(reason: CmoRuntimeErrorReason, message: string, error: unknown) {
  if (reason === "unsupported_chat_turn") {
    console.warn("[cmo-runtime] Adapter health passed, but /cmo/app-turn is unavailable; using app-chat fallback.", {
      reason,
      message,
    });
    return;
  }

  if (reason === "invalid_response" && error instanceof CmoAdapterError && error.code.includes("dashboard_json")) {
    console.warn("[cmo-runtime] Adapter returned dashboard run-brief JSON for app chat; using app-chat fallback.", {
      reason,
      message,
    });
    return;
  }

  if (reason === "timeout") {
    console.warn("[cmo-runtime] Live app-chat turn timed out; using fallback.", {
      reason,
      message,
    });
    return;
  }

  if (reason === "invalid_response") {
    console.warn("[cmo-runtime] Live app-chat turn returned an invalid response; using fallback.", {
      reason,
      message,
    });
    return;
  }

  if (reason === "empty_answer") {
    console.warn("[cmo-runtime] Live app-chat turn returned an empty answer; using fallback.", {
      reason,
      message,
    });
    return;
  }

  console.warn("[cmo-runtime] Live app-chat turn failed; using fallback.", {
    reason,
    message,
  });
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
    const fallback = fallbackAnswer(input, this.reason);

    return {
      answer: fallback.answer,
      assumptions: [],
      suggestedActions: fallback.suggestedActions,
      runtimeStatus: this.status,
      runtimeMode: this.mode,
      runtimeLabel: this.label,
      isDevelopmentFallback: true,
      isRuntimeFallback: true,
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
      const result = await callOpenClawAppTurnRuntime(input.contextPackage, availability.config, input.history);

      return {
        answer: result.answer,
        assumptions: result.assumptions,
        suggestedActions: result.suggestedActions.length ? result.suggestedActions : DEFAULT_FALLBACK_ACTIONS,
        runtimeStatus: "connected",
        runtimeMode: "live",
        attemptedRuntimeMode: "live",
        runtimeLabel: result.runtimeLabel,
        isDevelopmentFallback: false,
        isRuntimeFallback: false,
      };
    } catch (error) {
      const runtimeError = error instanceof Error ? error.message : "OpenClaw CMO runtime failed";
      const runtimeErrorReason = classifyAppTurnErrorReason(error);
      logAppTurnFailure(runtimeErrorReason, runtimeError, error);
      const fallback = await new FallbackRuntime({
        status: "live_failed_then_fallback",
        mode: "fallback",
        label: availability.label,
        reason: "Live runtime unavailable for app chat; fallback used.",
      }).runTurn(input);

      return {
        ...fallback,
        runtimeStatus: "live_failed_then_fallback",
        runtimeMode: "fallback",
        attemptedRuntimeMode: "live",
        runtimeLabel: availability.label,
        runtimeError,
        runtimeErrorReason,
        isDevelopmentFallback: true,
        isRuntimeFallback: true,
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
