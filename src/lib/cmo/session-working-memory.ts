import type { CmoSessionLocalResearchResult } from "./app-workspace-types";

export interface CmoSessionWorkingMemoryScope {
  tenantId: string;
  workspaceId: string;
  appId: string;
  userId: string;
  sessionId: string;
}

export interface CmoSessionWorkingMemoryActiveContext {
  kind: "session_local_research_result";
  artifact_id: string;
  schema_version: "cmo.session_local_research_result.v1";
  status: "available";
  truth_status: "session_only";
  saved_to_vault: false;
  no_auto_promote: true;
  scope: {
    tenant_id: string;
    workspace_id: string;
    app_id: string;
    user_id: string;
    session_id: string;
    validated_by_product: true;
  };
}

export interface CmoSessionWorkingMemory {
  schema_version: "cmo.session_working_memory.v1";
  scope_validated_by_product: true;
  active_contexts: CmoSessionWorkingMemoryActiveContext[];
  safety: {
    read_only: true;
    vault_mutation: false;
    gbrain_mutation: false;
    durable_memory_mutation: false;
    promotion_performed: false;
  };
}

export interface CmoSessionWorkingMemoryResolution {
  scopedResearchResults: CmoSessionLocalResearchResult[];
  workingMemory: CmoSessionWorkingMemory;
}

export function sessionResearchResultMatchesScope(
  result: CmoSessionLocalResearchResult,
  scope: CmoSessionWorkingMemoryScope,
): boolean {
  return (
    result.tenant_id === scope.tenantId &&
    result.workspace_id === scope.workspaceId &&
    result.app_id === scope.appId &&
    result.user_id === scope.userId &&
    result.session_id === scope.sessionId
  );
}

function activeResearchContext(result: CmoSessionLocalResearchResult): CmoSessionWorkingMemoryActiveContext {
  return {
    kind: "session_local_research_result",
    artifact_id: result.research_id,
    schema_version: "cmo.session_local_research_result.v1",
    status: "available",
    truth_status: "session_only",
    saved_to_vault: false,
    no_auto_promote: true,
    scope: {
      tenant_id: result.tenant_id,
      workspace_id: result.workspace_id,
      app_id: result.app_id,
      user_id: result.user_id,
      session_id: result.session_id,
      validated_by_product: true,
    },
  };
}

export function resolveSessionWorkingMemory(input: {
  scope: CmoSessionWorkingMemoryScope;
  researchResults?: CmoSessionLocalResearchResult[];
}): CmoSessionWorkingMemoryResolution {
  const scopedResearchResults = (input.researchResults ?? [])
    .filter((result) => sessionResearchResultMatchesScope(result, input.scope))
    .slice(0, 3);

  return {
    scopedResearchResults,
    workingMemory: {
      schema_version: "cmo.session_working_memory.v1",
      scope_validated_by_product: true,
      active_contexts: scopedResearchResults.map(activeResearchContext),
      safety: {
        read_only: true,
        vault_mutation: false,
        gbrain_mutation: false,
        durable_memory_mutation: false,
        promotion_performed: false,
      },
    },
  };
}
