import {
  VAULT_GRAPH_SCHEMA_VERSION,
  VAULT_GRAPH_SOURCE_ROOT,
  VAULT_GRAPH_VAULT_AGENT_SOURCE_ROOT,
  isVaultGraphApiResponse,
  type VaultGraphApiResponse,
} from "@/lib/cmo/vault-graph-contract";
import {
  vaultGraphClusters,
  type VaultGraphColorGroup,
  type VaultGraphEdge,
  type VaultGraphNode,
  type VaultGraphNodeType,
} from "@/components/vault-graph/vault-graph-mock-data";

const nodeTypes = new Set<VaultGraphNodeType>([
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

const colorGroups = new Set<VaultGraphColorGroup>([
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

const clusterByColorGroup: Record<VaultGraphColorGroup, NonNullable<VaultGraphNode["cluster_id"]> | undefined> = {
  workspace: undefined,
  accepted_knowledge: "knowledge",
  sources: "sources",
  agents: "agents",
  proposals: "proposals",
  decisions: "decisions",
  content_outputs: "content_outputs",
  runtime: "runtime",
  governance: "governance",
};

type RawRecord = Record<string, unknown>;

export function normalizeVaultGraphForRendering(value: unknown): VaultGraphApiResponse | null {
  if (isVaultGraphApiResponse(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return null;
  }

  const sourceRoot = stringField(value, "source_root");
  if (
    value.schema_version !== VAULT_GRAPH_SCHEMA_VERSION ||
    value.vault_mutation !== false ||
    (sourceRoot !== VAULT_GRAPH_SOURCE_ROOT && sourceRoot !== VAULT_GRAPH_VAULT_AGENT_SOURCE_ROOT) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    typeof value.indexed_at !== "string"
  ) {
    return null;
  }

  const nodes = normalizeVaultGraphNodes(value.nodes);
  if (nodes.length === 0 && value.nodes.length > 0) {
    return null;
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = normalizeVaultGraphEdges(value.edges, nodeIds);

  const hiddenCounts = isHiddenCounts(value.hidden_counts) ? value.hidden_counts : {};

  return {
    schema_version: VAULT_GRAPH_SCHEMA_VERSION,
    vault_mutation: false,
    source_root: sourceRoot,
    indexed_at: value.indexed_at,
    nodes,
    edges,
    hidden_counts: hiddenCounts,
    warnings: stringArray(value.warnings),
    parse_errors: Array.isArray(value.parse_errors) ? value.parse_errors : [],
  };
}

function normalizeVaultGraphNodes(rawNodes: unknown[]) {
  const clusterCounts = new Map<VaultGraphColorGroup, number>();

  return rawNodes
    .map((rawNode, index) => normalizeVaultGraphNode(rawNode, index, clusterCounts))
    .filter((node): node is VaultGraphNode => Boolean(node));
}

function normalizeVaultGraphNode(
  rawNode: unknown,
  index: number,
  clusterCounts: Map<VaultGraphColorGroup, number>,
): VaultGraphNode | null {
  if (!isRecord(rawNode)) {
    return null;
  }

  const id = stringField(rawNode, "id");
  if (!id) {
    return null;
  }

  const rawType = stringField(rawNode, "type");
  const rawColorGroup = stringField(rawNode, "color_group");
  const folder = stringField(rawNode, "folder") || "Vault Agent";
  const type = normalizeNodeType(rawType, rawColorGroup, folder);
  const colorGroup = normalizeColorGroup(rawColorGroup, type, folder);
  const clusterIndex = clusterCounts.get(colorGroup) ?? 0;
  clusterCounts.set(colorGroup, clusterIndex + 1);
  const point = visualPoint(rawNode, id, colorGroup, clusterIndex, index);

  return {
    id,
    type,
    visual_role: rawNode.visual_role === "decorative" ? "decorative" : "semantic",
    label: stringField(rawNode, "label") || stringField(rawNode, "name") || id,
    description: stringField(rawNode, "description") || undefined,
    path: stringField(rawNode, "path") || `vault-agent://${id}`,
    folder,
    workspace_id: stringField(rawNode, "workspace_id") || "vault-agent",
    status: stringField(rawNode, "status") || stringField(rawNode, "review_status") || stringField(rawNode, "reviewStatus") || "indexed",
    truth_status: stringField(rawNode, "truth_status") || "indexed",
    visibility: stringField(rawNode, "visibility") || "team",
    tags: stringArray(rawNode.tags),
    size_score: numberField(rawNode, "size_score", 0.46),
    color_group: colorGroup,
    cluster_id: clusterByColorGroup[colorGroup],
    collapsed: booleanField(rawNode, "collapsed", type === "session_aggregate" || type === "governance"),
    x: point.x,
    y: point.y,
  };
}

function normalizeVaultGraphEdges(rawEdges: unknown[], nodeIds: Set<string>) {
  return rawEdges
    .map((rawEdge, index) => normalizeVaultGraphEdge(rawEdge, index, nodeIds))
    .filter((edge): edge is VaultGraphEdge => Boolean(edge));
}

function normalizeVaultGraphEdge(rawEdge: unknown, index: number, nodeIds: Set<string>): VaultGraphEdge | null {
  if (!isRecord(rawEdge)) {
    return null;
  }

  const source = stringField(rawEdge, "source");
  const target = stringField(rawEdge, "target");
  if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) {
    return null;
  }

  return {
    id: stringField(rawEdge, "id") || `live-edge-${index + 1}-${source}-${target}`,
    source,
    target,
    relation: stringField(rawEdge, "relation") || "related",
    confidence: numberField(rawEdge, "confidence", 0.74),
    source_field: stringField(rawEdge, "source_field") || "vault_agent",
    weight: numberField(rawEdge, "weight", 0.28),
  };
}

function normalizeNodeType(rawType: string, rawColorGroup: string, folder: string): VaultGraphNodeType {
  const normalized = `${rawType} ${rawColorGroup} ${folder}`.toLowerCase();

  if (nodeTypes.has(rawType as VaultGraphNodeType)) {
    return rawType as VaultGraphNodeType;
  }

  if (normalized.includes("workspace")) {
    return "workspace";
  }
  if (normalized.includes("lesson") || normalized.includes("knowledge") || normalized.includes("learning")) {
    return "knowledge";
  }
  if (normalized.includes("source") || normalized.includes("asset") || normalized.includes("map")) {
    return normalized.includes("asset") || normalized.includes("map") ? "source_asset" : "source_note";
  }
  if (normalized.includes("agent") || normalized.includes("skill")) {
    return "agent";
  }
  if (normalized.includes("proposal") || normalized.includes("candidate")) {
    return "proposal";
  }
  if (normalized.includes("decision")) {
    return "decision";
  }
  if (normalized.includes("content") || normalized.includes("output")) {
    return "content_output";
  }
  if (normalized.includes("session") || normalized.includes("runtime")) {
    return "session_aggregate";
  }
  if (normalized.includes("governance") || normalized.includes("policy")) {
    return "governance";
  }

  return "knowledge";
}

function normalizeColorGroup(rawColorGroup: string, type: VaultGraphNodeType, folder: string): VaultGraphColorGroup {
  if (colorGroups.has(rawColorGroup as VaultGraphColorGroup)) {
    return rawColorGroup as VaultGraphColorGroup;
  }

  const normalized = `${rawColorGroup} ${type} ${folder}`.toLowerCase();
  if (type === "workspace") {
    return "workspace";
  }
  if (type === "source_note" || type === "source_asset" || normalized.includes("source")) {
    return "sources";
  }
  if (type === "agent" || normalized.includes("agent")) {
    return "agents";
  }
  if (type === "proposal" || normalized.includes("candidate")) {
    return "proposals";
  }
  if (type === "decision") {
    return "decisions";
  }
  if (type === "content_output") {
    return "content_outputs";
  }
  if (type === "session_aggregate" || normalized.includes("runtime")) {
    return "runtime";
  }
  if (type === "governance" || normalized.includes("governance")) {
    return "governance";
  }
  if (normalized.includes("lesson") || normalized.includes("knowledge") || normalized.includes("learning")) {
    return "accepted_knowledge";
  }

  return "accepted_knowledge";
}

function visualPoint(
  rawNode: RawRecord,
  id: string,
  colorGroup: VaultGraphColorGroup,
  clusterIndex: number,
  globalIndex: number,
) {
  const existingX = finiteNumber(rawNode.x);
  const existingY = finiteNumber(rawNode.y);
  if (existingX !== undefined && existingY !== undefined) {
    return { x: existingX, y: existingY };
  }

  const cluster = clusterForColorGroup(colorGroup);
  const seed = deterministicSeed(`${id}:${globalIndex}`);
  const theta = clusterIndex * 2.399963229728653 + (seed % 997) / 997 * Math.PI * 0.82;
  const ring = Math.floor(clusterIndex / 16);
  const radius = Math.sqrt((clusterIndex % 16 + 0.72) / 16) + ring * 0.18;
  const lobe = 0.88 + ((seed >> 5) % 23) / 100 + Math.sin(theta * 2.1 + seed * 0.003) * 0.14;
  const drift = Math.cos(theta * 1.7 + seed * 0.002) * 18;
  const jitterX = ((seed % 41) - 20) * 0.72;
  const jitterY = (((seed >> 3) % 37) - 18) * 0.72;

  return {
    x: Math.round(clamp(cluster.center.x + Math.cos(theta) * cluster.spread.x * radius * lobe + Math.sin(theta) * drift + jitterX, 42, graphWidth - 42)),
    y: Math.round(clamp(cluster.center.y + Math.sin(theta) * cluster.spread.y * radius + Math.cos(theta) * drift * 0.5 + jitterY, 42, graphHeight - 42)),
  };
}

function clusterForColorGroup(colorGroup: VaultGraphColorGroup) {
  if (colorGroup === "workspace") {
    return { center: { x: graphWidth / 2, y: graphHeight / 2 }, spread: { x: 60, y: 48 } };
  }

  return vaultGraphClusters.find((cluster) => cluster.color_group === colorGroup) ?? vaultGraphClusters[1];
}

function deterministicSeed(value: string) {
  return value.split("").reduce((seed, character, index) => seed + character.charCodeAt(0) * (index + 17), 0);
}

export function chooseDefaultVaultGraphNodeId(
  nodes: VaultGraphNode[],
  sourceRoot: VaultGraphApiResponse["source_root"],
) {
  const semanticNodes = nodes.filter((node) => node.visual_role !== "decorative");
  const candidates = semanticNodes.length > 0 ? semanticNodes : nodes;
  if (candidates.length === 0) {
    return "";
  }

  if (sourceRoot !== VAULT_GRAPH_VAULT_AGENT_SOURCE_ROOT) {
    return (
      candidates.find((node) => node.id === "workspace-holdstation")?.id ??
      candidates.find((node) => node.type === "workspace")?.id ??
      candidates[0].id
    );
  }

  const workspaceById = candidates.find((node) => /\bworkspace\b/i.test(node.id));
  const workspaceByType = candidates.find((node) => node.type === "workspace");
  const holdstationNode = candidates.find((node) =>
    [node.label, node.path, node.folder, node.workspace_id, ...node.tags]
      .join(" ")
      .toLowerCase()
      .includes("holdstation"),
  );
  const miniAppNode = candidates.find((node) =>
    [node.label, node.path, node.folder, node.workspace_id, ...node.tags]
      .join(" ")
      .toLowerCase()
      .includes("holdstation-mini-app"),
  );

  return (
    workspaceById?.id ??
    workspaceByType?.id ??
    miniAppNode?.id ??
    holdstationNode?.id ??
    [...candidates].sort((left, right) => right.size_score - left.size_score)[0]?.id ??
    candidates[0].id
  );
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringField(record: RawRecord, field: string) {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

function numberField(record: RawRecord, field: string, fallback: number) {
  return finiteNumber(record[field]) ?? fallback;
}

function booleanField(record: RawRecord, field: string, fallback: boolean) {
  return typeof record[field] === "boolean" ? record[field] : fallback;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isHiddenCounts(value: unknown): value is VaultGraphApiResponse["hidden_counts"] {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((count) => typeof count === "number" && Number.isFinite(count) && count >= 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const graphWidth = 1200;
const graphHeight = 820;
