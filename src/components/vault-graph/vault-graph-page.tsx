"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import {
  buildMockVaultGraphResponse,
  isVaultGraphApiResponse,
  type VaultGraphApiResponse,
} from "@/lib/cmo/vault-graph-contract";
import { cn } from "@/lib/utils";
import {
  vaultGraphClusters,
  vaultGraphSemanticNodes,
  type VaultGraphData,
  type VaultGraphColorGroup,
  type VaultGraphEdge,
  type VaultGraphNode,
  type VaultGraphNodeType,
} from "@/components/vault-graph/vault-graph-mock-data";

type VaultGraphFilter = "All" | "Knowledge" | "Sources" | "Agents" | "Proposals" | "Decisions";
type VaultGraphApiStatus = "loading" | "mock-api" | "fallback";

const fallbackGraphResponse = buildMockVaultGraphResponse("1970-01-01T00:00:00.000Z");

const graphWidth = 1200;
const graphHeight = 820;
const graphViewBox = {
  x: -240,
  y: -150,
  width: 1680,
  height: 1100,
};

const filters: { label: VaultGraphFilter; types?: VaultGraphNodeType[]; colorGroups?: VaultGraphColorGroup[] }[] = [
  { label: "All" },
  { label: "Knowledge", types: ["workspace", "knowledge"], colorGroups: ["workspace", "accepted_knowledge"] },
  { label: "Sources", types: ["source_note", "source_asset"], colorGroups: ["sources"] },
  { label: "Agents", types: ["agent", "session_aggregate"], colorGroups: ["agents", "runtime"] },
  { label: "Proposals", types: ["proposal", "content_output"], colorGroups: ["proposals", "content_outputs"] },
  { label: "Decisions", types: ["decision", "governance"], colorGroups: ["decisions", "governance"] },
];

const colorSystem: Record<
  VaultGraphColorGroup,
  {
    fill: string;
    stroke: string;
    edge: string;
    glow: string;
    text: string;
    darkText: string;
    label: string;
  }
> = {
  workspace: {
    fill: "#c4b5fd",
    stroke: "#8b5cf6",
    edge: "#a78bfa",
    glow: "rgba(139,92,246,0.62)",
    text: "text-violet-700",
    darkText: "text-violet-200",
    label: "Workspace",
  },
  accepted_knowledge: {
    fill: "#5ee6a8",
    stroke: "#10f0a0",
    edge: "#62f6b8",
    glow: "rgba(16,240,160,0.5)",
    text: "text-emerald-700",
    darkText: "text-emerald-200",
    label: "Knowledge",
  },
  sources: {
    fill: "#68c7ff",
    stroke: "#38bdf8",
    edge: "#7dd3fc",
    glow: "rgba(56,189,248,0.48)",
    text: "text-sky-700",
    darkText: "text-sky-200",
    label: "Sources",
  },
  agents: {
    fill: "#55f1ff",
    stroke: "#22d3ee",
    edge: "#67e8f9",
    glow: "rgba(34,211,238,0.48)",
    text: "text-cyan-700",
    darkText: "text-cyan-200",
    label: "Agents",
  },
  proposals: {
    fill: "#facc5b",
    stroke: "#f59e0b",
    edge: "#fde68a",
    glow: "rgba(245,158,11,0.48)",
    text: "text-amber-700",
    darkText: "text-amber-200",
    label: "Proposals",
  },
  decisions: {
    fill: "#ff8b6b",
    stroke: "#fb7185",
    edge: "#fda4af",
    glow: "rgba(251,113,133,0.5)",
    text: "text-rose-700",
    darkText: "text-rose-200",
    label: "Decisions",
  },
  content_outputs: {
    fill: "#f472d0",
    stroke: "#f0abfc",
    edge: "#f5d0fe",
    glow: "rgba(240,171,252,0.48)",
    text: "text-fuchsia-700",
    darkText: "text-fuchsia-200",
    label: "Outputs",
  },
  runtime: {
    fill: "#e2e8f0",
    stroke: "#cbd5e1",
    edge: "#e5e7eb",
    glow: "rgba(226,232,240,0.36)",
    text: "text-slate-700",
    darkText: "text-slate-200",
    label: "Runtime",
  },
  governance: {
    fill: "#94a3b8",
    stroke: "#cbd5e1",
    edge: "#cbd5e1",
    glow: "rgba(148,163,184,0.38)",
    text: "text-slate-700",
    darkText: "text-slate-200",
    label: "Governance",
  },
};

const typeLabel: Record<VaultGraphNodeType, string> = {
  decorative: "Cluster context",
  workspace: "Workspace",
  knowledge: "Accepted knowledge",
  source_note: "Source note",
  source_asset: "Source asset",
  agent: "Agent",
  proposal: "Proposal",
  decision: "Decision",
  content_output: "Content output",
  session_aggregate: "Session aggregate",
  governance: "Governance",
};

