"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { icons } from "@/components/dashboard/icons";
import { ContextBriefCard } from "@/components/cmo-apps/context-brief-card";
import type {
  AppWorkspace,
  CMOAppChatResponse,
  CMOContextBrief,
  CMOContextDiagnostics,
  CMOContextQualitySummary,
  CMOChatMessage,
  CMORuntimeStatus,
  CmoRuntimeErrorReason,
  CmoRuntimeMode,
  RawCaptureResponse,
  VaultNoteRef,
} from "@/lib/cmo/app-workspace-types";
import { summarizeContextQuality } from "@/lib/cmo/context-quality";
import { cn } from "@/lib/utils";

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const record = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
    const message = typeof record?.error === "string" ? record.error : "Request failed";

    throw new Error(`${response.status} ${message}`);
  }

  return payload as T;
}

function nowIso() {
  return new Date().toISOString();
}

function messageId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function runtimeStatusLabel(status: CMORuntimeStatus | null): string {
  if (status === "connected") {
    return "Runtime connected";
  }

  if (status === "configured_but_unreachable") {
    return "Runtime unavailable";
  }

  if (status === "live_failed_then_fallback") {
    return "Live failed; fallback used";
  }

  if (status === "runtime_error") {
    return "Runtime error";
  }

  if (status === "development_fallback") {
    return "Development fallback";
  }

  if (status === "not_configured") {
    return "Runtime not configured";
  }

  return "Runtime not checked";
}

function runtimeStatusVariant(status: CMORuntimeStatus | null): "green" | "orange" | "red" | "slate" {
  if (status === "connected") {
    return "green";
  }

  if (status === "configured_but_unreachable" || status === "runtime_error") {
    return "red";
  }

  if (status === "development_fallback" || status === "not_configured" || status === "live_failed_then_fallback") {
    return "orange";
  }

  return "slate";
}

function runtimeExplanation(status: CMORuntimeStatus | null): string | null {
  if (status === "configured_but_unreachable") {
    return "CMO runtime is not connected yet. Using development fallback.";
  }

  if (status === "development_fallback") {
    return "Using development fallback for this session.";
  }

  if (status === "live_failed_then_fallback") {
    return "Live runtime unavailable for app chat; fallback used.";
  }

  if (status === "runtime_error") {
    return "Runtime returned an error. Use the visible fallback or try again later.";
  }

  if (status === "not_configured") {
    return "CMO runtime is not configured yet. Using development fallback.";
  }

  return null;
}

function captureSummary(
  app: AppWorkspace,
  messages: CMOChatMessage[],
  runtimeStatus: CMORuntimeStatus | null,
  runtimeMode: CmoRuntimeMode | null,
  runtimeLabel: string,
  attemptedRuntimeMode: CmoRuntimeMode | null,
  runtimeErrorReason: CmoRuntimeErrorReason | null,
  contextUsed: VaultNoteRef[],
  missingContext: VaultNoteRef[],
  isDevelopmentFallback: boolean,
  isRuntimeFallback: boolean,
  qualitySummary: CMOContextQualitySummary,
): string {
  const userMessage = messages.find((message) => message.role === "user")?.content ?? "No user question captured.";
  const assistantMessage = [...messages].reverse().find((message) => message.role === "assistant")?.content ?? "No CMO response captured.";
  const contextLine = contextUsed.length ? contextUsed.map((note) => note.title).join(", ") : "No context pack items were included.";
  const missingLine = missingContext.length ? missingContext.map((note) => note.title).join(", ") : "None.";

  return [
    `App-specific CMO session for ${app.name}.`,
    runtimeStatusLabel(runtimeStatus),
    `Runtime mode: ${runtimeMode ?? "not captured"}`,
    `Attempted runtime mode: ${attemptedRuntimeMode ?? "not captured"}`,
    `Fallback: ${isDevelopmentFallback ? "true" : "false"}`,
    `Runtime fallback: ${isRuntimeFallback ? "true" : "false"}`,
    `Runtime error reason: ${runtimeErrorReason ?? "none"}`,
    `Runtime label: ${runtimeStatus ? runtimeLabel || "Unlabeled runtime" : "Not checked"}`,
    `Context pack used: ${contextLine}`,
    `Unavailable context pack items: ${missingLine}`,
    `Context quality counts: ${qualitySummary.confirmedCount} confirmed, ${qualitySummary.draftCount} draft, ${qualitySummary.placeholderCount} placeholder, ${qualitySummary.missingCount} missing.`,
    `User asked: ${userMessage}`,
    `CMO response captured: ${assistantMessage}`,
  ].join("\n");
}

