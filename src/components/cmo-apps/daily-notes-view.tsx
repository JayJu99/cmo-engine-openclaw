"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import type { DailyNoteGenerateResponse } from "@/lib/cmo/app-workspace-types";
import type { DailyNotesState } from "@/lib/cmo/vault-files";

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const record = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
    const message = typeof record?.error === "string" ? record.error : "Request failed";

    throw new Error(message);
  }

  return payload as T;
}

export function DailyNotesView({ state }: { state: DailyNotesState }) {
  const [dailyExists, setDailyExists] = useState(state.dailyExists);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generateDailyNote() {
    if (!state.rawExists || dailyExists || isGenerating) {
      return;
    }

    setIsGenerating(true);
    setStatus(null);
    setError(null);

    try {
      const response = await readJsonResponse<DailyNoteGenerateResponse>(
        await fetch("/api/vault/daily-notes/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId: "holdstation",
            date: state.date,
            sourceRawPath: state.rawPath,
          }),
        }),
      );

      setDailyExists(true);
      setStatus(`Generated ${response.path} from raw captures.`);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Daily note generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <PageChrome
      title="Daily Notes"
      description={`Daily Review for ${state.date}`}
      actions={
        <>
          <Button onClick={() => void generateDailyNote()} disabled={!state.rawExists || dailyExists || isGenerating}>
            {isGenerating ? <icons.RefreshCw className="animate-spin" /> : <icons.FileText />}
            Generate Daily Note
          </Button>
          <Button asChild variant="outline">
            <Link href="/vault">
              <icons.Package />
              Vault Visibility
            </Link>
          </Button>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Today&apos;s Raw Captures</CardTitle>
              <CardDescription className="mt-1 break-all">{state.rawPath}</CardDescription>
            </div>
            <Badge variant={state.rawExists ? "green" : "slate"}>{state.rawExists ? `${state.captures.length} captured` : "Missing"}</Badge>
          </div>

          <div className="mt-6 space-y-4">
            {state.captures.length ? (
              state.captures.map((capture, index) => (
                <div key={`${capture.appName}-${capture.topic}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-slate-950">{capture.topic}</div>
                      <div className="mt-1 text-sm font-medium text-slate-500">{capture.appName}</div>
                    </div>
                    <Badge variant="slate">Raw</Badge>
                  </div>
                  {capture.summary ? <CardDescription className="mt-3">{capture.summary}</CardDescription> : null}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-xl bg-white text-slate-500 ring-1 ring-slate-200">
                  <icons.Database />
                </div>
                <CardTitle className="mt-4">No raw captures for today</CardTitle>
                <CardDescription className="mt-2">Capture a CMO session from an App Workspace first.</CardDescription>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Daily Note Generation</CardTitle>
              <CardDescription className="mt-1 break-all">{state.dailyPath}</CardDescription>
            </div>
            <Badge variant={dailyExists ? "green" : state.rawExists ? "orange" : "slate"}>{dailyExists ? "Exists" : state.rawExists ? "Ready" : "Waiting"}</Badge>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 p-5">
            {dailyExists ? (
              <div>
                <div className="font-bold text-slate-950">Daily note already exists</div>
                <CardDescription className="mt-2">Phase 1 will not overwrite an existing Daily Note silently.</CardDescription>
              </div>
            ) : state.rawExists ? (
              <div>
                <div className="font-bold text-slate-950">Ready to generate</div>
                <CardDescription className="mt-2">
                  The generated note uses a deterministic summary from raw capture headings and session summaries.
                </CardDescription>
              </div>
            ) : (
              <div>
                <div className="font-bold text-slate-950">Waiting for raw captures</div>
                <CardDescription className="mt-2">No raw capture note exists for today.</CardDescription>
              </div>
            )}
          </div>

          {status ? <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{status}</div> : null}
          {error ? <div className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Button onClick={() => void generateDailyNote()} disabled={!state.rawExists || dailyExists || isGenerating}>
              {isGenerating ? <icons.RefreshCw className="animate-spin" /> : <icons.FileText />}
              Generate Daily Note
            </Button>
            <Button asChild variant="outline">
              <Link href="/apps">
                <icons.Grid2X2 />
                Open Apps
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </PageChrome>
  );
}