const starField = Array.from({ length: 150 }, (_, index) => ({
  id: `star-${index}`,
  x: Math.round(((Math.sin(index * 12.9898) * 43758.5453) % 1) * graphWidth + graphWidth) % graphWidth,
  y: Math.round(((Math.sin(index * 78.233) * 24634.6345) % 1) * graphHeight + graphHeight) % graphHeight,
  r: 0.45 + (index % 4) * 0.22,
  opacity: 0.12 + (index % 5) * 0.035,
}));

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const onChange = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  return prefersReducedMotion;
}

function deterministicSeed(value: string) {
  return value.split("").reduce((seed, character, index) => seed + character.charCodeAt(0) * (index + 17), 0);
}

function animationDelay(value: string, range = 4.8) {
  return Number(((deterministicSeed(value) % 1000) / 1000 * range).toFixed(2));
}

function isSemanticNode(node: VaultGraphNode) {
  return node.visual_role !== "decorative";
}

function isClusterHub(node: VaultGraphNode) {
  return node.type === "workspace" || vaultGraphClusters.some((cluster) => cluster.anchor === node.id);
}

function getNodeRadius(node: VaultGraphNode) {
  if (!isSemanticNode(node)) {
    return 2.1 + node.size_score * 7.5;
  }

  if (node.type === "workspace") {
    return 17;
  }

  if (isClusterHub(node)) {
    return 8.5 + node.size_score * 3.6;
  }

  return 6.4 + node.size_score * 2.2;
}

function matchesSearch(node: VaultGraphNode, query: string) {
  if (!query.trim()) {
    return true;
  }

  const normalized = query.trim().toLowerCase();
  return [
    node.label,
    node.type,
    node.folder,
    node.status,
    node.truth_status,
    node.visibility,
    node.path,
    ...node.tags,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function relatedNodeIds(edges: VaultGraphEdge[], nodeId: string | null) {
  if (!nodeId) {
    return new Set<string>();
  }

  return edges.reduce((ids, edge) => {
    if (edge.source === nodeId) {
      ids.add(edge.target);
    }
    if (edge.target === nodeId) {
      ids.add(edge.source);
    }
    return ids;
  }, new Set<string>([nodeId]));
}

function edgeTouches(edge: VaultGraphEdge, nodeId: string | null) {
  return Boolean(nodeId && (edge.source === nodeId || edge.target === nodeId));
}

function isDecorativeEdge(edge: VaultGraphEdge) {
  return edge.relation === "cluster_local" || edge.relation === "cluster_arc" || edge.relation === "cluster_sample";
}

function isLocalEdge(edge: VaultGraphEdge, nodeById: Map<string, VaultGraphNode>) {
  if (isDecorativeEdge(edge)) {
    return true;
  }

  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  return Boolean(source?.cluster_id && source.cluster_id === target?.cluster_id);
}

function edgePath(source: VaultGraphNode, target: VaultGraphNode, edge: VaultGraphEdge, local: boolean) {
  if (local) {
    return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
  }

  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const bend = Math.min(68, length * 0.1) * (edge.id.length % 2 === 0 ? 1 : -1);
  const cx = (source.x + target.x) / 2 + (-dy / length) * bend;
  const cy = (source.y + target.y) / 2 + (dx / length) * bend;

  return `M ${source.x} ${source.y} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${target.x} ${target.y}`;
}

function signalTiming(edge: VaultGraphEdge, index: number, focused: boolean) {
  const seed = deterministicSeed(edge.id);
  return {
    delay: Number(((seed % 1100) / 1000 + index * 0.18).toFixed(2)),
    duration: Number((focused ? 1.28 + (seed % 7) * 0.11 : 1.8 + (seed % 9) * 0.12).toFixed(2)),
  };
}

function metricCount(nodes: VaultGraphNode[], colorGroups: VaultGraphColorGroup[]) {
  return nodes.filter((node) => colorGroups.includes(node.color_group)).length;
}

function VaultGraphTopOverlay({
  activeFilter,
  onFilterChange,
  search,
  onSearchChange,
  visibleCount,
  nodes,
  apiStatus,
  graphResponse,
}: {
  activeFilter: VaultGraphFilter;
  onFilterChange: (filter: VaultGraphFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  visibleCount: number;
  nodes: VaultGraphNode[];
  apiStatus: VaultGraphApiStatus;
  graphResponse: VaultGraphApiResponse;
}) {
  const metrics = [
    { label: "Knowledge", groups: ["accepted_knowledge"] as VaultGraphColorGroup[] },
    { label: "Sources", groups: ["sources"] as VaultGraphColorGroup[] },
    { label: "Agents", groups: ["agents", "runtime"] as VaultGraphColorGroup[] },
    { label: "Proposals", groups: ["proposals", "content_outputs"] as VaultGraphColorGroup[] },
    { label: "Decisions", groups: ["decisions", "governance"] as VaultGraphColorGroup[] },
  ];

  return (
    <div className="relative z-30 flex flex-col gap-3 rounded-[26px] border border-white/10 bg-slate-950/52 p-3 shadow-[0_20px_70px_rgba(0,0,0,0.35)] backdrop-blur-xl xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {filters.map((filter) => (
          <button
            key={filter.label}
            type="button"
            onClick={() => onFilterChange(filter.label)}
            className={cn(
              "h-9 rounded-full border px-3.5 text-xs font-bold transition",
              activeFilter === filter.label
                ? "border-cyan-300/40 bg-cyan-300/14 text-cyan-100 shadow-[0_0_28px_rgba(34,211,238,0.22)]"
                : "border-white/8 bg-white/[0.035] text-slate-400 hover:border-white/16 hover:bg-white/[0.07] hover:text-slate-100",
            )}
          >
            {filter.label}
          </button>
        ))}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-violet-100">
            Mock API
          </span>
          <span className="rounded-full border border-cyan-300/14 bg-cyan-300/[0.06] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100/80">
            Read-only
          </span>
          <span className="rounded-full border border-emerald-300/14 bg-emerald-300/[0.06] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-100/80">
            No Vault mutation
          </span>
          {apiStatus === "fallback" ? (
            <span className="rounded-full border border-amber-300/14 bg-amber-300/[0.06] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-amber-100/80">
              Local fallback
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="hidden items-center gap-2 2xl:flex">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-white/8 bg-white/[0.045] px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{metric.label}</div>
              <div className="mt-0.5 text-sm font-bold text-slate-100">{metricCount(nodes, metric.groups)}</div>
            </div>
          ))}
        </div>
        <div className="relative w-full lg:w-72">
          <icons.Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search graph..."
            className="h-10 rounded-full border-white/10 bg-black/24 pl-9 text-sm text-slate-100 shadow-none placeholder:text-slate-500"
          />
        </div>
        <span className="whitespace-nowrap rounded-full border border-white/8 bg-white/[0.045] px-3 py-2 text-xs font-semibold text-slate-400">
          {visibleCount} nodes
        </span>
        <span className="whitespace-nowrap rounded-full border border-white/8 bg-white/[0.035] px-3 py-2 text-[11px] font-semibold text-slate-500">
          {apiStatus === "loading" ? "Loading" : graphResponse.source_root}
        </span>
      </div>
    </div>
  );
}

