"use client";

import Link from "next/link";
import type { ComponentType } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { AppProjectLogo } from "@/components/cmo-apps/app-project-logo";
import { icons } from "@/components/dashboard/icons";
import type { CommandCenterState } from "@/lib/cmo/vault-files";

const MASCOT_VIDEO_URL = "/mascot/mascot-animation-light.webm";

function stageVariant(stage?: string): "green" | "orange" | "slate" {
  const normalized = stage?.toLowerCase() ?? "";

  if (normalized.includes("active")) {
    return "green";
  }

  if (normalized.includes("discovery")) {
    return "orange";
  }

  return "slate";
}

function SnapshotMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[32px_1fr] items-center gap-3 border-t border-slate-200/70 py-4 first:border-t-0 first:pt-0 last:pb-0">
      <Icon className="size-6 text-slate-500" />
      <div>
        <div className="text-base font-semibold text-slate-950">{value}</div>
        <div className="mt-0.5 text-xs font-medium text-slate-500">{label}</div>
      </div>
    </div>
  );
}

function HeroStat({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-h-[68px] grid-cols-[28px_1fr] items-center gap-x-3 border-slate-200/70 px-4 py-3 text-slate-600 md:border-l md:first:border-l-0">
      <Icon className="size-6" />
      <strong className="text-sm font-semibold text-slate-950">{value}</strong>
      <span className="col-start-2 -mt-1 text-xs font-medium">{label}</span>
    </div>
  );
}

