"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import { cn } from "@/lib/utils";
import type { CmoAction, CmoAgent, CmoCampaign, CmoReport, CmoRun, CmoRunIndexItem, CmoSignal, CmoVaultItem } from "@/lib/cmo/types";

type RunsViewProps = {
  runs: CmoRunIndexItem[];
  total: number;
  limit: number;
  selectedRunId?: string;
  selectedRunDetail?: CmoRun | null;
  selectedRunDetailError?: string;
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

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const record = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
    const message = typeof record?.error === "string" ? record.error : "CMO run detail failed to load";

    throw new Error(message);
  }

  return payload as T;
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

function runDetailCounts(run: CmoRun): CmoRunIndexItem {
  return {
    schema_version: run.schema_version,
    run_id: run.run_id,
    created_at: run.created_at,
    workspace: run.workspace,
    status: run.status,
    title: run.summary.title,
    actions_count: run.actions.length,
    signals_count: run.signals.length,
    agents_count: run.agents.length,
    campaigns_count: run.campaigns.length,
    reports_count: run.reports.length,
    vault_count: run.vault.length,
    has_error: Boolean(run.error) || ["failed", "timeout", "partial", "invalid"].includes(run.status),
  };
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

function EmptySection({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm font-medium text-slate-500">
      No {label} returned for this run.
    </div>
  );
}

function FieldGrid({ items }: { items: Array<{ label: string; value: string | number | undefined }> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold text-slate-500">{item.label}</div>
          <div className="mt-1 font-semibold leading-6 text-slate-900">{item.value ?? "-"}</div>
        </div>
      ))}
    </div>
  );
}

function DetailItem({
  title,
  meta,
  body,
  badge,
}: {
  title: string;
  meta?: string;
  body?: string;
  badge?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold leading-6 text-slate-950">{title}</div>
          {meta ? <div className="mt-1 text-xs font-semibold text-slate-500">{meta}</div> : null}
        </div>
        {badge ? <Badge variant="slate">{badge}</Badge> : null}
      </div>
      {body ? <p className="mt-3 text-sm leading-6 text-slate-600">{body}</p> : null}
    </div>
  );
}

