import { readFile } from "node:fs/promises";

import { buildCapturePreviewEvent } from "./vault-capture-preview";
import { extractCaptureTestMarker } from "./vault-capture-paths";
import { cmoEngineVaultRoot, saveCaptureToCmoEngineVault } from "./vault-capture-writer";
import type { CMOAppChatRequest, CMOChatSession } from "./app-workspace-types";
import type { CMOVaultCaptureEvent, CMOVaultCaptureEventType, CMOVaultSourceClass } from "./vault-capture-types";

interface AutoCaptureContext {
  request: CMOAppChatRequest;
  session: CMOChatSession;
  assistantMessageId: string;
  sourceUserMessageId?: string;
  answer: string;
  /** Test/instrumentation-only proposed type for derived secondary attempts; UI eventType must never be passed here. */
  proposedCaptureType?: CMOVaultCaptureEventType;
  /** Stable server-side auto-capture inputs only. Do not pass UI preview/save eventType here. */
  routeKind?: string;
  runtimeSource?: string;
  assistantFooterSourceLabel?: string;
  runtimeLabel?: string;
  runtimeProvider?: string;
  runtimeAgent?: string;
}

export interface AutoCaptureResult {
  ok: boolean;
  savedToVault: boolean;
  relativePath?: string;
  writtenPath?: string;
  captureType?: CMOVaultCaptureEventType;
  sourceClass?: CMOVaultSourceClass;
  reviewStatus?: "raw" | "review_candidate";
  warnings: string[];
  error?: string;
  duplicate?: boolean;
  skipped?: boolean;
  skipReason?: string;
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function normalizedCommand(message = ""): string {
  return message.trim().toLowerCase();
}

function metadataText(ctx: AutoCaptureContext): string {
  return [
    ctx.routeKind,
    ctx.runtimeSource,
    ctx.assistantFooterSourceLabel,
    ctx.runtimeLabel,
    ctx.runtimeProvider,
    ctx.runtimeAgent,
  ].filter(Boolean).join("\n").toLowerCase();
}

function commandPrefixClassification(command: string): Pick<CMOVaultCaptureEvent, "type" | "sourceAgent" | "mode" | "skill" | "sourceClass" | "reviewStatus" | "warnings"> | null {
  if (/^(\/|@)echo\b/.test(command)) return classifyEcho();
  if (/^\/x\b|^\/surf\s+x\b|^@surf\s+x\b/.test(command)) return classifySurfX();
  if (/^\/trend\b|^@trend\b/.test(command)) return classifyTrend();
  if (/^\/pulse\b|^@pulse\b/.test(command)) return classifyPulse();
  if (/^\/surf\b|^@surf\b/.test(command)) return classifySurfResearch();
  return null;
}

function classifyEcho(): Pick<CMOVaultCaptureEvent, "type" | "sourceAgent" | "mode" | "skill" | "sourceClass" | "reviewStatus" | "warnings"> {
  return { type: "echo_output", sourceAgent: "Echo", mode: "content_execution", skill: "echo", sourceClass: "execution_artifact", reviewStatus: "raw", warnings: [] };
}

function classifySurfX(): Pick<CMOVaultCaptureEvent, "type" | "sourceAgent" | "mode" | "skill" | "sourceClass" | "reviewStatus" | "warnings"> {
  return { type: "surf_x_signal", sourceAgent: "Surf", mode: "x_search", skill: "surf_x", sourceClass: "social_signal", reviewStatus: "raw", warnings: ["Auto-captured social signal. Verify before using as fact."] };
}

function classifyTrend(): Pick<CMOVaultCaptureEvent, "type" | "sourceAgent" | "mode" | "skill" | "sourceClass" | "reviewStatus" | "warnings"> {
  return { type: "last30days_trend", sourceAgent: "Surf", mode: "last30days", skill: "trend", sourceClass: "weak_trend_signal", reviewStatus: "raw", warnings: ["Auto-captured weak trend signal. Verify before using as fact."] };
}

function classifyPulse(): Pick<CMOVaultCaptureEvent, "type" | "sourceAgent" | "mode" | "skill" | "sourceClass" | "reviewStatus" | "warnings"> {
  return { type: "pulse_pack", sourceAgent: "Surf", mode: "pulse", skill: "pulse", sourceClass: "composite", reviewStatus: "raw", warnings: ["Auto-captured composite pulse pack. Preserve branch warnings during review."] };
}

function classifySurfResearch(): Pick<CMOVaultCaptureEvent, "type" | "sourceAgent" | "mode" | "skill" | "sourceClass" | "reviewStatus" | "warnings"> {
  return { type: "surf_research", sourceAgent: "Surf", mode: "research", skill: "surf", sourceClass: "source_backed_public", reviewStatus: "raw", warnings: [] };
}

function classifyByType(type: CMOVaultCaptureEventType): Pick<CMOVaultCaptureEvent, "type" | "sourceAgent" | "mode" | "skill" | "sourceClass" | "reviewStatus" | "warnings"> | null {
  if (type === "echo_output") return classifyEcho();
  if (type === "surf_x_signal") return classifySurfX();
  if (type === "last30days_trend") return classifyTrend();
  if (type === "pulse_pack") return classifyPulse();
  if (type === "surf_research") return classifySurfResearch();
  if (type === "cmo_decision") return { type: "cmo_decision", sourceAgent: "CMO", mode: "strategy", skill: "cmo", sourceClass: "cmo_interpretation", reviewStatus: "review_candidate", warnings: ["Auto-captured decision candidate for review only. Nothing promoted."] };
  if (type === "cmo_session") return { type: "cmo_session", sourceAgent: "CMO", mode: "session", skill: "cmo", sourceClass: "cmo_interpretation", reviewStatus: "raw", warnings: ["Auto-classifier confidence low; saved as raw CMO session, not decision."] };
  return null;
}

export function allowedAutoCaptureTypesForUserMessage(message = ""): CMOVaultCaptureEventType[] | null {
  const command = normalizedCommand(message);
  if (/^(\/|@)echo\b/.test(command)) return ["echo_output"];
  if (/^\/x\b|^\/surf\s+x\b|^@surf\s+x\b/.test(command)) return ["surf_x_signal"];
  if (/^\/trend\b|^@trend\b/.test(command)) return ["last30days_trend"];
  if (/^\/pulse\b|^@pulse\b/.test(command)) return ["pulse_pack"];
  if (/^\/surf\b|^@surf\b/.test(command)) return ["surf_research"];
  return null;
}

export function classifyAutoCapture(ctx: AutoCaptureContext): Pick<CMOVaultCaptureEvent, "type" | "sourceAgent" | "mode" | "skill" | "sourceClass" | "reviewStatus" | "warnings"> {
  const meta = metadataText(ctx);
  const command = normalizedCommand(ctx.request.message);
  const answer = (ctx.answer ?? "").toLowerCase();

  // 1) Hard command-prefix lock. Prefixes are explicit user routing intent and
  // must beat stale runtime labels, UI preview/save state, and content words.
  const commandLock = commandPrefixClassification(command);
  if (commandLock) return commandLock;

  const proposed = ctx.proposedCaptureType ? classifyByType(ctx.proposedCaptureType) : null;
  if (proposed) return proposed;

  // 2) Runtime/source metadata wins for non-prefixed bridge requests. This
  // keeps "Draft 2 X posts" handled by Echo as Echo, while plain "X" research
  // can still become Surf X when the server runtime says so.
  if (/\blive\s*-\s*echo\b|\becho\b/.test(meta)) return classifyEcho();
  if (/\blive\s*-\s*surf-x\b|\bsurf-x\b|\bsurf_x\b/.test(meta)) return classifySurfX();
  if (/\blive\s*-\s*surf-last30days\b|\bsurf-last30days\b|\blast30days\b/.test(meta)) return classifyTrend();
  if (/\blive\s*-\s*pulse\b|\bpulse\b/.test(meta)) return classifyPulse();
  if (/\blive\s*-\s*surf\b|\bsurf\b/.test(meta)) return classifySurfResearch();

  // 3) Assistant content markers are last and intentionally strict. "X post"
  // alone means platform/copy format and must not trigger Surf X.
  if (includesAny(answer, ["echo output", "echo execution"]) || /(^|\n)\s*(draft|variant|option|post)\s*\d+[.:)]/i.test(ctx.answer)) return classifyEcho();
  if (includesAny(answer, ["x search was used", "surf x used", "surf x signal", "x signal says"])) return classifySurfX();
  if (includesAny(answer, ["last30days sandbox", "last30days trend signal", "trend signal"])) return classifyTrend();
  if (includesAny(answer, ["pulse used", "pulse pack"])) return classifyPulse();
  if (includesAny(answer, ["research pack", "surf research", "official source", "source-backed", "source backed"])) return classifySurfResearch();

