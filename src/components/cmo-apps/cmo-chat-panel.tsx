"use client";

import type { ClipboardEvent, DragEvent } from "react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CmoAgentActivityPanel } from "@/components/cmo-apps/cmo-agent-activity-panel";
import { icons } from "@/components/dashboard/icons";
import { assistantDisplayMarkdown } from "@/lib/cmo/assistant-markdown-display";
import type {
  AppWorkspace,
  CMOAppChatResponse,
  CMOContextBrief,
  CMOChatMessage,
  CMOChatSession,
  CmoSessionAttachment,
  CMORuntimeStatus,
  CmoVaultApprovedWriteDryRunResult,
  CmoVaultApprovedWriteResult,
  CmoRuntimeErrorReason,
  CmoVaultUpdateReviewAction,
} from "@/lib/cmo/app-workspace-types";
import { cn } from "@/lib/utils";

const CMO_ASYNC_POLL_INTERVAL_MS = 3_000;
const CMO_ASYNC_POLL_MAX_MS = 10 * 60 * 1000;
const CMO_ATTACHMENT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  ".md",
  ".markdown",
].join(",");
const CMO_MAX_PENDING_ATTACHMENTS = 8;
const CMO_PASTE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function compactTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function pastedImageExtension(mimeType: string): string {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "png";
}

function pastedImageFileName(mimeType: string, index: number): string {
  const suffix = index > 0 ? `-${index + 1}` : "";

  return `pasted-image-${compactTimestamp()}${suffix}.${pastedImageExtension(mimeType)}`;
}

function filesFromList(files: FileList | null | undefined): File[] {
  return files ? Array.from(files) : [];
}

