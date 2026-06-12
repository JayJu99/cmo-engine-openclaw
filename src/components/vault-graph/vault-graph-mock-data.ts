export type VaultGraphNodeType =
  | "decorative"
  | "workspace"
  | "knowledge"
  | "source_note"
  | "source_asset"
  | "agent"
  | "proposal"
  | "decision"
  | "content_output"
  | "session_aggregate"
  | "governance";

export type VaultGraphColorGroup =
  | "workspace"
  | "accepted_knowledge"
  | "sources"
  | "agents"
  | "proposals"
  | "decisions"
  | "content_outputs"
  | "runtime"
  | "governance";

export type VaultGraphClusterKey =
  | "knowledge"
  | "sources"
  | "agents"
  | "proposals"
  | "decisions"
  | "content_outputs"
  | "runtime"
  | "governance";

export type VaultGraphNode = {
  id: string;
  type: VaultGraphNodeType;
  visual_role?: "semantic" | "decorative";
  label: string;
  description?: string;
  path: string;
  folder: string;
  workspace_id: string;
  status: string;
  truth_status: string;
  visibility: string;
  tags: string[];
  size_score: number;
  color_group: VaultGraphColorGroup;
  cluster_id?: VaultGraphClusterKey;
  collapsed: boolean;
  x: number;
  y: number;
};

export type VaultGraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence: number;
  source_field: string;
  weight: number;
};

export type VaultGraphCluster = {
  id: VaultGraphClusterKey;
  label: string;
  color_group: VaultGraphColorGroup;
  anchor: string;
  folder: string;
  count: number;
  center: { x: number; y: number };
  spread: { x: number; y: number };
  halo: { rx: number; ry: number; rotate: number };
};

export type VaultGraphData = {
  nodes: VaultGraphNode[];
  edges: VaultGraphEdge[];
};

export const vaultGraphClusters: VaultGraphCluster[] = [
  {
    id: "sources",
    label: "Sources",
    color_group: "sources",
    anchor: "source-dune",
    folder: "Source Notes",
    count: 34,
    center: { x: 260, y: 245 },
    spread: { x: 150, y: 102 },
    halo: { rx: 192, ry: 128, rotate: -16 },
  },
  {
    id: "knowledge",
    label: "Knowledge",
    color_group: "accepted_knowledge",
    anchor: "knowledge-positioning",
    folder: "Accepted Knowledge",
    count: 38,
    center: { x: 350, y: 535 },
    spread: { x: 172, y: 116 },
    halo: { rx: 212, ry: 148, rotate: 12 },
  },
  {
    id: "runtime",
    label: "Sessions",
    color_group: "runtime",
    anchor: "session-aggregate",
    folder: "Runtime Sessions",
    count: 22,
    center: { x: 505, y: 158 },
    spread: { x: 118, y: 72 },
    halo: { rx: 148, ry: 92, rotate: 8 },
  },
  {
    id: "governance",
    label: "Governance",
    color_group: "governance",
    anchor: "governance-cluster",
    folder: "Governance",
    count: 24,
    center: { x: 720, y: 152 },
    spread: { x: 124, y: 76 },
    halo: { rx: 154, ry: 96, rotate: -11 },
  },
  {
    id: "agents",
    label: "Agents",
    color_group: "agents",
    anchor: "agent-cmo",
    folder: "Agents",
    count: 40,
    center: { x: 880, y: 270 },
    spread: { x: 180, y: 120 },
    halo: { rx: 218, ry: 144, rotate: -8 },
  },
  {
    id: "decisions",
    label: "Decisions",
    color_group: "decisions",
    anchor: "decision-approve",
    folder: "Decisions",
    count: 24,
    center: { x: 1044, y: 435 },
    spread: { x: 112, y: 88 },
    halo: { rx: 142, ry: 110, rotate: 16 },
  },
  {
    id: "proposals",
    label: "Proposals",
    color_group: "proposals",
    anchor: "proposal-hook",
    folder: "Candidates",
    count: 30,
    center: { x: 930, y: 610 },
    spread: { x: 156, y: 110 },
    halo: { rx: 188, ry: 136, rotate: -18 },
  },
  {
    id: "content_outputs",
    label: "Outputs",
    color_group: "content_outputs",
    anchor: "output-carousel",
    folder: "Content Outputs",
    count: 28,
    center: { x: 620, y: 690 },
    spread: { x: 166, y: 80 },
    halo: { rx: 198, ry: 104, rotate: 5 },
  },
];