  if (/\b(decision|decide|recommendation|recommend)\b/i.test(ctx.answer) && /\b(confident|should|recommend)\b/i.test(ctx.answer)) {
    return { type: "cmo_decision", sourceAgent: "CMO", mode: "strategy", skill: "cmo", sourceClass: "cmo_interpretation", reviewStatus: "review_candidate", warnings: ["Auto-captured decision candidate for review only. Nothing promoted."] };
  }
  return { type: "cmo_session", sourceAgent: "CMO", mode: "session", skill: "cmo", sourceClass: "cmo_interpretation", reviewStatus: "raw", warnings: ["Auto-classifier confidence low; saved as raw CMO session, not decision."] };
}

function safeIndexKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 180);
}

function turnIndexKey(ctx: AutoCaptureContext): string | null {
  const userMessageId = ctx.sourceUserMessageId?.trim();
  if (!ctx.session.id || !userMessageId) return null;
  return `turn_${safeIndexKey(ctx.session.id)}_${safeIndexKey(userMessageId)}`;
}

async function existingAutoCaptureForMessage(messageId: string): Promise<AutoCaptureResult | null> {
  const indexPath = `${cmoEngineVaultRoot()}/.cmo-auto-capture-index/${safeIndexKey(messageId)}.json`;
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as AutoCaptureResult;
    return { ...parsed, duplicate: true };
  } catch {
    return null;
  }
}

