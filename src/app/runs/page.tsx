import { RunsView } from "@/components/dashboard/runs-view";
import { readDashboardRun, readDashboardRuns } from "@/lib/cmo/adapter";
import type { CmoRun, CmoRunListResponse } from "@/lib/cmo/types";

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

async function loadSelectedRun(runId: string): Promise<{ data: CmoRun | null; error?: string }> {
  if (!runId) {
    return { data: null };
  }

  try {
    const run = await readDashboardRun(runId);

    return run
      ? { data: run }
      : {
          data: null,
          error: "Selected CMO run was not found.",
        };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Selected CMO run detail is unavailable.",
    };
  }
}

export default async function RunsPage({ searchParams }: { searchParams: RunsPageSearchParams }) {
  const params = await searchParams;
  const selectedRunId = firstParam(params.runId).trim();
  const [runs, selectedRun] = await Promise.all([loadRuns(), loadSelectedRun(selectedRunId)]);

  return (
    <RunsView
      runs={runs.data}
      total={runs.total}
      limit={runs.limit}
      selectedRunId={selectedRunId}
      selectedRunDetail={selectedRun.data}
      selectedRunDetailError={selectedRun.error}
      error={runs.error}
    />
  );
}
