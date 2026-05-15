import { createHash } from "crypto";

import type {
  CMOAppChatResponse,
  CmoAssumptionItem,
  CmoDecisionConfidence,
  CmoDecisionItem,
  CmoDecisionLayer,
  CmoDecisionStatus,
  CmoMemoryCandidateItem,
  CmoMemoryCandidateType,
  CmoSuggestedActionItem,
  CmoTaskCandidateItem,
} from "@/lib/cmo/app-workspace-types";

const MAX_ITEMS = 8;

export interface BuildDecisionLayerInput {
  workspaceId: string;
  appId: string;
  sourceId: string;
  sessionId: string;
  createdAt: string;
  answer: string;
  runtimeAssumptions: string[];
  runtimeSuggestedActions: CMOAppChatResponse["suggestedActions"];
}

interface ExtractedLine {
  text: string;
  section: string;
  snippet: string;
}

function stableId(prefix: string, parts: string[]): string {
  return `${prefix}_${createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12)}`;
}

function compact(value: string, limit = 360): string {
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/^["']|["']$/g, "")
    .trim();

  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .trim();
}

function normalizeLine(value: string): string {
  return compact(
    stripInlineMarkdown(value)
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/^Action\s+\d+:\s*/i, "")
      .replace(/^Decision\s*:\s*/i, "")
      .replace(/^Assumption\s*:\s*/i, "")
      .replace(/^Task\s*:\s*/i, ""),
    300,
  );
}

function titleFromStatement(statement: string): string {
  const beforeColon = statement.split(":")[0]?.trim() ?? "";
  const title = beforeColon.length >= 8 && beforeColon.length <= 90 ? beforeColon : statement;

  return compact(title.replace(/[.!?]+$/g, ""), 96);
}

function sectionKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function extractLines(answer: string): ExtractedLine[] {
  const lines = answer.split(/\r?\n/);
  const extracted: ExtractedLine[] = [];
  let section = "general";

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    const heading = trimmed.match(/^#{1,4}\s+(.+)$/);

    if (heading?.[1]) {
      section = sectionKey(heading[1]);
      return;
    }

    const isListLike = /^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed) || /^Action\s+\d+:/i.test(trimmed);
    const sentenceLike = /^(Decision|Assumption|Task|Open question|Question|Next step):/i.test(trimmed);

    if (!isListLike && !sentenceLike) {
      return;
    }

    const text = normalizeLine(trimmed);

    if (text.length < 8) {
      return;
    }

    extracted.push({
      text,
      section,
      snippet: compact(trimmed, 260),
    });
  });

  return extracted;
}

function dedupeByText<T extends { sourceSnippet?: string }>(items: T[], getText: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = getText(item).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);

    if (result.length >= MAX_ITEMS) {
      break;
    }
  }

  return result;
}

function priorityHint(text: string): "low" | "medium" | "high" | undefined {
  if (/\b(p0|urgent|critical|highest|must|this week|now|priority)\b/i.test(text)) {
    return "high";
  }

  if (/\b(next|should|important|focus)\b/i.test(text)) {
    return "medium";
  }

  return undefined;
}

function confidenceFromLine(line: ExtractedLine, base: CmoDecisionConfidence = "medium"): CmoDecisionConfidence {
  if (/\bconfirmed|locked|must|current priority|p0|always\b/i.test(line.text)) {
    return "high";
  }

  if (/\bmaybe|could|might|assumption|hypothesis|draft|placeholder|if\b/i.test(line.text)) {
    return "low";
  }

  return base;
}

function decisionStatus(text: string): CmoDecisionStatus {
  if (/\bconfirmed|locked|approved|decided\b/i.test(text)) {
    return "confirmed";
  }

  if (/\brejected|do not|don't|avoid|not pursue\b/i.test(text)) {
    return "rejected";
  }

  if (/\bdefer|later|not yet|wait\b/i.test(text)) {
    return "deferred";
  }

  return "proposed";
}