const semanticNodes: VaultGraphNode[] = [
  {
    id: "workspace-holdstation",
    type: "workspace",
    visual_role: "semantic",
    label: "Holdstation Workspace",
    description: "Central mock workspace hub for the Orbit UI graph preview.",
    path: "mock://holdstation",
    folder: "Workspace",
    workspace_id: "holdstation",
    status: "active",
    truth_status: "workspace",
    visibility: "team",
    tags: ["workspace", "orbit"],
    size_score: 1,
    color_group: "workspace",
    collapsed: false,
    x: 600,
    y: 420,
  },
  {
    id: "knowledge-positioning",
    type: "knowledge",
    visual_role: "semantic",
    label: "Trading Positioning",
    description: "Accepted market positioning and message hierarchy.",
    path: "mock://knowledge/positioning",
    folder: "Accepted Knowledge",
    workspace_id: "holdstation",
    status: "indexed",
    truth_status: "accepted",
    visibility: "team",
    tags: ["knowledge", "positioning", "trading"],
    size_score: 0.78,
    color_group: "accepted_knowledge",
    cluster_id: "knowledge",
    collapsed: false,
    x: 350,
    y: 535,
  },
  {
    id: "knowledge-audience",
    type: "knowledge",
    visual_role: "semantic",
    label: "Retail Trader Audience",
    description: "Audience traits that shape content framing.",
    path: "mock://knowledge/audience",
    folder: "Accepted Knowledge",
    workspace_id: "holdstation",
    status: "indexed",
    truth_status: "accepted",
    visibility: "team",
    tags: ["knowledge", "audience", "retail"],
    size_score: 0.62,
    color_group: "accepted_knowledge",
    cluster_id: "knowledge",
    collapsed: false,
    x: 244,
    y: 566,
  },
  {
    id: "knowledge-campaign",
    type: "knowledge",
    visual_role: "semantic",
    label: "Campaign Learnings",
    description: "Reusable learnings from prior campaign reviews.",
    path: "mock://knowledge/campaign-learnings",
    folder: "Accepted Knowledge",
    workspace_id: "holdstation",
    status: "fresh",
    truth_status: "accepted",
    visibility: "team",
    tags: ["knowledge", "campaign", "learning"],
    size_score: 0.58,
    color_group: "accepted_knowledge",
    cluster_id: "knowledge",
    collapsed: false,
    x: 442,
    y: 585,
  },
  {
    id: "source-dune",
    type: "source_note",
    visual_role: "semantic",
    label: "Dune Metrics Snapshot",
    description: "Provenance sample for market and product traction signals.",
    path: "mock://sources/dune-metrics",
    folder: "Source Notes",
    workspace_id: "holdstation",
    status: "captured",
    truth_status: "source",
    visibility: "team",
    tags: ["sources", "metrics", "dune"],
    size_score: 0.68,
    color_group: "sources",
    cluster_id: "sources",
    collapsed: false,
    x: 260,
    y: 245,
  },
  {
    id: "source-social",
    type: "source_note",
    visual_role: "semantic",
    label: "Social Listening Notes",
    description: "Mock source note cluster for social and community signals.",
    path: "mock://sources/social-listening",
    folder: "Source Notes",
    workspace_id: "holdstation",
    status: "captured",
    truth_status: "source",
    visibility: "team",
    tags: ["sources", "social", "signals"],
    size_score: 0.48,
    color_group: "sources",
    cluster_id: "sources",
    collapsed: false,
    x: 152,
    y: 302,
  },
  {
    id: "asset-creative",
    type: "source_asset",
    visual_role: "semantic",
    label: "Creative Swipe Assets",
    description: "Source asset set for campaign visual inspiration.",
    path: "mock://assets/swipe-file",
    folder: "Source Assets",
    workspace_id: "holdstation",
    status: "reviewed",
    truth_status: "source",
    visibility: "team",
    tags: ["sources", "creative", "asset"],
    size_score: 0.44,
    color_group: "sources",
    cluster_id: "sources",
    collapsed: false,
    x: 345,
    y: 178,
  },
  {
    id: "agent-cmo",
    type: "agent",
    visual_role: "semantic",
    label: "CMO Agent",
    description: "Mock orchestration hub for the agent cluster.",
    path: "mock://agents/cmo",
    folder: "Agents",
    workspace_id: "holdstation",
    status: "active",
    truth_status: "runtime",
    visibility: "system",
    tags: ["agents", "orchestrator"],
    size_score: 0.86,
    color_group: "agents",
    cluster_id: "agents",
    collapsed: false,
    x: 880,
    y: 270,
  },
  {
    id: "agent-echo",
    type: "agent",
    visual_role: "semantic",
    label: "Echo Agent",
    description: "Content generation agent represented as mock runtime context.",
    path: "mock://agents/echo",
    folder: "Agents",
    workspace_id: "holdstation",
    status: "running",
    truth_status: "runtime",
    visibility: "system",
    tags: ["agents", "content"],
    size_score: 0.56,
    color_group: "agents",
    cluster_id: "agents",
    collapsed: false,
    x: 994,
    y: 206,
  },
  {
    id: "agent-surf",
    type: "agent",
    visual_role: "semantic",
    label: "Surf Agent",
    description: "Research agent mock node connected to source clusters.",
    path: "mock://agents/surf",
    folder: "Agents",
    workspace_id: "holdstation",
    status: "available",
    truth_status: "runtime",
    visibility: "system",
    tags: ["agents", "research"],
    size_score: 0.52,
    color_group: "agents",
    cluster_id: "agents",
    collapsed: false,
    x: 1012,
    y: 330,
  },
  {
    id: "agent-vault",
    type: "agent",
    visual_role: "semantic",
    label: "Vault Agent",
    description: "Mock-only node, not connected to any real Vault Agent call.",
    path: "mock://agents/vault",
    folder: "Agents",
    workspace_id: "holdstation",
    status: "readiness mock",
    truth_status: "runtime",
    visibility: "system",
    tags: ["agents", "vault"],
    size_score: 0.5,
    color_group: "agents",
    cluster_id: "agents",
    collapsed: false,
    x: 772,
    y: 326,
  },
  {
    id: "agent-lens",
    type: "agent",
    visual_role: "semantic",
    label: "Lens Agent",
    description: "Analytics agent mock node for insight routing.",
    path: "mock://agents/lens",
    folder: "Agents",
    workspace_id: "holdstation",
    status: "idle",
    truth_status: "runtime",
    visibility: "system",
    tags: ["agents", "analytics"],
    size_score: 0.48,
    color_group: "agents",
    cluster_id: "agents",
    collapsed: false,
    x: 824,
    y: 164,
  },
  {
    id: "proposal-hook",
    type: "proposal",
    visual_role: "semantic",
    label: "Hidden Opportunity Hook",
    description: "Candidate concept waiting for review.",
    path: "mock://proposals/hidden-opportunity-hook",
    folder: "Candidates",
    workspace_id: "holdstation",
    status: "candidate",
    truth_status: "proposed",
    visibility: "team",
    tags: ["proposals", "hook", "candidate"],
    size_score: 0.64,
    color_group: "proposals",
    cluster_id: "proposals",
    collapsed: false,
    x: 930,
    y: 610,
  },
  {
    id: "proposal-brief",
    type: "proposal",
    visual_role: "semantic",
    label: "US Traders Brief",
    description: "Brief candidate derived from mock research context.",
    path: "mock://proposals/us-traders-brief",
    folder: "Candidates",
    workspace_id: "holdstation",
    status: "review",
    truth_status: "proposed",
    visibility: "team",
    tags: ["proposals", "brief", "us-market"],
    size_score: 0.46,
    color_group: "proposals",
    cluster_id: "proposals",
    collapsed: false,
    x: 820,
    y: 682,
  },
  {
    id: "decision-approve",
    type: "decision",
    visual_role: "semantic",
    label: "Approve Meme Angle",
    description: "Decision node joining proposal and output branches.",
    path: "mock://decisions/approve-meme-angle",
    folder: "Decisions",
    workspace_id: "holdstation",
    status: "accepted",
    truth_status: "decision",
    visibility: "team",
    tags: ["decisions", "approval"],
    size_score: 0.72,
    color_group: "decisions",
    cluster_id: "decisions",
    collapsed: false,
    x: 1044,
    y: 435,
  },
  {
    id: "output-carousel",
    type: "content_output",
    visual_role: "semantic",
    label: "Facebook Carousel Draft",
    description: "Mock output node produced from approved direction.",
    path: "mock://outputs/facebook-carousel-draft",
    folder: "Content Outputs",
    workspace_id: "holdstation",
    status: "ready",
    truth_status: "generated",
    visibility: "team",
    tags: ["content_outputs", "facebook", "carousel"],
    size_score: 0.64,
    color_group: "content_outputs",
    cluster_id: "content_outputs",
    collapsed: false,
    x: 620,
    y: 690,
  },
  {
    id: "session-aggregate",
    type: "session_aggregate",
    visual_role: "semantic",
    label: "18 Sessions",
    description: "Collapsed mock runtime/session aggregate.",
    path: "mock://sessions/aggregate",
    folder: "Runtime Sessions",
    workspace_id: "holdstation",
    status: "collapsed",
    truth_status: "runtime",
    visibility: "system",
    tags: ["runtime", "sessions", "collapsed"],
    size_score: 0.58,
    color_group: "runtime",
    cluster_id: "runtime",
    collapsed: true,
    x: 505,
    y: 158,
  },
  {
    id: "governance-cluster",
    type: "governance",
    visual_role: "semantic",
    label: "Governance Cluster",
    description: "Collapsed mock policy and review context.",
    path: "mock://governance/collapsed",
    folder: "Governance",
    workspace_id: "holdstation",
    status: "collapsed",
    truth_status: "policy",
    visibility: "system",
    tags: ["governance", "policy", "review"],
    size_score: 0.56,
    color_group: "governance",
    cluster_id: "governance",
    collapsed: true,
    x: 720,
    y: 152,
  },
];