export function CommandCenterView({ state }: { state: CommandCenterState }) {
  const hasRawCaptures = state.rawCaptureCount > 0;
  const focusApp = state.apps[0];
  const firstAppHref = `/apps/${focusApp?.slug ?? "holdstation-mini-app"}`;
  const discoveryApps = state.apps.filter((app) => app.stage?.toLowerCase().includes("discovery")).length;
  const activeApps = state.apps.filter((app) => app.stage?.toLowerCase().includes("active")).length;
  const heroTitle = focusApp?.name.replace(/\s+Mini App$/i, "") ?? "Holdstation";
  const heroSubtitle = focusApp?.currentMission || "Chat-first CMO workspace with live app context and vault capture.";
  const visibleApps = state.apps;

  return (
    <div className="mx-auto w-full max-w-[1720px] space-y-7">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-4 text-slate-500">
          <h1 className="text-3xl font-semibold tracking-normal text-slate-950">Holdstation Orbit</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
        </div>
      </header>

      <section className="relative min-h-[760px] overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(120deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.98)_55%,rgba(249,249,255,0.96)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_30px_80px_rgba(93,103,139,0.08)] md:min-h-[620px]">
        <div className="absolute inset-0 soft-grid opacity-25" />
        <div className="absolute -top-28 left-[24%] right-[-12%] h-[340px] rounded-b-[70%] border border-t-0 border-slate-300/40" />
        <div className="absolute -top-16 left-[32%] right-[-8%] h-[260px] rounded-b-[70%] border border-t-0 border-slate-300/30" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_24%_38%,rgba(255,255,255,0.96)_0%,rgba(255,255,255,0.7)_34%,transparent_66%),radial-gradient(ellipse_at_78%_48%,rgba(235,230,255,0.32)_0%,rgba(255,255,255,0.48)_46%,transparent_72%)]" />

        <div className="relative z-10 grid min-h-[760px] grid-cols-1 gap-8 px-6 py-8 md:min-h-[620px] md:grid-cols-[minmax(320px,0.85fr)_minmax(340px,1fr)] md:items-center lg:px-12 xl:grid-cols-[minmax(360px,0.85fr)_minmax(420px,1fr)_190px] xl:px-20">
          <div className="flex flex-col justify-center pb-0 pt-8 md:pb-20 md:pt-0 xl:pb-16">
            <Badge variant={hasRawCaptures ? "orange" : "slate"} className="w-fit rounded-full px-4">
              <span className={`size-2 rounded-full ${hasRawCaptures ? "bg-orange-500" : "bg-slate-400"}`} />
              {hasRawCaptures ? "Needs Review" : "Workspace Ready"}
            </Badge>
            <h2 className="mt-7 font-serif text-[clamp(3.8rem,6vw,7rem)] font-normal leading-[0.92] tracking-normal text-slate-950">
              {heroTitle}
            </h2>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-500">{heroSubtitle}</p>

            <div className="mt-8 grid max-w-[460px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white/62 shadow-[0_14px_42px_rgba(92,103,137,0.08)] backdrop-blur-xl sm:grid-cols-3">
              <HeroStat icon={icons.Package} value={String(state.apps.length)} label="Apps" />
              <HeroStat icon={icons.MessageSquare} value={String(state.recentSessions.length)} label="Sessions" />
              <HeroStat icon={icons.Database} value={String(state.rawCaptureCount)} label="Raw Vault" />
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Button asChild size="lg" className="h-14 min-w-[210px] rounded-2xl bg-[#7059ff] shadow-[0_22px_44px_rgba(103,76,235,0.28)] hover:bg-[#6348ec]">
                <Link href={firstAppHref}>
                  Open Project
                  <icons.ChevronRight />
                </Link>
              </Button>
            </div>
          </div>

          <div className="relative flex min-h-[330px] items-center justify-center pb-24 md:min-h-0 md:pb-20 xl:pb-16">
            <div className="absolute bottom-[74px] h-24 w-[78%] rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(112,89,255,0.13),rgba(255,255,255,0.72)_48%,transparent_74%)] blur-2xl" />
            <video
              aria-label="Holdstation mascot motion"
              autoPlay
              className="relative z-10 h-auto max-h-[380px] w-auto max-w-[min(92%,620px)] object-contain mix-blend-multiply md:max-h-[460px] xl:max-h-[500px]"
              loop
              muted
              playsInline
              preload="auto"
              style={{
                WebkitMaskImage:
                  "radial-gradient(ellipse at 50% 52%, #000 0%, #000 58%, rgba(0,0,0,0.7) 68%, transparent 82%)",
                maskImage:
                  "radial-gradient(ellipse at 50% 52%, #000 0%, #000 58%, rgba(0,0,0,0.7) 68%, transparent 82%)",
              }}
            >
              <source src={MASCOT_VIDEO_URL} type="video/webm" />
            </video>
          </div>

          <aside className="hidden self-center rounded-2xl border border-white/70 bg-white/70 p-7 shadow-[0_26px_64px_rgba(73,82,112,0.10)] backdrop-blur-xl xl:block">
            <p className="mb-5 text-sm font-semibold text-slate-950">Snapshot</p>
            <SnapshotMetric icon={icons.Package} value={String(activeApps || state.apps.length)} label="Active apps" />
            <SnapshotMetric icon={icons.Database} value={String(state.rawCaptureCount)} label="Captures" />
            <SnapshotMetric icon={icons.Workflow} value={String(discoveryApps)} label="Discovery" />
          </aside>

          <nav className="absolute bottom-6 left-1/2 z-20 grid w-[min(860px,calc(100%-64px))] -translate-x-1/2 grid-flow-col auto-cols-[80px] justify-center gap-2 overflow-x-auto rounded-full border border-slate-200/80 bg-white/72 p-3 shadow-[0_24px_70px_rgba(78,89,119,0.10)] backdrop-blur-xl">
            {visibleApps.map((app, index) => (
              <Link
                key={app.id}
                aria-label={`Open ${app.name}`}
                href={`/apps/${app.slug}`}
                title={app.name}
                className={`inline-flex h-14 items-center justify-center rounded-full px-3 transition hover:bg-white hover:shadow-[0_14px_36px_rgba(92,103,137,0.10)] ${
                  index === 0 ? "bg-white shadow-[0_14px_36px_rgba(92,103,137,0.10)]" : ""
                }`}
              >
                <AppProjectLogo app={app} className="h-11 w-14 rounded-2xl" iconClassName="size-5" />
                <span className="sr-only">{app.name}</span>
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <div className="grid gap-6">
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
                  <AppProjectLogo app={app} iconClassName="size-5" />
                  <Badge variant={stageVariant(app.stage)}>{app.stage || "Unknown"}</Badge>
                </div>
                <div className="mt-5 font-bold text-slate-950">{app.name}</div>
                <div className="mt-1 text-sm font-medium text-slate-500">{app.group}</div>
                <div className="mt-4 text-sm leading-6 text-slate-600">{app.currentMission || "No current mission found yet."}</div>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
