import { buildCapturePreview } from "./vault-capture-renderer";
import type { CMOVaultCaptureEvent, CMOVaultCaptureEventType, CMOVaultCaptureResult, CMOVaultSourceClass } from "./vault-capture-types";

export interface CMOVaultCapturePreviewInput {
  appId?: string;
  sessionId?: string;
  messageId?: string;
  eventType: CMOVaultCaptureEventType;
  content?: string;
  createdAt?: string;
  topic?: string;
  platform?: string;
  workspaceId?: string;
  workspaceGroup?: string;
  project?: string;
  authMode?: "supabase" | "legacy";
  userId?: string;
  userEmail?: string;
  organizationId?: string;
  createdByUserId?: string;
  createdByEmail?: string;
  sourceUserId?: string;
  sourceUserEmail?: string;
  sourceUserMessageId?: string;
  sourceUrls?: string[];
  related?: string[];
}

const workspaceMap: Record<string, { workspaceId: string; workspaceGroup: string; project: string }> = {
  "holdstation-mini-app": { workspaceId: "world-app-holdstation-mini-app", workspaceGroup: "world_app", project: "Holdstation Mini App" },
  "world-app-holdstation-mini-app": { workspaceId: "world-app-holdstation-mini-app", workspaceGroup: "world_app", project: "Holdstation Mini App" },
  "holdstation-wallet": { workspaceId: "holdstation-wallet", workspaceGroup: "holdstation", project: "Holdstation Wallet" },
  "hold-pay": { workspaceId: "hold-pay", workspaceGroup: "holdstation", project: "Hold Pay" },
  tickx: { workspaceId: "tickx", workspaceGroup: "holdstation", project: "TickX" },
  "world-app-aion": { workspaceId: "world-app-aion", workspaceGroup: "world_app", project: "AION" },
  "world-app-winance": { workspaceId: "world-app-winance", workspaceGroup: "world_app", project: "Winance" },
  "world-app-feeback": { workspaceId: "world-app-feeback", workspaceGroup: "world_app", project: "Feeback" },
};

function normalizeWorkspace(input: CMOVaultCapturePreviewInput) {
  const key = input.workspaceId || input.appId || input.project || "";
  const mapped = workspaceMap[key] || workspaceMap[key.toLowerCase()] || { workspaceId: input.workspaceId || input.appId, workspaceGroup: input.workspaceGroup, project: input.project };
  return {
    workspaceId: input.workspaceId && workspaceMap[input.workspaceId] ? workspaceMap[input.workspaceId].workspaceId : mapped.workspaceId,
    workspaceGroup: input.workspaceGroup || mapped.workspaceGroup,
    project: input.project || mapped.project,
  };
}

function compactText(value = "", max = 420): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function echoVariantCount(content = ""): number {
  const postBlocks = content.match(/(^|\n)\s*#{1,4}\s*(post|draft|variant|option)\s*\d+\b/gi)?.length ?? 0;
  if (postBlocks) return postBlocks;
  const labelled = content.match(/(^|\n)\s*(post|draft|variant|option)\s*\d+[.:)]/gi)?.length ?? 0;
  return labelled;
}

function inferEchoPlatform(input: CMOVaultCapturePreviewInput): string {
  if (input.platform && !/^platform$/i.test(input.platform)) return input.platform;
  const haystack = `${input.content ?? ""} ${input.topic ?? ""} ${input.project ?? ""}`;
  return /(^|\W)(x|twitter|tweet|tweets|post|posts|x post|x posts)(\W|$)/i.test(haystack) ? "x" : "content";
}

