import {
  vaultGraphMockData,
  type VaultGraphData,
  type VaultGraphEdge,
  type VaultGraphNode,
} from "@/components/vault-graph/vault-graph-mock-data";

export const VAULT_GRAPH_SCHEMA_VERSION = "cmo.vault_graph.v1";
export const VAULT_GRAPH_SOURCE_ROOT = "mock";
export const VAULT_GRAPH_VAULT_AGENT_SOURCE_ROOT = "vault-agent";
export type VaultGraphSourceRoot = typeof VAULT_GRAPH_SOURCE_ROOT | typeof VAULT_GRAPH_VAULT_AGENT_SOURCE_ROOT;

export type VaultGraphHiddenCounts = {
  runtime?: number;
  private?: number;
  archive?: number;
  templates?: number;
};

export type VaultGraphParseError = string | {
  code: string;
  message: string;
};

export type VaultGraphApiResponse = VaultGraphData & {
  schema_version: typeof VAULT_GRAPH_SCHEMA_VERSION;
  vault_mutation: false;
  source_root: VaultGraphSourceRoot;
  indexed_at: string;
  hidden_counts: VaultGraphHiddenCounts;
  warnings: string[];
  parse_errors: VaultGraphParseError[];
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
    (response.source_root === VAULT_GRAPH_SOURCE_ROOT || response.source_root === VAULT_GRAPH_VAULT_AGENT_SOURCE_ROOT) &&
    typeof response.indexed_at === "string" &&
    Array.isArray(response.nodes) &&
    response.nodes.every(isVaultGraphNode) &&
    Array.isArray(response.edges) &&
    response.edges.every(isVaultGraphEdge) &&
    isHiddenCounts(response.hidden_counts) &&
    Array.isArray(response.warnings) &&
    response.warnings.every((warning) => typeof warning === "string") &&
    Array.isArray(response.parse_errors)
  );
}

function isHiddenCounts(value: unknown): value is VaultGraphHiddenCounts {
  if (!value || typeof value !== "object") {
    return false;
  }

  const counts = value as Partial<VaultGraphHiddenCounts>;
  return ["runtime", "private", "archive", "templates"].every((key) => {
    const count = counts[key as keyof VaultGraphHiddenCounts];
    return count === undefined || (typeof count === "number" && Number.isFinite(count) && count >= 0);
  });
}

const nodeTypes = new Set<VaultGraphNode["type"]>([
  "decorative",
  "workspace",
  "knowledge",
  "source_note",
  "source_asset",
  "agent",
  "proposal",
  "decision",
  "content_output",
  "session_aggregate",
  "governance",
]);

const colorGroups = new Set<VaultGraphNode["color_group"]>([
  "workspace",
  "accepted_knowledge",
  "sources",
  "agents",
  "proposals",
  "decisions",
  "content_outputs",
  "runtime",
  "governance",
]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isVaultGraphNode(value: unknown): value is VaultGraphNode {
  if (!value || typeof value !== "object") {
    return false;
  }

  const node = value as Partial<VaultGraphNode>;
  return (
    typeof node.id === "string" &&
    nodeTypes.has(node.type as VaultGraphNode["type"]) &&
    typeof node.label === "string" &&
    typeof node.path === "string" &&
    typeof node.folder === "string" &&
    typeof node.workspace_id === "string" &&
    typeof node.status === "string" &&
    typeof node.truth_status === "string" &&
    typeof node.visibility === "string" &&
    isStringArray(node.tags) &&
    typeof node.size_score === "number" &&
    Number.isFinite(node.size_score) &&
    colorGroups.has(node.color_group as VaultGraphNode["color_group"]) &&
    typeof node.collapsed === "boolean" &&
    typeof node.x === "number" &&
    Number.isFinite(node.x) &&
    typeof node.y === "number" &&
    Number.isFinite(node.y)
  );
}

function isVaultGraphEdge(value: unknown): value is VaultGraphEdge {
  if (!value || typeof value !== "object") {
    return false;
  }

  const edge = value as Partial<VaultGraphEdge>;
  return (
    typeof edge.id === "string" &&
    typeof edge.source === "string" &&
    typeof edge.target === "string" &&
    typeof edge.relation === "string" &&
    typeof edge.confidence === "number" &&
    Number.isFinite(edge.confidence) &&
    typeof edge.source_field === "string" &&
    typeof edge.weight === "number" &&
    Number.isFinite(edge.weight)
  );
}

export type { VaultGraphData, VaultGraphEdge, VaultGraphNode };
