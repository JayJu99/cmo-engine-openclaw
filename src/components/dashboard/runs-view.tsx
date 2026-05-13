"use client";

import Link from "next/link";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import { cn } from "@/lib/utils";
import type { CmoRunIndexItem } from "@/lib/cmo/types";

type RunsViewProps = {
  runs: CmoRunIndexItem[];
  total: number;
  limit: number;
  selectedRunId?: string;
  error?: string;
};

type CountKey = "actions_count" | "signals_count" | "agents_count" | "campaigns_count" | "reports_count" | "vault_count";

const countLabels: Array<{ key: CountKey; label: string; icon: keyof typeof icons }> = [
  { key: "actions_count", label: "Actions", icon: "CirclePlus" },
  { key: "signals_count", label: "Signals", icon: "Radio" },
  { key: "campaigns_count", label: "Campaigns", icon: "Workflow" },
  { key: "reports_count", label: "Reports", icon: "FileText" },
  { key: "vault_count", label: "Vault", icon: "Package" },
];

const detailCountLabels: Array<{ key: CountKey; label: string; icon: keyof typeof icons }> = [
  ...countLabels.slice(0, 2),
  { key: "agents_count", label: "Agents", icon: "Bot" },
  ...countLabels.slice(2),
];

function statusVariant(status: string): BadgeProps["variant"] {
  if (status === "completed") {
    return "green";
  }

  if (status === "running") {
    return "blue";
  }

  if (status === "failed" || status === "timeout") {
    return "red";
  }

  if (status === "partial") {
    return "orange";
  }

  return "slate";
}

function displayDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function shortRunId(runId: string): string {
  if (runId.length <= 18) {
    return runId;
  }

  return `${runId.slice(0, 10)}...${runId.slice(-6)}`;
}

function RunStatusBadge({ status }: { status: string }) {
  return <Badge variant={statusVariant(status)}>{status}</Badge>;
}

function CountPill({ run, item }: { run: CmoRunIndexItem; item: { key: CountKey; label: string; icon: keyof typeof icons } }) {
  const Icon = icons[item.icon];

  return (
    <div className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm">
      <Icon className="size-4 text-slate-400" />
      <span className="font-bold text-slate-950">{run[item.key]}</span>
      <span className="text-xs font-semibold text-slate-500">{item.label}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="grid min-h-[420px] place-items-center p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-slate-50 text-slate-500 ring-1 ring-slate-200">
          <icons.List className="size-7" />
        </div>
        <CardTitle className="mt-5 text-xl">No CMO runs yet</CardTitle>
        <CardDescription className="mt-2">
          Run history will appear here after the CMO brief pipeline writes normalized run output.
        </CardDescription>
      </div>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-red-100 bg-red-50/50 p-6">
      <div className="flex gap-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600 ring-1 ring-red-100">
          <icons.AlertTriangle className="size-5" />
        </div>
        <div>
          <CardTitle>Run history failed to load</CardTitle>
          <CardDescription className="mt-2">{message}</CardDescription>
        </div>
      </div>
    </Card>
  );
}

function RunDetailPanel({ run }: { run: CmoRunIndexItem | null }) {
  if (!run) {
    return (
      <Card className="p-6">
        <CardTitle>Select a run</CardTitle>
        <CardDescription className="mt-2">Compact run details will appear here.</CardDescription>
      </Card>
    );
  }

  return (
    <Card className="h-fit p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
              <icons.List className="size-5" />
            </div>
            <div>
              <CardTitle className="text-xl">{run.title}</CardTitle>
              <div className="mt-1 text-xs font-semibold text-slate-500">{shortRunId(run.run_id)}</div>
            </div>
          </div>
        </div>
        <RunStatusBadge status={run.status} />
      </div>

      {run.has_error ? (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <icons.AlertTriangle className="size-4" />
          Error signal present in this run
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 text-sm">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="text-xs font-semibold text-slate-500">Run ID</div>
          <div className="mt-1 break-all font-mono text-sm font-semibold text-slate-900">{run.run_id}</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold text-slate-500">Created</div>
            <div className="mt-1 font-bold text-slate-950">{displayDate(run.created_at)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold text-slate-500">Workspace</div>
            <div className="mt-1 font-bold text-slate-950">{run.workspace}</div>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 text-sm font-bold text-slate-950">Section Counts</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {detailCountLabels.map((item) => (
            <CountPill key={item.key} run={run} item={item} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function RunRow({
  run,
  active,
}: {
  run: CmoRunIndexItem;
  active: boolean;
}) {
  return (
    <Link
      href={`/runs?runId=${encodeURIComponent(run.run_id)}`}
      className={cn(
        "block w-full rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_18px_50px_rgba(15,23,42,0.08)]",
        active && "border-indigo-200 bg-indigo-50/60 ring-1 ring-indigo-100",
      )}
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold text-slate-950">{run.title}</h2>
            <RunStatusBadge status={run.status} />
            {run.has_error ? (
              <Badge variant="red">
                <icons.AlertTriangle className="size-3" />
                Error
              </Badge>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
            <span className="flex items-center gap-2">
              <icons.Clock3 className="size-4" />
              {displayDate(run.created_at)}
            </span>
            <span className="flex items-center gap-2">
              <icons.Database className="size-4" />
              {run.workspace}
            </span>
            <span className="font-mono text-xs font-semibold text-slate-500">{shortRunId(run.run_id)}</span>
          </div>
        </div>
        <icons.ChevronRight className={cn("hidden size-5 text-slate-400 xl:block", active && "text-indigo-500")} />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {countLabels.map((item) => (
          <CountPill key={item.key} run={run} item={item} />
        ))}
      </div>
    </Link>
  );
}

export function RunsView({ runs, total, limit, selectedRunId, error }: RunsViewProps) {
  const selectedRun = runs.find((run) => run.run_id === selectedRunId) ?? runs[0] ?? null;

  return (
    <PageChrome title="Run History" description="Review recent CMO brief runs and their compact dashboard output" primary="New Brief">
      {error ? <ErrorState message={error} /> : null}

      {!error && runs.length === 0 ? <EmptyState /> : null}

      {!error && runs.length > 0 ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="p-5">
              <div className="text-xs font-semibold text-slate-500">Runs Loaded</div>
              <div className="mt-2 text-3xl font-bold text-slate-950">{runs.length}</div>
              <div className="mt-1 text-xs font-semibold text-slate-500">Limit {limit}</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs font-semibold text-slate-500">Total Available</div>
              <div className="mt-2 text-3xl font-bold text-slate-950">{total}</div>
              <div className="mt-1 text-xs font-semibold text-slate-500">Normalized files only</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs font-semibold text-slate-500">Attention</div>
              <div className="mt-2 text-3xl font-bold text-slate-950">{runs.filter((run) => run.has_error).length}</div>
              <div className="mt-1 text-xs font-semibold text-slate-500">Runs with error signal</div>
            </Card>
          </div>

          <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="space-y-4">
              {runs.map((run) => (
                <RunRow
                  key={run.run_id}
                  run={run}
                  active={run.run_id === selectedRun?.run_id}
                />
              ))}
            </div>
            <RunDetailPanel run={selectedRun} />
          </div>
        </>
      ) : null}
    </PageChrome>
  );
}
