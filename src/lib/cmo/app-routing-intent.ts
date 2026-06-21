export type CmoRouteIntent = "cmo_review" | "echo_execution" | "creative_execution" | "creative_ideation" | "creative_session" | "surf_x" | "surf_trend" | "surf_research" | "cmo_default";

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function leadingIntentText(message: string): string {
  const trimmed = message.trim();
  const firstLine = trimmed.split(/\n{2,}|\n(?=#{1,6}\s)|\n(?=[-*]\s)/)[0] ?? trimmed;
  return normalize(firstLine.slice(0, 320));
}

export function isReviewAuditIntent(message: string): boolean {
  const lead = leadingIntentText(message);
  return /^(review|audit|check|feedback|analyze|analyse|evaluate|đanh gia|gop y|xem giup|cho toi feedback|review plan|check plan|nen sua gi|co van đe gi|co van de gi)\b/.test(lead)
    || /\b(review|audit|feedback|đanh gia|gop y)\b.{0,80}\b(plan|program|campaign|ambassador|proposal)\b/.test(lead)
    || /\b(plan|program|campaign|ambassador|proposal)\b.{0,80}\b(co van de gi|nen sua gi|gop y|feedback)\b/.test(lead);
}

export function isExplicitEchoExecutionIntent(message: string): boolean {
  const lead = leadingIntentText(message);
  if (/^(?:\/|@)echo\b/.test(lead)) return true;
  if (isReviewAuditIntent(message)) return false;
  return /^(draft|write|compose|generate|create|rewrite|turn this into|bien cai nay thanh|viet|soan)\b/.test(lead)
    && /\b(x posts?|tweets?|thread|caption|copy|facebook post|telegram announcement|announcement|content)\b/.test(lead);
}

export function isExplicitCreativeExecutionIntent(message: string): boolean {
  const lead = leadingIntentText(message);
  if (/^(?:\/|@)creative\b/.test(lead)) return true;
  if (isReviewAuditIntent(message)) return false;

  return /^(generate|render|produce)\b/.test(lead)
    && /\b(image|visual|graphic|creative|banner|ad creative|thumbnail|illustration|logo|icon|png|webp|jpeg|jpg|video|motion|asset)\b/.test(lead);
}

export function isCreativeDraftSessionIntent(message: string): boolean {
  const lead = leadingIntentText(message);
  if (/^(?:\/|@)creative\b/.test(lead)) return true;
  if (isReviewAuditIntent(message)) return false;

  const creativeAction =
    /\b(generate|create|make|design|draw|render|produce|brainstorm|concept|ideate|tao|ve|thiet ke|lam|muon tao|can tao|muon lam)\b/.test(lead) ||
    /\b(key visual|prompt|poster|sticker)\b/.test(lead);
  const creativeObject =
    /\b(image|visual|graphic|creative|banner|thumbnail|illustration|logo|icon|video|motion|asset|poster|sticker|key visual|campaign|prompt|concept|hinh|anh|hinh anh)\b/.test(lead);

  return creativeAction && creativeObject;
}

export function isCreativeSessionFollowupIntent(message: string): boolean {
  const lead = leadingIntentText(message);
  if (/^(?:\/|@)creative\b/.test(lead)) return true;
  if (isReviewAuditIntent(message)) return false;

  const draftOrPromptReference =
    /\b(draft|prompt|negative prompt|brief|concept|visual|style|format|ratio|aspect|version|variant|key visual)\b/.test(lead) ||
    /\b(hinh|anh|hinh anh|mau|ban nhap|ban thao|y tuong|phong cach|ti le|ty le)\b/.test(lead) ||
    /\b(1:1|16:9|9:16|4:5|square|portrait|landscape)\b/.test(lead);
  const presentOrRequest =
    /\b(show|view|present|send|give|write|list|preview|xem|cho|minh xem|viet|dua|gui|draft truoc|prompt truoc)\b/.test(lead);
  const refineOrChange =
    /\b(refine|revise|edit|change|adjust|modify|update|make it|switch|chinh|sua|doi|thay|lam version|lam ban|version)\b/.test(lead);
  const holdExecution =
    /\b(prompt only|dont generate|do not generate|dont create|do not create|not yet|wait|chi viet prompt|chi prompt|dung tao|dung generate|dung voi|chua tao|tao voi)\b/.test(lead);
  const executeFromDraft =
    /\b(ok|okay|yes|confirm|approve|generate|render|create|produce|tao|lam|chay)\b/.test(lead) &&
    /\b(prompt|draft|do|di|now|image|visual|hinh|anh|hinh anh|tu prompt|from prompt)\b/.test(lead);

  return draftOrPromptReference && (presentOrRequest || refineOrChange || holdExecution) || holdExecution || executeFromDraft;
}

export function routeIntentForMessage(message: string): CmoRouteIntent {
  const lead = leadingIntentText(message);
  if (isReviewAuditIntent(message)) return "cmo_review";
  if (isExplicitCreativeExecutionIntent(message)) return "creative_execution";
  if (isCreativeDraftSessionIntent(message)) return "creative_ideation";
  if (isCreativeSessionFollowupIntent(message)) return "creative_session";
  if (/^\/x\b|^\/surf\s+x\b/.test(lead)) return "surf_x";
  if (/^\/trend\b/.test(lead)) return "surf_trend";
  if (/^\/surf\b/.test(lead)) return "surf_research";
  if (isExplicitEchoExecutionIntent(message)) return "echo_execution";
  return "cmo_default";
}
