"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import type { CommandCenterState } from "@/lib/cmo/vault-files";

function displayDate(value: string): string {
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

export function CommandCenterView({ state }: { state: CommandCenterState }) {
  const hasRawCaptures = state.rawCaptureCount > 0;
  const firstAppHref = `/apps/${state.apps[0]?.slug ?? "holdstation-mini-app"}`;

  return (
    <PageChrome
      title="Command Center"
      description={`Workspace: Holdstation | Daily Review: ${state.date}`}
      actions={
        <>
          <Button asChild>
            <Link href={firstAppHref}>
              <icons.Rocket />
              Open App Workspace
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`${firstAppHref}#cmo-session`}>
              <icons.MessageSquare />
              Start CMO Session
            </Link>
          </Button>
        </>
      }
    >
      <div className="grid gap-6 2xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="glass-panel p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Badge>Today&apos;s Focus</Badge>
              <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-950">App-centric CMO workspace</h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                {state.recentSessions.length
                  ? "Continue from the latest app-specific CMO session and capture useful context into Raw Vault."
                  : "Choose an app and start a CMO session."}
              </p>
            </div>
            <div className="hidden size-24 place-items-center rounded-3xl bg-white text-indigo-700 shadow-[inset_0_0_0_12px_rgba(99,102,241,0.07)] ring-1 ring-indigo-100 sm:grid">
              <icons.Target className="size-10" />
            </div>
          </div>
        </Card>

        <Card className="p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Raw Vault Captures Today</CardTitle>
              <CardDescription className="mt-1 break-all">{state.rawPath}</CardDescription>
            </div>
            <Badge variant={hasRawCaptures ? "green" : "slate"}>{hasRawCaptures ? `${state.rawCaptureCount} captured` : "None yet"}</Badge>
          </div>
          <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-950">Daily Note</div>
                <div className="mt-1 break-all text-xs font-medium text-slate-500">{state.dailyPath}</div>
              </div>
              <Badge variant={state.dailyExists ? "green" : "orange"}>{state.dailyExists ? "Generated" : "Draft missing"}</Badge>
            </div>
          </div>
          {hasRawCaptures ? (
            <Button asChild className="mt-6 w-full">
              <Link href="/daily">
                <icons.FileText />
                Generate Daily Note
              </Link>
            </Button>
          ) : (
            <Button className="mt-6 w-full" disabled>
              <icons.FileText />
              Generate Daily Note
            </Button>
          )}
          {!hasRawCaptures ? (
            <p className="mt-3 text-sm font-medium text-slate-500">No raw captures for today.</p>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="p-7">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <CardTitle>Active Apps</CardTitle>
              <CardDescription>Choose a product workspace before chatting with CMO.</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/apps">View all</Link>
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {state.apps.map((app) => (
              <Link
                key={app.id}
                href={`/apps/${app.slug}`}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-indigo-200 hover:bg-indigo-50/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="grid size-11 place-items-center rounded-xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
                    <icons.Package />
                  </div>
                  <Badge variant="slate">{app.stage || "Unknown"}</Badge>
                </div>
                <div className="mt-5 font-bold text-slate-950">{app.name}</div>
                <div className="mt-1 text-sm font-medium text-slate-500">{app.group}</div>
                <div className="mt-4 text-sm leading-6 text-slate-600">{app.currentMission || "No current mission found yet."}</div>
              </Link>
            ))}
          </div>
        </Card>

        <Card className="p-7">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <CardTitle>Recent CMO Sessions</CardTitle>
              <CardDescription>Latest app-specific sessions.</CardDescription>
            </div>
            <Badge variant="slate">{state.recentSessions.length} saved</Badge>
          </div>

          {state.recentSessions.length ? (
            <div className="space-y-4">
              {state.recentSessions.map((session) => (
                <div key={session.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-slate-950">{session.topic || "CMO session"}</div>
                      <div className="mt-1 text-sm font-medium text-slate-500">{session.appName}</div>
                    </div>
                    <Badge variant={session.status === "completed" ? "green" : "orange"}>{session.status}</Badge>
                  </div>
                  <div className="mt-3 text-xs font-medium text-slate-500">{displayDate(session.createdAt)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-xl bg-white text-slate-500 ring-1 ring-slate-200">
                <icons.MessageSquare />
              </div>
              <CardTitle className="mt-4">No CMO sessions yet</CardTitle>
              <CardDescription className="mt-2">Open an App Workspace and start a CMO session.</CardDescription>
            </div>
          )}
        </Card>
      </div>
    </PageChrome>
  );
}
