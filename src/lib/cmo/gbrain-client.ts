import { buildSourceId } from "@/lib/cmo/workspace-registry";

export interface GBrainSourceScopedRequest {
  workspaceId: string;
  appId: string;
  sourceId: string;
}

export function requireGBrainSourceBoundary(request: GBrainSourceScopedRequest): void {
  const expectedSourceId = buildSourceId(request.workspaceId, request.appId);

  if (!request.sourceId || request.sourceId !== expectedSourceId) {
    throw new Error(`GBrain requests must be scoped to sourceId ${expectedSourceId}`);
  }
}

export class GBrainClient {
  async assertSourceScoped(request: GBrainSourceScopedRequest): Promise<void> {
    requireGBrainSourceBoundary(request);
  }
}

