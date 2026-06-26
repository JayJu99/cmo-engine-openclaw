import "server-only";

import type { StudioJobRecord } from "@/lib/cmo/studio-job-service";

export interface StudioDispatchResult {
  mode: "mock";
  hermesDispatched: false;
  nextAgentRoute: "/agents/video/execute";
}

export async function dispatchStudioJob(job: StudioJobRecord): Promise<StudioDispatchResult> {
  void job;

  return {
    mode: "mock",
    hermesDispatched: false,
    nextAgentRoute: "/agents/video/execute",
  };
}