export function CMOChatPanel({
  app,
  contextBrief,
  onSessionCreated,
  onSessionSaved,
  initialRuntimeStatus = null,
  initialRuntimeLabel = "",
  focusSignal = 0,
  relatedPriority,
}: {
  app: AppWorkspace;
  contextBrief: CMOContextBrief;
  onSessionCreated?: (sessionId?: string) => void;
  onSessionSaved?: (path: string) => void;
  initialRuntimeStatus?: CMORuntimeStatus | null;
  initialRuntimeLabel?: string;
  focusSignal?: number;
  relatedPriority?: string;
}) {
  const [messages, setMessages] = useState<CMOChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [savedSessionNotePath, setSavedSessionNotePath] = useState<string | null>(null);
  const [rawCapturePath, setRawCapturePath] = useState<string | null>(null);
  const [lastContextUsed, setLastContextUsed] = useState<VaultNoteRef[]>([]);
  const [missingContext, setMissingContext] = useState<VaultNoteRef[]>([]);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [suggestedActions, setSuggestedActions] = useState<CMOAppChatResponse["suggestedActions"]>([]);
  const [contextDiagnostics, setContextDiagnostics] = useState<CMOContextDiagnostics | undefined>(undefined);
  const [contextQualitySummary, setContextQualitySummary] = useState<CMOContextQualitySummary | undefined>(undefined);
  const [isDevelopmentFallback, setIsDevelopmentFallback] = useState(false);
  const [isRuntimeFallback, setIsRuntimeFallback] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<CMORuntimeStatus | null>(initialRuntimeStatus);
  const [runtimeMode, setRuntimeMode] = useState<CmoRuntimeMode | null>(null);
  const [attemptedRuntimeMode, setAttemptedRuntimeMode] = useState<CmoRuntimeMode | null>(null);
  const [runtimeErrorReason, setRuntimeErrorReason] = useState<CmoRuntimeErrorReason | null>(null);
  const [runtimeLabel, setRuntimeLabel] = useState(initialRuntimeLabel);
  const [isSending, setIsSending] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedQualitySummary = contextBrief.contextQualitySummary;
  const effectiveQualitySummary = contextQualitySummary ?? selectedQualitySummary;
  const capturableMessages = messages.filter((message) => message.role === "user" || message.role === "assistant");

  useEffect(() => {
    let isMounted = true;

    async function checkRuntimeStatus() {
      try {
        const payload = await readJsonResponse<Record<string, unknown>>(await fetch("/api/cmo/status", { cache: "no-store" }));
        const status = payload.runtime_status ?? payload.openclaw_runtime;

        if (!isMounted) {
          return;
        }

        if (
          status === "connected" ||
          status === "configured_but_unreachable" ||
          status === "live_failed_then_fallback" ||
          status === "development_fallback" ||
          status === "runtime_error" ||
          status === "not_configured"
        ) {
          setRuntimeStatus(status);
        } else {
          setRuntimeStatus("runtime_error");
        }

        setRuntimeLabel(typeof payload.adapter === "string" ? payload.adapter : "");
      } catch {
        if (isMounted) {
          setRuntimeStatus("configured_but_unreachable");
          setRuntimeLabel("CMO Adapter");
        }
      }
    }

    void checkRuntimeStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (focusSignal <= 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      inputRef.current?.scrollIntoView({ block: "center" });
      inputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [focusSignal]);

  async function sendMessage() {
    const question = input.trim();

    if (!question || isSending) {
      if (!question) {
        setError("Failed to send: enter a message first.");
      }
      return;
    }

    const userMessage: CMOChatMessage = {
      id: messageId("user"),
      role: "user",
      content: question,
      createdAt: nowIso(),
    };
    const pendingAssistantId = messageId("assistant");

    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: pendingAssistantId,
        role: "assistant",
        content: "CMO runtime request is being prepared...",
        createdAt: nowIso(),
      },
    ]);
    setInput("");
    setIsSending(true);
    setError(null);
    setSendStatus("Sending...");
    setCaptureStatus(null);
    setSaveStatus(null);
    setSavedSessionNotePath(null);
    setRawCapturePath(null);
    setRuntimeStatus(null);
    setRuntimeMode(null);
    setRuntimeLabel("");
    setIsDevelopmentFallback(false);
    setIsRuntimeFallback(false);
    setAttemptedRuntimeMode(null);
    setRuntimeErrorReason(null);
    setLastContextUsed([]);
    setMissingContext([]);
    setAssumptions([]);
    setSuggestedActions([]);
    setContextDiagnostics(undefined);
    setContextQualitySummary(undefined);

    try {
      const response = await readJsonResponse<CMOAppChatResponse>(
        await fetch("/api/cmo/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId: "holdstation",
            appId: app.id,
            appName: app.name,
            sessionId: sessionId ?? undefined,
            message: question,
            topic: question.slice(0, 96),
            context: {
              selectedNotes: [],
              mode: "app_context",
            },
          }),
        }),
      );

      setSessionId(response.sessionId);
      setLastContextUsed(response.contextUsed);
      setMissingContext(response.missingContext);
      setAssumptions(response.assumptions);
      setSuggestedActions(response.suggestedActions);
      setContextDiagnostics(response.contextDiagnostics);
      setContextQualitySummary(response.contextQualitySummary ?? response.contextDiagnostics);
      setIsDevelopmentFallback(response.isDevelopmentFallback);
      setIsRuntimeFallback(response.isRuntimeFallback === true);
      setRuntimeStatus(response.runtimeStatus);
      setRuntimeMode(response.runtimeMode ?? null);
      setAttemptedRuntimeMode(response.attemptedRuntimeMode ?? null);
      setRuntimeErrorReason(response.runtimeErrorReason ?? null);
      setRuntimeLabel(response.runtimeLabel);
      setError(response.status === "failed" ? response.runtimeError || "CMO runtime returned an error." : null);
      setSendStatus(
        response.isRuntimeFallback || response.runtimeStatus === "live_failed_then_fallback"
          ? "Live runtime unavailable for app chat; fallback used"
          : response.isDevelopmentFallback
            ? "Runtime unavailable; using development fallback."
            : "CMO response received.",
      );
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingAssistantId
            ? {
                ...message,
                id: response.messageId,
                content: response.answer,
              }
            : message,
        ),
      );
      onSessionCreated?.(response.sessionId);
    } catch (sendError) {
      setRuntimeStatus("runtime_error");
      setRuntimeLabel("OpenClaw CMO runtime");
      setSendStatus(null);
      setError(`Failed to send: ${sendError instanceof Error ? sendError.message : "CMO chat failed"}`);
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingAssistantId
            ? {
                ...message,
                content: "CMO chat request failed. No session was captured.",
              }
            : message,
        ),
      );
    } finally {
      setIsSending(false);
    }
  }

  async function saveSessionToVault() {
    if (!sessionId || isSavingSession) {
      return;
    }

    setIsSavingSession(true);
    setError(null);
    setSaveStatus("Saving session...");

    try {
      const response = await readJsonResponse<{ status: "saved"; path: string; sessionId: string; alreadySaved: boolean }>(
        await fetch("/api/cmo/sessions/save-to-vault", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            appId: app.id,
            sessionId,
            topic: messages.find((message) => message.role === "user")?.content.slice(0, 96),
            relatedPriority,
          }),
        }),
      );

      setSavedSessionNotePath(response.path);
      setSaveStatus(`${response.alreadySaved ? "Already saved" : "Saved to Vault"}: ${response.path}`);
      onSessionSaved?.(response.path);
      onSessionCreated?.(sessionId);
    } catch (saveError) {
      setSaveStatus(null);
      setError(`Failed to save: ${saveError instanceof Error ? saveError.message : "Session save failed"}`);
    } finally {
      setIsSavingSession(false);
    }
  }

  async function captureToRawVault() {
    if (!capturableMessages.length || isCapturing) {
      return;
    }

    const topic = capturableMessages.find((message) => message.role === "user")?.content.slice(0, 96) || "CMO session";

    setIsCapturing(true);
    setError(null);
    setCaptureStatus("Capturing...");

    try {
      const response = await readJsonResponse<RawCaptureResponse>(
        await fetch("/api/vault/raw-captures", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId: "holdstation",
            appId: app.id,
            appName: app.name,
            topic,
            source: "cmo-session",
            relatedSource: "cmo-session",
            sessionId: sessionId ?? undefined,
            sessionNotePath: savedSessionNotePath ?? undefined,
            relatedPriority,
            summary: captureSummary(
              app,
              capturableMessages,
              runtimeStatus,
              runtimeMode,
              runtimeLabel,
              attemptedRuntimeMode,
              runtimeErrorReason,
              lastContextUsed,
              missingContext,
              isDevelopmentFallback,
              isRuntimeFallback,
              contextQualitySummary ?? summarizeContextQuality([...lastContextUsed, ...missingContext]),
            ),
            selectedContextNotes: [...lastContextUsed, ...missingContext],
            messages: capturableMessages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            contextUsed: lastContextUsed,
            missingContext,
            runtimeStatus: runtimeStatus ?? undefined,
            runtimeMode: runtimeMode ?? undefined,
            attemptedRuntimeMode: attemptedRuntimeMode ?? undefined,
            isDevelopmentFallback,
            isRuntimeFallback,
            runtimeErrorReason: runtimeErrorReason ?? undefined,
            contextDiagnostics,
            contextQualitySummary: contextQualitySummary ?? summarizeContextQuality([...lastContextUsed, ...missingContext]),
            assumptions,
            suggestedActions,
          }),
        }),
      );

      setRawCapturePath(response.path);
      setCaptureStatus(`Captured to Raw Vault: ${response.path}`);
      onSessionCreated?.(sessionId ?? undefined);
    } catch (captureError) {
      setCaptureStatus(null);
      setError(`Failed to capture: ${captureError instanceof Error ? captureError.message : "Raw capture write failed"}`);
    } finally {
      setIsCapturing(false);
    }
  }

  function focusChat() {
    inputRef.current?.focus();
  }

  return (
    <div id="cmo-session" className="space-y-5">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
              <icons.MessageSquare />
            </div>
            <div>
              <CardTitle>CMO Chat</CardTitle>
              <CardDescription>{sessionId ? `Session ${sessionId}` : `App context: ${app.name}`}</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge title={runtimeStatus ?? "not_checked"} variant={runtimeStatusVariant(runtimeStatus)}>{runtimeStatusLabel(runtimeStatus)}</Badge>
            <Badge variant={selectedQualitySummary.missingCount ? "orange" : "slate"}>
              Context: {selectedQualitySummary.existingCount}/{selectedQualitySummary.selectedCount} ready
            </Badge>
            <Badge variant={selectedQualitySummary.confirmedCount ? "green" : "slate"}>{selectedQualitySummary.confirmedCount} confirmed</Badge>
            <Badge variant={selectedQualitySummary.draftCount ? "blue" : "slate"}>{selectedQualitySummary.draftCount} draft</Badge>
            <Badge variant={selectedQualitySummary.placeholderCount ? "orange" : "slate"}>{selectedQualitySummary.placeholderCount} need content</Badge>
            {isRuntimeFallback ? <Badge variant="orange">fallback used</Badge> : isDevelopmentFallback ? <Badge variant="orange">development response</Badge> : null}
            <Button variant="outline" size="sm" onClick={focusChat}>
              <icons.MessageSquare />
              Start CMO Session
            </Button>
            <Button variant="outline" size="sm" onClick={() => void saveSessionToVault()} disabled={!sessionId || !capturableMessages.length || isSavingSession} title={!capturableMessages.length ? "Send a message before saving a session note." : undefined}>
              {isSavingSession ? <icons.RefreshCw className="animate-spin" /> : <icons.FileText />}
              Save Session to Vault
            </Button>
            <Button size="sm" onClick={() => void captureToRawVault()} disabled={!capturableMessages.length || Boolean(rawCapturePath) || isCapturing} title={!capturableMessages.length ? "Send a message before capturing to Raw Vault." : undefined}>
              {isCapturing ? <icons.RefreshCw className="animate-spin" /> : <icons.Database />}
              {rawCapturePath ? "Raw Captured" : "Capture to Raw Vault"}
            </Button>
          </div>
        </div>

        {runtimeExplanation(runtimeStatus) ? (
          <div className="border-b border-orange-100 bg-orange-50 px-5 py-3 text-sm font-medium text-orange-800">
            {runtimeExplanation(runtimeStatus)}
            {runtimeStatus ? <span className="ml-2 text-xs text-orange-700">Status: {runtimeStatus}</span> : null}
          </div>
        ) : null}

        <div className="min-h-[360px] space-y-4 bg-slate-50/70 p-5">
          {messages.length ? (
            messages.map((message) => (
              <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[640px] rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm",
                    message.role === "user" ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-700",
                  )}
                >
                  {message.role === "assistant" ? (
                    <div className="mb-2 flex items-center gap-2 text-xs font-bold text-indigo-700">
                      <icons.Sparkles className="size-4" />
                      CMO
                    </div>
                  ) : null}
                  <div className="whitespace-pre-wrap">{message.content}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="grid min-h-[300px] place-items-center text-center">
              <div className="max-w-sm">
                <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-indigo-700 ring-1 ring-indigo-100">
                  <icons.MessageSquare />
                </div>
                <CardTitle className="mt-4">Start with an app-specific question</CardTitle>
                <CardDescription className="mt-2">
                  CMO context is resolved automatically. Ask what this app should focus on next.
                </CardDescription>
              </div>
            </div>
          )}
        </div>

        {sendStatus ? <div className="border-t border-indigo-100 bg-indigo-50 px-5 py-3 text-sm font-medium text-indigo-700">{sendStatus}</div> : null}
        {error ? <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm font-medium text-red-700">{error}</div> : null}
        {saveStatus ? <div className="border-t border-blue-100 bg-blue-50 px-5 py-3 text-sm font-medium text-blue-700">{saveStatus}</div> : null}
        {captureStatus ? <div className="border-t border-emerald-100 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-700">{captureStatus}</div> : null}

        {sessionId ? (
          <div className="grid gap-3 border-t border-slate-100 bg-white px-5 py-4 text-xs text-slate-600 sm:grid-cols-2">
            <div>
              <div className="font-bold text-slate-950">Context used</div>
              <div className="mt-1">{lastContextUsed.length ? lastContextUsed.map((note) => note.title).join(", ") : "No context pack items were included."}</div>
            </div>
            <div>
              <div className="font-bold text-slate-950">Unavailable context</div>
              <div className="mt-1">{missingContext.length ? missingContext.map((note) => note.title).join(", ") : "None"}</div>
            </div>
            <div>
              <div className="font-bold text-slate-950">Assumptions</div>
              <div className="mt-1">{assumptions.length ? assumptions.join("; ") : "None returned."}</div>
            </div>
            <div>
              <div className="font-bold text-slate-950">Suggested action</div>
              <div className="mt-1">{suggestedActions[0]?.label ?? "Capture this session to Raw Vault."}</div>
            </div>
            <div>
              <div className="font-bold text-slate-950">Context quality</div>
              <div className="mt-1">
                {effectiveQualitySummary.confirmedCount} confirmed; {effectiveQualitySummary.placeholderCount} need content;{" "}
                {effectiveQualitySummary.draftCount} draft; {effectiveQualitySummary.missingCount} missing.
              </div>
            </div>
            <div>
              <div className="font-bold text-slate-950">Vault session note</div>
              <div className="mt-1 break-all">{savedSessionNotePath ?? "Not saved yet."}</div>
            </div>
            <div>
              <div className="font-bold text-slate-950">Raw capture</div>
              <div className="mt-1 break-all">{rawCapturePath ?? "Not captured yet."}</div>
            </div>
          </div>
        ) : null}

        <div className="border-t border-slate-100 bg-white p-4">
          <div className="flex flex-col gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Ask what this app should focus on next..."
              className="min-h-28 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
              disabled={isSending}
            />
            <Button className="self-end" onClick={() => void sendMessage()} disabled={!input.trim() || isSending}>
              {isSending ? <icons.RefreshCw className="animate-spin" /> : <icons.Send />}
              Send
            </Button>
          </div>
        </div>
      </Card>

      <ContextBriefCard brief={contextBrief} />
    </div>
  );
}