async function existingAutoCaptureForTurn(ctx: AutoCaptureContext): Promise<AutoCaptureResult | null> {
  const key = turnIndexKey(ctx);
  if (!key) return null;
  const indexPath = `${cmoEngineVaultRoot()}/.cmo-auto-capture-index/${key}.json`;
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as AutoCaptureResult;
    return { ...parsed, duplicate: true };
  } catch {
    return null;
  }
}

function logAutoCaptureDecision(ctx: AutoCaptureContext, classification: Pick<CMOVaultCaptureEvent, "type">, result: Partial<AutoCaptureResult> & { relativePath?: string }, callsite = "vault-auto-capture") {
  console.info("[cmo-auto-capture]", JSON.stringify({
    callsite,
    sessionId: ctx.session.id,
    messageId: ctx.assistantMessageId,
    sourceUserMessageId: ctx.sourceUserMessageId,
    userMessagePrefix: normalizedCommand(ctx.request.message).slice(0, 80),
    assistantFooterSourceLabel: ctx.assistantFooterSourceLabel ?? ctx.runtimeLabel,
    routeKind: ctx.routeKind,
    chosenEventType: classification.type,
    targetRelativePath: result.relativePath,
    skipped: result.skipped === true,
    skipReason: result.skipReason,
  }));
}

