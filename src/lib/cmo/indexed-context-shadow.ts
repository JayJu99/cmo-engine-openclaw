import "server-only";

import { buildContextPack } from "@/lib/cmo/context-pack-builder";
import { buildIndexedContextPreview, type IndexedContextPreviewItem } from "@/lib/cmo/indexed-context-preview";
import {
  resolveIndexedContextDryRun,
  type IndexedContextResolverInput,
  type IndexedContextResolverOutput,
} from "@/lib/cmo/indexed-context-resolver";

type ShadowRecommendation = "keep_current" | "canary_indexed" | "needs_more_data";

export type ContextPipelineShadowInput = IndexedContextResolverInput;

export interface ContextPipelineShadowSource {
  id: string;
  sourceType: string;
  title?: string;
  path?: string | null;
  status?: string | null;
  quality?: string | null;
  visibility?: string | null;
  createdAt?: string | null;
  excerpt?: string;
  whySelected: string;
  legacyContext?: boolean;
}

export interface ContextPipelineShadowOutput {
  ok: boolean;
  dryRun: true;
  currentPipeline: {
    sources: ContextPipelineShadowSource[];
    summary: string;
    warnings: string[];
  };
  indexedPipeline: {
    sources: ContextPipelineShadowSource[];
    summary: string;
    warnings: string[];
  };
  comparison: {
    overlap: string[];
    indexedOnly: string[];
    currentOnly: string[];
    missingRisks: string[];
    leakRisks: string[];
    recommendation: ShadowRecommendation;
  };
  safety: {
    noWrites: true;
    noRuntimeInjection: true;
    permissionFiltered: true;
  };
}

function compactText(value: string | undefined | null, maxChars = 420): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function sourceKey(source: ContextPipelineShadowSource): string {
  return [source.sourceType, source.path ?? source.id].join(":").toLowerCase();
}

function summarizeSources(label: string, sources: ContextPipelineShadowSource[], warnings: string[]): string {
  const counts = sources.reduce<Record<string, number>>((acc, source) => {
    acc[source.sourceType] = (acc[source.sourceType] ?? 0) + 1;
    return acc;
  }, {});
  const parts = Object.entries(counts).map(([type, count]) => `${type}: ${count}`);
  return `${label}: ${sources.length} source(s)${parts.length ? ` (${parts.join(", ")})` : ""}${warnings.length ? `; ${warnings.length} warning(s)` : ""}.`;
}

