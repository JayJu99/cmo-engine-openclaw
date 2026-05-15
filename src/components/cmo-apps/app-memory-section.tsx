"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardDescription } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import type { AppMemoryNoteDetail, AppMemoryNoteKey, AppMemoryNoteSummary, CMOContextQuality } from "@/lib/cmo/app-workspace-types";
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

function qualityVariant(quality: CMOContextQuality | undefined): "green" | "orange" | "blue" | "red" | "slate" {
  if (quality === "confirmed") {
    return "green";
  }

  if (quality === "draft") {
    return "blue";
  }

  if (quality === "placeholder") {
    return "orange";
  }

  if (quality === "missing") {
    return "red";
  }

  return "slate";
}

function statusLabel(status: CMOContextQuality): string {
  if (status === "placeholder") {
    return "Needs content";
  }

  if (status === "draft") {
    return "Draft memory";
  }

  if (status === "confirmed") {
    return "Confirmed memory";
  }

  return "Missing";
}

function displayDate(value: string | undefined): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function AppMemorySection({
  appId,
  refreshSignal,
  onChanged,
}: {
  appId: string;
  refreshSignal: number;
  onChanged: () => Promise<void> | void;
}) {
  const [notes, setNotes] = useState<AppMemoryNoteSummary[]>([]);
  const [activeKey, setActiveKey] = useState<AppMemoryNoteKey | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [detail, setDetail] = useState<AppMemoryNoteDetail | null>(null);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<CMOContextQuality>("draft");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshNotes() {
    const payload = await readJsonResponse<{ data: AppMemoryNoteSummary[] }>(
      await fetch(`/api/apps/${appId}/memory`, { cache: "no-store" }),
    );
    setNotes(payload.data);
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const payload = await readJsonResponse<{ data: AppMemoryNoteSummary[] }>(
          await fetch(`/api/apps/${appId}/memory`, { cache: "no-store" }),
        );

        if (mounted) {
          setNotes(payload.data);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "App memory load failed");
        }
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [appId, refreshSignal]);

  async function openNote(noteKey: AppMemoryNoteKey, nextMode: "view" | "edit") {
    setIsLoading(true);
    setError(null);
    setMessage(null);

    try {
      const payload = await readJsonResponse<{ data: AppMemoryNoteDetail }>(
        await fetch(`/api/apps/${appId}/memory/${noteKey}`, { cache: "no-store" }),
      );

      setActiveKey(noteKey);
      setDetail(payload.data);
      setBody(payload.data.body);
      setStatus(payload.data.status === "missing" ? "draft" : payload.data.status);
      setMode(payload.data.editable ? nextMode : "view");
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "App memory note load failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function patchNote(noteKey: AppMemoryNoteKey, payload: Record<string, unknown>) {
    const response = await readJsonResponse<{ data: AppMemoryNoteDetail }>(
      await fetch(`/api/apps/${appId}/memory/${noteKey}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
    );

    setDetail(response.data);
    setBody(response.data.body);
    setStatus(response.data.status === "missing" ? "draft" : response.data.status);
    await refreshNotes();
    await onChanged();

    return response.data;
  }

  async function saveDetail() {
    if (!detail || isSaving) {
      return;
    }

    setIsSaving(true);
    setMessage("Saving...");
    setError(null);

    try {
      const saved = await patchNote(detail.noteKey, {
        body,
        status,
        expectedHash: detail.hash,
      });

      setMessage(`Saved at ${displayDate(new Date().toISOString())}: ${saved.path}`);
    } catch (saveError) {
      setMessage(null);
      setError(`Failed: ${saveError instanceof Error ? saveError.message : "App memory save failed"}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function markStatus(note: AppMemoryNoteSummary, nextStatus: CMOContextQuality) {
    setIsSaving(true);
    setMessage("Saving...");
    setError(null);

    try {
      const payload = await readJsonResponse<{ data: AppMemoryNoteDetail }>(
        await fetch(`/api/apps/${appId}/memory/${note.noteKey}`, { cache: "no-store" }),
      );
      const saved = await patchNote(note.noteKey, {
        status: nextStatus,
        expectedHash: payload.data.hash,
      });

      setActiveKey(note.noteKey);
      setMode("view");
      setMessage(`Saved at ${displayDate(new Date().toISOString())}: ${saved.path}`);
    } catch (markError) {
      setMessage(null);
      setError(`Failed: ${markError instanceof Error ? markError.message : "Status update failed"}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function resetToPlaceholder(note: AppMemoryNoteSummary) {
    if (!window.confirm(`Reset ${note.title} to the placeholder template? This replaces the note body.`)) {
      return;
    }

    setIsSaving(true);
    setMessage("Saving...");
    setError(null);

    try {
      const payload = await readJsonResponse<{ data: AppMemoryNoteDetail }>(
        await fetch(`/api/apps/${appId}/memory/${note.noteKey}`, { cache: "no-store" }),
      );
      const saved = await patchNote(note.noteKey, {
        status: "placeholder",
        resetToPlaceholder: true,
        expectedHash: payload.data.hash,
      });

      setActiveKey(note.noteKey);
      setMode("view");
      setMessage(`Saved at ${displayDate(new Date().toISOString())}: ${saved.path}`);
    } catch (resetError) {
      setMessage(null);
      setError(`Failed: ${resetError instanceof Error ? resetError.message : "Reset failed"}`);
    } finally {
      setIsSaving(false);
    }
  }

  function useTemplate() {
    if (!detail) {
      return;
    }

    setBody(detail.suggestedBody);
    setStatus("draft");
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {notes.map((note) => (
          <div
            key={note.noteKey}
            className={cn(
              "rounded-xl border px-4 py-3 transition",
              activeKey === note.noteKey ? "border-indigo-200 bg-indigo-50/70" : "border-slate-100 bg-slate-50",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-slate-950">{note.title}</div>
                <div className="mt-1 break-all text-xs font-medium text-slate-500">{note.path}</div>
              </div>
              <Badge variant={note.exists ? "green" : "red"}>{note.exists ? "File exists" : "Missing"}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant={qualityVariant(note.status)}>{statusLabel(note.status)}</Badge>
              <Badge variant="slate">status: {note.frontmatterStatus ?? note.status}</Badge>
              <Badge variant={qualityVariant(note.contextQuality)}>quality: {note.contextQuality}</Badge>
              <Badge variant="slate">updated: {displayDate(note.updatedAt)}</Badge>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{note.preview || "No readable preview yet."}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void openNote(note.noteKey, "view")} disabled={isLoading}>
                <icons.Eye />
                View
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void openNote(note.noteKey, "edit")}
                disabled={isLoading || !note.editable}
                title={note.editable ? undefined : `${note.title} is read-mostly in Phase 1.7.`}
              >
                <icons.PencilLine />
                Edit
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void markStatus(note, "draft")} disabled={isSaving}>
                Mark Draft
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void markStatus(note, "confirmed")} disabled={isSaving}>
                Mark Confirmed
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void resetToPlaceholder(note)} disabled={isSaving}>
                Reset
              </Button>
            </div>
          </div>
        ))}
      </div>

      {detail ? (
        <div className="rounded-xl border border-slate-100 bg-white px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-bold text-slate-950">{mode === "edit" ? `Edit ${detail.title}` : detail.title}</div>
                <Badge variant={qualityVariant(detail.status)}>{statusLabel(detail.status)}</Badge>
                {!detail.editable ? <Badge variant="orange">read-mostly</Badge> : null}
              </div>
              <CardDescription className="mt-1 break-all">{detail.path}</CardDescription>
              {!detail.editable ? (
                <p className="mt-2 text-xs font-medium text-slate-500">
                  {detail.noteKey === "decisions"
                    ? "Decision Locking comes in Phase 2. Promotion can add decision candidates only."
                    : "Task Tracker is the source of truth when connected. Promotion can add task candidates only."}
                </p>
              ) : null}
            </div>
            {detail.editable ? (
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as CMOContextQuality)}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                disabled={mode !== "edit" || isSaving}
              >
                <option value="placeholder">placeholder</option>
                <option value="draft">draft</option>
                <option value="confirmed">confirmed</option>
              </select>
            ) : null}
          </div>

          {mode === "edit" && detail.editable ? (
            <div className="mt-4 space-y-3">
              {detail.status === "placeholder" ? (
                <Button type="button" size="sm" variant="outline" onClick={useTemplate}>
                  <icons.FileText />
                  Use structured template
                </Button>
              ) : null}
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-80 w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm leading-6 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
              />
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={() => void saveDetail()} disabled={isSaving}>
                  {isSaving ? <icons.RefreshCw className="animate-spin" /> : <icons.Check />}
                  Save Memory
                </Button>
                <Button type="button" variant="outline" onClick={() => setMode("view")} disabled={isSaving}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <pre className="mt-4 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
              {detail.body || "No body content yet."}
            </pre>
          )}
        </div>
      ) : null}

      {message ? <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}
    </div>
  );
}
