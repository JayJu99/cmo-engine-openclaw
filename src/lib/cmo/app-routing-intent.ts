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

export function isPureAcknowledgementIntent(message: string): boolean {
  const lead = leadingIntentText(message);
  const tokens = tokensFor(lead);
  const acknowledgementTerms = ["ok", "okay", "yes", "yep", "yeah", "uh", "ua", "duoc", "roi", "on", "tam", "giu", "vay", "thanks", "thank", "cam", "on"];
  const mutationTerms = ["generate", "create", "render", "produce", "edit", "change", "adjust", "resize", "reframe", "apply", "make", "tao", "chinh", "sua", "doi", "resize"];
  const questionOrReviewTerms = ["?", "review", "critique", "analyze", "analyse", "evaluate", "why", "how", "nen", "sao", "danh", "gia", "nhan", "xet", "yeu"];

  if (!hasAny(tokens, acknowledgementTerms) || tokens.size > 10) {
    return false;
  }

  if (hasAny(tokens, questionOrReviewTerms) || lead.includes("?")) {
    return false;
  }

  if (hasAny(tokens, mutationTerms)) {
    return hasAny(tokens, ["no", "not", "dont", "chua", "khong", "khoan", "dung", "stop"]);
  }

  return true;
}

export function isPromptProposalOnlyIntent(message: string): boolean {
  const lead = leadingIntentText(message);
  const tokens = tokensFor(lead);
  const asksForPrompt = hasAny(tokens, ["prompt", "brief", "direction", "concept", "idea", "angle", "viet", "write", "rewrite", "de", "xuat", "goi", "y"]);
  const explicitNoExecution = hasAny(tokens, ["only", "thoi", "dont", "not", "no", "chua", "khoan"]) ||
    hasPhrase(lead, [
      /\bwithout\s+(?:creating|generating|rendering|editing)\b/,
      /\bno\s+(?:image|edit|generation|render)\b/,
      /\bdung\s+(?:tao|chinh|sua|execute|render|generate|edit)\b/,
    ]);

  return asksForPrompt && explicitNoExecution;
}

export function isCreativeReviewConversationIntent(message: string): boolean {
  const lead = leadingIntentText(message);
  const tokens = tokensFor(lead);
  const reviewTerms = ["review", "critique", "audit", "feedback", "analyze", "analyse", "evaluate", "score", "grade", "weak", "weakness", "conversion", "trust", "attention", "danh", "gia", "nhan", "xet", "yeu", "diem"];
  const visualTerms = ["visual", "image", "asset", "creative", "hero", "landing", "banner", "post", "social", "community", "telegram", "web", "hinh", "anh"];
  const explicitNoMutation = hasAny(tokens, ["only", "thoi", "dont", "not", "no", "chua", "khong", "khoan"]) ||
    hasPhrase(lead, [/\bno\s+(?:edit|image|generation|render)\b/, /\bwithout\s+(?:editing|generating|creating|rendering)\b/]);

  return hasAny(tokens, reviewTerms) && (hasAny(tokens, visualTerms) || explicitNoMutation);
}

export function isChannelUseCaseAdvisoryIntent(message: string): boolean {
  const lead = leadingIntentText(message);
  const tokens = tokensFor(lead);
  const channelTerms = ["landing", "web", "website", "social", "post", "x", "twitter", "telegram", "community", "banner", "channel", "kenh"];
  const advisoryTerms = ["use", "used", "using", "across", "angle", "emphasize", "position", "adapt", "different", "differently", "khac", "dung", "nhan", "manh", "angle"];

  return hasAny(tokens, channelTerms) && hasAny(tokens, advisoryTerms);
}

export function isCreativeConversationOnlyIntent(message: string): boolean {
  return isPureAcknowledgementIntent(message) ||
    isPromptProposalOnlyIntent(message) ||
    isCreativeReviewConversationIntent(message) ||
    isChannelUseCaseAdvisoryIntent(message);
}

export function creativeSessionFollowupIntentClass(message: string): CreativeSessionFollowupIntentClass {
  if (isPureAcknowledgementIntent(message)) {
    return "ack_noop";
  }

  if (isPromptProposalOnlyIntent(message)) {
    return "prompt_proposal";
  }

  if (isCreativeReviewConversationIntent(message)) {
    const tokens = tokensFor(leadingIntentText(message));

    return hasAny(tokens, ["new", "newer", "latest", "updated", "edited", "moi", "sau", "ban"]) ? "post_edit_review" : "asset_review";
  }

  if (isChannelUseCaseAdvisoryIntent(message)) {
    return "channel_advisory";
  }

  if (isExplicitCreativeMutationIntent(message)) {
    return "explicit_mutation";
  }

  return "asset_review";
}