async function currentContextSnapshot(input: ContextPipelineShadowInput): Promise<{
  sources: ContextPipelineShadowSource[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  try {
    const result = await buildContextPack({
      appId: input.appId,
      runtimeMode: "fallback",
      maxItemChars: 1_200,
    });
    const sources: ContextPipelineShadowSource[] = result.contextPack.items.map((item) => ({
      id: item.id,
      sourceType: item.kind,
      title: item.title,
      path: item.source.path ?? item.source.label,
      status: item.exists ? "included" : "missing",
      quality: item.contextQuality,
      excerpt: compactText(item.contentPreview || item.content),
      whySelected: item.inclusionReason,
    }));

    for (const hint of result.contextPack.graphHints ?? []) {
      sources.push({
        id: hint.id,
        sourceType: `graph_hint:${hint.sourceType}`,
        title: hint.title,
        path: hint.path,
        status: hint.exists ? "included" : "missing",
        quality: hint.confidence,
        excerpt: compactText(hint.contentPreview),
        whySelected: hint.reason,
      });
    }

    return { sources, warnings };
  } catch (error) {
    warnings.push(`Current context snapshot failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return { sources: [], warnings };
  }
}

function previewSource(source: IndexedContextPreviewItem): ContextPipelineShadowSource {
  return {
    id: source.id,
    sourceType: source.sourceType,
    path: source.path,
    visibility: source.visibility,
    createdAt: source.createdAt,
    excerpt: compactText(source.excerpt),
    whySelected: source.whySelected,
    legacyContext: source.visibility === "legacy_or_workspace",
  };
}

async function indexedContextSnapshot(input: ContextPipelineShadowInput): Promise<{
  resolverOutput: IndexedContextResolverOutput;
  sources: ContextPipelineShadowSource[];
  warnings: string[];
}> {
  const resolverOutput = await resolveIndexedContextDryRun(input);
  const preview = await buildIndexedContextPreview({ resolverOutput });
  const sources = [
    ...preview.contextPreview.sessions.map(previewSource),
    ...preview.contextPreview.captures.map(previewSource),
    ...preview.contextPreview.candidates.map(previewSource),
  ];

  return {
    resolverOutput,
    sources,
    warnings: preview.warnings,
  };
}

function leakRisks(input: ContextPipelineShadowInput, indexed: {
  resolverOutput: IndexedContextResolverOutput;
  sources: ContextPipelineShadowSource[];
}): string[] {
  const risks: string[] = [];

  if (!indexed.resolverOutput.workspaceId) {
    risks.push("indexed_workspace_unresolved");
  }

  const privateForeign = [
    ...indexed.resolverOutput.records.captures,
    ...indexed.resolverOutput.records.candidates,
  ].filter((record) => record.visibility === "private" && record.userId && record.userId !== input.userId);
  if (privateForeign.length) {
    risks.push(`private_foreign_records:${privateForeign.length}`);
  }

  const systemForMember = [
    ...indexed.resolverOutput.records.captures,
    ...indexed.resolverOutput.records.candidates,
  ].filter((record) => record.visibility === "system" && !input.isOwnerOrAdmin);
  if (systemForMember.length) {
    risks.push(`system_records_for_non_admin:${systemForMember.length}`);
  }

  const legacy = indexed.sources.filter((source) => source.legacyContext).length;
  if (legacy) {
    risks.push(`legacy_context_null_user:${legacy}`);
  }

  return risks;
}

function missingRisks(current: ContextPipelineShadowSource[], indexed: ContextPipelineShadowSource[]): string[] {
  const risks: string[] = [];
  const indexedTypes = new Set(indexed.map((source) => source.sourceType));
  const currentTypes = new Set(current.map((source) => source.sourceType));
  for (const required of ["current_priority", "app_memory", "business_metrics"]) {
    if (currentTypes.has(required) && !indexedTypes.has(required)) {
      risks.push(`indexed_missing_${required}`);
    }
  }
  if (!indexed.length) {
    risks.push("indexed_selected_no_preview_sources");
  }
  return risks;
}

function recommendation(input: {
  current: ContextPipelineShadowSource[];
  indexed: ContextPipelineShadowSource[];
  missingRisks: string[];
  leakRisks: string[];
  indexedWarnings: string[];
}): ShadowRecommendation {
  if (input.leakRisks.some((risk) => !risk.startsWith("legacy_context_null_user"))) {
    return "keep_current";
  }

  if (input.indexedWarnings.length || input.missingRisks.length) {
    return "needs_more_data";
  }

  if (input.indexed.length >= 2 && input.indexed.length >= Math.min(input.current.length, 2)) {
    return "canary_indexed";
  }

  return "needs_more_data";
}

export async function compareContextPipelinesDryRun(
  input: ContextPipelineShadowInput,
): Promise<ContextPipelineShadowOutput> {
  const current = await currentContextSnapshot(input);
  const indexed = await indexedContextSnapshot(input);
  const currentKeys = new Map(current.sources.map((source) => [sourceKey(source), source]));
  const indexedKeys = new Map(indexed.sources.map((source) => [sourceKey(source), source]));
  const overlap = [...indexedKeys.keys()].filter((key) => currentKeys.has(key));
  const indexedOnly = [...indexedKeys.keys()].filter((key) => !currentKeys.has(key));
  const currentOnly = [...currentKeys.keys()].filter((key) => !indexedKeys.has(key));
  const leakRiskList = leakRisks(input, indexed);
  const missingRiskList = missingRisks(current.sources, indexed.sources);
  const rec = recommendation({
    current: current.sources,
    indexed: indexed.sources,
    missingRisks: missingRiskList,
    leakRisks: leakRiskList,
    indexedWarnings: indexed.warnings,
  });

  return {
    ok: current.warnings.length === 0 && indexed.warnings.length === 0 && leakRiskList.length === 0,
    dryRun: true,
    currentPipeline: {
      sources: current.sources,
      summary: summarizeSources("Current context snapshot", current.sources, current.warnings),
      warnings: current.warnings,
    },
    indexedPipeline: {
      sources: indexed.sources,
      summary: summarizeSources("Indexed context preview", indexed.sources, indexed.warnings),
      warnings: indexed.warnings,
    },
    comparison: {
      overlap,
      indexedOnly,
      currentOnly,
      missingRisks: missingRiskList,
      leakRisks: leakRiskList,
      recommendation: rec,
    },
    safety: {
      noWrites: true,
      noRuntimeInjection: true,
      permissionFiltered: true,
    },
  };
}

export const __indexedContextShadowTest = {
  sourceKey,
  missingRisks,
  leakRisks,
  recommendation,
};
