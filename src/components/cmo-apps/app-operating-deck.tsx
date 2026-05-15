"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import type { AppDashboardSnapshot } from "@/lib/cmo/app-workspace-types";
import type { AppWorkspace, CMOContextQuality, VaultNoteRef } from "@/lib/cmo/app-workspace-types";
import type { RawCaptureEntry } from "@/lib/cmo/vault-files";

function EmptyCopy({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-500">
      {children}
    </div>
  );
}

function DeckSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
          {icon}
        </div>
        <CardTitle>{title}</CardTitle>
      </div>
      {children}
    </Card>
  );
}

function noteByTitle(notes: VaultNoteRef[], title: string): VaultNoteRef | undefined {
  return notes.find((note) => note.title === title);
}

function qualityVariant(quality: CMOContextQuality | undefined): "green" | "orange" | "blue" | "slate" {
  if (quality === "confirmed") {
    return "green";
  }

  if (quality === "draft") {
    return "blue";
  }

  if (quality === "placeholder") {
    return "orange";
  }

  return "slate";
}

function NotePreview({ note }: { note: VaultNoteRef | undefined }) {
  if (!note?.exists) {
    return <EmptyCopy>No app note found yet.</EmptyCopy>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge variant="green">File exists</Badge>
        <Badge variant={qualityVariant(note.contextQuality)}>{note.contextQuality ?? "draft"}</Badge>
        {note.frontmatterStatus ? <Badge variant="slate">status: {note.frontmatterStatus}</Badge> : null}
      </div>
      <p className="text-sm leading-6 text-slate-600">{note.contentPreview || "This note exists but has no readable preview yet."}</p>
      {note.qualityReason ? <p className="text-xs font-medium text-slate-500">{note.qualityReason}</p> : null}
      <p className="break-all text-xs font-medium text-slate-400">{note.path}</p>
    </div>
  );
}

function qualityLabel(quality: CMOContextQuality | undefined): string {
  if (quality === "placeholder") {
    return "Needs content";
  }

  if (quality === "draft") {
    return "Draft memory";
  }

  if (quality === "confirmed") {
    return "Confirmed memory";
  }

  return "Missing";
}

export function AppOperatingDeck({
  app,
  notes,
  recentCaptures,
  dailyNotePath,
  dailyNoteExists,
  latestPromotion,
}: {
  app: AppWorkspace;
  notes: VaultNoteRef[];
  recentCaptures: RawCaptureEntry[];
  dailyNotePath: string;
  dailyNoteExists: boolean;
  latestPromotion?: AppDashboardSnapshot["latestPromotion"];
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-950">App Memory Snapshot</h2>
          <p className="mt-1 text-sm text-slate-500">Read-only app memory notes selected for CMO context.</p>
        </div>
        <Badge variant="slate">Phase 1.7</Badge>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <DeckSection title="Memory Note Status" icon={<icons.Database />}>
          <div className="space-y-3">
            {notes.map((note) => (
              <div key={note.path} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold text-slate-950">{note.title}</div>
                  <Badge variant={qualityVariant(note.contextQuality)}>{qualityLabel(note.contextQuality)}</Badge>
                </div>
                <div className="mt-1 break-all text-xs font-medium text-slate-500">{note.path}</div>
              </div>
            ))}
          </div>
        </DeckSection>

        <DeckSection title="Latest Promoted Item" icon={<icons.Sparkles />}>
          {latestPromotion ? (
            <div className="space-y-3">
              <div className="font-bold text-slate-950">{latestPromotion.title}</div>
              {latestPromotion.promotedAt ? <Badge variant="blue">{latestPromotion.promotedAt}</Badge> : null}
              {latestPromotion.sourcePath ? <p className="break-all text-xs font-medium text-slate-500">Source: {latestPromotion.sourcePath}</p> : null}
              <p className="break-all text-xs font-medium text-slate-500">Target: {latestPromotion.targetPath}</p>
            </div>
          ) : (
            <EmptyCopy>No promoted App Memory item yet.</EmptyCopy>
          )}
        </DeckSection>

        <DeckSection title="App Snapshot" icon={<icons.Target />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">One-liner</div>
              <p className="mt-2 text-sm leading-6 text-slate-700">{app.oneLiner || "No app snapshot found yet."}</p>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Stage</div>
              <p className="mt-2 text-sm font-bold text-slate-950">{app.stage || "Unknown"}</p>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Current Goal</div>
              <p className="mt-2 text-sm leading-6 text-slate-700">{app.currentGoal || app.currentMission || "No current goal found yet."}</p>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Current Bottleneck</div>
              <p className="mt-2 text-sm leading-6 text-slate-700">{app.currentBottleneck || "No bottleneck captured yet."}</p>
            </div>
          </div>
        </DeckSection>

        <DeckSection title="Recent Raw Captures" icon={<icons.Clock3 />}>
          {recentCaptures.length ? (
            <div className="space-y-3">
              {recentCaptures.slice(0, 4).map((capture, index) => (
                <div key={`${capture.topic}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="font-bold text-slate-950">{capture.topic}</div>
                  <div className="mt-1 text-xs font-medium text-slate-500">{capture.timestamp || "Captured today"}</div>
                  {capture.summary ? <CardDescription className="mt-2">{capture.summary}</CardDescription> : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyCopy>No raw captures for this app today.</EmptyCopy>
          )}
        </DeckSection>

        <DeckSection title="Positioning" icon={<icons.Sparkles />}>
          <NotePreview note={noteByTitle(notes, "Positioning")} />
        </DeckSection>

        <DeckSection title="Audience" icon={<icons.Users />}>
          <NotePreview note={noteByTitle(notes, "Audience")} />
        </DeckSection>

        <DeckSection title="Product Notes" icon={<icons.Package />}>
          <NotePreview note={noteByTitle(notes, "Product Notes")} />
        </DeckSection>

        <DeckSection title="Content Notes" icon={<icons.PencilLine />}>
          <NotePreview note={noteByTitle(notes, "Content Notes")} />
        </DeckSection>
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Daily Note Link</CardTitle>
            <CardDescription className="mt-1 break-all">{dailyNotePath}</CardDescription>
          </div>
          <Badge variant={dailyNoteExists ? "green" : "slate"}>{dailyNoteExists ? "Generated" : "Not generated"}</Badge>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-orange-50 text-orange-700 ring-1 ring-orange-100">
            <icons.HelpCircle />
          </div>
          <div>
            <CardTitle>Open Questions</CardTitle>
            <CardDescription className="mt-1">Questions from chat captures will stay in Raw Vault during Phase 1.</CardDescription>
          </div>
        </div>
      </Card>
    </div>
  );
}