const bridgeEdges: VaultGraphEdge[] = [
  { id: "e-workspace-knowledge", source: "workspace-holdstation", target: "knowledge-positioning", relation: "contains", confidence: 0.98, source_field: "workspace_id", weight: 0.64 },
  { id: "e-workspace-sources", source: "workspace-holdstation", target: "source-dune", relation: "indexes", confidence: 0.92, source_field: "workspace_id", weight: 0.48 },
  { id: "e-workspace-agents", source: "workspace-holdstation", target: "agent-cmo", relation: "orchestrates", confidence: 0.96, source_field: "runtime", weight: 0.62 },
  { id: "e-workspace-outputs", source: "workspace-holdstation", target: "output-carousel", relation: "publishes", confidence: 0.82, source_field: "mock_output", weight: 0.38 },
  { id: "e-session-workspace", source: "session-aggregate", target: "workspace-holdstation", relation: "summarizes", confidence: 0.72, source_field: "sessions", weight: 0.34 },
  { id: "e-governance-workspace", source: "governance-cluster", target: "workspace-holdstation", relation: "governs", confidence: 0.88, source_field: "policy", weight: 0.36 },
  { id: "e-dune-positioning", source: "source-dune", target: "knowledge-positioning", relation: "supports", confidence: 0.82, source_field: "provenance", weight: 0.34 },
  { id: "e-social-audience", source: "source-social", target: "knowledge-audience", relation: "supports", confidence: 0.88, source_field: "provenance", weight: 0.3 },
  { id: "e-lens-dune", source: "agent-lens", target: "source-dune", relation: "reads_metrics", confidence: 0.82, source_field: "mock_source", weight: 0.3 },
  { id: "e-surf-social", source: "agent-surf", target: "source-social", relation: "reads_signal", confidence: 0.8, source_field: "mock_source", weight: 0.28 },
  { id: "e-echo-hook", source: "agent-echo", target: "proposal-hook", relation: "creates", confidence: 0.78, source_field: "candidate", weight: 0.32 },
  { id: "e-hook-decision", source: "proposal-hook", target: "decision-approve", relation: "approved_by", confidence: 0.84, source_field: "review", weight: 0.34 },
  { id: "e-decision-output", source: "decision-approve", target: "output-carousel", relation: "authorizes", confidence: 0.9, source_field: "decision", weight: 0.4 },
  { id: "e-output-campaign", source: "output-carousel", target: "knowledge-campaign", relation: "updates_learning", confidence: 0.68, source_field: "feedback", weight: 0.26 },
  { id: "e-governance-decision", source: "governance-cluster", target: "decision-approve", relation: "requires_trace", confidence: 0.8, source_field: "policy", weight: 0.28 },
];

