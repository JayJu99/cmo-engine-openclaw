export type CmoRouteIntent = "cmo_review" | "echo_execution" | "creative_execution" | "creative_ideation" | "creative_session" | "surf_x" | "surf_trend" | "surf_research" | "cmo_default";

export interface CreativeWorkingStateIntentContext {
  active_draft_id?: string | null;
  active_asset_id?: string | null;
  drafts?: unknown[];
  assets?: unknown[];
}

export type CreativeSessionFollowupIntentClass =
  | "ack_noop"
  | "asset_review"
  | "channel_advisory"
  | "prompt_proposal"
  | "explicit_mutation"
  | "post_edit_review";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111|\u0110/g, "d");
}

function tokensFor(value: string): Set<string> {
  return new Set(normalize(value).match(/[a-z0-9:]+/g) ?? []);
}

function hasAny(tokens: Set<string>, vocabulary: readonly string[]): boolean {
  return vocabulary.some((term) => tokens.has(term));
}

function hasPhrase(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function creativeStateHasDraft(state: CreativeWorkingStateIntentContext | undefined): boolean {
  const activeDraftId = typeof state?.active_draft_id === "string" && state.active_draft_id.trim()
    ? state.active_draft_id.trim()
    : undefined;
  const activeAssetId = typeof state?.active_asset_id === "string" && state.active_asset_id.trim()
    ? state.active_asset_id.trim()
    : undefined;
  const draftsCount = Array.isArray(state?.drafts) ? state.drafts.length : 0;
  const assetsCount = Array.isArray(state?.assets) ? state.assets.length : 0;

  return Boolean(activeDraftId || activeAssetId || draftsCount > 0 || assetsCount > 0);
}

export function leadingIntentText(message: string): string {
  const trimmed = message.trim();
  const firstLine = trimmed.split(/\n{2,}|\n(?=#{1,6}\s)|\n(?=[-*]\s)/)[0] ?? trimmed;
  return normalize(firstLine.slice(0, 320));
}

export function isReviewAuditIntent(message: string): boolean {
  const tokens = tokensFor(leadingIntentText(message));
  const reviewTerms = ["review", "audit", "check", "feedback", "analyze", "analyse", "evaluate", "critique", "weak", "weakness", "danh", "gia", "gop", "y", "nhan", "xet", "yeu"];
  const planningTerms = ["plan", "program", "campaign", "ambassador", "proposal"];

  return hasAny(tokens, reviewTerms) && (hasAny(tokens, planningTerms) || hasAny(tokens, ["feedback", "audit", "review"]));
}

type CreativeSemanticGoal = "ack" | "asset_review" | "channel_advisory" | "prompt_proposal" | "explicit_mutation" | "direct_create" | "ideation" | "none";

interface CreativeSemanticIntent {
  goal: CreativeSemanticGoal;
  desiredOutput: "native_ack" | "text" | "text_prompt" | "asset" | "draft" | "none";
  creationScore: number;
  mutationScore: number;
  reviewScore: number;
  advisoryScore: number;
  promptScore: number;
  assetOutputScore: number;
  negativeExecution: boolean;
}

function countPatternMatches(value: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
}

function tokenCount(tokens: Set<string>, vocabulary: readonly string[]): number {
  return vocabulary.reduce((count, term) => count + (tokens.has(term) ? 1 : 0), 0);
}

function creativeStateHasAsset(state: CreativeWorkingStateIntentContext | undefined): boolean {
  const activeAssetId = typeof state?.active_asset_id === "string" && state.active_asset_id.trim()
    ? state.active_asset_id.trim()
    : undefined;
  const assetsCount = Array.isArray(state?.assets) ? state.assets.length : 0;

  return Boolean(activeAssetId || assetsCount > 0);
}

function classifyCreativeSemanticIntent(
  message: string,
  creativeWorkingState?: CreativeWorkingStateIntentContext,
): CreativeSemanticIntent {
  const lead = leadingIntentText(message);
  const tokens = tokensFor(lead);
  const hasCreativeAsset = creativeStateHasAsset(creativeWorkingState);
  const hasCreativeDraft = creativeStateHasDraft(creativeWorkingState);
  const shortTurn = tokens.size <= 10;
  const negativeExecution = hasPhrase(lead, [
    /\b(?:do\s*not|don't|dont|no|without|hold|wait|pause)\s+(?:creat|generat|render|edit|chang|appl|produc|mak)\w*\b/,
    /\b(?:not|only)\s+(?:yet|now)\b/,
    /\b(?:chua|khoan|dung|khong)\s+(?:tao|lam|ve|chinh|sua|doi|render|generate|edit|apply)\b/,
  ]);
  const promptOnlyModifier = negativeExecution || hasPhrase(lead, [
    /\b(?:only|just|text|copy)\b/,
    /\b(?:chi|thoi|truoc)\b/,
  ]);
  const acknowledgementScore = tokenCount(tokens, ["ok", "okay", "yes", "yep", "yeah", "confirm", "approve", "thanks", "thank", "duoc", "roi", "chot", "duyet", "cam", "on"]);
  const questionScore = lead.includes("?") ? 1 : tokenCount(tokens, ["why", "how", "what", "when", "where", "sao", "nen", "the", "nao", "gi"]);
  const promptScore = tokenCount(tokens, ["prompt", "draft", "brief", "instruction", "instructions", "spec", "copy", "direction", "concept", "idea", "angle", "outline", "show", "present", "preview", "xem", "viet", "rewrite", "de", "xuat", "goi", "y"]);
  const reviewScore = tokenCount(tokens, ["review", "audit", "critique", "feedback", "analyze", "analyse", "evaluate", "assess", "compare", "score", "grade", "risk", "weakness", "improve", "fix", "confusing", "unclear", "danh", "gia", "nhan", "xet", "gop", "y", "diem", "yeu", "rui", "ro"]) +
    countPatternMatches(lead, [/\b(?:look|talk|walk)\s+(?:at|through)\b/, /\b(?:what|which)\s+(?:is|are|should)\b/]);
  const channelScore = tokenCount(tokens, ["channel", "placement", "usecase", "website", "web", "social", "feed", "post", "community", "telegram", "discord", "landing", "store", "ad", "ads", "campaign", "kenh"]);
  const advisoryScore = channelScore + tokenCount(tokens, ["use", "using", "adapt", "vary", "map", "position", "positioned", "emphasize", "fit", "apply", "deploy", "reuse", "dung", "nhan", "manh", "khac"]);
  const creationScore = tokenCount(tokens, ["generate", "create", "produce", "make", "build", "design", "draw", "render", "compose", "craft", "sketch", "tao", "lam", "ve", "thiet", "ke"]) +
    countPatternMatches(lead, [/\b(?:generat|creat|produc|design|draw|render|compos|craft|sketch|build|mak)\w*\b/, /\b(?:turn|convert)\s+.+\s+into\b/, /\b(?:need|want|can)\s+.+\b(?:asset|image|graphic|creative)\b/]);
  const mutationScore = tokenCount(tokens, ["edit", "change", "adjust", "modify", "update", "revise", "refine", "apply", "resize", "reframe", "variant", "version", "iterate", "chinh", "sua", "doi", "thay", "ap", "nhap"]) +
    countPatternMatches(lead, [/\b(?:make|turn)\s+(?:it|this|that|current)\b/]);
  const mediaObjectScore = tokenCount(tokens, ["image", "graphic", "artwork", "illustration", "creative", "asset", "poster", "thumbnail", "logo", "icon", "video", "motion", "storyboard", "canvas", "keyart", "hinh", "anh"]);
  const layoutOrDeliveryScore = tokenCount(tokens, ["png", "jpg", "jpeg", "webp", "mp4", "webm", "square", "portrait", "landscape", "ratio", "format", "9:16", "16:9", "4:5", "1:1"]) +
    (/\b\d{1,2}\s*:\s*\d{1,2}\b/.test(lead) ? 1 : 0);
  const creativeContextScore = tokenCount(tokens, ["launch", "seasonal", "quest", "reward", "campaign", "brand", "style", "premium", "product", "offer", "event", "activation", "theme", "subject", "cta"]);
  const visualAttributeScore = tokenCount(tokens, ["color", "palette", "background", "layout", "composition", "contrast", "brighter", "lighter", "darker", "warmer", "cleaner", "premium", "minimal", "bold", "mau", "nen", "sang", "toi", "dam", "nhat"]);
  const assetOutputScore = mediaObjectScore + layoutOrDeliveryScore + Math.min(creativeContextScore, 2) + Math.min(visualAttributeScore, 2);
  const hasEnoughCreationBrief = assetOutputScore >= 2 || (assetOutputScore >= 1 && tokens.size >= 6);
  const channelAdvisoryCandidate = advisoryScore >= 2 && (hasCreativeAsset || mediaObjectScore > 0 || channelScore >= 2);

  if (shortTurn && acknowledgementScore > 0 && questionScore === 0 && creationScore === 0 && mutationScore === 0 && reviewScore === 0) {
    return {
      goal: "ack",
      desiredOutput: "native_ack",
      creationScore,
      mutationScore,
      reviewScore,
      advisoryScore,
      promptScore,
      assetOutputScore,
      negativeExecution,
    };
  }

  if (hasCreativeDraft && shortTurn && acknowledgementScore > 0 && !negativeExecution && creationScore + mutationScore > 0) {
    return {
      goal: "explicit_mutation",
      desiredOutput: "asset",
      creationScore,
      mutationScore,
      reviewScore,
      advisoryScore,
      promptScore,
      assetOutputScore,
      negativeExecution,
    };
  }

  if (!channelAdvisoryCandidate && promptScore >= 1 && promptOnlyModifier && (hasCreativeDraft || creationScore + mutationScore + mediaObjectScore >= 1)) {
    return {
      goal: "prompt_proposal",
      desiredOutput: "text_prompt",
      creationScore,
      mutationScore,
      reviewScore,
      advisoryScore,
      promptScore,
      assetOutputScore,
      negativeExecution,
    };
  }

  if (channelAdvisoryCandidate) {
    return {
      goal: "channel_advisory",
      desiredOutput: "text",
      creationScore,
      mutationScore,
      reviewScore,
      advisoryScore,
      promptScore,
      assetOutputScore,
      negativeExecution,
    };
  }

  if (hasCreativeDraft && promptScore >= 1 && creationScore === 0 && mutationScore === 0) {
    return {
      goal: "prompt_proposal",
      desiredOutput: "text_prompt",
      creationScore,
      mutationScore,
      reviewScore,
      advisoryScore,
      promptScore,
      assetOutputScore,
      negativeExecution,
    };
  }

  if (hasCreativeAsset && !negativeExecution && mutationScore >= 1 && (assetOutputScore >= 1 || creationScore >= 1)) {
    return {
      goal: "explicit_mutation",
      desiredOutput: "asset",
      creationScore,
      mutationScore,
      reviewScore,
      advisoryScore,
      promptScore,
      assetOutputScore,
      negativeExecution,
    };
  }

  if (hasCreativeDraft && !negativeExecution && mutationScore >= 1 && assetOutputScore >= 1) {
    return {
      goal: "explicit_mutation",
      desiredOutput: "asset",
      creationScore,
      mutationScore,
      reviewScore,
      advisoryScore,
      promptScore,
      assetOutputScore,
      negativeExecution,
    };
  }

  if (hasCreativeAsset && reviewScore >= 1 && (mediaObjectScore > 0 || channelScore > 0 || questionScore > 0 || negativeExecution)) {
    return {
      goal: "asset_review",
      desiredOutput: "text",
      creationScore,
      mutationScore,
      reviewScore,
      advisoryScore,
      promptScore,
      assetOutputScore,
      negativeExecution,
    };
  }

  if (hasCreativeDraft && reviewScore >= 1 && negativeExecution) {
    return {
      goal: "asset_review",
      desiredOutput: "text",
      creationScore,
      mutationScore,
      reviewScore,
      advisoryScore,
      promptScore,
      assetOutputScore,
      negativeExecution,
    };
  }

  if (!negativeExecution && creationScore >= 1 && hasEnoughCreationBrief) {
    return {
      goal: "direct_create",
      desiredOutput: "asset",
      creationScore,
      mutationScore,
      reviewScore,
      advisoryScore,
      promptScore,
      assetOutputScore,
      negativeExecution,
    };
  }

  if (!negativeExecution && (creationScore >= 1 || promptScore >= 1) && (mediaObjectScore >= 1 || hasCreativeDraft)) {
    return {
      goal: "ideation",
      desiredOutput: "draft",
      creationScore,
      mutationScore,
      reviewScore,
      advisoryScore,
      promptScore,
      assetOutputScore,
      negativeExecution,
    };
  }

  return {
    goal: "none",
    desiredOutput: "none",
    creationScore,
    mutationScore,
    reviewScore,
    advisoryScore,
    promptScore,
    assetOutputScore,
    negativeExecution,
  };
}

export function isPureAcknowledgementIntent(message: string): boolean {
  return classifyCreativeSemanticIntent(message).goal === "ack";
}

export function isPromptProposalOnlyIntent(message: string): boolean {
  return classifyCreativeSemanticIntent(message).goal === "prompt_proposal";
}

export function isCreativeReviewConversationIntent(message: string): boolean {
  return classifyCreativeSemanticIntent(message, { active_asset_id: "active", drafts: [], assets: [{}] }).goal === "asset_review";
}

export function isChannelUseCaseAdvisoryIntent(message: string): boolean {
  return classifyCreativeSemanticIntent(message, { active_asset_id: "active", drafts: [], assets: [{}] }).goal === "channel_advisory";
}

export function isCreativeConversationOnlyIntent(message: string): boolean {
  const goal = classifyCreativeSemanticIntent(message, { active_asset_id: "active", drafts: [], assets: [{}] }).goal;

  return goal === "ack" || goal === "prompt_proposal" || goal === "asset_review" || goal === "channel_advisory";
}

export function creativeSessionFollowupIntentClass(message: string): CreativeSessionFollowupIntentClass {
  const semanticIntent = classifyCreativeSemanticIntent(message, { active_asset_id: "active", drafts: [], assets: [{}] });

  if (semanticIntent.goal === "ack") {
    return "ack_noop";
  }

  if (semanticIntent.goal === "prompt_proposal") {
    return "prompt_proposal";
  }

  if (semanticIntent.goal === "asset_review") {
    const tokens = tokensFor(leadingIntentText(message));

    return hasAny(tokens, ["new", "newer", "latest", "updated", "edited", "moi", "sau", "ban"]) ? "post_edit_review" : "asset_review";
  }

  if (semanticIntent.goal === "channel_advisory") {
    return "channel_advisory";
  }

  if (semanticIntent.goal === "explicit_mutation" || semanticIntent.goal === "direct_create") {
    return "explicit_mutation";
  }

  return "asset_review";
}

export function isExplicitCreativeMutationIntent(message: string): boolean {
  return classifyCreativeSemanticIntent(message, { active_asset_id: "active", drafts: [], assets: [{}] }).goal === "explicit_mutation";
}

export function isExplicitEchoExecutionIntent(message: string): boolean {
  const lead = leadingIntentText(message);
  const tokens = tokensFor(lead);

  if (/^(?:\/|@)echo\b/.test(lead)) return true;
  if (isReviewAuditIntent(message)) return false;

  return hasAny(tokens, ["draft", "write", "compose", "generate", "create", "rewrite", "viet", "soan"]) &&
    hasAny(tokens, ["post", "posts", "tweet", "tweets", "thread", "caption", "copy", "facebook", "telegram", "announcement", "content"]);
}

export function isExplicitCreativeExecutionIntent(message: string): boolean {
  const lead = leadingIntentText(message);

  if (/^(?:\/|@)creative\b/.test(lead)) return true;
  if (isCreativeConversationOnlyIntent(message)) return false;
  if (isReviewAuditIntent(message)) return false;

  return classifyCreativeSemanticIntent(message).goal === "direct_create";
}

export function isCreativeDraftSessionIntent(message: string): boolean {
  const lead = leadingIntentText(message);

  if (/^(?:\/|@)creative\b/.test(lead)) return true;
  if (isReviewAuditIntent(message)) return false;
  const semanticIntent = classifyCreativeSemanticIntent(message);

  return semanticIntent.goal === "ideation" || semanticIntent.goal === "prompt_proposal";
}

export function isCreativeSessionTransportContinuation(
  message: string,
  creativeWorkingState?: CreativeWorkingStateIntentContext,
): boolean {
  if (!creativeStateHasDraft(creativeWorkingState)) {
    return false;
  }

  const lead = leadingIntentText(message);
  const tokens = tokensFor(lead);

  if (/^(?:\/|@)creative\b/.test(lead)) {
    return true;
  }

  const semanticIntent = classifyCreativeSemanticIntent(message, creativeWorkingState);
  const toolOrAnalyticsTerms = [
    "traffic",
    "conversion",
    "chart",
    "metric",
    "metrics",
    "analytics",
    "dune",
    "sql",
    "query",
    "volume",
    "revenue",
    "retention",
    "cohort",
    "funnel",
    "task",
    "pending",
    "vault",
    "source",
    "link",
    "read",
    "doc",
    "tom",
    "tat",
  ];

  if (hasAny(tokens, toolOrAnalyticsTerms) && semanticIntent.goal === "none") {
    return false;
  }

  return semanticIntent.goal !== "none";
}

export function routeIntentForMessage(
  message: string,
  options: { creativeWorkingState?: CreativeWorkingStateIntentContext } = {},
): CmoRouteIntent {
  const lead = leadingIntentText(message);
  const creativeSessionContinuation = isCreativeSessionTransportContinuation(message, options.creativeWorkingState);

  if (creativeSessionContinuation) return "creative_session";
  if (isReviewAuditIntent(message)) return "cmo_review";
  if (isExplicitCreativeExecutionIntent(message)) return "creative_execution";
  if (isCreativeDraftSessionIntent(message)) return "creative_ideation";
  if (/^\/x\b|^\/surf\s+x\b/.test(lead)) return "surf_x";
  if (/^\/trend\b/.test(lead)) return "surf_trend";
  if (/^\/surf\b/.test(lead)) return "surf_research";
  if (isExplicitEchoExecutionIntent(message)) return "echo_execution";

  return "cmo_default";
}