function cleanEchoOutput(content = ""): string {
  return content.replace(/^\s*#{1,2}\s+Agent Execution\s*\n(?:.*\n){0,8}?(?=\s*#{1,4}\s*(?:Post|Draft|Variant|Option)\s*\d+|$)/im, "").trim();
}

function deriveTopic(input: CMOVaultCapturePreviewInput, project?: string): string {
  return input.topic || project || input.content?.split(/\s+/).slice(0, 8).join(" ") || input.eventType;
}

function titleFor(eventType: CMOVaultCaptureEventType, topic: string, createdAt: string): string {
  const day = createdAt.slice(0, 10);
  switch (eventType) {
    case "echo_output": return `Echo Output — ${topic} — ${day}`;
    case "surf_x_signal": return `${topic} — X Signal — ${day}`;
    case "last30days_trend": return `${topic} — Trend Signal — ${day}`;
    case "pulse_pack": return `${topic} — Pulse — ${day}`;
    case "cmo_decision": return `Decision — ${topic} — ${day}`;
    default: return `${topic} — ${day}`;
  }
}

function summaryFor(input: CMOVaultCapturePreviewInput, eventType: CMOVaultCaptureEventType, topic: string): string {
  if (eventType === "echo_output") {
    const count = echoVariantCount(input.content);
    const platform = inferEchoPlatform(input).toUpperCase() === "X" ? "X" : inferEchoPlatform(input);
    const countText = count ? `${count} short ${platform} post variant${count === 1 ? "" : "s"}` : `${platform} content output`;
    return `Echo generated ${countText} for ${topic} activation.`;
  }
  return compactText(input.content, 260) || `Capture preview generated for ${topic}.`;
}

function payloadSummaryFor(input: CMOVaultCapturePreviewInput, eventType: CMOVaultCaptureEventType, topic: string): string {
  if (eventType === "echo_output") {
    const count = echoVariantCount(input.content);
    const platform = inferEchoPlatform(input).toUpperCase() === "X" ? "X" : inferEchoPlatform(input);
    return `Echo output with ${count || "multiple"} ${platform} post variant${count === 1 ? "" : "s"} for ${topic} activation. No unsupported metric claims added.`;
  }
  return compactText(input.content, 220);
}

function sourceClassFor(eventType: CMOVaultCaptureEventType): CMOVaultSourceClass {
  switch (eventType) {
    case "echo_output":
      return "execution_artifact";
    case "surf_x_signal":
      return "social_signal";
    case "last30days_trend":
      return "weak_trend_signal";
    case "pulse_pack":
      return "composite";
    case "cmo_decision":
      return "cmo_interpretation";
    case "ops_event":
      return "operational_event";
    case "surf_research":
      return "source_backed_public";
    case "memory_candidate":
      return "cmo_interpretation";
    case "cmo_session":
    default:
      return "operational_event";
  }
}

export function buildCapturePreviewEvent(input: CMOVaultCapturePreviewInput): CMOVaultCaptureEvent {
  const eventType = input.eventType;
  const createdAt = input.createdAt || new Date().toISOString();
  const workspace = normalizeWorkspace(input);
  const topic = deriveTopic(input, workspace.project);
  const isSurfX = eventType === "surf_x_signal";
  const isTrend = eventType === "last30days_trend";
  const isPulse = eventType === "pulse_pack";
  const isEcho = eventType === "echo_output";
  const isSurf = eventType === "surf_research" || isSurfX || isTrend || isPulse;
  const isDecision = eventType === "cmo_decision" || eventType === "memory_candidate";

  return {
    type: eventType,
    captureMode: "dry_run",
    title: titleFor(eventType, topic, createdAt),
    appId: input.appId,
    sessionId: input.sessionId,
    requestId: input.messageId,
    createdAt,
    authMode: input.authMode,
    userId: input.userId,
    userEmail: input.userEmail,
    organizationId: input.organizationId,
    createdByUserId: input.createdByUserId,
    createdByEmail: input.createdByEmail,
    sourceUserId: input.sourceUserId,
    sourceUserEmail: input.sourceUserEmail,
    sourceUserMessageId: input.sourceUserMessageId,
    workspaceId: workspace.workspaceId,
    workspaceGroup: workspace.workspaceGroup,
    project: workspace.project,
    topic,
    platform: isEcho ? inferEchoPlatform(input) : input.platform,
    sourceAgent: isEcho ? "Echo" : isSurf ? "Surf" : "CMO",
    mode: isSurfX ? "x_search" : isTrend ? "last30days" : isPulse ? "pulse" : isEcho ? "content_execution" : isDecision ? "decision" : eventType === "cmo_session" ? "session_capture" : "web_research",
    skill: isEcho ? "echo" : isSurfX ? "surf_x" : isTrend ? "trend" : isPulse ? "pulse" : eventType === "surf_research" ? "web_research" : "",
    sourceClass: sourceClassFor(eventType),
    reviewStatus: isDecision ? "review_candidate" : "raw",
    visibility: "private",
    summary: summaryFor(input, eventType, topic),
    payloadSummary: payloadSummaryFor(input, eventType, topic),
    keyFindings: input.content ? [isEcho ? cleanEchoOutput(input.content) : input.content] : undefined,
    sourceUrls: input.sourceUrls,
    related: input.related,
    tags: ["capture-preview"],
  };
}

export function buildManualCapturePreview(input: CMOVaultCapturePreviewInput): CMOVaultCaptureResult {
  return buildCapturePreview(buildCapturePreviewEvent(input));
}
