import "server-only";

import { buildContextPack } from "@/lib/cmo/context-pack-builder";
import type { ContextItem, ContextItemKind } from "@/lib/cmo/app-workspace-types";

export type IndexedCanonicalContextSourceType =
  | "current_priority"
  | "app_memory"
  | "business_metrics"
  | "promotion_candidates";

export interface IndexedCanonicalContextInput {
  appId: string;
  workspaceKey?: string;
  limit?: number;
}

export interface IndexedCanonicalContextSource {
  id: string;
  sourceType: IndexedCanonicalContextSourceType;
  title: string;
  path?: string | null;
  key?: string;
  status: "included" | "missing";
  quality?: string | null;
  excerpt: string;
  whySelected: string;
  warning?: string;
  origin: "canonical_context";
}

export interface IndexedCanonicalContextPreview {
  ok: boolean;
  dryRun: true;
  workspaceId?: string;
  sourceId?: string;
  appId: string;
  sources: IndexedCanonicalContextSource[];
  warnings: string[];
}

const CANONICAL_SOURCE_TYPES: IndexedCanonicalContextSourceType[] = [
  "current_priority",
  "app_memory",
  "business_metrics",
  "promotion_candidates",
];

function isCanonicalSourceType(value: ContextItemKind): value is IndexedCanonicalContextSourceType {
  return CANONICAL_SOURCE_TYPES.includes(value as IndexedCanonicalContextSourceType);
}

function isCanonicalItem(item: ContextItem): item is ContextItem & { kind: IndexedCanonicalContextSourceType } {
  return isCanonicalSourceType(item.kind);
}

function compactText(value: string | undefined | null, maxChars = 520): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function titleFor(sourceType: IndexedCanonicalContextSourceType): string {
  switch (sourceType) {
    case "current_priority":
      return "Current Priority";
    case "app_memory":
      return "App Memory";
    case "business_metrics":
      return "Business Metrics";
    case "promotion_candidates":
      return "Promotion Candidates";
  }
}

function missingSource(
  appId: string,
  sourceType: IndexedCanonicalContextSourceType,
): IndexedCanonicalContextSource {
  return {
    id: `${appId}-canonical-${sourceType}`,
    sourceType,
    title: titleFor(sourceType),
    key: sourceType,
    status: "missing",
    quality: "missing",
    excerpt: "",
    whySelected: "Canonical context adapter expected this source, but it was unavailable in the current context pack.",
    warning: `canonical_${sourceType}_missing`,
    origin: "canonical_context",
  };
}

export async function resolveCanonicalContextPreview(
  input: IndexedCanonicalContextInput,
): Promise<IndexedCanonicalContextPreview> {
  const warnings: string[] = [];

  try {
    const result = await buildContextPack({
      appId: input.appId,
      runtimeMode: "fallback",
      maxItemChars: 1_200,
    });
    const sources = result.contextPack.items
      .filter(isCanonicalItem)
      .map<IndexedCanonicalContextSource>((item) => {
        const warning = item.exists ? undefined : `canonical_${item.kind}_missing`;
        if (warning) {
          warnings.push(warning);
        }

        return {
          id: `canonical:${item.id}`,
          sourceType: item.kind,
          title: item.title,
          path: item.source.path ?? item.source.label,
          key: item.kind,
          status: item.exists ? "included" : "missing",
          quality: item.contextQuality,
          excerpt: compactText(item.contentPreview || item.content),
          whySelected: `Canonical context adapter: ${item.inclusionReason}`,
          ...(warning ? { warning } : {}),
          origin: "canonical_context",
        };
      });
    const presentTypes = new Set(sources.map((source) => source.sourceType));

    for (const sourceType of CANONICAL_SOURCE_TYPES) {
      if (!presentTypes.has(sourceType)) {
        const source = missingSource(input.appId, sourceType);
        sources.push(source);
        warnings.push(source.warning ?? `canonical_${sourceType}_missing`);
      }
    }

    return {
      ok: warnings.length === 0,
      dryRun: true,
      workspaceId: result.contextPack.workspaceId,
      sourceId: result.contextPack.sourceId,
      appId: result.contextPack.appId,
      sources,
      warnings: [...new Set(warnings)],
    };
  } catch (error) {
    warnings.push(`Canonical context preview failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return {
      ok: false,
      dryRun: true,
      appId: input.appId,
      sources: CANONICAL_SOURCE_TYPES.map((sourceType) => missingSource(input.appId, sourceType)),
      warnings,
    };
  }
}

export const __indexedCanonicalContextTest = {
  compactText,
  missingSource,
  isCanonicalSourceType,
};