function VaultGraphCanvas({
  nodes,
  edges,
  selectedNode,
  hoveredNodeId,
  search,
  zoom,
  onSelectNode,
  onHoverNode,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: {
  nodes: VaultGraphNode[];
  edges: VaultGraphEdge[];
  selectedNode: VaultGraphNode | null;
  hoveredNodeId: string | null;
  search: string;
  zoom: number;
  onSelectNode: (node: VaultGraphNode) => void;
  onHoverNode: (nodeId: string | null) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const focusedId = hoveredNodeId ?? selectedNode?.id ?? null;
  const shouldDimByFocus = Boolean(hoveredNodeId || (selectedNode && selectedNode.id !== "workspace-holdstation"));
  const relatedIds = useMemo(() => relatedNodeIds(edges, focusedId), [edges, focusedId]);
  const hasSearch = search.trim().length > 0;
  const centerX = graphWidth / 2;
  const centerY = graphHeight / 2;
  const renderZoom = Math.min(1.16, Math.max(0.9, zoom));
  const decorativeNodes = useMemo(() => nodes.filter((node) => !isSemanticNode(node)), [nodes]);
  const semanticNodes = useMemo(() => nodes.filter(isSemanticNode), [nodes]);
  const localEdges = useMemo(() => edges.filter((edge) => isLocalEdge(edge, nodeById)), [edges, nodeById]);
  const bridgeEdges = useMemo(() => edges.filter((edge) => !isLocalEdge(edge, nodeById)), [edges, nodeById]);
  const visibleClusterIds = useMemo(() => new Set(nodes.map((node) => node.cluster_id).filter(Boolean)), [nodes]);
  const idleSignalEdges = useMemo(
    () =>
      bridgeEdges
        .filter((edge) => {
          const source = nodeById.get(edge.source);
          const target = nodeById.get(edge.target);
          return Boolean(
            source &&
              target &&
              !isDecorativeEdge(edge) &&
              (source.type === "workspace" || target.type === "workspace" || isClusterHub(source) || isClusterHub(target)),
          );
        })
        .slice(0, 7),
    [bridgeEdges, nodeById],
  );
  const focusedSignalEdges = useMemo(() => {
    if (!focusedId) {
      return [];
    }

    return edges.filter((edge) => edgeTouches(edge, focusedId) && !isDecorativeEdge(edge)).slice(0, 6);
  }, [edges, focusedId]);
  const signalEdges = useMemo(() => {
    const seen = new Set<string>();
    return [...idleSignalEdges, ...focusedSignalEdges]
      .filter((edge) => {
        if (seen.has(edge.id)) {
          return false;
        }
        seen.add(edge.id);
        return true;
      })
      .slice(0, hoveredNodeId || (selectedNode && selectedNode.id !== "workspace-holdstation") ? 12 : 8);
  }, [focusedSignalEdges, hoveredNodeId, idleSignalEdges, selectedNode]);

  return (
    <div className="relative min-h-[720px] overflow-hidden rounded-[30px] border border-white/8 bg-black/20 xl:min-h-[calc(100vh-245px)] xl:max-h-[840px]">
      <svg
        aria-label="Mock Vault Graph"
        className="relative z-10 h-[720px] min-h-[720px] w-full xl:h-[calc(100vh-245px)] xl:max-h-[840px]"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        viewBox={`${graphViewBox.x} ${graphViewBox.y} ${graphViewBox.width} ${graphViewBox.height}`}
      >
        <defs>
          <radialGradient id="stageGlow" cx="50%" cy="50%" r="62%">
            <stop offset="0%" stopColor="#312e81" stopOpacity="0.46" />
            <stop offset="42%" stopColor="#0f172a" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#020617" stopOpacity="0" />
          </radialGradient>
          <filter id="darkNodeGlow" x="-140%" y="-140%" width="380%" height="380%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="darkSelectedGlow" x="-190%" y="-190%" width="480%" height="480%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="signalGlow" x="-180%" y="-180%" width="460%" height="460%">
            <feGaussianBlur stdDeviation="4.4" result="signalBlur" />
            <feMerge>
              <feMergeNode in="signalBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="workspaceDarkGradient" cx="35%" cy="26%" r="76%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="36%" stopColor="#c4b5fd" stopOpacity="1" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="1" />
          </radialGradient>
        </defs>
        <style>
          {`
            .vault-stage-shimmer {
              animation: vaultStageShimmer 9s ease-in-out infinite;
            }

            .vault-star-shimmer {
              animation: vaultStarShimmer 6.8s ease-in-out infinite;
            }

            .vault-cluster-orbit {
              animation: vaultOrbitBreath 8.8s ease-in-out infinite;
            }

            .vault-node-ambient-ring {
              animation: vaultNodePulse 5.2s ease-in-out infinite;
              transform-box: fill-box;
              transform-origin: center;
            }

            .vault-node-arrival-ring {
              animation: vaultNodeArrival 1.45s ease-out infinite;
              transform-box: fill-box;
              transform-origin: center;
            }

            .vault-selected-ring {
              animation: vaultSelectedRing 2.7s ease-in-out infinite;
            }

            .vault-signal-trace {
              stroke-dasharray: 2 20;
              animation: vaultSignalTrace 3.8s linear infinite;
            }

            @keyframes vaultStageShimmer {
              0%, 100% { opacity: 0.82; }
              50% { opacity: 1; }
            }

            @keyframes vaultStarShimmer {
              0%, 100% { opacity: 0.08; }
              44% { opacity: 0.34; }
            }

            @keyframes vaultOrbitBreath {
              0%, 100% { stroke-opacity: 0.025; }
              50% { stroke-opacity: 0.075; }
            }

            @keyframes vaultNodePulse {
              0%, 100% { opacity: 0.045; }
              50% { opacity: 0.2; }
            }

            @keyframes vaultNodeArrival {
              0%, 100% { opacity: 0.08; }
              42% { opacity: 0.36; }
            }

            @keyframes vaultSelectedRing {
              0%, 100% { stroke-opacity: 0.45; }
              50% { stroke-opacity: 0.86; }
            }

            @keyframes vaultSignalTrace {
              from { stroke-dashoffset: 0; }
              to { stroke-dashoffset: -88; }
            }

            @media (prefers-reduced-motion: reduce) {
              .vault-stage-shimmer,
              .vault-star-shimmer,
              .vault-cluster-orbit,
              .vault-node-ambient-ring,
              .vault-node-arrival-ring,
              .vault-selected-ring,
              .vault-signal-trace {
                animation: none;
              }
            }
          `}
        </style>

        <rect className="vault-stage-shimmer" x={graphViewBox.x} y={graphViewBox.y} width={graphViewBox.width} height={graphViewBox.height} fill="url(#stageGlow)" opacity="0.9" />
        <g opacity="0.55">
          {starField.map((star) => (
            <circle
              key={star.id}
              className={prefersReducedMotion ? undefined : "vault-star-shimmer"}
              cx={star.x}
              cy={star.y}
              fill="#e0f2fe"
              opacity={star.opacity}
              r={star.r}
              style={{ animationDelay: `${animationDelay(star.id, 7)}s` }}
            />
          ))}
        </g>

        <g transform={`translate(${centerX} ${centerY}) scale(${renderZoom}) translate(${-centerX} ${-centerY})`}>
          <g>
            {vaultGraphClusters
              .filter((cluster) => visibleClusterIds.has(cluster.id))
              .map((cluster) => {
                const color = colorSystem[cluster.color_group];
                return (
                  <g key={cluster.id}>
                    <ellipse
                      className={prefersReducedMotion ? undefined : "vault-cluster-orbit"}
                      cx={cluster.center.x}
                      cy={cluster.center.y}
                      fill="none"
                      rx={cluster.halo.rx * 0.58}
                      ry={cluster.halo.ry * 0.54}
                      stroke={color.edge}
                      strokeDasharray="1 18"
                      strokeLinecap="round"
                      strokeOpacity="0.055"
                      strokeWidth="0.75"
                      transform={`rotate(${cluster.halo.rotate} ${cluster.center.x} ${cluster.center.y})`}
                      style={{ animationDelay: `${animationDelay(`${cluster.id}-orbit`, 6)}s` }}
                    />
                  </g>
                );
              })}
          </g>

          {[...localEdges, ...bridgeEdges].map((edge) => {
            const source = nodeById.get(edge.source);
            const target = nodeById.get(edge.target);
            if (!source || !target) {
              return null;
            }

            const local = isLocalEdge(edge, nodeById);
            const isFocused = edgeTouches(edge, focusedId);
            const sourceColor = colorSystem[source.color_group].edge;
            const dimmed = shouldDimByFocus ? !isFocused : false;

            return (
              <path
                key={edge.id}
                className={isFocused && !prefersReducedMotion ? "vault-signal-trace" : undefined}
                d={edgePath(source, target, edge, local)}
                fill="none"
                stroke={sourceColor}
                strokeLinecap="round"
                strokeOpacity={isFocused ? 0.68 : dimmed ? 0.035 : local ? 0.18 : 0.11}
                strokeWidth={isFocused ? 1.2 : local ? 0.72 : 0.62}
              />
            );
          })}

          {!prefersReducedMotion ? (
            <g className="pointer-events-none">
              {signalEdges.map((edge, index) => {
                const source = nodeById.get(edge.source);
                const target = nodeById.get(edge.target);
                if (!source || !target) {
                  return null;
                }

                const local = isLocalEdge(edge, nodeById);
                const pathId = `vault-signal-path-${edge.id}`;
                const path = edgePath(source, target, edge, local);
                const color = colorSystem[source.color_group];
                const focused = edgeTouches(edge, focusedId);
                const timing = signalTiming(edge, index, focused);

                return (
                  <g key={edge.id}>
                    <path id={pathId} d={path} fill="none" stroke="none" />
                    <circle fill={color.edge} filter="url(#signalGlow)" opacity="0" r={focused ? 4.2 : 3.1}>
                      <animate attributeName="opacity" begin={`${timing.delay}s`} dur={`${timing.duration}s`} keyTimes="0;0.16;0.74;1" repeatCount="indefinite" values="0;0.95;0.58;0" />
                      <animateMotion begin={`${timing.delay}s`} dur={`${timing.duration}s`} repeatCount="indefinite" rotate="auto">
                        <mpath href={`#${pathId}`} />
                      </animateMotion>
                    </circle>
                    <circle fill={color.fill} filter="url(#signalGlow)" opacity="0" r={focused ? 8 : 6}>
                      <animate attributeName="opacity" begin={`${timing.delay + 0.05}s`} dur={`${timing.duration}s`} keyTimes="0;0.12;0.46;1" repeatCount="indefinite" values="0;0.2;0.09;0" />
                      <animateMotion begin={`${timing.delay + 0.05}s`} dur={`${timing.duration}s`} repeatCount="indefinite" rotate="auto">
                        <mpath href={`#${pathId}`} />
                      </animateMotion>
                    </circle>
                  </g>
                );
              })}
            </g>
          ) : null}

          {decorativeNodes.map((node) => {
            const isRelated = relatedIds.has(node.id);
            const searchMatch = matchesSearch(node, search);
            const color = colorSystem[node.color_group];
            const radius = getNodeRadius(node);
            const dimmedByFocus = shouldDimByFocus ? !isRelated : false;
            const dimmedBySearch = hasSearch && !searchMatch;

            return (
              <circle
                key={node.id}
                cx={node.x}
                cy={node.y}
                fill={color.fill}
                filter="url(#darkNodeGlow)"
                opacity={dimmedByFocus || dimmedBySearch ? 0.16 : 0.88}
                r={radius}
              />
            );
          })}

          {semanticNodes.map((node) => {
            const isSelected = selectedNode?.id === node.id;
            const isHovered = hoveredNodeId === node.id;
            const isRelated = relatedIds.has(node.id);
            const searchMatch = matchesSearch(node, search);
            const color = colorSystem[node.color_group];
            const radius = getNodeRadius(node);
            const dimmedByFocus = shouldDimByFocus ? !isRelated : false;
            const dimmedBySearch = hasSearch && !searchMatch;
            const showLabel = isHovered || isSelected;
            const shouldPulseArrival = isRelated && (Boolean(hoveredNodeId) || selectedNode?.id !== "workspace-holdstation");

            return (
              <g
                key={node.id}
                className="cursor-pointer outline-none"
                onClick={() => onSelectNode(node)}
                onFocus={() => onHoverNode(node.id)}
                onMouseEnter={() => onHoverNode(node.id)}
                onMouseLeave={() => onHoverNode(null)}
                tabIndex={0}
                role="button"
                aria-label={`Select ${node.label}`}
              >
                {!prefersReducedMotion ? (
                  <circle
                    className={shouldPulseArrival ? "vault-node-arrival-ring" : "vault-node-ambient-ring"}
                    cx={node.x}
                    cy={node.y}
                    fill={color.fill}
                    opacity="0.08"
                    r={radius + (isClusterHub(node) ? 16 : 11)}
                    style={{ animationDelay: `${animationDelay(node.id, 5)}s` }}
                  />
                ) : null}
                {isSelected ? (
                  <>
                    <circle
                      cx={node.x}
                      cy={node.y}
                      fill={node.type === "workspace" ? "#8b5cf6" : color.fill}
                      filter="url(#darkSelectedGlow)"
                      opacity="0.48"
                      r={radius + (node.type === "workspace" ? 36 : 26)}
                    />
                    <circle
                      className={prefersReducedMotion ? undefined : "vault-selected-ring"}
                      cx={node.x}
                      cy={node.y}
                      fill="none"
                      r={radius + 12}
                      stroke={color.stroke}
                      strokeOpacity="0.95"
                      strokeWidth="2"
                    />
                    <circle
                      cx={node.x}
                      cy={node.y}
                      fill="none"
                      r={radius + 22}
                      stroke={node.type === "workspace" ? "#22d3ee" : color.edge}
                      strokeDasharray="2 8"
                      strokeLinecap="round"
                      strokeOpacity="0.6"
                      strokeWidth="1.35"
                    />
                  </>
                ) : null}
                {isHovered ? <circle cx={node.x} cy={node.y} fill={color.fill} opacity="0.24" r={radius + 14} /> : null}
                <circle
                  cx={node.x}
                  cy={node.y}
                  fill={node.type === "workspace" ? "url(#workspaceDarkGradient)" : color.fill}
                  filter="url(#darkNodeGlow)"
                  opacity={dimmedByFocus || dimmedBySearch ? 0.28 : 1}
                  r={radius}
                  stroke={isSelected ? "#ffffff" : color.stroke}
                  strokeOpacity={isSelected ? 0.95 : 0.72}
                  strokeWidth={isSelected ? 2.2 : isHovered ? 1.8 : 1.1}
                />
                {node.collapsed ? (
                  <text
                    x={node.x}
                    y={node.y + 4.5}
                    textAnchor="middle"
                    className="pointer-events-none fill-slate-950 text-[12px] font-black"
                  >
                    {node.type === "session_aggregate" ? "18" : "G"}
                  </text>
                ) : (
                  <circle cx={node.x - radius * 0.22} cy={node.y - radius * 0.25} fill="#ffffff" opacity="0.72" r={Math.max(1.8, radius * 0.22)} />
                )}
                {hasSearch && searchMatch ? (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    fill="none"
                    r={radius + 7}
                    stroke="#ffffff"
                    strokeDasharray="4 5"
                    strokeOpacity="0.64"
                    strokeWidth="1.2"
                  />
                ) : null}
                {showLabel ? (
                  <g>
                    <rect
                      x={node.x - 96}
                      y={node.y - radius - 42}
                      width="192"
                      height="30"
                      rx="15"
                      fill="rgba(15,23,42,0.88)"
                      stroke="rgba(148,163,184,0.32)"
                    />
                    <text
                      x={node.x}
                      y={node.y - radius - 22}
                      textAnchor="middle"
                      className="pointer-events-none fill-white text-[12px] font-bold"
                    >
                      {node.label}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </g>

      </svg>

      <div className="pointer-events-none absolute inset-0 z-20 rounded-[30px] bg-[radial-gradient(circle_at_50%_45%,transparent_0%,transparent_54%,rgba(0,0,0,0.42)_100%)]" />

      <div className="absolute right-4 top-4 z-30 overflow-hidden rounded-full border border-white/10 bg-slate-950/54 p-1 shadow-[0_16px_38px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <div className="flex items-center gap-1">
          <Button aria-label="Zoom out" size="icon" variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={onZoomOut}>
            <icons.ChevronDown />
          </Button>
          <button
            type="button"
            onClick={onZoomReset}
            className="h-10 min-w-14 rounded-full px-3 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button aria-label="Zoom in" size="icon" variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={onZoomIn}>
            <icons.ChevronUp />
          </Button>
        </div>
      </div>

      {selectedNode ? (
        <div className="absolute bottom-5 left-5 z-30 flex max-w-[calc(100%-220px)] items-center gap-3 rounded-full border border-white/10 bg-slate-950/64 px-4 py-2.5 text-sm font-semibold text-slate-200 shadow-[0_20px_48px_rgba(0,0,0,0.3)] backdrop-blur-xl">
          <span className="size-2 rounded-full" style={{ backgroundColor: colorSystem[selectedNode.color_group].stroke, boxShadow: `0 0 16px ${colorSystem[selectedNode.color_group].glow}` }} />
          <span className="truncate">Selected: {selectedNode.label}</span>
          <span className="hidden text-slate-600 sm:inline">/</span>
          <span className="hidden truncate text-slate-400 sm:inline">{typeLabel[selectedNode.type]}</span>
        </div>
      ) : null}

      <VaultGraphMiniMap nodes={nodes} selectedNode={selectedNode} />
    </div>
  );
}

function VaultGraphMiniMap({
  nodes,
  selectedNode,
}: {
  nodes: VaultGraphNode[];
  selectedNode: VaultGraphNode | null;
}) {
  const visibleClusterIds = useMemo(() => new Set(nodes.map((node) => node.cluster_id).filter(Boolean)), [nodes]);

  return (
    <div className="absolute bottom-5 right-5 z-30 h-30 w-44 rounded-2xl border border-white/10 bg-slate-950/68 p-3 shadow-[0_20px_48px_rgba(0,0,0,0.32)] backdrop-blur-xl">
      <svg aria-label="Vault Graph minimap" className="h-full w-full" viewBox={`0 0 ${graphWidth} ${graphHeight}`}>
        <rect x="0" y="0" width={graphWidth} height={graphHeight} rx="54" fill="#020617" />
        {vaultGraphClusters
          .filter((cluster) => visibleClusterIds.has(cluster.id))
          .map((cluster) => (
            <ellipse
              key={cluster.id}
              cx={cluster.center.x}
              cy={cluster.center.y}
              fill={colorSystem[cluster.color_group].fill}
              opacity="0.18"
              rx={cluster.halo.rx}
              ry={cluster.halo.ry}
              transform={`rotate(${cluster.halo.rotate} ${cluster.center.x} ${cluster.center.y})`}
            />
          ))}
        {nodes.map((node) => {
          const selected = selectedNode?.id === node.id;
          const semantic = isSemanticNode(node);
          return (
            <circle
              key={node.id}
              cx={node.x}
              cy={node.y}
              fill={colorSystem[node.color_group].fill}
              opacity={selected ? 1 : semantic ? 0.8 : 0.66}
              r={selected ? 16 : semantic ? 7 : 3.1}
              stroke={selected ? "#ffffff" : "transparent"}
              strokeWidth="4"
            />
          );
        })}
        <rect x="72" y="52" width="1056" height="716" rx="42" fill="none" stroke="#a78bfa" strokeDasharray="16 16" strokeOpacity="0.45" strokeWidth="6" />
      </svg>
    </div>
  );
}

function VaultGraphNodeDetails({
  node,
  edges,
  nodes,
}: {
  node: VaultGraphNode | null;
  edges: VaultGraphEdge[];
  nodes: VaultGraphNode[];
}) {
  const relatedEdges = node ? edges.filter((edge) => edgeTouches(edge, node.id) && !isDecorativeEdge(edge)) : [];
  const color = node ? colorSystem[node.color_group] : colorSystem.workspace;
  const bars = [
    { label: "Confidence", value: node?.type === "workspace" ? 94 : 78, color: color.stroke },
    { label: "Trace", value: node?.collapsed ? 64 : 86, color: color.edge },
    { label: "Freshness", value: node?.status === "active" ? 92 : 73, color: "#e2e8f0" },
  ];

  return (
    <aside className="h-fit rounded-[28px] border border-white/10 bg-slate-950/54 p-4 text-slate-100 shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl xl:min-h-[calc(100vh-245px)] xl:max-h-[840px] xl:overflow-auto">
      {node ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div
              className="grid size-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.055]"
              style={{ color: color.stroke, boxShadow: `0 0 34px ${color.glow}` }}
            >
              {node.type === "agent" ? (
                <icons.Bot className="size-5" />
              ) : node.type === "decision" || node.type === "governance" ? (
                <icons.ShieldCheck className="size-5" />
              ) : node.type === "source_note" || node.type === "source_asset" ? (
                <icons.FileText className="size-5" />
              ) : node.type === "proposal" || node.type === "content_output" ? (
                <icons.PencilLine className="size-5" />
              ) : (
                <icons.Database className="size-5" />
              )}
            </div>
            <span className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-300">
              {node.collapsed ? "Collapsed" : node.status}
            </span>
          </div>

          <div className="mt-5">
            <CardTitle className="text-xl leading-tight text-white">{node.label}</CardTitle>
            <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-400">
              <span>{typeLabel[node.type]}</span>
              <span className="size-1 rounded-full bg-slate-600" />
              <span className={color.darkText}>{color.label}</span>
            </div>
            <CardDescription className="mt-3 text-sm leading-5 text-slate-400">
              {node.description ?? "Mock graph node for the Phase 1 Vault Graph preview."}
            </CardDescription>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Connections</div>
              <div className="mt-1 text-3xl font-black tracking-tight text-white">{relatedEdges.length}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Visibility</div>
              <div className="mt-2 truncate text-sm font-bold text-slate-200">{node.visibility}</div>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {bars.map((bar) => (
              <div key={bar.label}>
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.13em] text-slate-500">
                  <span>{bar.label}</span>
                  <span>{bar.value}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${bar.value}%`, backgroundColor: bar.color, boxShadow: `0 0 18px ${bar.color}` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Related items</div>
            <div className="space-y-2">
              {relatedEdges.slice(0, 4).map((edge) => {
                const otherId = edge.source === node.id ? edge.target : edge.source;
                const other = nodes.find((item) => item.id === otherId);
                return (
                  <div key={edge.id} className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{
                        backgroundColor: colorSystem[other?.color_group ?? node.color_group].fill,
                        boxShadow: `0 0 14px ${colorSystem[other?.color_group ?? node.color_group].glow}`,
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-slate-200">{other?.label ?? edge.relation}</div>
                      <div className="truncate text-[11px] text-slate-500">{edge.relation}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Button className="mt-5 w-full rounded-2xl bg-cyan-300 text-slate-950 shadow-[0_0_36px_rgba(34,211,238,0.24)] hover:bg-cyan-200">
            <icons.Search />
            Inspect mock node
          </Button>
        </>
      ) : (
        <div className="py-8 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-cyan-200">
            <icons.Package className="size-5" />
          </div>
          <CardTitle className="mt-4 text-lg text-white">Select a node</CardTitle>
          <CardDescription className="mt-2 text-slate-400">Choose a semantic graph node to inspect its mock metadata.</CardDescription>
        </div>
      )}
    </aside>
  );
}

export function VaultGraphPage() {
  const [activeFilter, setActiveFilter] = useState<VaultGraphFilter>("All");
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("workspace-holdstation");
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [graphResponse, setGraphResponse] = useState<VaultGraphApiResponse>(fallbackGraphResponse);
  const [apiStatus, setApiStatus] = useState<VaultGraphApiStatus>("loading");
  const graphData: VaultGraphData = graphResponse;

  useEffect(() => {
    const controller = new AbortController();

    async function loadGraph() {
      try {
        const response = await fetch("/api/cmo/vault-graph", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Vault Graph API returned ${response.status}`);
        }

        const payload: unknown = await response.json();
        if (!isVaultGraphApiResponse(payload)) {
          throw new Error("Vault Graph API response did not match cmo.vault_graph.v1.");
        }

        setGraphResponse(payload);
        setApiStatus("mock-api");
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setGraphResponse(fallbackGraphResponse);
        setApiStatus("fallback");
      }
    }

    loadGraph();
    return () => controller.abort();
  }, []);

  const visibleNodes = useMemo(() => {
    const active = filters.find((filter) => filter.label === activeFilter);
    if (!active?.types && !active?.colorGroups) {
      return graphData.nodes;
    }

    return graphData.nodes.filter(
      (node) => active.types?.includes(node.type) || active.colorGroups?.includes(node.color_group),
    );
  }, [activeFilter, graphData.nodes]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () =>
      graphData.edges.filter(
        (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
      ),
    [graphData.edges, visibleNodeIds],
  );
  const selectedNode =
    visibleNodes.find((node) => node.id === selectedNodeId && isSemanticNode(node)) ??
    visibleNodes.find(isSemanticNode) ??
    vaultGraphSemanticNodes[0] ??
    null;

  return (
    <PageChrome
      title="Vault Graph"
      description="Orbit UI constellation view for workspace knowledge, sources, agents, decisions, and outputs."
      actions={
        <Badge variant="slate" className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
          Mock
        </Badge>
      }
    >
      <div className="relative left-1/2 -mt-2 w-[calc(100vw-2rem)] -translate-x-1/2 sm:w-[calc(100vw-3rem)] lg:w-[calc(100vw-4rem)] xl:w-[calc(100vw-282px-2rem)]">
        <div className="relative min-h-[calc(100vh-132px)] overflow-hidden rounded-[36px] border border-slate-900/10 bg-[#020617] p-3 shadow-[0_34px_110px_rgba(15,23,42,0.22)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_45%_35%,rgba(59,130,246,0.22),transparent_32%),radial-gradient(circle_at_72%_68%,rgba(217,70,239,0.16),transparent_28%),linear-gradient(135deg,#020617_0%,#07111f_48%,#020617_100%)]" />
          <div className="pointer-events-none absolute inset-0 rounded-[36px] ring-1 ring-inset ring-white/10" />

          <div className="relative z-10 space-y-3">
            <VaultGraphTopOverlay
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              search={search}
              onSearchChange={setSearch}
              visibleCount={visibleNodes.length}
              nodes={visibleNodes}
              apiStatus={apiStatus}
              graphResponse={graphResponse}
            />

            <div className="grid gap-3 xl:min-h-[calc(100vh-205px)] xl:grid-cols-[minmax(0,1fr)_280px] 2xl:grid-cols-[minmax(0,1fr)_320px]">
              <VaultGraphCanvas
                edges={visibleEdges}
                nodes={visibleNodes}
                search={search}
                selectedNode={selectedNode}
                hoveredNodeId={hoveredNodeId}
                zoom={zoom}
                onSelectNode={(node) => {
                  if (isSemanticNode(node)) {
                    setSelectedNodeId(node.id);
                  }
                }}
                onHoverNode={setHoveredNodeId}
                onZoomIn={() => setZoom((value) => Math.min(1.16, Number((value + 0.08).toFixed(2))))}
                onZoomOut={() => setZoom((value) => Math.max(0.9, Number((value - 0.08).toFixed(2))))}
                onZoomReset={() => setZoom(1)}
              />
              <VaultGraphNodeDetails node={selectedNode} edges={visibleEdges} nodes={graphData.nodes} />
            </div>
          </div>
        </div>
      </div>
    </PageChrome>
  );
}