function RunSection({ title, children, count }: { title: string; children: ReactNode; count: number }) {
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-950">{title}</h3>
        <Badge variant="slate">{count}</Badge>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function SummarySection({ run }: { run: CmoRun }) {
  return (
    <RunSection title="summary" count={1}>
      <FieldGrid
        items={[
          { label: "Market Sentiment", value: run.summary.market_sentiment },
          { label: "Content Momentum", value: run.summary.content_momentum },
          { label: "Top Opportunity", value: run.summary.top_opportunity },
          { label: "Risk", value: run.summary.risk },
          { label: "Next Action", value: run.summary.next_action },
        ]}
      />
    </RunSection>
  );
}

function ActionsSection({ actions }: { actions: CmoAction[] }) {
  return (
    <RunSection title="actions" count={actions.length}>
      {actions.length ? (
        actions.map((action) => (
          <DetailItem
            key={action.id}
            title={action.title}
            meta={[action.source, action.agent, action.time].filter(Boolean).join(" / ")}
            body={action.summary}
            badge={action.priority}
          />
        ))
      ) : (
        <EmptySection label="actions" />
      )}
    </RunSection>
  );
}

function SignalsSection({ signals }: { signals: CmoSignal[] }) {
  return (
    <RunSection title="signals" count={signals.length}>
      {signals.length ? (
        signals.map((signal) => (
          <DetailItem
            key={signal.id}
            title={signal.title}
            meta={[signal.category, signal.source, signal.time].filter(Boolean).join(" / ")}
            body={signal.summary}
            badge={signal.severity}
          />
        ))
      ) : (
        <EmptySection label="signals" />
      )}
    </RunSection>
  );
}

function CampaignsSection({ campaigns }: { campaigns: CmoCampaign[] }) {
  return (
    <RunSection title="campaigns" count={campaigns.length}>
      {campaigns.length ? (
        campaigns.map((campaign) => (
          <DetailItem
            key={campaign.id}
            title={campaign.name}
            meta={[campaign.stage, campaign.status, campaign.owner_agent].filter(Boolean).join(" / ")}
            body={campaign.summary || campaign.next_action}
            badge={`${campaign.progress}/6`}
          />
        ))
      ) : (
        <EmptySection label="campaigns" />
      )}
    </RunSection>
  );
}

function AgentsSection({ agents }: { agents: CmoAgent[] }) {
  return (
    <RunSection title="agents" count={agents.length}>
      {agents.length ? (
        agents.map((agent) => (
          <DetailItem
            key={agent.id}
            title={`${agent.name} (${agent.codename})`}
            meta={[agent.status, `${agent.progress}%`, agent.metricA, agent.metricB].filter(Boolean).join(" / ")}
            body={agent.activity || agent.description}
            badge={agent.tone}
          />
        ))
      ) : (
        <EmptySection label="agents" />
      )}
    </RunSection>
  );
}

function ReportsSection({ reports }: { reports: CmoReport[] }) {
  return (
    <RunSection title="reports" count={reports.length}>
      {reports.length ? (
        reports.map((report) => (
          <DetailItem
            key={report.id}
            title={report.title}
            meta={[report.type, report.meta, report.stats.join(" / ")].filter(Boolean).join(" / ")}
            badge={report.tone}
          />
        ))
      ) : (
        <EmptySection label="reports" />
      )}
    </RunSection>
  );
}

function VaultSection({ vault }: { vault: CmoVaultItem[] }) {
  return (
    <RunSection title="vault" count={vault.length}>
      {vault.length ? (
        vault.map((item) => (
          <DetailItem
            key={item.id}
            title={item.name}
            meta={[item.type, item.status].filter(Boolean).join(" / ")}
            badge={item.count}
          />
        ))
      ) : (
        <EmptySection label="vault" />
      )}
    </RunSection>
  );
}

function RunWarning({ run }: { run: CmoRun }) {
  if (!run.error && !["failed", "timeout", "partial", "invalid"].includes(run.status)) {
    return null;
  }

  const trimmedError = run.error?.message
    ?.split(/\s+(?:Execution rules:|The normalized JSON must match|Source:)/)[0]
    ?.slice(0, 320)
    ?.trim();
  const readableError =
    trimmedError && trimmedError.length <= 180 && !trimmedError.startsWith("Command failed:")
      ? trimmedError
      : null;
  const message =
    readableError ||
    (run.status === "partial"
      ? "This run is partial. Some sections may be incomplete."
      : run.status === "timeout"
        ? "This run timed out before completion."
        : run.status === "failed"
          ? run.summary.risk || "This run failed before completion."
          : "This run needs review.");

  return (
    <div className="mt-5 flex items-start gap-2 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-800">
      <icons.AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <div>{message}</div>
        {run.error?.code ? <div className="mt-1 text-xs text-orange-700">Code: {run.error.code}</div> : null}
      </div>
    </div>
  );
}

function RunDetailPanel({
  compactRun,
  run,
  isLoading,
  error,
}: {
  compactRun: CmoRunIndexItem | null;
  run: CmoRun | null;
  isLoading: boolean;
  error?: string | null;
}) {
  if (!compactRun) {
    return (
      <Card className="p-6">
        <CardTitle>Select a run</CardTitle>
        <CardDescription className="mt-2">Full run details will appear here.</CardDescription>
      </Card>
    );
  }

  const countRun = run ? runDetailCounts(run) : compactRun;
  const askHref = `/chat?intent=run&id=${encodeURIComponent(compactRun.run_id)}`;

  return (
    <Card className="h-fit p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
              <icons.List className="size-5" />
            </div>
            <div>
              <CardTitle className="text-xl">{run?.summary.title ?? compactRun.title}</CardTitle>
              <div className="mt-1 text-xs font-semibold text-slate-500">{shortRunId(compactRun.run_id)}</div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RunStatusBadge status={run?.status ?? compactRun.status} />
          <Button asChild size="sm" variant="outline">
            <Link href={askHref}>
              <icons.MessageSquare />
              Ask CMO
            </Link>
          </Button>
        </div>
      </div>

      {!run && compactRun.has_error ? (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <icons.AlertTriangle className="size-4" />
          Error signal present in this run
        </div>
      ) : null}

      {run ? <RunWarning run={run} /> : null}

      {isLoading ? (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
          <icons.RefreshCw className="size-4 animate-spin" />
          Loading full run detail...
        </div>
      ) : null}

      {error ? (
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <icons.AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 text-sm">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="text-xs font-semibold text-slate-500">Run ID</div>
          <div className="mt-1 break-all font-mono text-sm font-semibold text-slate-900">{compactRun.run_id}</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold text-slate-500">Created</div>
            <div className="mt-1 font-bold text-slate-950">{displayDate(run?.created_at ?? compactRun.created_at)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold text-slate-500">Workspace</div>
            <div className="mt-1 font-bold text-slate-950">{run?.workspace ?? compactRun.workspace}</div>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 text-sm font-bold text-slate-950">Section Counts</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {detailCountLabels.map((item) => (
            <CountPill key={item.key} run={countRun} item={item} />
          ))}
        </div>
      </div>

      {run ? (
        <>
          <SummarySection run={run} />
          <ActionsSection actions={run.actions} />
          <SignalsSection signals={run.signals} />
          <CampaignsSection campaigns={run.campaigns} />
          <AgentsSection agents={run.agents} />
          <ReportsSection reports={run.reports} />
          <VaultSection vault={run.vault} />
        </>
      ) : null}
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

export function RunsView({ runs, total, limit, selectedRunId, selectedRunDetail = null, selectedRunDetailError, error }: RunsViewProps) {
  const selectedRunFromList = runs.find((run) => run.run_id === selectedRunId) ?? null;
  const selectedRun = selectedRunFromList ?? (selectedRunDetail ? runDetailCounts(selectedRunDetail) : runs[0] ?? null);
  const [fetchedRunDetail, setFetchedRunDetail] = useState<{
    runId: string;
    data: CmoRun | null;
    error: string | null;
  } | null>(null);
  const serverRunDetail = selectedRunDetail && selectedRunDetail.run_id === selectedRun?.run_id ? selectedRunDetail : null;
  const clientRunDetail = fetchedRunDetail?.runId === selectedRun?.run_id ? fetchedRunDetail.data : null;
  const runDetail = clientRunDetail ?? serverRunDetail;
  const runDetailError = fetchedRunDetail?.runId === selectedRun?.run_id ? fetchedRunDetail.error : selectedRunDetailError ?? null;
  const isRunDetailLoading = Boolean(selectedRun && !runDetail && fetchedRunDetail?.runId !== selectedRun.run_id);

  useEffect(() => {
    if (!selectedRun) {
      return;
    }

    let cancelled = false;

    async function loadRunDetail() {
      try {
        const detail = await readJsonResponse<CmoRun>(
          await fetch(`/api/cmo/runs/${encodeURIComponent(selectedRun.run_id)}`, { cache: "no-store" }),
        );

        if (!cancelled) {
          setFetchedRunDetail({
            runId: selectedRun.run_id,
            data: detail,
            error: null,
          });
        }
      } catch (detailError) {
        if (!cancelled) {
          setFetchedRunDetail({
            runId: selectedRun.run_id,
            data: null,
            error: detailError instanceof Error ? detailError.message : "CMO run detail failed to load",
          });
        }
      }
    }

    void loadRunDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedRun]);

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
            <RunDetailPanel compactRun={selectedRun} run={runDetail} isLoading={isRunDetailLoading} error={runDetailError} />
          </div>
        </>
      ) : null}
    </PageChrome>
  );
}
