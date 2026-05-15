"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import type { CMOContextQuality } from "@/lib/cmo/app-workspace-types";
import type { VaultVisibilityState } from "@/lib/cmo/vault-files";

function qualityVariant(quality: CMOContextQuality | undefined, exists: boolean | undefined): "green" | "orange" | "blue" | "slate" {
  if (exists === false || quality === "missing") {
    return "slate";
  }

  if (quality === "confirmed") {
    return "green";
  }

  if (quality === "draft") {
    return "blue";
  }

  return "orange";
}

export function VaultVisibilityView({ state }: { state: VaultVisibilityState }) {
  return (
    <PageChrome
      title="Vault"
      description="Minimal Phase 1 visibility for Raw Vault, Daily Notes, and selected app note paths."
      actions={
        <>
          <Button asChild>
            <Link href="/daily">
              <icons.FileText />
              Daily Notes
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/apps">
              <icons.Grid2X2 />
              Apps
            </Link>
          </Button>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Raw Capture Note</CardTitle>
              <CardDescription className="mt-1 break-all">{state.rawPath}</CardDescription>
            </div>
            <Badge variant={state.rawExists ? "green" : "slate"}>{state.rawExists ? "Exists" : "Missing"}</Badge>
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-600">
            Raw CMO chat/session capture appends here for {state.date}.
          </p>
        </Card>

        <Card className="p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Daily Note</CardTitle>
              <CardDescription className="mt-1 break-all">{state.dailyPath}</CardDescription>
            </div>
            <Badge variant={state.dailyExists ? "green" : "orange"}>{state.dailyExists ? "Exists" : "Missing"}</Badge>
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-600">
            Daily Note generation reads today&apos;s Raw Vault capture and creates a readable daily review.
          </p>
        </Card>
      </div>

      <Card className="p-7">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <CardTitle>Selected App Vault Note Paths</CardTitle>
            <CardDescription>Phase 1 checks known app note paths only. It does not claim all-vault semantic retrieval.</CardDescription>
          </div>
          <Badge variant="slate">{state.appNotes.length} apps</Badge>
        </div>

        <div className="space-y-5">
          {state.appNotes.map(({ app, notes }) => (
            <div key={app.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-bold text-slate-950">{app.name}</div>
                  <div className="mt-1 text-xs font-medium text-slate-500">{app.vaultPath}</div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/apps/${app.slug}`}>
                    Open Workspace
                    <icons.ChevronRight />
                  </Link>
                </Button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {notes.map((note) => (
                  <div key={note.id} className="rounded-xl border border-slate-100 bg-white px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{note.title}</div>
                        <div className="mt-1 break-all text-xs font-medium text-slate-500">{note.path}</div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Badge variant={note.exists ? "green" : "slate"}>{note.exists ? "Exists" : "Missing"}</Badge>
                        <Badge variant={qualityVariant(note.contextQuality, note.exists)}>{note.contextQuality ?? "draft"}</Badge>
                      </div>
                    </div>
                    {note.qualityReason ? <CardDescription className="mt-2">{note.qualityReason}</CardDescription> : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </PageChrome>
  );
}