function hasFileDrag(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function imageFilesFromClipboard(event: ClipboardEvent<HTMLTextAreaElement>): File[] {
  const itemFiles: File[] = [];

  Array.from(event.clipboardData.items).forEach((item, index) => {
    if (item.kind !== "file" || !CMO_PASTE_IMAGE_MIME_TYPES.has(item.type)) {
      return;
    }

    const file = item.getAsFile();
    if (!file) {
      return;
    }

    itemFiles.push(file.name ? file : new File([file], pastedImageFileName(file.type || item.type, index), {
      type: file.type || item.type,
      lastModified: file.lastModified || Date.now(),
    }));
  });

  if (itemFiles.length) {
    return itemFiles;
  }

  return Array.from(event.clipboardData.files).flatMap((file, index) => {
    if (!CMO_PASTE_IMAGE_MIME_TYPES.has(file.type)) {
      return [];
    }

    if (file.name) {
      return [file];
    }

    return [new File([file], pastedImageFileName(file.type, index), {
      type: file.type,
      lastModified: file.lastModified || Date.now(),
    })];
  });
}

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

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  if (value < 1024) {
    return `${Math.round(value)} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function isActiveCmoRunStatus(value: unknown): value is "pending" | "running" {
  return value === "pending" || value === "running";
}

function isTerminalCmoRunStatus(value: unknown): value is "completed" | "failed" | "timed_out" {
  return value === "completed" || value === "failed" || value === "timed_out";
}

function latestAssistantMessage(messages: CMOChatMessage[]): CMOChatMessage | undefined {
  return [...messages].reverse().find((message) => message.role === "assistant");
}

function latestAssistantRunStartedAt(messages: CMOChatMessage[]): number {
  const assistant = latestAssistantMessage(messages);
  const startedAt = Date.parse(assistant?.cmoRunStartedAt ?? assistant?.createdAt ?? "");

  return Number.isFinite(startedAt) ? startedAt : Date.now();
}

function recordString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function candidateKey(candidate: Record<string, unknown>): string {
  return recordString(candidate, ["candidate_key", "candidate_id", "update_id", "id"]);
}

function candidateStatus(candidate: Record<string, unknown>): string {
  const status = recordString(candidate, ["review_status", "status"]);

  return status || "needs_review";
}

function statusVariant(status: string): "green" | "orange" | "red" | "blue" | "slate" {
  if (status === "approved") {
    return "green";
  }

  if (status === "rejected") {
    return "red";
  }

  if (status === "deferred") {
    return "blue";
  }

  return status === "draft" || status === "needs_review" ? "orange" : "slate";
}

function reviewActionLabel(action: CmoVaultUpdateReviewAction): string {
  return action === "approved" ? "Approve" : action === "rejected" ? "Reject" : "Defer";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function approvalCandidateKey(event: Record<string, unknown>): string {
  return isRecord(event.reviewed_update) ? recordString(event.reviewed_update, ["candidate_key", "candidate_id", "update_id", "id"]) : "";
}

function latestApprovedEventForCandidate(message: CMOChatMessage, key: string, session?: CMOChatSession | null): Record<string, unknown> | null {
  const messageEvent = [...(message.vaultUpdateApprovalEvents ?? [])].reverse().find((item) =>
    isRecord(item) &&
    item.action === "approved" &&
    item.review_status === "approved" &&
    Boolean(item.approved_update) &&
    approvalCandidateKey(item) === key,
  );

  if (messageEvent) {
    return messageEvent as unknown as Record<string, unknown>;
  }

  const sessionEvent = [...(session?.vaultUpdateApprovalEvents ?? [])].reverse().find((item) =>
    isRecord(item) &&
    item.action === "approved" &&
    item.review_status === "approved" &&
    Boolean(item.approved_update) &&
    approvalCandidateKey(item) === key,
  );

  return sessionEvent
    ? sessionEvent as unknown as Record<string, unknown>
    : null;
}

function dryRunResultForApproval(
  message: CMOChatMessage,
  approvalId: string,
  session?: CMOChatSession | null,
): CmoVaultApprovedWriteDryRunResult | null {
  return [...(message.vaultUpdateDryRunResults ?? [])].reverse().find((result) => result.approval_id === approvalId)
    ?? [...(session?.vaultUpdateDryRunResults ?? [])].reverse().find((result) => result.approval_id === approvalId)
    ?? null;
}

function writeResultForApproval(
  message: CMOChatMessage,
  approvalId: string,
  session?: CMOChatSession | null,
): CmoVaultApprovedWriteResult | null {
  return [...(message.vaultUpdateWriteResults ?? [])].reverse().find((result) => result.approval_id === approvalId)
    ?? [...(session?.vaultUpdateWriteResults ?? [])].reverse().find((result) => result.approval_id === approvalId)
    ?? null;
}

function canWriteVaultUpdate(
  approvalId: string,
  dryRunResult: CmoVaultApprovedWriteDryRunResult | null,
  writeResult: CmoVaultApprovedWriteResult | null,
): boolean {
  return Boolean(approvalId) &&
    dryRunResult?.dry_run === true &&
    dryRunResult.write_allowed === true &&
    dryRunResult.vault_write_performed === false &&
    dryRunResult.conflict !== true &&
    !(dryRunResult.errors?.length) &&
    !writeResult?.conflict &&
    !writeResult?.vault_write_performed &&
    !writeResult?.deduped;
}

function dryRunSemanticState(result: CmoVaultApprovedWriteDryRunResult): {
  label: string;
  detail: string;
  variant: "green" | "orange" | "red" | "blue" | "slate";
} {
  if (result.conflict || result.errors?.length || result.write_allowed !== true) {
    return {
      label: "Save not available",
      detail: "This draft needs review before saving.",
      variant: result.errors?.length || result.conflict ? "red" : "orange",
    };
  }

  return {
    label: "Preview ready.",
    detail: "This will be saved as an approved draft if you confirm.",
    variant: "green",
  };
}

function writeResultSemanticState(result: CmoVaultApprovedWriteResult): {
  label: string;
  detail: string;
  variant: "green" | "orange" | "red" | "blue" | "slate";
} {
  if (result.conflict || result.errors?.length || result.status === "failed" || result.status === "rejected") {
    return {
      label: "Save failed.",
      detail: "The draft was not saved. Review the candidate and try again.",
      variant: "red",
    };
  }

  if (result.deduped || result.status === "deduped") {
    return {
      label: "Already saved.",
      detail: "This approved draft was already saved.",
      variant: "blue",
    };
  }

  if (result.vault_write_performed === true && result.status === "completed") {
    return {
      label: "Saved.",
      detail: "Saved as approved draft.",
      variant: "green",
    };
  }

  return {
    label: "Not saved.",
    detail: "No save was performed.",
    variant: "orange",
  };
}

function runtimeStatusLabel(status: CMORuntimeStatus | null): string {
  if (status === "connected" || status === "live" || status === "configured_but_unreachable") {
    return "CMO Hermes Active";
  }

  if (status === "live_failed_then_fallback" || status === "development_fallback") {
    return "Workspace Context Active";
  }

  if (status === "not_configured") {
    return "CMO setup pending";
  }

  if (status === "runtime_error") {
    return "CMO needs attention";
  }

  return "CMO status checking";
}

function runtimeStatusVariant(status: CMORuntimeStatus | null): "green" | "orange" | "red" | "slate" {
  if (status === "connected" || status === "live" || status === "configured_but_unreachable") {
    return "green";
  }

  if (status === "runtime_error") {
    return "red";
  }

  if (status === "development_fallback" || status === "not_configured" || status === "live_failed_then_fallback") {
    return "orange";
  }

  return "slate";
}

function runtimeExplanation(status: CMORuntimeStatus | null, reason: CmoRuntimeErrorReason | null): string | null {
  if (status === "connected" || status === "live" || status === "configured_but_unreachable") {
    return "Using approved workspace context.";
  }

  if (status === "development_fallback") {
    return "Workspace context is available for this session.";
  }

  if (status === "live_failed_then_fallback") {
    if (reason === "timeout") {
      return "Workspace context was used after the CMO request timed out.";
    }

    if (reason === "execution_error") {
      return "Workspace context was used for this answer.";
    }

    if (reason === "invalid_response" || reason === "empty_answer") {
      return "Workspace context was used after the CMO response could not be completed.";
    }

    return "Workspace context was used for this answer.";
  }

  if (status === "runtime_error") {
    return "CMO runtime returned an error. Try again later.";
  }

  if (status === "not_configured") {
    return "CMO runtime setup is pending.";
  }

  return null;
}

function assistantProvenance(message: CMOChatMessage): string | null {
  if (message.role !== "assistant" || !message.runtimeMode) {
    return null;
  }

  return message.runtimeMode === "live" ? "CMO Hermes - workspace context enabled" : "Workspace context answer";
}

function renderAssistantContent(content: string) {
  const markdown = assistantDisplayMarkdown(content);

  return (
    <div className="space-y-3 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => {
            const isExternal = typeof href === "string" && /^https?:\/\//i.test(href);

            return (
              <a
                {...props}
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="font-semibold text-indigo-700 underline decoration-indigo-200 underline-offset-2 transition hover:text-indigo-900"
              >
                {children}
              </a>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-indigo-200 bg-indigo-50/50 py-2 pl-4 pr-3 text-slate-700">
              {children}
            </blockquote>
          ),
          code: ({ children, className }) => (
            <code className={cn("rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-900", className)}>
              {children}
            </code>
          ),
          h1: ({ children }) => <h2 className="pt-2 text-lg font-extrabold leading-7 text-slate-950 first:pt-0">{children}</h2>,
          h2: ({ children }) => <h3 className="pt-2 text-base font-extrabold leading-7 text-slate-950 first:pt-0">{children}</h3>,
          h3: ({ children }) => <h4 className="pt-2 text-sm font-extrabold uppercase leading-6 text-slate-950 first:pt-0">{children}</h4>,
          h4: ({ children }) => <h5 className="pt-2 text-sm font-bold leading-6 text-slate-950 first:pt-0">{children}</h5>,
          hr: () => <hr className="border-slate-200" />,
          li: ({ children }) => <li className="pl-1 text-slate-700">{children}</li>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          p: ({ children }) => <p className="whitespace-pre-wrap text-slate-700">{children}</p>,
          pre: ({ children }) => (
            <pre className="overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-6 text-slate-50 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-slate-50">
              {children}
            </pre>
          ),
          strong: ({ children }) => <strong className="font-extrabold text-slate-950">{children}</strong>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
        }}
      >
        {markdown || content}
      </ReactMarkdown>
    </div>
  );
}

function AttachmentCards({
  attachments,
  tone = "light",
  onRemove,
}: {
  attachments?: CmoSessionAttachment[];
  tone?: "light" | "dark";
  onRemove?: (attachmentId: string) => void;
}) {
  if (!attachments?.length) {
    return null;
  }

  const isDark = tone === "dark";

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.attachment_id}
          className={cn(
            "flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-xs leading-5",
            isDark
              ? "border-indigo-300/40 bg-indigo-500/40 text-white"
              : "border-slate-200 bg-slate-50 text-slate-700",
          )}
        >
          <icons.FileText className="size-4 shrink-0" />
          <div className="min-w-0">
            <div className="truncate font-bold">{attachment.filename}</div>
            <div className={cn("truncate", isDark ? "text-indigo-100" : "text-slate-500")}>
              {attachment.mime_type} - {formatBytes(attachment.size_bytes)}
            </div>
          </div>
          {onRemove ? (
            <button
              type="button"
              aria-label={`Remove ${attachment.filename}`}
              onClick={() => onRemove(attachment.attachment_id)}
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-md transition",
                isDark ? "hover:bg-white/15" : "hover:bg-slate-200",
              )}
            >
              <icons.X className="size-4" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function CMOChatPanel({
  app,
  contextBrief,
  onSessionCreated,
  onStartNewSession,
  initialRuntimeStatus = null,
  focusSignal = 0,
  activeSessionId,
  selectedSession,
}: {
  app: AppWorkspace;
  contextBrief: CMOContextBrief;
  onSessionCreated?: (sessionId?: string) => void;
  onStartNewSession?: () => void;
  initialRuntimeStatus?: CMORuntimeStatus | null;
  focusSignal?: number;
  activeSessionId?: string | null;
  selectedSession?: CMOChatSession | null;
}) {
  const [messages, setMessages] = useState<CMOChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<CmoSessionAttachment[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<CMORuntimeStatus | null>(initialRuntimeStatus);
  const [runtimeErrorReason, setRuntimeErrorReason] = useState<CmoRuntimeErrorReason | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [pendingAssistantMessageId, setPendingAssistantMessageId] = useState<string | null>(null);
  const [pendingStartedAt, setPendingStartedAt] = useState<number | null>(null);
  const [pendingElapsedMs, setPendingElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [reviewStatusMessage, setReviewStatusMessage] = useState<string | null>(null);
  const [reviewingCandidateKey, setReviewingCandidateKey] = useState<string | null>(null);
  const [dryRunStatusMessage, setDryRunStatusMessage] = useState<string | null>(null);
  const [dryRunningApprovalId, setDryRunningApprovalId] = useState<string | null>(null);
  const [writeStatusMessage, setWriteStatusMessage] = useState<string | null>(null);
  const [writingApprovalId, setWritingApprovalId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const asyncPollTimerRef = useRef<number | null>(null);
  const asyncPollStartedAtRef = useRef<number | null>(null);
  const selectedQualitySummary = contextBrief.contextQualitySummary;
  const visibleMessages = messages.length ? messages : selectedSession?.messages ?? [];
  const activeDisplaySessionId = activeSessionId ?? sessionId ?? selectedSession?.id ?? null;
  const latestVisibleCmoRunStatus = latestAssistantMessage(visibleMessages)?.cmoRunStatus;

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
      setSessionId(null);
      setMessages([]);
      setRuntimeStatus(initialRuntimeStatus);
      setRuntimeErrorReason(null);
      setError(null);
      setSendStatus(null);
      setReviewStatusMessage(null);
      setDryRunStatusMessage(null);
      setWriteStatusMessage(null);
      setPendingAssistantMessageId(null);
      setPendingStartedAt(null);
      setPendingElapsedMs(0);
      setPendingAttachments([]);
      inputRef.current?.scrollIntoView({ block: "center" });
      inputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [focusSignal, initialRuntimeStatus]);

  useEffect(() => {
    if (!selectedSession) {
      const timeout = window.setTimeout(() => {
        setSessionId(null);
        setMessages([]);
        setRuntimeStatus(initialRuntimeStatus);
        setRuntimeErrorReason(null);
        setPendingAssistantMessageId(null);
        setPendingStartedAt(null);
        setPendingElapsedMs(0);
        setPendingAttachments([]);
        setReviewStatusMessage(null);
        setDryRunStatusMessage(null);
        setWriteStatusMessage(null);
      }, 0);

      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(() => {
      setSessionId(selectedSession.id);
      setMessages(selectedSession.messages);
      setRuntimeStatus(selectedSession.runtimeStatus ?? initialRuntimeStatus);
      setRuntimeErrorReason(selectedSession.runtimeErrorReason ?? null);
      setReviewStatusMessage(null);
      setDryRunStatusMessage(null);
      setWriteStatusMessage(null);
      const latestAssistant = latestAssistantMessage(selectedSession.messages);
      if (isActiveCmoRunStatus(latestAssistant?.cmoRunStatus)) {
        setPendingAssistantMessageId(latestAssistant?.id ?? null);
        setPendingStartedAt(latestAssistantRunStartedAt(selectedSession.messages));
      } else {
        setPendingAssistantMessageId(null);
        setPendingStartedAt(null);
        setPendingElapsedMs(0);
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [initialRuntimeStatus, selectedSession]);

  useEffect(() => {
    if (!pendingStartedAt) {
      return;
    }

    const updateElapsed = () => setPendingElapsedMs(Math.max(0, Date.now() - pendingStartedAt));
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);

    return () => window.clearInterval(interval);
  }, [pendingStartedAt]);

  useEffect(() => {
    if (!activeDisplaySessionId || !isActiveCmoRunStatus(latestVisibleCmoRunStatus)) {
      if (asyncPollTimerRef.current) {
        window.clearTimeout(asyncPollTimerRef.current);
        asyncPollTimerRef.current = null;
      }
      asyncPollStartedAtRef.current = null;
      return;
    }

    let cancelled = false;
    asyncPollStartedAtRef.current ??= Date.now();

    const pollSession = async () => {
      if (cancelled || !activeDisplaySessionId) {
        return;
      }

      const elapsedMs = Date.now() - (asyncPollStartedAtRef.current ?? Date.now());
      if (elapsedMs > CMO_ASYNC_POLL_MAX_MS) {
        setPendingAssistantMessageId(null);
        setPendingStartedAt(null);
        setSendStatus("CMO run polling timed out. Refresh sessions to check the latest result.");
        return;
      }

      try {
        const payload = await readJsonResponse<{ data: CMOChatSession[] }>(
          await fetch(`/api/apps/${app.id}/sessions?limit=20`, { cache: "no-store" }),
        );
        const refreshedSession = payload.data.find((session) => session.id === activeDisplaySessionId);

        if (!refreshedSession || cancelled) {
          asyncPollTimerRef.current = window.setTimeout(() => void pollSession(), CMO_ASYNC_POLL_INTERVAL_MS);
          return;
        }

        const latestAssistant = latestAssistantMessage(refreshedSession.messages);

        setSessionId(refreshedSession.id);
        setMessages(refreshedSession.messages);
        setRuntimeStatus(refreshedSession.runtimeStatus ?? initialRuntimeStatus);
        setRuntimeErrorReason(refreshedSession.runtimeErrorReason ?? null);
        onSessionCreated?.(refreshedSession.id);

        if (isActiveCmoRunStatus(latestAssistant?.cmoRunStatus)) {
          setPendingAssistantMessageId(latestAssistant?.id ?? null);
          setPendingStartedAt(latestAssistantRunStartedAt(refreshedSession.messages));
          setSendStatus("CMO is working...");
          asyncPollTimerRef.current = window.setTimeout(() => void pollSession(), CMO_ASYNC_POLL_INTERVAL_MS);
          return;
        }

        if (isTerminalCmoRunStatus(latestAssistant?.cmoRunStatus)) {
          setPendingAssistantMessageId(null);
          setPendingStartedAt(null);
          setPendingElapsedMs(0);
          setIsSending(false);
          setError(latestAssistant.cmoRunStatus === "completed" ? null : "CMO could not complete the run.");
          setSendStatus(latestAssistant.cmoRunStatus === "completed" ? "CMO response received from live Hermes CMO." : "CMO run finished with a safe failure response.");
          asyncPollStartedAtRef.current = null;
          return;
        }

        setPendingAssistantMessageId(null);
        setPendingStartedAt(null);
        setPendingElapsedMs(0);
        asyncPollStartedAtRef.current = null;
      } catch {
        if (!cancelled) {
          asyncPollTimerRef.current = window.setTimeout(() => void pollSession(), CMO_ASYNC_POLL_INTERVAL_MS);
        }
      }
    };

    asyncPollTimerRef.current = window.setTimeout(() => void pollSession(), CMO_ASYNC_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (asyncPollTimerRef.current) {
        window.clearTimeout(asyncPollTimerRef.current);
        asyncPollTimerRef.current = null;
      }
    };
  }, [activeDisplaySessionId, app.id, initialRuntimeStatus, latestVisibleCmoRunStatus, onSessionCreated]);

  async function sendMessage() {
    const trimmedInput = input.trim();
    const attachmentsForTurn = pendingAttachments;
    const question = trimmedInput || (attachmentsForTurn.length ? "Please review the attached file(s)." : "");

    if (!question || isSending || isUploadingAttachment) {
      if (!question) {
        setError("Failed to send: enter a message first.");
      } else if (isUploadingAttachment) {
        setError("Failed to send: wait for the attachment upload to finish.");
      }
      return;
    }

    const userMessage: CMOChatMessage = {
      id: messageId("user"),
      role: "user",
      content: question,
      createdAt: nowIso(),
      ...(attachmentsForTurn.length ? { attachments: attachmentsForTurn } : {}),
    };
    const pendingAssistantId = messageId("assistant");
    const pendingStartedMs = Date.now();

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
    setIsSending(true);
    setPendingAssistantMessageId(pendingAssistantId);
    setPendingStartedAt(pendingStartedMs);
    setPendingElapsedMs(0);
    setError(null);
    setSendStatus("Sending...");
    setRuntimeStatus(null);
    setRuntimeErrorReason(null);

    let keepPendingRun = false;

    try {
      const response = await readJsonResponse<CMOAppChatResponse>(
        await fetch("/api/cmo/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId: app.workspaceId,
            appId: app.id,
            appName: app.name,
            sessionId: activeSessionId ?? sessionId ?? undefined,
            message: question,
            topic: question.slice(0, 96),
            context: {
              selectedNotes: [],
              mode: "app_context",
            },
            attachments: attachmentsForTurn,
          }),
        }),
      );

      setInput("");
      setPendingAttachments([]);
      setSessionId(response.sessionId);
      setRuntimeStatus(response.runtimeStatus);
      setRuntimeErrorReason(response.runtimeErrorReason ?? null);
      keepPendingRun = isActiveCmoRunStatus(response.cmoRunStatus);
      setError(response.status === "failed" ? response.runtimeError || "CMO runtime returned an error." : null);
      setSendStatus(
        response.runtimeProvider === "dashboard" && response.runtimeAgent === "decision-review"
          ? "Decision review updated from chat."
          : response.runtimeProvider === "hermes" && response.runtimeAgent === "cmo"
            ? "CMO response received from live Hermes CMO."
          : response.isRuntimeFallback || response.runtimeStatus === "live_failed_then_fallback"
          ? response.runtimeErrorReason === "timeout"
            ? "Workspace context was used after the CMO request timed out."
            : response.runtimeErrorReason === "invalid_response" || response.runtimeErrorReason === "empty_answer"
              ? "Workspace context was used after the CMO response could not be completed."
              : response.runtimeErrorReason === "execution_error"
                ? "Workspace context was used for this answer."
                : "Workspace context was used for this answer."
          : response.isDevelopmentFallback
            ? "Workspace context is available for this session."
            : "CMO response received from live Hermes CMO.",
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
                calledHermesCmo: response.calledHermesCmo,
                hermesCmoStatus: response.hermesCmoStatus,
                hermesCmoErrorReason: response.hermesCmoErrorReason,
                hermesCmoCounters: response.hermesCmoCounters,
                hermesCmoMetadata: response.hermesCmoMetadata,
                strategyMode: response.strategyMode,
                mainBottleneck: response.mainBottleneck,
                decisionLabel: response.decisionLabel,
                currentStep: response.currentStep,
                activityEvents: response.activityEvents,
                delegationSummary: response.delegationSummary,
                agentsUsed: response.agentsUsed,
                surfCalls: response.surfCalls,
                echoCalls: response.echoCalls,
                forbiddenCounters: response.forbiddenCounters,
                platformPersistenceSummary: response.platformPersistenceSummary,
                delegationsMode: response.delegationsMode,
                cmoRunStatus: response.cmoRunStatus,
                cmoRunStartedAt: response.cmoRunStartedAt,
                cmoRunCompletedAt: response.cmoRunCompletedAt,
                cmoRunDurationMs: response.cmoRunDurationMs,
                cmoRunTimeoutMs: response.cmoRunTimeoutMs,
                contextUsedCount: response.contextUsed.length,
                graphHintCount: response.graphHintCount ?? response.graphHints?.length ?? 0,
                requestReceivedAt: response.requestReceivedAt,
                liveAttemptStartedAt: response.liveAttemptStartedAt,
                liveAttemptDurationMs: response.liveAttemptDurationMs,
                fallbackDurationMs: response.fallbackDurationMs,
                totalDurationMs: response.totalDurationMs,
                timeoutMs: response.timeoutMs,
                contextSourceCount: response.contextSourceCount,
                contextCharLength: response.contextCharLength,
                indexedSupplementCharLength: response.indexedSupplementCharLength,
                authDurationMs: response.authDurationMs,
                sessionResolutionDurationMs: response.sessionResolutionDurationMs,
                contextPackBuildDurationMs: response.contextPackBuildDurationMs,
                indexedContextBuildDurationMs: response.indexedContextBuildDurationMs,
                sessionSummary: response.sessionSummary,
                sessionArtifacts: response.sessionArtifacts,
                suggestedVaultUpdates: response.suggestedVaultUpdates,
                vaultUpdateApprovalEvents: response.vaultUpdateApprovalEvents,
                vaultUpdateDryRunResults: response.vaultUpdateDryRunResults,
                vaultUpdateWriteResults: response.vaultUpdateWriteResults,
              }
            : message,
        ),
      );
      onSessionCreated?.(response.sessionId);
      if (keepPendingRun) {
        setPendingAssistantMessageId(response.messageId);
        setPendingStartedAt(Number.isFinite(Date.parse(response.cmoRunStartedAt ?? ""))
          ? Date.parse(response.cmoRunStartedAt ?? "")
          : pendingStartedMs);
        setSendStatus("CMO is working...");
      }
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
      if (!keepPendingRun) {
        setPendingAssistantMessageId(null);
        setPendingStartedAt(null);
      }
    }
  }

  function focusChat() {
    if (onStartNewSession) {
      onStartNewSession();
      return;
    }

    inputRef.current?.focus();
  }

  async function uploadAttachmentFiles(inputFiles: File[] | FileList | null) {
    const files = Array.isArray(inputFiles) ? inputFiles : filesFromList(inputFiles);

    if (!files.length || isUploadingAttachment) {
      return;
    }

    if (isSending) {
      setError("Attachment upload failed: wait for the current CMO request to finish.");
      return;
    }

    const availableSlots = Math.max(0, CMO_MAX_PENDING_ATTACHMENTS - pendingAttachments.length);
    if (!availableSlots) {
      setError(`Attachment upload failed: this message already has ${CMO_MAX_PENDING_ATTACHMENTS} attachments.`);
      return;
    }

    const uploadQueue = files.slice(0, availableSlots);
    const skippedCount = files.length - uploadQueue.length;
    const uploadedAttachments: CmoSessionAttachment[] = [];

    setIsUploadingAttachment(true);
    setError(null);
    setSendStatus(uploadQueue.length === 1 ? "Uploading attachment..." : `Uploading ${uploadQueue.length} attachments...`);

    try {
      for (const file of uploadQueue) {
        const formData = new FormData();
        formData.set("file", file);
        formData.set("workspaceId", app.workspaceId);
        const activeSession = activeSessionId ?? sessionId ?? selectedSession?.id;
        if (activeSession) {
          formData.set("sessionId", activeSession);
        }

        const payload = await readJsonResponse<{ data: CmoSessionAttachment }>(
          await fetch(`/api/apps/${app.id}/attachments`, {
            method: "POST",
            body: formData,
          }),
        );

        uploadedAttachments.push(payload.data);
      }

      setPendingAttachments((current) => [...current, ...uploadedAttachments].slice(0, CMO_MAX_PENDING_ATTACHMENTS));
      setSendStatus(
        skippedCount > 0
          ? `${uploadedAttachments.length} attachment${uploadedAttachments.length === 1 ? "" : "s"} uploaded. ${skippedCount} skipped because this message is full.`
          : uploadedAttachments.length === 1
            ? "Attachment uploaded."
            : `${uploadedAttachments.length} attachments uploaded.`,
      );
    } catch (uploadError) {
      if (uploadedAttachments.length) {
        setPendingAttachments((current) => [...current, ...uploadedAttachments].slice(0, CMO_MAX_PENDING_ATTACHMENTS));
      }
      setSendStatus(null);
      setError(`Attachment upload failed: ${uploadError instanceof Error ? uploadError.message : "Upload failed"}`);
    } finally {
      setIsUploadingAttachment(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleAttachmentDragEnter(event: DragEvent<HTMLElement>) {
    if (!hasFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  }

  function handleAttachmentDragOver(event: DragEvent<HTMLElement>) {
    if (!hasFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragActive(true);
  }

  function handleAttachmentDragLeave(event: DragEvent<HTMLElement>) {
    if (!hasFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  }

  function handleAttachmentDrop(event: DragEvent<HTMLElement>) {
    if (!hasFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    const droppedFiles = filesFromList(event.dataTransfer.files);
    void uploadAttachmentFiles(droppedFiles);
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedImageFiles = imageFilesFromClipboard(event);

    if (!pastedImageFiles.length) {
      return;
    }

    event.preventDefault();
    void uploadAttachmentFiles(pastedImageFiles);
  }

  async function reviewSuggestedVaultUpdate(candidate: Record<string, unknown>, action: CmoVaultUpdateReviewAction) {
    const activeKey = candidateKey(candidate);
    const activeSession = activeDisplaySessionId;

    if (!activeKey || !activeSession || reviewingCandidateKey) {
      return;
    }

    setReviewingCandidateKey(activeKey);
    setReviewStatusMessage(`${reviewActionLabel(action)} pending...`);
    setError(null);

    try {
      const payload = await readJsonResponse<{ data: CMOChatSession }>(
        await fetch("/api/cmo/sessions/suggested-vault-updates/review", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            appId: app.id,
            sessionId: activeSession,
            candidateKey: activeKey,
            action,
          }),
        }),
      );

      setSessionId(payload.data.id);
      setMessages(payload.data.messages);
      setReviewStatusMessage(`${reviewActionLabel(action)} recorded. Not saved.`);
      onSessionCreated?.(payload.data.id);
    } catch (reviewError) {
      setReviewStatusMessage(null);
      setError(`Review failed: ${reviewError instanceof Error ? reviewError.message : "suggested update review failed"}`);
    } finally {
      setReviewingCandidateKey(null);
    }
  }

  async function previewVaultWrite(approvalId: string) {
    const activeSession = activeDisplaySessionId;

    if (!approvalId || !activeSession || dryRunningApprovalId) {
      return;
    }

    setDryRunningApprovalId(approvalId);
    setDryRunStatusMessage("Save preview pending...");
    setError(null);

    try {
      const payload = await readJsonResponse<{ data: CMOChatSession }>(
        await fetch("/api/cmo/sessions/suggested-vault-updates/dry-run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            appId: app.id,
            sessionId: activeSession,
            approvalId,
          }),
        }),
      );

      setSessionId(payload.data.id);
      setMessages(payload.data.messages);
      setDryRunStatusMessage("Preview ready.");
      onSessionCreated?.(payload.data.id);
    } catch (dryRunError) {
      setDryRunStatusMessage(null);
      setError(`Preview failed: ${dryRunError instanceof Error ? dryRunError.message : "Save preview failed"}`);
    } finally {
      setDryRunningApprovalId(null);
    }
  }

  async function writeVaultUpdate(approvalId: string) {
    const activeSession = activeDisplaySessionId;

    if (!approvalId || !activeSession || writingApprovalId) {
      return;
    }

    setWritingApprovalId(approvalId);
    setWriteStatusMessage("Saving...");
    setError(null);

    try {
      const payload = await readJsonResponse<{ data: CMOChatSession }>(
        await fetch("/api/cmo/sessions/suggested-vault-updates/write", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            appId: app.id,
            sessionId: activeSession,
            approvalId,
          }),
        }),
      );

      setSessionId(payload.data.id);
      setMessages(payload.data.messages);
      setWriteStatusMessage("Saved.");
      onSessionCreated?.(payload.data.id);
    } catch (writeError) {
      setWriteStatusMessage(null);
      setError(`Save failed: ${writeError instanceof Error ? writeError.message : "Save failed"}`);
    } finally {
      setWritingApprovalId(null);
    }
  }

  function renderDryRunResult({
    result,
    approvalId,
    canWrite,
  }: {
    result: CmoVaultApprovedWriteDryRunResult | null;
    approvalId: string;
    writeResult: CmoVaultApprovedWriteResult | null;
    canWrite: boolean;
  }) {
    if (!result) {
      return null;
    }

    const planAllowed = result.write_allowed && !(result.errors?.length);
    const semanticState = dryRunSemanticState(result);

    return (
      <div className="mt-3 space-y-3 rounded-lg border border-blue-100 bg-white px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={semanticState.variant}>{semanticState.label}</Badge>
          <Badge variant={planAllowed ? "green" : "orange"}>{planAllowed ? "Ready to save" : "Needs review before saving."}</Badge>
        </div>
        <p className="text-sm leading-6 text-slate-600">{semanticState.detail}</p>
        {result.warnings?.length ? (
          <div className="rounded border border-orange-100 bg-orange-50 px-3 py-2 text-xs leading-5 text-orange-800">
            Needs review before saving.
          </div>
        ) : null}
        {result.errors?.length ? (
          <div className="rounded border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-800">
            Save not available.
          </div>
        ) : null}
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={Boolean(writingApprovalId)} onClick={() => void writeVaultUpdate(approvalId)}>
              {writingApprovalId === approvalId ? <icons.RefreshCw className="animate-spin" /> : <icons.Check />}
              Save Draft
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderWriteResult(result: CmoVaultApprovedWriteResult | null) {
    if (!result) {
      return null;
    }
    const semanticState = writeResultSemanticState(result);

    return (
      <div className="mt-3 space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={semanticState.variant}>{semanticState.label}</Badge>
        </div>
        <p className="text-sm leading-6 text-slate-600">{semanticState.detail}</p>
        {result.warnings?.length ? (
          <div className="rounded border border-orange-100 bg-orange-50 px-3 py-2 text-xs leading-5 text-orange-800">
            Needs review before saving.
          </div>
        ) : null}
        {result.errors?.length ? (
          <div className="rounded border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-800">
            Save failed.
          </div>
        ) : null}
      </div>
    );
  }

  function renderSuggestedVaultUpdates(message: CMOChatMessage) {
    const candidates = message.suggestedVaultUpdates ?? [];

    if (message.role !== "assistant" || !candidates.length) {
      return null;
    }

    return (
      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-500">
            <icons.Database className="size-4" />
            Suggested Updates
          </div>
          <Badge variant="orange">draft</Badge>
          <Badge variant="slate">{candidates.length}</Badge>
        </div>
        <div className="grid gap-3">
          {candidates.map((candidate, index) => {
            const key = candidateKey(candidate) || `candidate_${index}`;
            const kind = recordString(candidate, ["kind", "type"]) || "vault_update";
            const subject = recordString(candidate, ["subject", "title", "name"]) || "Untitled update";
            const summary = recordString(candidate, ["summary", "statement", "description"]);
            const truthStatus = recordString(candidate, ["truth_status"]) || "draft";
            const reviewStatus = candidateStatus(candidate);
            const requiresApproval = candidate.requires_user_or_product_approval !== false;
            const isReviewed = reviewStatus === "approved" || reviewStatus === "rejected" || reviewStatus === "deferred";
            const isBusy = reviewingCandidateKey === key;
            const approvedEvent = reviewStatus === "approved" ? latestApprovedEventForCandidate(message, key, selectedSession) : null;
            const approvalId = recordString(approvedEvent ?? {}, ["approval_id"]);
            const dryRunResult = approvalId ? dryRunResultForApproval(message, approvalId, selectedSession) : null;
            const writeResult = approvalId ? writeResultForApproval(message, approvalId, selectedSession) : null;
            const dryRunBusy = Boolean(approvalId && dryRunningApprovalId === approvalId);
            const writeBusy = Boolean(approvalId && writingApprovalId === approvalId);
            const canWrite = canWriteVaultUpdate(approvalId, dryRunResult, writeResult);

            return (
              <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="slate">{kind}</Badge>
                      <Badge variant={statusVariant(reviewStatus)}>{reviewStatus}</Badge>
                      <Badge variant={truthStatus === "confirmed" ? "green" : "orange"}>{truthStatus}</Badge>
                      {requiresApproval ? <Badge variant="blue">needs_review</Badge> : null}
                    </div>
                    <div className="mt-2 break-words text-sm font-bold leading-6 text-slate-950">{subject}</div>
                    {summary ? <p className="mt-1 break-words text-sm leading-6 text-slate-600">{summary}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={isReviewed || Boolean(reviewingCandidateKey)} onClick={() => void reviewSuggestedVaultUpdate(candidate, "approved")}>
                      {isBusy ? <icons.RefreshCw className="animate-spin" /> : <icons.Check />}
                      Approve
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={isReviewed || Boolean(reviewingCandidateKey)} onClick={() => void reviewSuggestedVaultUpdate(candidate, "rejected")}>
                      <icons.X />
                      Reject
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={isReviewed || Boolean(reviewingCandidateKey)} onClick={() => void reviewSuggestedVaultUpdate(candidate, "deferred")}>
                      <icons.Clock3 />
                      Defer
                    </Button>
                    {approvalId ? (
                      <Button type="button" size="sm" variant="outline" disabled={Boolean(dryRunningApprovalId)} onClick={() => void previewVaultWrite(approvalId)}>
                        {dryRunBusy ? <icons.RefreshCw className="animate-spin" /> : <icons.Database />}
                        Preview Save
                      </Button>
                    ) : null}
                    {canWrite ? (
                      <Button type="button" size="sm" variant="outline" disabled={Boolean(writingApprovalId)} onClick={() => void writeVaultUpdate(approvalId)}>
                        {writeBusy ? <icons.RefreshCw className="animate-spin" /> : <icons.Check />}
                        Save Draft
                      </Button>
                    ) : null}
                  </div>
                </div>
                {renderDryRunResult({ result: dryRunResult, approvalId, writeResult, canWrite })}
                {renderWriteResult(writeResult)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div id="cmo-session" className="space-y-5">
      <Card
        className="relative overflow-hidden"
        onDragEnter={handleAttachmentDragEnter}
        onDragOver={handleAttachmentDragOver}
        onDragLeave={handleAttachmentDragLeave}
        onDrop={handleAttachmentDrop}
      >
        {isDragActive ? (
          <div className="pointer-events-none absolute inset-x-4 bottom-24 z-20 flex items-center justify-center rounded-lg border border-dashed border-indigo-300 bg-white/95 px-4 py-3 text-sm font-semibold text-indigo-700 shadow-lg shadow-indigo-950/10">
            <icons.Upload className="mr-2 size-4" />
            Drop files to attach
          </div>
        ) : null}
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
              <icons.MessageSquare />
            </div>
            <div>
              <CardTitle>CMO Chat</CardTitle>
              <CardDescription>{activeDisplaySessionId ? "Active CMO session" : `Active CMO session ready for ${app.name}`}</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge title={runtimeStatus ?? "not_checked"} variant={runtimeStatusVariant(runtimeStatus)}>{runtimeStatusLabel(runtimeStatus)}</Badge>
            <Badge variant={selectedQualitySummary.missingCount ? "orange" : "green"}>Using approved workspace context.</Badge>
            <Button variant="outline" size="sm" onClick={focusChat}>
              <icons.MessageSquare />
              Start CMO Session
            </Button>
          </div>
        </div>
        <div className="border-b border-slate-100 bg-white px-5 py-3 text-xs font-medium text-slate-500">
          Ask what this app should focus on next. Hermes uses workspace context automatically.
        </div>

        {visibleMessages.length && runtimeExplanation(runtimeStatus, runtimeErrorReason) ? (
          <div className={cn("border-b px-5 py-3 text-sm font-medium", runtimeStatus === "runtime_error" || runtimeStatus === "live_failed_then_fallback" ? "border-orange-100 bg-orange-50 text-orange-800" : "border-emerald-100 bg-emerald-50 text-emerald-800")}>
            {runtimeExplanation(runtimeStatus, runtimeErrorReason)}
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
                  <AttachmentCards attachments={message.attachments} tone={message.role === "user" ? "dark" : "light"} />
                  {message.role === "assistant" ? (
                    <CmoAgentActivityPanel
                      message={message}
                      running={pendingAssistantMessageId === message.id}
                      elapsedMs={pendingAssistantMessageId === message.id ? pendingElapsedMs : null}
                    />
                  ) : null}
                  {renderSuggestedVaultUpdates(message)}
                  {message.role === "assistant" && assistantProvenance(message) ? (
                    <div className="mt-4 border-t border-emerald-100 pt-3 text-xs font-semibold text-emerald-700">
                      {assistantProvenance(message)}
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
        {reviewStatusMessage ? <div className="border-t border-blue-100 bg-blue-50 px-5 py-3 text-sm font-medium text-blue-700">{reviewStatusMessage}</div> : null}
        {dryRunStatusMessage ? <div className="border-t border-blue-100 bg-blue-50 px-5 py-3 text-sm font-medium text-blue-700">{dryRunStatusMessage}</div> : null}
        {writeStatusMessage ? <div className="border-t border-emerald-100 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-700">{writeStatusMessage}</div> : null}
        {error ? <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm font-medium text-red-700">{error}</div> : null}

        <div className="border-t border-slate-100 bg-white p-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {[
                "What should I review next?",
                "Mark action 1 reviewed",
                "Save this session",
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
              onPaste={handleComposerPaste}
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
            <AttachmentCards
              attachments={pendingAttachments}
              onRemove={(attachmentId) =>
                setPendingAttachments((current) => current.filter((attachment) => attachment.attachment_id !== attachmentId))
              }
            />
            <div className="flex items-center justify-between gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept={CMO_ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(event) => void uploadAttachmentFiles(event.currentTarget.files)}
                disabled={isSending || isUploadingAttachment}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSending || isUploadingAttachment}
              >
                {isUploadingAttachment ? <icons.RefreshCw className="animate-spin" /> : <icons.Upload />}
                Attach
              </Button>
              <Button className="ml-auto" onClick={() => void sendMessage()} disabled={(!input.trim() && !pendingAttachments.length) || isSending || isUploadingAttachment}>
                {isSending ? <icons.RefreshCw className="animate-spin" /> : <icons.Send />}
                Send
              </Button>
            </div>
          </div>
        </div>
      </Card>

    </div>
  );
}