function riskLevel(text: string): "low" | "medium" | "high" | undefined {
  if (/\bno live|missing|not connected|unavailable|thin|placeholder|risk|constraint\b/i.test(text)) {
    return "high";
  }

  if (/\bassume|if|draft|hypothesis\b/i.test(text)) {
    return "medium";
  }

  return undefined;
}

function memoryType(text: string, section: string): CmoMemoryCandidateType {
  if (section.includes("question") || /\?$|open question/i.test(text)) {
    return "open_question";
  }

  if (/\bconstraint|must not|do not|avoid|limited|no live|not connected\b/i.test(text)) {
    return "constraint";
  }

  if (/\bpriority|focus|p0|p1|this week\b/i.test(text)) {
    return "priority";
  }

  if (/\bactivation|retention|growth|funnel|conversion\b/i.test(text)) {
    return "growth_insight";
  }

  if (/\buser|audience|journey|onboarding|behavior\b/i.test(text)) {
    return "user_insight";
  }

  if (/\bchannel|campaign|content|creator|landing|message|narrative|positioning\b/i.test(text)) {
    return /\bnarrative|positioning|message\b/i.test(text) ? "narrative" : "channel";
  }

  if (/\bproduct|feature|surface|proof point|capability\b/i.test(text)) {
    return "product_truth";
  }

  return "other";
}

function looksActionable(text: string): boolean {
  return /\b(define|create|review|confirm|choose|turn|capture|build|draft|test|set|map|identify|prioritize|decide|ask|document)\b/i.test(text);
}

function extractDecisions(lines: ExtractedLine[], sessionId: string): CmoDecisionItem[] {
  const decisionLines = lines.filter((line) =>
    line.section.includes("decision") ||
    /\b(decide|decision|approve|approved|choose|commit|lock|do not|avoid|must not)\b/i.test(line.text),
  );

  return dedupeByText(
    decisionLines.map((line): CmoDecisionItem => ({
      id: stableId("decision", [sessionId, line.text]),
      title: titleFromStatement(line.text),
      statement: line.text,
      status: decisionStatus(line.text),
      rationale: line.section.includes("decision") ? "Extracted from a decision-oriented section." : undefined,
      confidence: confidenceFromLine(line),
      sourceSnippet: line.snippet,
      reviewStatus: "unreviewed",
    })),
    (item) => item.statement,
  );
}

function extractAssumptions(lines: ExtractedLine[], runtimeAssumptions: string[], sessionId: string): CmoAssumptionItem[] {
  const fromRuntime = runtimeAssumptions.map((assumption): ExtractedLine => ({
    text: compact(assumption, 300),
    section: "runtime assumptions",
    snippet: compact(assumption, 260),
  }));
  const assumptionLines = lines.filter((line) =>
    line.section.includes("assumption") ||
    /\b(assume|assumption|if|draft|placeholder|not connected|no live|unavailable|unknown|hypothesis)\b/i.test(line.text),
  );

  return dedupeByText(
    [...fromRuntime, ...assumptionLines].map((line): CmoAssumptionItem => ({
      id: stableId("assumption", [sessionId, line.text]),
      statement: line.text,
      riskLevel: riskLevel(line.text),
      confidence: confidenceFromLine(line, line.section === "runtime assumptions" ? "high" : "medium"),
      sourceSnippet: line.snippet,
      reviewStatus: "unreviewed",
    })),
    (item) => item.statement,
  );
}

