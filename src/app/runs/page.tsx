import { RunsView } from "@/components/dashboard/runs-view";
import { readDashboardRuns } from "@/lib/cmo/adapter";
import type { CmoRunListResponse } from "@/lib/cmo/types";

export const dynamic = "force-dynamic";

type RunsPageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

async function loadRuns(): Promise<CmoRunListResponse & { error?: string }> {
  try {
    return await readDashboardRuns(20);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run history is unavailable.";

    return {
      schema_version: "cmo.dashboard.v1",
      data: [],
      total: 0,
      limit: 20,
      error: message,
    };
  }
}

export default async function RunsPage({ searchParams }: { searchParams: RunsPageSearchParams }) {
  const params = await searchParams;
  const runs = await loadRuns();
  const selectedRunId = firstParam(params.runId).trim();

  return <RunsView runs={runs.data} total={runs.total} limit={runs.limit} selectedRunId={selectedRunId} error={runs.error} />;
}
