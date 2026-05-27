export type CmoRouteIntent = "cmo_review" | "echo_execution" | "surf_x" | "surf_trend" | "surf_research" | "cmo_default";

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

export function routeIntentForMessage(message: string): CmoRouteIntent {
  const lead = leadingIntentText(message);
  if (isReviewAuditIntent(message)) return "cmo_review";
  if (/^\/x\b|^\/surf\s+x\b/.test(lead)) return "surf_x";
  if (/^\/trend\b/.test(lead)) return "surf_trend";
  if (/^\/surf\b/.test(lead)) return "surf_research";
  if (isExplicitEchoExecutionIntent(message)) return "echo_execution";
  return "cmo_default";
}