export function isExplicitCreativeMutationIntent(message: string): boolean {
  const lead = leadingIntentText(message);
  const tokens = tokensFor(lead);
  const mutationTerms = ["generate", "create", "render", "produce", "make", "edit", "change", "adjust", "resize", "reframe", "apply", "variant", "version", "tao", "chinh", "sua", "doi", "ap"];
  const assetTerms = ["image", "visual", "asset", "creative", "banner", "poster", "video", "motion", "hinh", "anh", "ban", "9:16", "16:9", "4:5", "1:1"];
  const explicitNoExecution = isPromptProposalOnlyIntent(message) || hasPhrase(lead, [/\b(?:do\s*not|don't|dont|no)\s+(?:create|generate|render|edit)\b/]);

  return !explicitNoExecution && hasAny(tokens, mutationTerms) && (hasAny(tokens, assetTerms) || hasAny(tokens, ["current", "hien", "tai"]));
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
  const tokens = tokensFor(lead);

  if (/^(?:\/|@)creative\b/.test(lead)) return true;
  if (isCreativeConversationOnlyIntent(message)) return false;
  if (isReviewAuditIntent(message)) return false;

  const concreteAssetFormat = hasAny(tokens, ["png", "webp", "jpeg", "jpg", "mp4", "webm"]) &&
    hasAny(tokens, ["generate", "render", "produce", "create", "tao"]);

  return (hasAny(tokens, ["generate", "render", "produce", "create"]) || concreteAssetFormat) &&
    hasAny(tokens, ["image", "visual", "graphic", "creative", "banner", "thumbnail", "illustration", "logo", "icon", "png", "webp", "jpeg", "jpg", "video", "motion", "asset"]);
}

export function isCreativeDraftSessionIntent(message: string): boolean {
  const lead = leadingIntentText(message);
  const tokens = tokensFor(lead);

  if (/^(?:\/|@)creative\b/.test(lead)) return true;
  if (isPureAcknowledgementIntent(message)) return false;
  if (isPromptProposalOnlyIntent(message)) return true;
  if (isCreativeReviewConversationIntent(message) || isChannelUseCaseAdvisoryIntent(message)) return false;
  if (isReviewAuditIntent(message)) return false;

  const creativeAction = hasAny(tokens, [
    "generate",
    "create",
    "make",
    "design",
    "draw",
    "render",
    "produce",
    "brainstorm",
    "concept",
    "ideate",
    "tao",
    "ve",
    "thiet",
    "ke",
    "lam",
    "muon",
    "can",
  ]);
  const creativeObject = hasAny(tokens, [
    "image",
    "visual",
    "graphic",
    "creative",
    "banner",
    "thumbnail",
    "illustration",
    "logo",
    "icon",
    "video",
    "motion",
    "asset",
    "poster",
    "sticker",
    "key",
    "campaign",
    "prompt",
    "concept",
    "hinh",
    "anh",
  ]);

  return creativeAction && creativeObject;
}

export function isCreativeSessionTransportContinuation(
  message: string,
  creativeWorkingState?: CreativeWorkingStateIntentContext,
): boolean {
  if (!creativeStateHasDraft(creativeWorkingState)) {
    return false;
  }

  if (isCreativeConversationOnlyIntent(message)) {
    return true;
  }

  if (isReviewAuditIntent(message)) {
    return false;
  }

  const lead = leadingIntentText(message);
  const tokens = tokensFor(lead);

  if (/^(?:\/|@)creative\b/.test(lead)) {
    return true;
  }

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
  const creativeSessionTerms = [
    "draft",
    "prompt",
    "brief",
    "concept",
    "direction",
    "idea",
    "visual",
    "style",
    "format",
    "ratio",
    "aspect",
    "variant",
    "version",
    "key",
    "hinh",
    "anh",
    "mau",
    "nen",
    "sang",
    "toi",
    "color",
    "background",
    "lighter",
    "brighter",
    "orange",
    "variant",
    "version",
    "nhap",
    "thao",
    "tuong",
    "phong",
    "cach",
    "ti",
    "ty",
    "le",
    "1:1",
    "16:9",
    "9:16",
    "4:5",
    "show",
    "view",
    "present",
    "propose",
    "suggest",
    "preview",
    "display",
    "see",
    "write",
    "list",
    "send",
    "give",
    "xem",
    "cho",
    "viet",
    "dua",
    "gui",
    "de",
    "xuat",
    "goi",
    "y",
    "refine",
    "revise",
    "edit",
    "change",
    "adjust",
    "modify",
    "update",
    "switch",
    "chinh",
    "sua",
    "doi",
    "thay",
    "generate",
    "generating",
    "generated",
    "generation",
    "render",
    "rendering",
    "create",
    "creating",
    "produce",
    "producing",
    "run",
    "make",
    "build",
    "tao",
    "lam",
    "chay",
    "ok",
    "okay",
    "yes",
    "confirm",
    "approve",
    "approved",
    "proceed",
    "go",
    "chot",
    "duyet",
    "dong",
    "dung",
    "dont",
    "not",
    "no",
    "stop",
    "wait",
    "later",
    "hold",
    "pause",
    "only",
    "yet",
    "chi",
    "thoi",
    "chua",
    "khoan",
    "image",
    "asset",
    "banner",
    "poster",
    "video",
  ];

  if (hasAny(tokens, toolOrAnalyticsTerms) && !hasAny(tokens, creativeSessionTerms)) {
    return false;
  }

  return hasAny(tokens, creativeSessionTerms);
}

export function routeIntentForMessage(
  message: string,
  options: { creativeWorkingState?: CreativeWorkingStateIntentContext } = {},
): CmoRouteIntent {
  const lead = leadingIntentText(message);
  const creativeSessionContinuation = isCreativeSessionTransportContinuation(message, options.creativeWorkingState);

  if (isReviewAuditIntent(message)) return "cmo_review";
  if (creativeSessionContinuation) return "creative_session";
  if (isExplicitCreativeExecutionIntent(message)) return "creative_execution";
  if (isCreativeDraftSessionIntent(message)) return "creative_ideation";
  if (/^\/x\b|^\/surf\s+x\b/.test(lead)) return "surf_x";
  if (/^\/trend\b/.test(lead)) return "surf_trend";
  if (/^\/surf\b/.test(lead)) return "surf_research";
  if (isExplicitEchoExecutionIntent(message)) return "echo_execution";

  return "cmo_default";
}