function extractSuggestedActions(
  lines: ExtractedLine[],
  runtimeSuggestedActions: CMOAppChatResponse["suggestedActions"],
  sessionId: string,
): CmoSuggestedActionItem[] {
  const fromRuntime = runtimeSuggestedActions.map((action): ExtractedLine => ({
    text: compact(action.label, 300),
    section: action.type || "runtime suggested actions",
    snippet: compact(action.label, 260),
  }));
  const actionLines = lines.filter((line) =>
    line.section.includes("action") ||
    line.section.includes("next step") ||
    line.section.includes("recommend") ||
    looksActionable(line.text),
  );

  return dedupeByText(
    [...fromRuntime, ...actionLines].map((line): CmoSuggestedActionItem => ({
      id: stableId("action", [sessionId, line.text]),
      title: titleFromStatement(line.text),
      description: line.text.includes(":") ? compact(line.text.split(":").slice(1).join(":")) : undefined,
      timeframeHint: /\bthis week\b/i.test(line.text) ? "this week" : /\btoday|now\b/i.test(line.text) ? "now" : undefined,
      ownerHint: /\bcmo\b/i.test(line.text) ? "CMO" : undefined,
      priorityHint: priorityHint(line.text),
      expectedImpact: /\bactivation|retention|growth|conversion|proof\b/i.test(line.text)
        ? "Improve the app growth or proof-building motion without claiming unverified metrics."
        : undefined,
      confidence: confidenceFromLine(line),
      sourceSnippet: line.snippet,
      reviewStatus: "unreviewed",
    })),
    (item) => item.title,
  );
}

function extractMemoryCandidates(lines: ExtractedLine[], sessionId: string): CmoMemoryCandidateItem[] {
  const memoryLines = lines.filter((line) =>
    line.section.includes("context") ||
    line.section.includes("question") ||
    line.section.includes("assumption") ||
    /\b(priority|activation|retention|campaign|onboarding|user|journey|proof point|constraint|do not|must not|open question|product|narrative|channel)\b/i.test(line.text),
  );

  return dedupeByText(
    memoryLines.map((line): CmoMemoryCandidateItem => ({
      id: stableId("memory", [sessionId, line.text]),
      type: memoryType(line.text, line.section),
      statement: line.text,
      reason: "Deterministic candidate from CMO session answer. Review before App Memory promotion.",
      reviewStatus: "review_required",
      confidence: confidenceFromLine(line),
      sourceSnippet: line.snippet,
    })),
    (item) => `${item.type}:${item.statement}`,
  );
}

function extractTaskCandidates(lines: ExtractedLine[], sessionId: string): CmoTaskCandidateItem[] {
  const taskLines = lines.filter((line) =>
    line.section.includes("task") ||
    line.section.includes("action") ||
    line.section.includes("next step") ||
    (looksActionable(line.text) && !/\bdo not|avoid|must not\b/i.test(line.text)),
  );

  return dedupeByText(
    taskLines.map((line): CmoTaskCandidateItem => ({
      id: stableId("task", [sessionId, line.text]),
      title: titleFromStatement(line.text),
      description: line.text,
      ownerHint: /\bcmo\b/i.test(line.text) ? "CMO" : undefined,
      dueDateHint: /\bthis week\b/i.test(line.text) ? "this week" : undefined,
      priorityHint: priorityHint(line.text),
      source: "cmo_session",
      pushStatus: "not_pushed",
      confidence: confidenceFromLine(line),
      sourceSnippet: line.snippet,
      reviewStatus: "unreviewed",
    })),
    (item) => item.title,
  );
}

export function buildDecisionLayer(input: BuildDecisionLayerInput): CmoDecisionLayer {
  const answer = input.answer.trim();
  const lines = extractLines(answer);
  const decisions = extractDecisions(lines, input.sessionId);
  const assumptions = extractAssumptions(lines, input.runtimeAssumptions, input.sessionId);
  const suggestedActions = extractSuggestedActions(lines, input.runtimeSuggestedActions, input.sessionId);
  const memoryCandidates = extractMemoryCandidates(lines, input.sessionId);
  const taskCandidates = extractTaskCandidates(lines, input.sessionId);
  const totalItems = decisions.length + assumptions.length + suggestedActions.length + memoryCandidates.length + taskCandidates.length;

  return {
    schemaVersion: "cmo.decision-layer.v1",
    workspaceId: input.workspaceId,
    appId: input.appId,
    sourceId: input.sourceId,
    sessionId: input.sessionId,
    createdAt: input.createdAt,
    extractionMode: "deterministic",
    extractionStatus: !answer || totalItems === 0 ? "empty" : totalItems < 2 ? "partial" : "completed",
    decisions,
    assumptions,
    suggestedActions,
    memoryCandidates,
    taskCandidates,
  };
}
