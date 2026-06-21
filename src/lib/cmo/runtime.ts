import type {
  CMOAppChatRequest,
  CMOAppChatResponse,
  CMOChatMessage,
  CMOContextPackage,
  CMORuntimeStatus,
  CmoRuntimeErrorReason,
  CmoRuntimeMode,
  CmoRuntimeContext,
  CmoSourceReviewContext,
  ContextPack,
  ContextItem,
  VaultNoteRef,
} from "@/lib/cmo/app-workspace-types";
import { isExplicitCreativeExecutionIntent } from "@/lib/cmo/app-routing-intent";
import { summarizeContextQuality } from "@/lib/cmo/context-quality";
import { getCmoFallbackFastAfterMs, getCmoHermesCreativeExecuteTimeoutMs, getCmoLiveAppTurnTimeoutMs } from "@/lib/cmo/config";
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
  vaultAgentContextPackStatus?: "skipped" | "completed" | "empty" | "failed" | "rejected";
  runtimeContext?: CmoRuntimeContext;
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
  runtimeProvider?: string;
  runtimeAgent?: string;
  rawRuntimeResponse?: unknown;
  isDevelopmentFallback: boolean;
  isRuntimeFallback?: boolean;
  liveAttemptStartedAt?: string;
  liveAttemptDurationMs?: number;
  fallbackDurationMs?: number;
  timeoutMs?: number;
  outerTimeoutMs?: number;
  outerTimeoutSource?: "default_app_turn" | "creative_execute";
  routeDecision?: "app_turn" | "creative_execution";
  creativeExecutionRequested?: boolean;
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

type FallbackIntent = "greeting" | "start_session" | "strategic_recommendation" | "context_explanation" | "source_input" | "business_metrics" | "current_time" | "general";

function runtimeModeFromStatus(status: CMORuntimeStatus): CmoRuntimeMode {
  if (status === "connected" || status === "live") {
    return "live";
  }

  if (status === "configured_but_unreachable" || status === "runtime_error") {
    return "configured_but_unreachable";
  }

  return "fallback";
}

