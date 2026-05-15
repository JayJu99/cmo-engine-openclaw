"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import type { CMOContextBrief, CMOContextQuality, ContextGraphStatus, ContextPackRuntimeMode } from "@/lib/cmo/app-workspace-types";

function qualityVariant(quality: CMOContextQuality | undefined): "green" | "orange" | "slate" | "blue" {
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

function statusVariant(status: "included" | "missing" | "empty"): "green" | "orange" | "slate" {
  if (status === "included") {
    return "green";
  }

  if (status === "missing") {
    return "orange";
  }

  return "slate";
}

function runtimeVariant(runtimeMode: ContextPackRuntimeMode): "green" | "orange" | "red" | "slate" {
  if (runtimeMode === "connected" || runtimeMode === "live") {
    return "green";
  }

  if (runtimeMode === "configured_but_unreachable" || runtimeMode === "runtime_error") {
    return "red";
  }

  if (runtimeMode === "fallback" || runtimeMode === "not_configured") {
    return "orange";
  }

  return "slate";
}

function runtimeLabel(runtimeMode: ContextPackRuntimeMode): string {
  if (runtimeMode === "live" || runtimeMode === "connected") {
    return "adapter connected";
  }

  if (runtimeMode === "configured_but_unreachable") {
    return "live app-chat unavailable";
  }

  if (runtimeMode === "not_configured") {
    return "not configured";
  }

  if (runtimeMode === "runtime_error") {
    return "runtime error";
  }

  return runtimeMode;
}

function graphVariant(status: ContextGraphStatus | undefined): "green" | "orange" | "red" | "slate" | "blue" {
  if (status === "available") {
    return "green";
  }

  if (status === "partial") {
    return "orange";
  }

  if (status === "not_configured") {
    return "red";
  }

  return "slate";
}

export function ContextBriefCard({ brief }: { brief: CMOContextBrief }) {
  const graphStatus = brief.graphStatus ?? "empty";
  const graphHints = brief.graphHints ?? [];

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
            <icons.Database />
          </div>
          <div className="min-w-0">
            <CardTitle>CMO Context Brief</CardTitle>
            <CardDescription>
              {brief.workspaceId} / {brief.appName}
            </CardDescription>
          </div>
        </div>
        <Badge variant="slate">{brief.policyVersion}</Badge>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {brief.sections.map((section) => (
          <Badge key={section.id} variant={statusVariant(section.status)}>
            {section.label}: {section.status}
            {section.itemCount > 1 ? ` (${section.itemCount})` : ""}
          </Badge>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase text-slate-400">Runtime</div>
          <Badge className="mt-2" variant={runtimeVariant(brief.runtimeMode)}>{runtimeLabel(brief.runtimeMode)}</Badge>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase text-slate-400">Memory Status</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant={brief.contextQualitySummary.confirmedCount ? "green" : "slate"}>{brief.contextQualitySummary.confirmedCount} confirmed</Badge>
            <Badge variant={brief.contextQualitySummary.draftCount ? "blue" : "slate"}>{brief.contextQualitySummary.draftCount} draft</Badge>
            <Badge variant={brief.contextQualitySummary.placeholderCount ? "orange" : "slate"}>{brief.contextQualitySummary.placeholderCount} needs content</Badge>
          </div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase text-slate-400">Budget</div>
          <div className="mt-2 text-sm font-bold text-slate-950">
            {brief.tokenBudget.estimatedTokens} / {brief.tokenBudget.maxInputTokens} est. tokens
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-400">Graph Context</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant={graphVariant(graphStatus)}>Graph: {graphStatus.replaceAll("_", " ")}</Badge>
              <Badge variant={graphHints.length ? "blue" : "slate"}>Graph hints: {brief.graphHintCount ?? graphHints.length}</Badge>
            </div>
          </div>
        </div>
        {graphHints.length ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-bold text-slate-700">Related hints</summary>
            <div className="mt-3 grid gap-2">
              {graphHints.map((hint) => (
                <div key={hint.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-slate-950">{hint.title}</div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={hint.confidence === "high" ? "green" : hint.confidence === "medium" ? "blue" : "slate"}>{hint.confidence}</Badge>
                      <Badge variant="slate">{hint.sourceType.replaceAll("-", " ")}</Badge>
                    </div>
                  </div>
                  <div className="mt-1 text-xs font-medium text-slate-500">{hint.reason}</div>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {brief.sections.map((section) => (
          <div key={`${section.id}-status`} className="rounded-xl border border-slate-100 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-bold text-slate-950">{section.label}</div>
              <Badge variant={qualityVariant(section.quality)}>{section.quality ?? "missing"}</Badge>
            </div>
            <div className="mt-1 text-xs font-medium text-slate-500">
              {section.status === "included" ? "Resolved automatically for this app." : "No app-scoped source available yet."}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
        <div className="text-xs font-semibold uppercase text-slate-400">Excluded</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {brief.exclusions.map((exclusion) => (
            <Badge key={exclusion.id} variant="slate">{exclusion.label}</Badge>
          ))}
        </div>
      </div>
    </Card>
  );
}
