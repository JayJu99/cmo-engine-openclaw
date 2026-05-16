"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { icons } from "@/components/dashboard/icons";
import type {
  AppWorkspace,
  CMOAppChatResponse,
  CMOContextBrief,
  CMOChatMessage,
  CMOChatSession,
  CMORuntimeStatus,
  CmoRuntimeErrorReason,
} from "@/lib/cmo/app-workspace-types";
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
    return "Adapter connected";
  }

  if (status === "live") {
    return "Live app-chat";
  }

  if (status === "configured_but_unreachable") {
    return "Live app-chat unavailable";
  }

  if (status === "live_failed_then_fallback") {
    return "Fallback used";
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
  if (status === "connected" || status === "live") {
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

function runtimeExplanation(status: CMORuntimeStatus | null, reason: CmoRuntimeErrorReason | null): string | null {
  if (status === "live") {
    return "CMO response received from live OpenClaw app-turn.";
  }

  if (status === "configured_but_unreachable") {
    return "Live app-chat is unavailable. Fallback answers use workspace context.";
  }

  if (status === "development_fallback") {
    return "Using development fallback for this session.";
  }

  if (status === "live_failed_then_fallback") {
    if (reason === "timeout") {
      return "Live app-turn timed out; fallback answer generated from workspace context.";
    }

    if (reason === "execution_error") {
      return "Live app-chat intentionally bypassed; fallback generated this response from workspace context.";
    }

    if (reason === "invalid_response" || reason === "empty_answer") {
      return "Live app-turn returned an invalid response; fallback generated this response from workspace context.";
    }

    return "Live app-chat unavailable; fallback answer generated from workspace context.";
  }

  if (status === "runtime_error") {
    return "Runtime returned an error. Use the visible fallback or try again later.";
  }

  if (status === "not_configured") {
    return "CMO runtime is not configured yet. Using development fallback.";
  }

  return null;
}

function assistantProvenance(message: CMOChatMessage, sessionSaved: boolean, rawCaptured: boolean): string | null {
  if (message.role !== "assistant" || !message.runtimeMode) {
    return null;
  }

  const runtime = message.runtimeMode === "live" ? "Live" : "Fallback";
  const provider = message.runtimeMode === "live" ? message.runtimeAgent || message.runtimeProvider || "OpenClaw CMO" : `reason: ${message.runtimeErrorReason ?? "fallback"}`;
  const saved = sessionSaved ? "Saved" : "Not saved";
  const raw = rawCaptured ? "Raw captured" : "Raw pending";

  return `${runtime} · ${provider} · ${message.contextUsedCount ?? 0} context notes · ${saved} · ${raw}`;
}

function isBackendContextLine(line: string): boolean {
  return /^(context used|unavailable context|context quality|context caution|draft or placeholder notes|graph hints|graph status|graph hint refs|runtime note|remote cmo adapter|cmo context pack)/i.test(line);
}

function isBackendContextHeading(value: string): boolean {
  return /^(context used|context|runtime note|graph hints|graph context|system context)$/i.test(value.trim());
}

function renderAssistantContent(content: string) {
  const lines = content.split(/\r?\n/);

  return (
    <div className="space-y-3">
      {lines.map((line, index) => {
        const trimmed = line.trim();

        if (!trimmed) {
          return <div key={`space-${index}`} className="h-1" />;
        }

        const heading = trimmed.match(/^##\s+(.+)$/);

        if (heading) {
          if (isBackendContextHeading(heading[1])) {
            return null;
          }

          return (
            <h3 key={`heading-${index}`} className="pt-2 text-sm font-extrabold uppercase text-slate-950 first:pt-0">
              {heading[1]}
            </h3>
          );
        }

        if (isBackendContextLine(trimmed)) {
          return null;
        }

        const numbered = trimmed.match(/^(\d+)\.\s+(.+)$/);

        if (numbered) {
          return (
            <div key={`numbered-${index}`} className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">{numbered[1]}</span>
              <p className="font-semibold text-slate-950">{numbered[2]}</p>
            </div>
          );
        }

        const bullet = trimmed.match(/^[-*]\s+(.+)$/);

        if (bullet) {
          return (
            <div key={`bullet-${index}`} className="flex gap-2 text-slate-700">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400" />
              <p>{bullet[1]}</p>
            </div>
          );
        }

        return (
          <p key={`paragraph-${index}`} className="text-slate-700">
            {trimmed}
          </p>
        );
      })}
    </div>
  );
}

export function CMOChatPanel({
  app,
  contextBrief,
  onSessionCreated,
  initialRuntimeStatus = null,
  focusSignal = 0,
  activeSessionId,
  selectedSession,
}: {
  app: AppWorkspace;
  contextBrief: CMOContextBrief;
  onSessionCreated?: (sessionId?: string) => void;
  onSessionSaved?: (path: string) => void;
  initialRuntimeStatus?: CMORuntimeStatus | null;
  initialRuntimeLabel?: string;
  focusSignal?: number;
  relatedPriority?: string;
  activeSessionId?: string | null;
  selectedSession?: CMOChatSession | null;
}) {
  const [messages, setMessages] = useState<CMOChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [savedSessionNotePath, setSavedSessionNotePath] = useState<string | null>(null);
  const [rawCapturePath, setRawCapturePath] = useState<string | null>(null);
  const [isDevelopmentFallback, setIsDevelopmentFallback] = useState(false);
  const [isRuntimeFallback, setIsRuntimeFallback] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<CMORuntimeStatus | null>(initialRuntimeStatus);
  const [runtimeErrorReason, setRuntimeErrorReason] = useState<CmoRuntimeErrorReason | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedQualitySummary = contextBrief.contextQualitySummary;
  const visibleMessages = messages.length ? messages : selectedSession?.messages ?? [];
  const activeDisplaySessionId = activeSessionId ?? sessionId ?? selectedSession?.id ?? null;
  const activeSavedToVault = selectedSession?.savedToVault || Boolean(savedSessionNotePath);
  const activeRawCaptured = Boolean(selectedSession?.rawCapturePath || rawCapturePath);

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
          status === "live" ||
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

      } catch {
        if (isMounted) {
          setRuntimeStatus("configured_but_unreachable");
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

  useEffect(() => {
    if (!selectedSession) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSessionId(selectedSession.id);
      setMessages(selectedSession.messages);
      setSavedSessionNotePath(selectedSession.sessionNotePath ?? null);
      setRawCapturePath(selectedSession.rawCapturePath ?? null);
      setIsDevelopmentFallback(selectedSession.isDevelopmentFallback === true);
      setIsRuntimeFallback(selectedSession.isRuntimeFallback === true);
      setRuntimeStatus(selectedSession.runtimeStatus ?? initialRuntimeStatus);
      setRuntimeErrorReason(selectedSession.runtimeErrorReason ?? null);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [initialRuntimeStatus, selectedSession]);

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
    if (!activeSessionId) {
      setSavedSessionNotePath(null);
      setRawCapturePath(null);
    }
    setRuntimeStatus(null);
    setIsDevelopmentFallback(false);
    setIsRuntimeFallback(false);
    setRuntimeErrorReason(null);

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
            sessionId: activeSessionId ?? sessionId ?? undefined,
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
      setIsDevelopmentFallback(response.isDevelopmentFallback);
      setIsRuntimeFallback(response.isRuntimeFallback === true);
      setRuntimeStatus(response.runtimeStatus);
      setRuntimeErrorReason(response.runtimeErrorReason ?? null);
      setError(response.status === "failed" ? response.runtimeError || "CMO runtime returned an error." : null);
      setSendStatus(
        response.runtimeProvider === "dashboard" && response.runtimeAgent === "decision-review"
          ? "Decision review updated from chat."
          : response.isRuntimeFallback || response.runtimeStatus === "live_failed_then_fallback"
          ? response.runtimeErrorReason === "timeout"
            ? "Live app-turn timed out; fallback answer generated from workspace context."
            : response.runtimeErrorReason === "invalid_response" || response.runtimeErrorReason === "empty_answer"
              ? "Live app-turn returned an invalid response; fallback generated this response from workspace context."
              : response.runtimeErrorReason === "execution_error"
                ? "Live app-chat intentionally bypassed; fallback generated this response from workspace context."
                : "Live app-chat unavailable; fallback answer generated from workspace context."
          : response.isDevelopmentFallback
            ? "Runtime unavailable; using development fallback."
            : "CMO response received from live OpenClaw app-turn.",
      );
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingAssistantId
            ? {
                ...message,
                id: response.messageId,
                content: response.answer,
                runtimeMode: response.runtimeMode,
                runtimeStatus: response.runtimeStatus,
                runtimeProvider: response.runtimeProvider,
                runtimeAgent: response.runtimeAgent,
                runtimeErrorReason: response.runtimeErrorReason,
                contextUsedCount: response.contextUsed.length,
                graphHintCount: response.graphHintCount ?? response.graphHints?.length ?? 0,
              }
            : message,
        ),
      );
      onSessionCreated?.(response.sessionId);
    } catch (sendError) {
      setRuntimeStatus("runtime_error");
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
              <CardDescription>{activeDisplaySessionId ? `Session ${activeDisplaySessionId}` : `App context: ${app.name}`}</CardDescription>
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
          </div>
        </div>
        <div className="border-b border-slate-100 bg-white px-5 py-3 text-xs font-medium text-slate-500">
          Use chat for review commands like &quot;What should I review next?&quot; and &quot;Mark action 1 reviewed.&quot; Save and capture live in the Vault drawer.
        </div>

        {visibleMessages.length && runtimeExplanation(runtimeStatus, runtimeErrorReason) ? (
          <div className={cn("border-b px-5 py-3 text-sm font-medium", runtimeStatus === "live" ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-orange-100 bg-orange-50 text-orange-800")}>
            {runtimeExplanation(runtimeStatus, runtimeErrorReason)}
            {runtimeStatus ? <span className={cn("ml-2 text-xs", runtimeStatus === "live" ? "text-emerald-700" : "text-orange-700")}>Status: {runtimeStatus}</span> : null}
          </div>
        ) : null}

        <div className="min-h-[360px] space-y-4 bg-slate-50/70 p-5">
          {visibleMessages.length ? (
            visibleMessages.map((message) => (
              <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm",
                    message.role === "user"
                      ? "max-w-[560px] bg-indigo-600 text-white"
                      : "w-full max-w-5xl border border-slate-200 bg-white text-slate-700 sm:px-5 sm:py-4",
                  )}
                >
                  {message.role === "assistant" ? (
                    <div className="mb-2 flex items-center gap-2 text-xs font-bold text-indigo-700">
                      <icons.Sparkles className="size-4" />
                      CMO
                    </div>
                  ) : null}
                  {message.role === "assistant" ? renderAssistantContent(message.content) : <div className="whitespace-pre-wrap">{message.content}</div>}
                  {message.role === "assistant" && assistantProvenance(message, activeSavedToVault, activeRawCaptured) ? (
                    <div className="mt-4 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-400">
                      {assistantProvenance(message, activeSavedToVault, activeRawCaptured)}
                    </div>
                  ) : null}
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

        <div className="border-t border-slate-100 bg-white p-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {[
                "What should I review next?",
                "Mark action 1 reviewed",
                "Save this session",
                "Capture to raw vault",
              ].map((command) => (
                <button
                  key={command}
                  type="button"
                  onClick={() => {
                    setInput(command);
                    inputRef.current?.focus();
                  }}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {command}
                </button>
              ))}
            </div>
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

    </div>
  );
}
