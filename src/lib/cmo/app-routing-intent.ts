export type CmoRouteIntent = "cmo_review" | "echo_execution" | "creative_execution" | "creative_ideation" | "creative_session" | "surf_x" | "surf_trend" | "surf_research" | "cmo_default";

export type CreativeSessionFollowupIntent =
  | "present_draft"
  | "refine_draft"
  | "execute_draft"
  | "ask_clarification"
  | "cancel_or_hold"
  | "none";

export interface CreativeWorkingStateIntentContext {
  active_draft_id?: string | null;
  drafts?: unknown[];
}

export interface CreativeSessionIntentClassification {
  intent: CreativeSessionFollowupIntent;
  detected: boolean;
  activeDraftId?: string;
  draftsCount: number;
  hasActiveDraft: boolean;
  requiresCmoDecision: boolean;
}

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

function countAny(tokens: Set<string>, vocabulary: readonly string[]): number {
  return vocabulary.reduce((count, term) => count + (tokens.has(term) ? 1 : 0), 0);
}

function creativeStateSummary(state: CreativeWorkingStateIntentContext | undefined): {
  activeDraftId?: string;
  draftsCount: number;
  hasActiveDraft: boolean;
  hasAnyDraft: boolean;
} {
  const activeDraftId = typeof state?.active_draft_id === "string" && state.active_draft_id.trim()
    ? state.active_draft_id.trim()
    : undefined;
  const draftsCount = Array.isArray(state?.drafts) ? state.drafts.length : 0;

  return {
    activeDraftId,
    draftsCount,
    hasActiveDraft: Boolean(activeDraftId),
    hasAnyDraft: Boolean(activeDraftId || draftsCount > 0),
  };
}

export function leadingIntentText(message: string): string {
  const trimmed = message.trim();
  const firstLine = trimmed.split(/\n{2,}|\n(?=#{1,6}\s)|\n(?=[-*]\s)/)[0] ?? trimmed;
  return normalize(firstLine.slice(0, 320));
}

export function isReviewAuditIntent(message: string): boolean {
  const tokens = tokensFor(leadingIntentText(message));
  const reviewTerms = ["review", "audit", "check", "feedback", "analyze", "analyse", "evaluate", "danh", "gia", "gop", "y"];
  const planningTerms = ["plan", "program", "campaign", "ambassador", "proposal"];

  return hasAny(tokens, reviewTerms) && (hasAny(tokens, planningTerms) || hasAny(tokens, ["feedback", "audit", "review"]));
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

export function classifyCreativeSessionFollowup(
  message: string,
  creativeWorkingState?: CreativeWorkingStateIntentContext,
): CreativeSessionIntentClassification {
  const state = creativeStateSummary(creativeWorkingState);
  const none = (intent: CreativeSessionFollowupIntent = "none"): CreativeSessionIntentClassification => ({
    intent,
    detected: intent !== "none",
    activeDraftId: state.activeDraftId,
    draftsCount: state.draftsCount,
    hasActiveDraft: state.hasActiveDraft,
    requiresCmoDecision: intent !== "none",
  });

  if (!state.hasAnyDraft || isReviewAuditIntent(message)) {
    return none();
  }

  const lead = leadingIntentText(message);
  const tokens = tokensFor(lead);

  if (/^(?:\/|@)creative\b/.test(lead)) {
    return state.hasActiveDraft ? none("present_draft") : none("ask_clarification");
  }

  const draftReferenceScore = countAny(tokens, [
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
  ]);
  const presentScore = countAny(tokens, [
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
  ]);
  const refineScore = countAny(tokens, [
    "refine",
    "revise",
    "edit",
    "change",
    "adjust",
    "modify",
    "update",
    "switch",
    "version",
    "variant",
    "chinh",
    "sua",
    "doi",
    "thay",
  ]);
  const generationScore = countAny(tokens, [
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
  ]);
  const confirmationScore = countAny(tokens, [
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
    "y",
    "dung",
  ]);
  const holdScore = countAny(tokens, [
    "dont",
    "do",
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
    "dung",
    "chua",
    "khoan",
  ]);
  const assetTargetScore = countAny(tokens, [
    "image",
    "asset",
    "visual",
    "creative",
    "banner",
    "poster",
    "video",
    "hinh",
    "anh",
  ]);
  const immediateScore = countAny(tokens, ["now", "go", "proceed", "luon", "di"]);
  const promptOnlyIntent = hasAny(tokens, ["only", "chi"]) && hasAny(tokens, ["prompt"]);
  const negativeGenerationIntent = (hasAny(tokens, ["dont", "not", "no", "stop", "dung", "chua", "khoan"]) && (generationScore > 0 || assetTargetScore > 0)) ||
    promptOnlyIntent ||
    (holdScore >= 2 && generationScore > 0);

  if (negativeGenerationIntent) {
    return none("cancel_or_hold");
  }

  const creativeTargeted = draftReferenceScore > 0 || assetTargetScore > 0 || generationScore > 0;

  if (!creativeTargeted) {
    return none();
  }

  if (!state.hasActiveDraft && state.draftsCount > 1) {
    return none("ask_clarification");
  }

  if (refineScore > 0 && (draftReferenceScore > 0 || assetTargetScore > 0)) {
    return state.hasActiveDraft ? none("refine_draft") : none("ask_clarification");
  }

  const executeScore = generationScore + confirmationScore + immediateScore;
  const userIsConfirmingGeneration = state.hasActiveDraft &&
    generationScore > 0 &&
    (confirmationScore > 0 || immediateScore > 0 || assetTargetScore > 0);

  if (userIsConfirmingGeneration && executeScore >= 1) {
    return none("execute_draft");
  }

  if (presentScore > 0 && draftReferenceScore > 0) {
    return state.hasActiveDraft ? none("present_draft") : none("ask_clarification");
  }

  if (draftReferenceScore > 0 && generationScore === 0) {
    return state.hasActiveDraft ? none("present_draft") : none("ask_clarification");
  }

  return none();
}

export function isCreativeSessionFollowupIntent(
  message: string,
  creativeWorkingState?: CreativeWorkingStateIntentContext,
): boolean {
  return classifyCreativeSessionFollowup(message, creativeWorkingState).detected;
}

export function classifyCreativeSessionFollowupIntent(
  message: string,
  creativeWorkingState?: CreativeWorkingStateIntentContext,
): CreativeSessionFollowupIntent {
  return classifyCreativeSessionFollowup(message, creativeWorkingState).intent;
}

export function routeIntentForMessage(
  message: string,
  options: { creativeWorkingState?: CreativeWorkingStateIntentContext } = {},
): CmoRouteIntent {
  const lead = leadingIntentText(message);
  const creativeSessionClassification = classifyCreativeSessionFollowup(message, options.creativeWorkingState);

  if (isReviewAuditIntent(message)) return "cmo_review";
  if (isExplicitCreativeExecutionIntent(message)) return "creative_execution";
  if (creativeSessionClassification.detected) return "creative_session";
  if (isCreativeDraftSessionIntent(message)) return "creative_ideation";
  if (/^\/x\b|^\/surf\s+x\b/.test(lead)) return "surf_x";
  if (/^\/trend\b/.test(lead)) return "surf_trend";
  if (/^\/surf\b/.test(lead)) return "surf_research";
  if (isExplicitEchoExecutionIntent(message)) return "echo_execution";

  return "cmo_default";
}
