import {
  vaultGraphMockData,
  type VaultGraphData,
  type VaultGraphEdge,
  type VaultGraphNode,
} from "@/components/vault-graph/vault-graph-mock-data";

export const VAULT_GRAPH_SCHEMA_VERSION = "cmo.vault_graph.v1";
export const VAULT_GRAPH_SOURCE_ROOT = "mock";

export type VaultGraphHiddenCounts = {
  runtime: number;
  private: number;
  archive: number;
  templates: number;
};

export type VaultGraphApiResponse = VaultGraphData & {
  schema_version: typeof VAULT_GRAPH_SCHEMA_VERSION;
  vault_mutation: false;
  source_root: typeof VAULT_GRAPH_SOURCE_ROOT;
  indexed_at: string;
  hidden_counts: VaultGraphHiddenCounts;
  warnings: string[];
  parse_errors: string[];
};

export function buildMockVaultGraphResponse(indexedAt = new Date().toISOString()): VaultGraphApiResponse {
  return {
    schema_version: VAULT_GRAPH_SCHEMA_VERSION,
    vault_mutation: false,
    source_root: VAULT_GRAPH_SOURCE_ROOT,
    indexed_at: indexedAt,
    nodes: vaultGraphMockData.nodes,
    edges: vaultGraphMockData.edges,
    hidden_counts: {
      runtime: 0,
      private: 0,
      archive: 0,
      templates: 0,
    },
    warnings: [],
    parse_errors: [],
  };
}

export function isVaultGraphApiResponse(value: unknown): value is VaultGraphApiResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const response = value as Partial<VaultGraphApiResponse>;
  return (
    response.schema_version === VAULT_GRAPH_SCHEMA_VERSION &&
    response.vault_mutation === false &&
    response.source_root === VAULT_GRAPH_SOURCE_ROOT &&
    typeof response.indexed_at === "string" &&
    Array.isArray(response.nodes) &&
    Array.isArray(response.edges) &&
    isHiddenCounts(response.hidden_counts) &&
    Array.isArray(response.warnings) &&
    Array.isArray(response.parse_errors)
  );
}

function isHiddenCounts(value: unknown): value is VaultGraphHiddenCounts {
  if (!value || typeof value !== "object") {
    return false;
  }

  const counts = value as Partial<VaultGraphHiddenCounts>;
  return (
    counts.runtime === 0 &&
    counts.private === 0 &&
    counts.archive === 0 &&
    counts.templates === 0
  );
}

export type { VaultGraphData, VaultGraphEdge, VaultGraphNode };
