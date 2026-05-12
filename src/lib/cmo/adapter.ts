import { CMO_SCHEMA_VERSION, type CmoRun, type CmoRunIndexItem } from "@/lib/cmo/types";
import { getCmoAdapterMode, isRemoteCmoAdapter } from "@/lib/cmo/config";
import {
  createMockRun,
  readLatestRun,
  readRun,
  readRuns,
} from "@/lib/cmo/store";
import {
  getRemoteLatestRun,
  getRemoteRun,
  getRemoteStatus,
  postRemoteRunBrief,
  type CmoRemoteStatus,
  type CmoRunBriefResponse,
} from "@/lib/cmo/remote-client";

export async function readDashboardLatestRun(): Promise<CmoRun> {
  return isRemoteCmoAdapter() ? getRemoteLatestRun() : readLatestRun();
}

export async function readDashboardRun(runId: string): Promise<CmoRun | null> {
  return isRemoteCmoAdapter() ? getRemoteRun(runId) : readRun(runId);
}

export async function readDashboardRuns(): Promise<CmoRunIndexItem[]> {
  return readRuns();
}

export async function runDashboardBrief(body: unknown): Promise<{ data: CmoRun | CmoRunBriefResponse; status: number }> {
  if (isRemoteCmoAdapter()) {
    return postRemoteRunBrief(body);
  }

  return {
    data: await createMockRun(),
    status: 201,
  };
}

export async function readDashboardStatus(): Promise<CmoRemoteStatus> {
  if (isRemoteCmoAdapter()) {
    return getRemoteStatus();
  }

  return {
    schema_version: CMO_SCHEMA_VERSION,
    ok: true,
    mode: getCmoAdapterMode(),
    adapter: "local",
    data_dir: "data",
  };
}