export async function autoCaptureTurnOnce(ctx: AutoCaptureContext): Promise<AutoCaptureResult> {
  const duplicate = await existingAutoCaptureForMessage(ctx.assistantMessageId);
  if (duplicate) return duplicate;

  const classification = classifyAutoCapture(ctx);
  const allowedTypes = allowedAutoCaptureTypesForUserMessage(ctx.request.message);
  if (allowedTypes && !allowedTypes.includes(classification.type)) {
    const skipped: AutoCaptureResult = { ok: true, savedToVault: false, captureType: classification.type, sourceClass: classification.sourceClass, reviewStatus: classification.reviewStatus === "raw" || classification.reviewStatus === "review_candidate" ? classification.reviewStatus : undefined, warnings: ["auto_capture_skipped_secondary_for_turn"], skipped: true, skipReason: "auto_capture_skipped_secondary_for_turn" };
    logAutoCaptureDecision(ctx, classification, skipped);
    return skipped;
  }

  const turnDuplicate = await existingAutoCaptureForTurn(ctx);
  if (turnDuplicate) {
    if (allowedTypes && !allowedTypes.includes(turnDuplicate.captureType as CMOVaultCaptureEventType)) {
      const skipped: AutoCaptureResult = { ok: true, savedToVault: false, captureType: classification.type, sourceClass: classification.sourceClass, reviewStatus: classification.reviewStatus === "raw" || classification.reviewStatus === "review_candidate" ? classification.reviewStatus : undefined, warnings: ["auto_capture_skipped_secondary_for_turn"], skipped: true, skipReason: "auto_capture_skipped_secondary_for_turn" };
      logAutoCaptureDecision(ctx, classification, skipped);
      return skipped;
    }
    const skipped: AutoCaptureResult = { ...turnDuplicate, savedToVault: false, skipped: true, skipReason: "auto_capture_skipped_secondary_for_turn", warnings: ["auto_capture_skipped_secondary_for_turn", ...(turnDuplicate.warnings ?? [])] };
    logAutoCaptureDecision(ctx, classification, skipped);
    return skipped;
  }

  const fanOutWarnings = ["Auto-capture fan-out guard active: one assistant message can write only this single selected capture."];
  const event = buildCapturePreviewEvent({
    appId: ctx.request.appId,
    workspaceId: ctx.request.appId,
    sessionId: ctx.session.id,
    messageId: ctx.assistantMessageId,
    eventType: classification.type,
    content: ctx.answer,
    createdAt: ctx.session.updatedAt,
    // Current user turn is authoritative for auto-capture. Do not let stale
    // multi-turn session.topic route/title a later /x or /trend turn.
    topic: ctx.request.topic || ctx.request.message || ctx.session.topic || ctx.request.appName,
    project: ctx.request.appName,
  });
  const autoEvent: CMOVaultCaptureEvent = {
    ...event,
    ...classification,
    captureMode: "auto_raw",
    captureOrigin: "auto",
    gbrainStatus: "pending",
    messageId: ctx.assistantMessageId,
    requestId: ctx.assistantMessageId,
    reviewStatus: classification.reviewStatus === "raw" || classification.reviewStatus === "review_candidate" ? classification.reviewStatus : undefined,
    tags: ["auto-capture", "raw-capture"],
    warnings: classification.warnings,
    metadata: {
      ...(event.metadata ?? {}),
      auto_capture_version: "phase-2.11h",
      test_marker: extractCaptureTestMarker(ctx.request.message),
      runtime_label: ctx.runtimeLabel,
      runtime_provider: ctx.runtimeProvider,
      runtime_agent: ctx.runtimeAgent,
    },
  };
  if (extractCaptureTestMarker(ctx.request.message)) {
    autoEvent.payloadSummary = [autoEvent.payloadSummary, `Test marker: ${extractCaptureTestMarker(ctx.request.message)}`].filter(Boolean).join("\n");
  }

  try {
    const saved = await saveCaptureToCmoEngineVault(autoEvent, { idempotencyKey: ctx.assistantMessageId, turnIdempotencyKey: turnIndexKey(ctx) ?? undefined });
    const result = {
      ok: true,
      savedToVault: true,
      relativePath: saved.relativePath,
      writtenPath: saved.writtenPath,
      captureType: classification.type,
      sourceClass: classification.sourceClass,
      reviewStatus: classification.reviewStatus === "raw" || classification.reviewStatus === "review_candidate" ? classification.reviewStatus : undefined,
      warnings: [...fanOutWarnings, ...(classification.warnings ?? []), ...(saved.warnings ?? [])],
    };
    logAutoCaptureDecision(ctx, classification, result);
    return result;
  } catch (error) {
    const result: AutoCaptureResult = { ok: false, savedToVault: false, captureType: classification.type, sourceClass: classification.sourceClass, reviewStatus: classification.reviewStatus === "raw" || classification.reviewStatus === "review_candidate" ? classification.reviewStatus : undefined, warnings: [...fanOutWarnings, ...(classification.warnings ?? [])], error: error instanceof Error ? error.message : "Auto capture failed" };
    logAutoCaptureDecision(ctx, classification, result);
    return result;
  }
}

export const autoCaptureAssistantResponse = autoCaptureTurnOnce;
