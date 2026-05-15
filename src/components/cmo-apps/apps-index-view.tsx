"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import type { AppWorkspace } from "@/lib/cmo/app-workspace-types";

export function AppsIndexView({ apps }: { apps: AppWorkspace[] }) {
  return (
    <PageChrome
      title="Apps"
      description="Choose the app context before opening a CMO session."
      actions={
        <Button asChild>
          <Link href={`/apps/${apps[0]?.slug ?? "holdstation-mini-app"}`}>
            <icons.Rocket />
            Open App Workspace
          </Link>
        </Button>
      }
    >
      <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
        {apps.map((app) => (
          <Card key={app.id} className="p-6 transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-[0_24px_70px_rgba(15,23,42,0.1)]">
            <div className="flex items-start justify-between gap-4">
              <div className="grid size-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
                <icons.Package />
              </div>
              <Badge variant={app.stage === "Active" ? "green" : "slate"}>{app.stage || "Unknown"}</Badge>
            </div>
            <h2 className="mt-6 text-xl font-bold text-slate-950">{app.name}</h2>
            <p className="mt-2 text-sm font-medium text-slate-500">{app.group}</p>
            <p className="mt-4 min-h-12 text-sm leading-6 text-slate-600">{app.currentMission || "No current mission found yet."}</p>
            <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase text-slate-400">Vault path</div>
              <div className="mt-1 break-all text-sm font-medium text-slate-600">{app.vaultPath}</div>
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-slate-500">Last updated: {app.lastUpdated || "Unknown"}</div>
              <Button asChild size="sm">
                <Link href={`/apps/${app.slug}`}>
                  Open Workspace
                  <icons.ChevronRight />
                </Link>
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </PageChrome>
  );
}