function includedContextLabels(input: CmoRuntimeTurnInput): string[] {
  const labelByKind: Record<ContextItem["kind"], string> = {
    current_priority: "Current Priority",
    app_memory: "App Memory",
    latest_sessions: "Latest Sessions",
    promotion_candidates: "Memory Candidates",
    business_metrics: "Business Metrics",
    indexed_context_supplement: "Indexed Context Supplement",
    project_context: "Project Context",
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

function looksLikeSourceInput(message: string): boolean {
  const normalized = normalizeMessage(message);

  return /\bhttps?:\/\/\S+/i.test(message) ||
    /\b(url|link|doc|document):/i.test(message) ||
    /\b(paste|pasted|source note|source material|save this source|add this source|url:|link:|doc:|document:|tai lieu nay|nguon nay)\b/i.test(normalized);
}

function normalizeMessage(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackIntent(message: string): FallbackIntent {
  const normalized = normalizeMessage(message);

  if (looksLikeSourceInput(message)) {
    return "source_input";
  }

  if (/\b(dune|worldchain|wld|partner stats|partner|aggregator|business metrics|traffic|transactions|transaction|fees|fee|revenue|volume 24h|volume 7d|volume 30d|defillama)\b/.test(normalized)) {
    return "business_metrics";
  }

  if (/\b(time|current time|what time|clock|gio|mấy giờ|may gio|bay gio|bây giờ)\b/.test(normalized)) {
    return "current_time";
  }

  if (/^(hi|hello|hey|yo|chao|xin chao|alo|hi there|hello there)$/.test(normalized)) {
    return "greeting";
  }

  if (
    /\b(recommend|recommended|recommendation|action|actions|plan|focus|priority|strategy|strategic|campaign|growth|marketing|activation|retention|increase activation|improve activation|this week|next step|next steps|what should we do next|what should i do next|what next)\b/.test(normalized) ||
    /\b(nen lam gi|lam gi tiep|de xuat|hanh dong|chien luoc|tang activation|cai thien activation)\b/.test(normalized)
  ) {
    return "strategic_recommendation";
  }

  if (
    /\b(context|memory|source|sources|using|loaded|included)\b/.test(normalized) &&
    /\b(what|which|show|explain|tell|state|gi|co gi|dang co)\b/.test(normalized)
  ) {
    return "context_explanation";
  }

  if (/\b(start|begin|kick off|new session|cmo session|next)\b/.test(normalized)) {
    return "start_session";
  }

  return "general";
}

function runtimeNote(reason: string): string {
  return reason === "Live runtime unavailable for app chat; fallback used."
    ? "Live app-chat is unavailable; fallback generated this response from workspace context."
    : `${reason} Fallback generated this response from workspace context.`;
}

function sourceReviewContext(input: CmoRuntimeTurnInput): CmoSourceReviewContext | undefined {
  return input.contextPackage.sourceReviewContext ?? input.contextPackage.contextPack?.sourceReviewContext;
}

function sourceReviewString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sourceReviewStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

function compactSourceReviewText(value: string, maxChars = 1300): string {
  const compact = value.replace(/\s+/g, " ").trim();

  return compact.length > maxChars ? `${compact.slice(0, maxChars - 3).trimEnd()}...` : compact;
}

function sourceReviewFallbackAnswer(input: CmoRuntimeTurnInput): FallbackComposition | undefined {
  const reviewContext = sourceReviewContext(input);

  if (!reviewContext || reviewContext.mode !== "review_only") {
    return undefined;
  }

  const source = reviewContext.source;
  const extraction = reviewContext.extraction;
  const extractionStatus = sourceReviewString(extraction.status);
  const title = sourceReviewString(source.source_title) || sourceReviewString(source.canonical_url) || "Source";
  const canonicalUrl = sourceReviewString(source.canonical_url) || sourceReviewString(source.original_url);
  const summary = compactSourceReviewText(sourceReviewString(extraction.extracted_summary));
  const sourceText = compactSourceReviewText(sourceReviewString(extraction.source_text) || sourceReviewString(extraction.source_text_excerpt), 1800);
  const tableSummary = compactSourceReviewText(sourceReviewString(extraction.table_summary), 800);
  const visualSummary = compactSourceReviewText(sourceReviewString(extraction.visual_summary), 800);
  const warnings = sourceReviewStringList(extraction.warnings);
  const errors = sourceReviewStringList(extraction.errors);
  const canReview = (extractionStatus === "completed" || extractionStatus === "partial") && Boolean(summary || sourceText || tableSummary || visualSummary);

  if (!canReview) {
    return {
      answer: [
        `I found the URL/source for ${input.request.appName}, but I could not extract reviewable text from it.`,
        "",
        `Source: ${title}${canonicalUrl ? ` (${canonicalUrl})` : ""}`,
        errors.length ? `Reason: ${errors.join(" / ")}` : "",
        warnings.length ? `Notes: ${warnings.join(" / ")}` : "",
        "",
        "If this is a private document, publish/export it as public text/PDF or paste the relevant excerpt. I did not save anything to Vault.",
      ].filter(Boolean).join("\n"),
      suggestedActions: [
        {
          type: "source_review_blocked",
          label: "Provide a public/exported source or paste the relevant excerpt.",
        },
        ...DEFAULT_FALLBACK_ACTIONS,
      ],
    };
  }

  return {
    answer: [
      `## Source Review: ${title}`,
      "",
      `Workspace: ${input.request.appName} (${reviewContext.workspace_id})`,
      canonicalUrl ? `Source URL: ${canonicalUrl}` : "",
      "",
      "## What I Read",
      "",
      summary || sourceText,
      tableSummary ? `\nTable notes: ${tableSummary}` : "",
      visualSummary ? `\nVisual notes: ${visualSummary}` : "",
      "",
      "## CMO Read",
      "",
      "This source is available as temporary review-only context for this turn. I can summarize it, extract positioning claims, list open questions, or turn it into workspace source material if you explicitly choose Save to Vault later.",
      warnings.length ? `\nWarnings: ${warnings.join(" / ")}` : "",
      "",
      "No Vault save, GBrain indexing, or knowledge promotion was performed.",
    ].filter(Boolean).join("\n"),
    suggestedActions: [
      {
        type: "source_review",
        label: `Review extracted source for ${input.request.appName}.`,
      },
      {
        type: "save_source_to_vault",
        label: "Save this source to Vault",
      },
      ...DEFAULT_FALLBACK_ACTIONS,
    ],
  };
}

export function cleanFallbackAnswerFormatting(answer: string): string {
  return answer
    .replace(/^##\s+Context Used\s+Contex(?:t)?\s*$/gim, "## Context Used")
    .replace(/^(##\s+Context Used)\s+Contex(?:t)?\s*$/gim, "$1")
    .replace(/(\n##\s+Context Used\s*\n\s*){2,}/gi, "\n## Context Used\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function businessMetricsFallbackAnswer(input: CmoRuntimeTurnInput, note: string): FallbackComposition {
  const item = input.contextPack.items.find((contextItem) => contextItem.kind === "business_metrics");

  if (!item?.content) {
    return {
      answer: [
        "I do not have connected Dune / Worldchain business metrics in this local context pack yet.",
        "",
        `CMO should only answer exact ${input.request.appName} business metrics from authoritative Dune / Worldchain \`cmo.business-metrics.v1\` JSON files. It should not use another workspace's metrics, DefiLlama, the Vault Markdown snapshot, or inferred values as the exact-number source of truth.`,
        "",
        "## Runtime Note",
        "",
        note,
      ].join("\n"),
      suggestedActions: DEFAULT_FALLBACK_ACTIONS,
    };
  }

  return {
    answer: [
      "## Dune / Worldchain Business Metrics",
      "",
      item.content,
      "",
      "## Source Boundary",
      "",
      `These numbers come from ${input.request.appName} app-scoped Dune / Worldchain \`cmo.business-metrics.v1\` JSON handoff files. DefiLlama and Vault Markdown snapshots are not exact-number sources of truth for this answer.`,
      "",
      "## Runtime Note",
      "",
      note,
    ].join("\n"),
    suggestedActions: DEFAULT_FALLBACK_ACTIONS,
  };
}

function fallbackAnswer(input: CmoRuntimeTurnInput, reason: string): FallbackComposition {
  const contextList = input.contextUsed.length ? input.contextUsed.map((note) => note.title).join(", ") : "no context pack items were available";
  const qualitySummary = summarizeContextQuality([...input.contextUsed, ...input.missingContext]);
  const contextLabels = includedContextLabels(input);
  const suggestedActions = fallbackRecommendations(input);
  const contextUsedDisplay = contextLabels.length ? contextLabels.join(" / ") : contextList;
  const hasWorkspaceContext = input.contextUsed.length > 0 || contextLabels.length > 0;
  const contextBoundaryLine = hasWorkspaceContext
    ? `I will only use ${input.request.appName} workspace context for workspace-specific facts.`
    : `${input.request.appName} workspace context is currently limited or empty, so I will not borrow facts from another workspace.`;
  const graphHints = input.contextPack.graphHints ?? [];
  const graphLine = graphHints.length
    ? `Graph hints: ${graphHints.map((hint) => `${hint.title} (${hint.confidence})`).join(" / ")}.`
    : `Graph: ${input.contextPack.graphStatus ?? "empty"}.`;
  const qualityLine = `${qualitySummary.confirmedCount} confirmed / ${qualitySummary.placeholderOrDraftCount} draft-placeholder / ${qualitySummary.missingCount} missing`;
  const note = runtimeNote(reason);
  const intent = fallbackIntent(input.message);
  const vaultContextIsEmpty = input.vaultAgentContextPackStatus === "empty";
  const runtimeContext = input.runtimeContext ?? input.contextPackage.runtimeContext;
  const reviewFallback = sourceReviewFallbackAnswer(input);

  if (reviewFallback) {
    return reviewFallback;
  }

  if (intent === "current_time" && runtimeContext) {
    const localTime = new Intl.DateTimeFormat(runtimeContext.locale || "vi-VN", {
      timeZone: runtimeContext.timezone || "Asia/Ho_Chi_Minh",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(runtimeContext.now_iso));

    return {
      answer: [
        `${localTime} (${runtimeContext.timezone_label || runtimeContext.timezone}).`,
        "",
        `now_iso: ${runtimeContext.now_iso}`,
      ].join("\n"),
      suggestedActions: DEFAULT_FALLBACK_ACTIONS,
    };
  }

  if (vaultContextIsEmpty) {
    if (intent === "greeting") {
      return {
        answer: [
          `Hi Jay, I'm ready for ${input.request.appName}.`,
          "",
          "I do not have accepted workspace sources or goals here yet. Send one source, goal, or constraint and I will use that as the starting point.",
        ].join("\n"),
        suggestedActions: [
          {
            type: "fallback_prompt",
            label: `Add one source, goal, or constraint for ${input.request.appName}.`,
          },
          ...DEFAULT_FALLBACK_ACTIONS,
        ],
      };
    }

    if (intent === "context_explanation") {
      return {
        answer: [
          `${input.request.appName} has no accepted knowledge/source context in the Vault Agent context pack yet.`,
          "",
          "Add a source, product goal, audience note, or constraint first. I will keep this workspace separate and will not use Holdstation Mini App facts.",
        ].join("\n"),
        suggestedActions: [
          {
            type: "fallback_prompt",
            label: `Add source context or a goal for ${input.request.appName}.`,
          },
          ...DEFAULT_FALLBACK_ACTIONS,
        ],
      };
    }

    if (intent === "source_input") {
      return {
        answer: [
          `I can treat this as source material for ${input.request.appName}, but it is not saved as accepted workspace context yet.`,
          "",
          "When Source UI is available, save it as a workspace source. For now, tell me the goal or decision you want this source to support.",
        ].join("\n"),
        suggestedActions: [
          {
            type: "fallback_prompt",
            label: "Attach a goal or decision for this source.",
          },
          ...DEFAULT_FALLBACK_ACTIONS,
        ],
      };
    }

    if (intent === "strategic_recommendation" || intent === "start_session" || intent === "general") {
      return {
        answer: [
          `I can help with ${input.request.appName}, but this workspace has no accepted source context yet.`,
          "",
          "Give me one of these first: the goal, the target user, a source link/doc, or a hard constraint. Then I can make the strategy specific without borrowing another workspace's facts.",
        ].join("\n"),
        suggestedActions: [
          {
            type: "fallback_prompt",
            label: `Provide one goal, user, source, or constraint for ${input.request.appName}.`,
          },
          ...DEFAULT_FALLBACK_ACTIONS,
        ],
      };
    }
  }

  if (intent === "greeting") {
    return {
      answer: [
        `Hi Jay, I'm ready. ${contextBoundaryLine}`,
        "",
        "What do you want to focus on: activation, retention, campaign messaging, or app memory cleanup?",
        "",
        "## Runtime Note",
        "",
        note,
      ].join("\n"),
      suggestedActions: [
        {
          type: "fallback_prompt",
          label: "Choose a CMO focus area: activation, retention, campaign messaging, or app memory cleanup.",
        },
        ...DEFAULT_FALLBACK_ACTIONS,
      ],
    };
  }

  if (intent === "context_explanation") {
    return {
      answer: [
        "## Context Used",
        "",
        `I'm using: ${contextUsedDisplay}.`,
        graphLine,
        `Quality: ${qualityLine}.`,
        "",
        `This context is resolved automatically from the ${input.request.appName} workspace. Vault file picking, all-vault RAG, fake metrics, and fake Task Tracker data are not part of this answer.`,
        "",
        "## Runtime Note",
        "",
        note,
      ].join("\n"),
      suggestedActions: [
        {
          type: "fallback_prompt",
          label: "Ask for recommendations, a campaign angle, retention loop, or app memory cleanup.",
        },
        ...DEFAULT_FALLBACK_ACTIONS,
      ],
    };
  }

  if (intent === "business_metrics") {
    return businessMetricsFallbackAnswer(input, note);
  }

  if (intent === "start_session" || intent === "general") {
    return {
      answer: [
        `I'm ready to help with ${input.request.appName}. ${contextBoundaryLine} The most useful next CMO angle is to choose one focus area before generating a plan.`,
        "",
        "Pick one: activation, retention, campaign messaging, or app memory cleanup.",
        "",
        "## Context Used",
        "",
        `Context used: ${contextUsedDisplay}.`,
        "",
        "## Runtime Note",
        "",
        note,
      ].join("\n"),
      suggestedActions: [
        {
          type: "fallback_prompt",
          label: "Pick a focus area before generating recommendations.",
        },
        ...DEFAULT_FALLBACK_ACTIONS,
      ],
    };
  }

  return {
    answer: [
      "## Recommended Actions",
      "",
      `1. ${suggestedActions[0].label.replace(/\.$/, "")}`,
      "Define the target user behavior for this week, the product surface that proves it happened, and the simplest qualitative check before scaling it.",
      "",
      `2. ${suggestedActions[1].label.replace(/\.$/, "")}`,
      "Turn one confirmed product truth into a short campaign angle, creator prompt, or landing-page message. Avoid performance claims unless they are already confirmed in the workspace context.",
      "",
      `3. ${suggestedActions[2].label.replace(/\.$/, "")}`,
      "Choose the next prompt, reminder, or content touch for users who reach the activation moment. Treat it as a retention hypothesis, not a proven result.",
      "",
      contextBoundaryLine,
      "",
      "## Context Used",
      "",
      `Context used: ${contextUsedDisplay}.`,
      graphLine,
      `Quality: ${qualityLine}.`,
      "",
      "## Runtime Note",
      "",
      note,
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
    error.code.includes("diagnostic") ||
    error.code.includes("invalid") ||
    error.code.includes("validation") ||
    error.code.includes("json")
  ) {
    return "invalid_response";
  }

  return "execution_error";
}

function logAppTurnFailure(
  reason: CmoRuntimeErrorReason,
  message: string,
  error: unknown,
  timeoutConfig?: ReturnType<typeof appTurnTimeoutConfig>,
) {
  const timeoutMetadata = timeoutConfig
    ? {
        timeoutMs: timeoutConfig.timeoutMs,
        outer_timeout_ms: timeoutConfig.timeoutMs,
        outer_timeout_source: timeoutConfig.timeoutSource,
        route_decision: timeoutConfig.routeDecision,
        creative_execution_requested: timeoutConfig.creativeExecutionRequested,
      }
    : {};

  if (reason === "unsupported_chat_turn") {
    console.warn("[cmo-runtime] Adapter health passed, but /cmo/app-turn is unavailable; using app-chat fallback.", {
      reason,
      message,
      ...timeoutMetadata,
    });
    return;
  }

  if (reason === "invalid_response" && error instanceof CmoAdapterError && error.code.includes("dashboard_json")) {
    console.warn("[cmo-runtime] Adapter returned dashboard run-brief JSON for app chat; using app-chat fallback.", {
      reason,
      message,
      ...timeoutMetadata,
    });
    return;
  }

  if (reason === "timeout") {
    if (timeoutConfig?.creativeExecutionRequested) {
      console.warn("[cmo-runtime] Creative app-chat turn timed out; no workspace fallback used.", {
        reason,
        message,
        ...timeoutMetadata,
      });
      return;
    }

    console.warn("[cmo-runtime] Live app-chat turn timed out; using fallback.", {
      reason,
      message,
      ...timeoutMetadata,
    });
    return;
  }

  if (reason === "invalid_response") {
    console.warn("[cmo-runtime] Live app-chat turn returned an invalid response; using fallback.", {
      reason,
      message,
      ...timeoutMetadata,
    });
    return;
  }

  if (reason === "empty_answer") {
    console.warn("[cmo-runtime] Live app-chat turn returned an empty answer; using fallback.", {
      reason,
      message,
      ...timeoutMetadata,
    });
    return;
  }

  console.warn("[cmo-runtime] Live app-chat turn failed; using fallback.", {
    reason,
    message,
    ...timeoutMetadata,
  });
}

function creativeExecutionRequested(input: CmoRuntimeTurnInput): boolean {
  return isExplicitCreativeExecutionIntent(input.message) || isExplicitCreativeExecutionIntent(input.request.message);
}

function appTurnTimeoutConfig(input: CmoRuntimeTurnInput): {
  timeoutMs: number;
  timeoutSource: "default_app_turn" | "creative_execute";
  routeDecision: "app_turn" | "creative_execution";
  creativeExecutionRequested: boolean;
} {
  const creativeRequested = creativeExecutionRequested(input);

  if (creativeRequested) {
    return {
      timeoutMs: getCmoHermesCreativeExecuteTimeoutMs(),
      timeoutSource: "creative_execute",
      routeDecision: "creative_execution",
      creativeExecutionRequested: true,
    };
  }

  return {
    timeoutMs: Math.min(getCmoLiveAppTurnTimeoutMs(), getCmoFallbackFastAfterMs()),
    timeoutSource: "default_app_turn",
    routeDecision: "app_turn",
    creativeExecutionRequested: false,
  };
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
    const fallbackStartedAt = Date.now();
    const fallback = fallbackAnswer(input, this.reason);
    const fallbackDurationMs = Date.now() - fallbackStartedAt;

    return {
      answer: cleanFallbackAnswerFormatting(fallback.answer),
      assumptions: [],
      suggestedActions: fallback.suggestedActions,
      runtimeStatus: this.status,
      runtimeMode: this.mode,
      runtimeLabel: this.label,
      runtimeProvider: "fallback",
      isDevelopmentFallback: true,
      isRuntimeFallback: true,
      fallbackDurationMs,
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

    const timeoutConfig = appTurnTimeoutConfig(input);
    const timeoutMs = timeoutConfig.timeoutMs;
    const liveAttemptStartedAt = new Date().toISOString();
    const liveAttemptStartedMs = Date.now();

    try {
      const result = await callOpenClawAppTurnRuntime(
        input.contextPackage,
        availability.config,
        input.history,
        input.request.sessionId,
        timeoutMs,
        {
          outer_timeout_ms: timeoutMs,
          outer_timeout_source: timeoutConfig.timeoutSource,
          route_decision: timeoutConfig.routeDecision,
          creative_execution_requested: timeoutConfig.creativeExecutionRequested,
        },
      );
      const liveAttemptDurationMs = Date.now() - liveAttemptStartedMs;

      return {
        answer: result.answer,
        assumptions: result.assumptions,
        suggestedActions: result.suggestedActions.length ? result.suggestedActions : DEFAULT_FALLBACK_ACTIONS,
        runtimeStatus: "live",
        runtimeMode: "live",
        attemptedRuntimeMode: "live",
        runtimeLabel: result.runtimeLabel,
        runtimeProvider: result.runtimeProvider ?? "openclaw",
        runtimeAgent: result.runtimeAgent ?? "cmo",
        rawRuntimeResponse: result.rawRuntimeResponse,
        isDevelopmentFallback: false,
        isRuntimeFallback: false,
        liveAttemptStartedAt,
        liveAttemptDurationMs,
        timeoutMs,
        outerTimeoutMs: timeoutMs,
        outerTimeoutSource: timeoutConfig.timeoutSource,
        routeDecision: timeoutConfig.routeDecision,
        creativeExecutionRequested: timeoutConfig.creativeExecutionRequested,
      };
    } catch (error) {
      const liveAttemptDurationMs = Date.now() - liveAttemptStartedMs;
      const runtimeError = error instanceof Error ? error.message : "OpenClaw CMO runtime failed";
      const runtimeErrorReason = classifyAppTurnErrorReason(error);
      logAppTurnFailure(runtimeErrorReason, runtimeError, error, timeoutConfig);
      console.warn("[cmo-runtime] Live app-turn diagnostic.", {
        reason: runtimeErrorReason,
        runtimeLabel: availability.label,
        liveAttemptDurationMs,
        timeoutMs,
        outer_timeout_ms: timeoutMs,
        outer_timeout_source: timeoutConfig.timeoutSource,
        route_decision: timeoutConfig.routeDecision,
        creative_execution_requested: timeoutConfig.creativeExecutionRequested,
      });
      if (timeoutConfig.creativeExecutionRequested && runtimeErrorReason === "timeout") {
        return {
          answer: "",
          assumptions: [],
          suggestedActions: [],
          runtimeStatus: "runtime_error",
          runtimeMode: "configured_but_unreachable",
          attemptedRuntimeMode: "live",
          runtimeLabel: "Remote CMO Creative execution",
          runtimeError: "Creative execution timed out before the remote CMO adapter returned asset metadata.",
          runtimeErrorReason: "timeout",
          runtimeProvider: "openclaw",
          runtimeAgent: "creative",
          isDevelopmentFallback: false,
          isRuntimeFallback: false,
          liveAttemptStartedAt,
          liveAttemptDurationMs,
          timeoutMs,
          outerTimeoutMs: timeoutMs,
          outerTimeoutSource: timeoutConfig.timeoutSource,
          routeDecision: timeoutConfig.routeDecision,
          creativeExecutionRequested: true,
        };
      }
      const fallbackStartedMs = Date.now();
      const fallback = await new FallbackRuntime({
        status: "live_failed_then_fallback",
        mode: "fallback",
        label: availability.label,
        reason: "Live runtime unavailable for app chat; fallback used.",
      }).runTurn(input);
      const fallbackDurationMs = Date.now() - fallbackStartedMs;

      return {
        ...fallback,
        runtimeStatus: "live_failed_then_fallback",
        runtimeMode: "fallback",
        attemptedRuntimeMode: "live",
        runtimeLabel: availability.label,
        runtimeError,
        runtimeErrorReason,
        runtimeProvider: fallback.runtimeProvider,
        runtimeAgent: fallback.runtimeAgent,
        isDevelopmentFallback: true,
        isRuntimeFallback: true,
        liveAttemptStartedAt,
        liveAttemptDurationMs,
        fallbackDurationMs,
        timeoutMs,
        outerTimeoutMs: timeoutMs,
        outerTimeoutSource: timeoutConfig.timeoutSource,
        routeDecision: timeoutConfig.routeDecision,
        creativeExecutionRequested: timeoutConfig.creativeExecutionRequested,
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