const semanticClusterEdges: VaultGraphEdge[] = [
  { id: "e-knowledge-positioning-audience", source: "knowledge-positioning", target: "knowledge-audience", relation: "related", confidence: 0.84, source_field: "mock_cluster", weight: 0.32 },
  { id: "e-knowledge-positioning-campaign", source: "knowledge-positioning", target: "knowledge-campaign", relation: "related", confidence: 0.8, source_field: "mock_cluster", weight: 0.3 },
  { id: "e-source-dune-social", source: "source-dune", target: "source-social", relation: "corroborates", confidence: 0.66, source_field: "mock_cluster", weight: 0.24 },
  { id: "e-source-dune-assets", source: "source-dune", target: "asset-creative", relation: "references", confidence: 0.62, source_field: "mock_cluster", weight: 0.24 },
  { id: "e-cmo-echo", source: "agent-cmo", target: "agent-echo", relation: "delegates", confidence: 0.92, source_field: "agent_run", weight: 0.38 },
  { id: "e-cmo-surf", source: "agent-cmo", target: "agent-surf", relation: "delegates", confidence: 0.9, source_field: "agent_run", weight: 0.36 },
  { id: "e-cmo-vault", source: "agent-cmo", target: "agent-vault", relation: "context", confidence: 0.86, source_field: "agent_run", weight: 0.3 },
  { id: "e-cmo-lens", source: "agent-cmo", target: "agent-lens", relation: "metrics", confidence: 0.84, source_field: "agent_run", weight: 0.28 },
  { id: "e-proposal-hook-brief", source: "proposal-hook", target: "proposal-brief", relation: "variant", confidence: 0.72, source_field: "candidate", weight: 0.24 },
];

