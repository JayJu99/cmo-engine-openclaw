"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardDescription } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import type { AppMemoryNoteKey, PromotionCandidate, PromotionCandidateStatus, PromotionResponse } from "@/lib/cmo/app-workspace-types";

const targetOptions: Array<{ key: AppMemoryNoteKey; label: string }> = [
  { key: "positioning", label: "Positioning" },
  { key: "audience", label: "Audience" },
  { key: "product", label: "Product Notes" },
  { key: "content", label: "Content Notes" },
  { key: "learnings", label: "Learnings" },
  { key: "decisions", label: "Decisions" },
  { key: "tasks", label: "Tasks" },
];

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const record = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
    const message = typeof record?.error === "string" ? record.error : "Request failed";

    throw new Error(`${response.status} ${message}`);
  }

  return payload as T;
}

function sourceLabel(value: PromotionCandidate["sourceType"]): string {
  if (value === "cmo-session") {
    return "CMO Session";
  }

  if (value === "raw-capture") {
    return "Raw Capture";
  }

  return "Daily Note";
}

function statusVariant(status: PromotionCandidateStatus): "green" | "orange" | "slate" {
  if (status === "promoted") {
    return "green";
  }

  if (status === "skipped") {
    return "slate";
  }

  return "orange";
}

function targetLabel(noteKey: AppMemoryNoteKey): string {
  return targetOptions.find((option) => option.key === noteKey)?.label ?? noteKey;
}

export function PromotionCandidatesSection({
  appId,
  refreshSignal,
  onPromoted,
}: {
  appId: string;
  refreshSignal: number;
  onPromoted: () => Promise<void> | void;
}) {
  const [candidates, setCandidates] = useState<PromotionCandidate[]>([]);
  const [targets, setTargets] = useState<Record<string, AppMemoryNoteKey>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [localStatus, setLocalStatus] = useState<Record<string, PromotionCandidateStatus>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshCandidates() {
    setIsLoading(true);

    try {
      const payload = await readJsonResponse<{ data: PromotionCandidate[] }>(
        await fetch(`/api/apps/${appId}/promotion-candidates`, { cache: "no-store" }),
      );

      setCandidates(payload.data);
      setTargets((current) => {
        const next = { ...current };

        payload.data.forEach((candidate) => {
          next[candidate.id] = next[candidate.id] ?? candidate.suggestedTargetNoteKey;
        });

        return next;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Promotion candidates load failed");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function loadCandidates() {
      try {
        const payload = await readJsonResponse<{ data: PromotionCandidate[] }>(
          await fetch(`/api/apps/${appId}/promotion-candidates`, { cache: "no-store" }),
        );

        if (!mounted) {
          return;
        }

        setCandidates(payload.data);
        setTargets((current) => {
          const next = { ...current };

          payload.data.forEach((candidate) => {
            next[candidate.id] = next[candidate.id] ?? candidate.suggestedTargetNoteKey;
          });

          return next;
        });
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Promotion candidates load failed");
        }
      }
    }

    void loadCandidates();

    return () => {
      mounted = false;
    };
  }, [appId, refreshSignal]);

  const visibleCandidates = useMemo(
    () =>
      candidates.map((candidate) => ({
        ...candidate,
        status: localStatus[candidate.id] ?? candidate.status,
      })),
    [candidates, localStatus],
  );

  async function promote(candidate: PromotionCandidate) {
    const targetNoteKey = targets[candidate.id] ?? candidate.suggestedTargetNoteKey;

    setPromotingId(candidate.id);
    setMessage("Promoting to App Memory...");
    setError(null);

    try {
      const response = await readJsonResponse<PromotionResponse>(
        await fetch(`/api/apps/${appId}/promotions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            candidateId: candidate.id,
            targetNoteKey,
            summary: candidate.summary,
            sourcePath: candidate.sourcePath,
            sourceType: candidate.sourceType,
            status: "draft",
            topic: candidate.topic,
            context: candidate.context,
          }),
        }),
      );

      setLocalStatus((current) => ({ ...current, [candidate.id]: "promoted" }));
      setMessage(`Promoted to App Memory: ${response.targetPath}`);
      await refreshCandidates();
      await onPromoted();
    } catch (promoteError) {
      setMessage(null);
      setError(`Failed: ${promoteError instanceof Error ? promoteError.message : "Promotion failed"}`);
    } finally {
      setPromotingId(null);
    }
  }

  function skip(candidateId: string) {
    setLocalStatus((current) => ({ ...current, [candidateId]: "skipped" }));
  }

  return (
    <div id="promotion-candidates" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardDescription>
            Review deterministic candidates from recent sessions, raw captures, and daily notes. Promotions append draft memory only.
          </CardDescription>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void refreshCandidates()} disabled={isLoading}>
          {isLoading ? <icons.RefreshCw className="animate-spin" /> : <icons.RefreshCw />}
          Refresh
        </Button>
      </div>

      {visibleCandidates.length ? (
        <div className="space-y-3">
          {visibleCandidates.slice(0, 10).map((candidate) => (
            <div key={candidate.id} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="slate">{sourceLabel(candidate.sourceType)}</Badge>
                    <Badge variant={statusVariant(candidate.status)}>{candidate.status}</Badge>
                    <Badge variant="blue">{targetLabel(targets[candidate.id] ?? candidate.suggestedTargetNoteKey)}</Badge>
                  </div>
                  <div className="mt-2 font-bold text-slate-950">{candidate.topic}</div>
                  <div className="mt-1 break-all text-xs font-medium text-slate-500">{candidate.sourcePath}</div>
                </div>
                <select
                  value={targets[candidate.id] ?? candidate.suggestedTargetNoteKey}
                  onChange={(event) =>
                    setTargets((current) => ({
                      ...current,
                      [candidate.id]: event.target.value as AppMemoryNoteKey,
                    }))
                  }
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                  disabled={candidate.status === "promoted"}
                >
                  {targetOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-700">{candidate.summary}</p>
              {expanded[candidate.id] ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-600">
                  <div className="font-bold text-slate-950">Evidence / Context</div>
                  <div className="mt-1 whitespace-pre-wrap">{candidate.context || "No extra context captured."}</div>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void promote(candidate)}
                  disabled={candidate.status === "promoted" || promotingId === candidate.id}
                >
                  {promotingId === candidate.id ? <icons.RefreshCw className="animate-spin" /> : <icons.Sparkles />}
                  Promote to App Memory
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => skip(candidate.id)} disabled={candidate.status === "promoted"}>
                  Skip
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setExpanded((current) => ({ ...current, [candidate.id]: !current[candidate.id] }))}
                >
                  <icons.Eye />
                  View Source
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-500">
          No promotion candidates yet. Save or capture a CMO session first.
        </div>
      )}

      {message ? <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}
    </div>
  );
}
