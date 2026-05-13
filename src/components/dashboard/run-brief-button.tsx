"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { icons } from "@/components/dashboard/icons";

type TerminalRunStatus = "completed" | "failed" | "partial" | "timeout";
type RunBriefState = "idle" | "starting" | "running" | "success" | "warning" | "error";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLLING_MS = 15 * 60 * 1_000;
const TERMINAL_STATUSES = new Set<TerminalRunStatus>(["completed", "failed", "partial", "timeout"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFromPayload(payload: unknown, fallback: string) {
  if (isRecord(payload)) {
    const message = payload.error ?? payload.message;

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text) as unknown;
}

async function requestLocalCmo(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(messageFromPayload(payload, "CMO run request failed"));
  }

  return payload;
}

function getRunId(payload: unknown) {
  if (!isRecord(payload) || typeof payload.run_id !== "string" || !payload.run_id.trim()) {
    throw new Error("CMO run did not return a run ID");
  }

  return payload.run_id;
}

function getRunStatus(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.status !== "string") {
    return "";
  }

  return payload.status.toLowerCase();
}

function isTerminalStatus(status: string): status is TerminalRunStatus {
  return TERMINAL_STATUSES.has(status as TerminalRunStatus);
}

function warningMessage(status: TerminalRunStatus) {
  if (status === "partial") {
    return "Brief finished with partial data. Previous dashboard data is still visible.";
  }

  if (status === "timeout") {
    return "Brief timed out. Previous dashboard data is still visible.";
  }

  return "Brief run failed. Previous dashboard data is still visible.";
}

export function RunBriefButton({
  maxPollingMs = DEFAULT_MAX_POLLING_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: {
  maxPollingMs?: number;
  pollIntervalMs?: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<RunBriefState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function clearPolling() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  function stopRequest() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  useEffect(() => {
    return () => {
      clearPolling();
      stopRequest();
    };
  }, []);

  async function pollRun(runId: string, startedAt: number, signal: AbortSignal) {
    if (Date.now() - startedAt >= maxPollingMs) {
      clearPolling();
      abortRef.current = null;
      setState("warning");
      setMessage("Brief polling timed out after 15 minutes. Previous dashboard data is still visible.");
      return;
    }

    try {
      const payload = await requestLocalCmo(`/api/cmo/runs/${encodeURIComponent(runId)}`, { signal });
      const status = getRunStatus(payload);

      if (isTerminalStatus(status)) {
        clearPolling();
        abortRef.current = null;

        if (status === "completed") {
          setState("success");
          setMessage("Brief completed. Dashboard updated.");
          router.refresh();
          return;
        }

        setState("warning");
        setMessage(warningMessage(status));
        return;
      }

      setState("running");
      setMessage("Brief is running. Checking every 5 seconds.");
      timeoutRef.current = setTimeout(() => void pollRun(runId, startedAt, signal), pollIntervalMs);
    } catch (error) {
      if (signal.aborted) {
        return;
      }

      clearPolling();
      abortRef.current = null;
      setState("error");
      setMessage(error instanceof Error ? error.message : "Unable to check CMO run status");
    }
  }

  async function handleRunBrief() {
    clearPolling();
    stopRequest();

    const controller = new AbortController();
    abortRef.current = controller;
    setState("starting");
    setMessage("Starting CMO brief...");

    try {
      const payload = await requestLocalCmo("/api/cmo/run-brief", {
        method: "POST",
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      const runId = getRunId(payload);
      const status = getRunStatus(payload);
      const startedAt = Date.now();

      setState("running");
      setMessage("Brief is running. Checking every 5 seconds.");

      if (isTerminalStatus(status)) {
        await pollRun(runId, startedAt, controller.signal);
        return;
      }

      timeoutRef.current = setTimeout(() => void pollRun(runId, startedAt, controller.signal), pollIntervalMs);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      abortRef.current = null;
      setState("error");
      setMessage(error instanceof Error ? error.message : "Unable to start CMO brief");
    }
  }

  const isRunning = state === "starting" || state === "running";
  const Icon = isRunning ? icons.RefreshCw : state === "success" ? icons.CheckCircle2 : state === "warning" || state === "error" ? icons.AlertTriangle : icons.Play;
  const label = state === "starting" ? "Starting..." : state === "running" ? "Running..." : "Run Brief";
  const messageClassName =
    state === "success"
      ? "text-emerald-600"
      : state === "warning" || state === "error"
        ? "text-orange-600"
        : "text-slate-500";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => void handleRunBrief()} disabled={isRunning} aria-busy={isRunning}>
        <Icon className={isRunning ? "animate-spin" : undefined} />
        {label}
      </Button>
      {message ? (
        <span className={`max-w-64 text-xs font-semibold leading-5 ${messageClassName}`} role="status" aria-live="polite">
          {message}
        </span>
      ) : null}
    </div>
  );
}