function decorativePoint(cluster: VaultGraphCluster, index: number) {
  const drift = cluster.id.length * 0.73;
  const theta = index * 2.399963229728653 + drift;
  const radius = Math.sqrt((index + 0.65) / cluster.count);
  const lobe = 1 + Math.sin(index * 0.83 + drift) * 0.16;
  const skew = Math.cos(index * 0.47 + drift) * 13;
  const x =
    cluster.center.x +
    Math.cos(theta) * cluster.spread.x * radius * lobe +
    Math.sin(index * 1.31 + drift) * 17;
  const y =
    cluster.center.y +
    Math.sin(theta) * cluster.spread.y * radius +
    skew;

  return {
    x: Math.max(36, Math.min(1164, Math.round(x))),
    y: Math.max(42, Math.min(788, Math.round(y))),
  };
}

function decorativeSizeScore(index: number) {
  return 0.08 + (index % 5) * 0.012;
}

const decorativeNodes = vaultGraphClusters.flatMap((cluster) =>
  Array.from({ length: cluster.count }, (_, index): VaultGraphNode => {
    const point = decorativePoint(cluster, index);

    return {
      id: `decorative-${cluster.id}-${index + 1}`,
      type: "decorative",
      visual_role: "decorative",
      label: `${cluster.label} context ${index + 1}`,
      description: "Decorative deterministic mock node for the Phase 1 graph preview.",
      path: `mock://decorative/${cluster.id}/${index + 1}`,
      folder: cluster.folder,
      workspace_id: "holdstation",
      status: "mock",
      truth_status: "decorative",
      visibility: "visual",
      tags: [cluster.id, "decorative", "mock"],
      size_score: decorativeSizeScore(index),
      color_group: cluster.color_group,
      cluster_id: cluster.id,
      collapsed: false,
      x: point.x,
      y: point.y,
    };
  }),
);

const decorativeEdges = vaultGraphClusters.flatMap((cluster): VaultGraphEdge[] => {
  const clusterNodes = decorativeNodes.filter((node) => node.cluster_id === cluster.id);
  const edges: VaultGraphEdge[] = [];

  clusterNodes.forEach((node, index) => {
    const previous = clusterNodes[index - 1];
    const near = clusterNodes[index - 4];
    const nextArc = clusterNodes[index + 3];

    if (previous) {
      edges.push({
        id: `e-${previous.id}-${node.id}`,
        source: previous.id,
        target: node.id,
        relation: "cluster_local",
        confidence: 0.42,
        source_field: "mock_layout",
        weight: 0.06,
      });
    }

    if (near && index % 3 === 0) {
      edges.push({
        id: `e-${near.id}-${node.id}`,
        source: near.id,
        target: node.id,
        relation: "cluster_local",
        confidence: 0.36,
        source_field: "mock_layout",
        weight: 0.045,
      });
    }

    if (nextArc && index % 7 === 2) {
      edges.push({
        id: `e-${node.id}-${nextArc.id}`,
        source: node.id,
        target: nextArc.id,
        relation: "cluster_arc",
        confidence: 0.34,
        source_field: "mock_layout",
        weight: 0.04,
      });
    }

    if (index % 9 === 1) {
      edges.push({
        id: `e-${cluster.anchor}-${node.id}`,
        source: cluster.anchor,
        target: node.id,
        relation: "cluster_sample",
        confidence: 0.46,
        source_field: "mock_cluster",
        weight: 0.075,
      });
    }
  });

  return edges;
});

export const vaultGraphMockData: VaultGraphData = {
  nodes: [...semanticNodes, ...decorativeNodes],
  edges: [...semanticClusterEdges, ...decorativeEdges, ...bridgeEdges],
};

export const vaultGraphSemanticNodes = semanticNodes;
export const vaultGraphDecorativeNodes = decorativeNodes;
