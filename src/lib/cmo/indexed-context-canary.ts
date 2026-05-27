import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  CMOContextDiagnostics,
  CMOContextQualitySummary,
  CMOContextNote,
  ContextItem,
  VaultNoteRef,
} from "@/lib/cmo/app-workspace-types";
import type { BuildContextPackResult } from "@/lib/cmo/context-pack-builder";
import {
  resolveIndexedContextDryRun,
  type IndexedChatSessionRecord,
  type IndexedContextResolverInput,
  type IndexedGBrainCandidateRecord,
  type IndexedVaultCaptureRecord,
} from "@/lib/cmo/indexed-context-resolver";
import {
  getCmoIndexedContextCanaryApps,
  getCmoIndexedContextMode,
  getSupabaseEnvStatus,
  isCmoIndexedContextEnabled,
} from "@/lib/supabase/config";

const APP_CHAT_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "cmo-dashboard", "app-chat");
const APP_CHAT_PREFIX = "data/cmo-dashboard/app-chat/";
const CMO_ENGINE_VAULT_PATH = "/home/ju/.openclaw/workspace/knowledge/cmo-engine-vault";

type CanaryPreviewSourceType = "session_json" | "vault_capture" | "gbrain_candidate";

export interface IndexedContextSupplementSource {
  id: string;
  sourceType: CanaryPreviewSourceType;
  title?: string;
  path: string | null;
  visibility?: string | null;
  createdAt?: string | null;
  excerpt: string;
  whySelected: string;
}

export interface IndexedContextSupplement {
  enabled: boolean;
  used: boolean;
  appId: string;
  mode: "supplemental";
  sources: IndexedContextSupplementSource[];
  text: string;
  warnings: string[];
  fallbackReason?: string;
}

const MAX_SESSION_SOURCES = 3;
const MAX_CAPTURE_SOURCES = 3;
const MAX_CANDIDATE_SOURCES = 3;
const MAX_EXCERPT_CHARS = 500;

function compactText(value: string | undefined | null, maxChars = MAX_EXCERPT_CHARS): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function disabled(appId: string, fallbackReason: string): IndexedContextSupplement {
  return {
    enabled: false,
    used: false,
    appId,
    mode: "supplemental",
    sources: [],
    text: "",
    warnings: [],
    fallbackReason,
  };
}

function skipped(appId: string, fallbackReason: string, warnings: string[] = []): IndexedContextSupplement {
  return {
    enabled: true,
    used: false,
    appId,
    mode: "supplemental",
    sources: [],
    text: "",
    warnings,
    fallbackReason,
  };
}

function canaryEnabledForApp(appId: string): boolean {
  return getCmoIndexedContextCanaryApps().includes(appId);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeResolveSessionJson(requestedPath: string | null): string | null {
  if (!requestedPath) {
    return null;
  }

  if (path.isAbsolute(requestedPath)) {
    const resolved = path.resolve(requestedPath);
    return isInside(APP_CHAT_DIR, resolved) ? resolved : null;
  }

  const normalized = requestedPath.replaceAll("\\", "/");
  const repoRelativePath = normalized.startsWith(APP_CHAT_PREFIX) ? normalized : `${APP_CHAT_PREFIX}${normalized}`;
  const resolved = path.resolve(/*turbopackIgnore: true*/ process.cwd(), repoRelativePath);
  return isInside(APP_CHAT_DIR, resolved) ? resolved : null;
}

function safeResolveVaultPath(requestedPath: string | null): string | null {
  if (!requestedPath || path.isAbsolute(requestedPath)) {
    return null;
  }

  const resolved = path.resolve(CMO_ENGINE_VAULT_PATH, requestedPath.replaceAll("\\", "/"));
  return isInside(CMO_ENGINE_VAULT_PATH, resolved) ? resolved : null;
}

function parseFrontmatter(markdown: string): { frontmatter: Record<string, string>; body: string } {
  if (!markdown.startsWith("---\n")) {
    return { frontmatter: {}, body: markdown };
  }

  const end = markdown.indexOf("\n---", 4);
  if (end === -1) {
    return { frontmatter: {}, body: markdown };
  }

  const frontmatter: Record<string, string> = {};
  for (const line of markdown.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    frontmatter[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }

  return { frontmatter, body: markdown.slice(end + 5).trim() };
}

function markdownSection(body: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`^##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?:\\n##\\s+|$)`, "im"));
  return match?.[1]?.trim() ?? null;
}

function sessionExcerpt(session: Record<string, unknown>): string {
  const topic = typeof session.topic === "string" ? session.topic : "";
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const recent = messages
    .slice(-3)
    .map((message) => {
      if (!message || typeof message !== "object") {
        return null;
      }
      const role = "role" in message && typeof message.role === "string" ? message.role : "message";
      const content = "content" in message && typeof message.content === "string" ? message.content : "";
      return content ? `${role}: ${compactText(content, 180)}` : null;
    })
    .filter((item): item is string => Boolean(item));

  return compactText([topic ? `Topic: ${topic}` : "", ...recent].filter(Boolean).join("\n"));
}

function captureExcerpt(markdown: string): string {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const sections = [
    frontmatter.title,
    markdownSection(body, "Summary"),
    markdownSection(body, "Source / Provenance"),
    markdownSection(body, "Key Findings / Outputs"),
    markdownSection(body, "Proposed Memory"),
    markdownSection(body, "Candidate"),
  ].filter(Boolean);

  return compactText(sections.join("\n") || body);
}

async function previewSession(record: IndexedChatSessionRecord, warnings: string[]): Promise<IndexedContextSupplementSource | null> {
  const safePath = safeResolveSessionJson(record.jsonPath);
  if (!safePath) {
    warnings.push(`Unsafe or missing session json_path skipped: ${record.id}`);
    return null;
  }

  try {
    const parsed = JSON.parse(await readFile(safePath, "utf8")) as Record<string, unknown>;
    return {
      id: record.id,
      sourceType: "session_json",
      title: "Indexed Session",
      path: record.jsonPath,
      visibility: record.userId ? "private_or_user_scoped" : "legacy_or_workspace",
      createdAt: record.createdAt,
      excerpt: sessionExcerpt(parsed),
      whySelected: "Selected by Supabase chat_sessions_index metadata for this workspace.",
    };
  } catch (error) {
    warnings.push(`Session preview failed for ${record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    return null;
  }
}

async function previewCapture(record: IndexedVaultCaptureRecord, warnings: string[]): Promise<IndexedContextSupplementSource | null> {
  const safePath = safeResolveVaultPath(record.vaultPath);
  if (!safePath) {
    warnings.push(`Unsafe or missing capture vault_path skipped: ${record.id}`);
    return null;
  }

  try {
    return {
      id: record.id,
      sourceType: "vault_capture",
      title: "Indexed Vault Capture",
      path: record.vaultPath,
      visibility: record.visibility,
      createdAt: record.createdAt,
      excerpt: captureExcerpt(await readFile(safePath, "utf8")),
      whySelected: "Selected by Supabase vault_captures_index metadata after visibility filtering.",
    };
  } catch (error) {
    warnings.push(`Capture preview failed for ${record.vaultPath ?? record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    return null;
  }
}

async function previewCandidate(record: IndexedGBrainCandidateRecord, warnings: string[]): Promise<IndexedContextSupplementSource | null> {
  const safePath = safeResolveVaultPath(record.sourcePath);
  if (!safePath) {
    warnings.push(`Unsafe or missing candidate source_path skipped: ${record.id}`);
    return null;
  }

  try {
    return {
      id: record.id,
      sourceType: "gbrain_candidate",
      title: "Indexed GBrain Candidate",
      path: record.sourcePath,
      visibility: record.visibility,
      createdAt: record.createdAt,
      excerpt: captureExcerpt(await readFile(safePath, "utf8")),
      whySelected: "Selected by Supabase gbrain_candidates_index metadata after visibility filtering.",
    };
  } catch (error) {
    warnings.push(`Candidate preview failed for ${record.sourcePath ?? record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    return null;
  }
}

async function previewIndexedRecordsForCanary(
  records: Awaited<ReturnType<typeof resolveIndexedContextDryRun>>["records"],
): Promise<{ sources: IndexedContextSupplementSource[]; warnings: string[] }> {
  const warnings: string[] = [];
  const sessions = (
    await Promise.all(records.sessions.slice(0, MAX_SESSION_SOURCES).map((record) => previewSession(record, warnings)))
  ).filter((item): item is IndexedContextSupplementSource => Boolean(item));
  const captures = (
    await Promise.all(records.captures.slice(0, MAX_CAPTURE_SOURCES).map((record) => previewCapture(record, warnings)))
  ).filter((item): item is IndexedContextSupplementSource => Boolean(item));
  const candidates = (
    await Promise.all(records.candidates.slice(0, MAX_CANDIDATE_SOURCES).map((record) => previewCandidate(record, warnings)))
  ).filter((item): item is IndexedContextSupplementSource => Boolean(item));

  return {
    sources: [...sessions, ...captures, ...candidates],
    warnings,
  };
}

function supplementText(sources: IndexedContextSupplementSource[]): string {
  return [
    "## Indexed Context Supplement",
    "",
    "Use these snippets as supporting context only. Current Priority, App Memory, Business Metrics, and Promotion Candidates remain higher authority.",
    "This supplement was selected from permission-filtered Supabase metadata indexes, then read from JSON/Vault source files as short excerpts.",
    "",
    ...sources.flatMap((source, index) => [
      `### ${index + 1}. ${source.title ?? source.sourceType}`,
      `Type: ${source.sourceType}`,
      source.path ? `Path: ${source.path}` : "Path: unavailable",
      source.createdAt ? `Created: ${source.createdAt}` : "",
      `Reason: ${source.whySelected}`,
      "",
      source.excerpt,
      "",
    ]),
  ].filter(Boolean).join("\n");
}

function tokenEstimate(content: string): number {
  return Math.ceil(content.length / 4);
}

function summaryWithSupplement(summary: CMOContextQualitySummary): CMOContextQualitySummary {
  return {
    ...summary,
    selectedCount: summary.selectedCount + 1,
    existingCount: summary.existingCount + 1,
    draftCount: summary.draftCount + 1,
    placeholderOrDraftCount: summary.placeholderOrDraftCount + 1,
  };
}

function diagnosticsWithSupplement(diagnostics: CMOContextDiagnostics, text: string): CMOContextDiagnostics {
  return {
    ...summaryWithSupplement(diagnostics),
    totalChars: diagnostics.totalChars + text.length,
  };
}

export async function buildIndexedContextSupplement(
  input: IndexedContextResolverInput,
): Promise<IndexedContextSupplement> {
  if (!isCmoIndexedContextEnabled()) {
    return disabled(input.appId, "CMO_INDEXED_CONTEXT_ENABLED is false");
  }

  if (getCmoIndexedContextMode() !== "supplemental") {
    return skipped(input.appId, "CMO_INDEXED_CONTEXT_MODE is not supplemental");
  }

  if (!canaryEnabledForApp(input.appId)) {
    return skipped(input.appId, "app_not_in_canary_list");
  }

  if (!input.userId?.trim()) {
    return skipped(input.appId, "missing_user_id");
  }

  const envStatus = getSupabaseEnvStatus();
  if (envStatus.missingAdmin.length) {
    return skipped(input.appId, `missing_supabase_admin_env:${envStatus.missingAdmin.join(",")}`);
  }

  try {
    const resolverOutput = await resolveIndexedContextDryRun({
      ...input,
      includeSystem: false,
      limit: Math.min(input.limit ?? 6, 6),
    });
    const preview = await previewIndexedRecordsForCanary(resolverOutput.records);
    const warnings = [...new Set([...resolverOutput.warnings, ...preview.warnings])];

    if (warnings.length) {
      return skipped(input.appId, "indexed_context_warnings", warnings);
    }

    if (!resolverOutput.ok) {
      return skipped(input.appId, "indexed_context_not_ok", warnings);
    }

    const sources = preview.sources;
    if (!sources.length) {
      return skipped(input.appId, "no_preview_sources");
    }

    const text = supplementText(sources);

    return {
      enabled: true,
      used: true,
      appId: input.appId,
      mode: "supplemental",
      sources,
      text,
      warnings: [],
    };
  } catch (error) {
    return skipped(input.appId, error instanceof Error ? error.message : "indexed_context_canary_failed");
  }
}

export function applyIndexedContextSupplement(
  result: BuildContextPackResult,
  supplement: IndexedContextSupplement,
): BuildContextPackResult {
  if (!supplement.used || !supplement.text) {
    return result;
  }

  const item: ContextItem = {
    id: `${result.contextPack.appId}-indexed-context-supplement`,
    kind: "indexed_context_supplement",
    title: "Indexed Context Supplement",
    source: {
      sourceId: result.contextPack.sourceId,
      type: "indexed_context_preview",
      label: "Permission-filtered indexed context",
      path: "supabase-index://cmo-engine/context-preview",
    },
    inclusionReason: "Feature-flagged U7D canary supplement from permission-filtered indexed context previews.",
    exists: true,
    content: supplement.text,
    contentPreview: compactText(supplement.text, 420),
    contextQuality: "draft",
    tokenEstimate: tokenEstimate(supplement.text),
    truncated: false,
    itemCount: supplement.sources.length,
  };
  const note: CMOContextNote = {
    title: item.title,
    path: item.source.path ?? item.source.label,
    type: "app-note",
    exists: true,
    content: item.content,
    truncated: false,
    contextQuality: item.contextQuality,
    qualityReason: item.inclusionReason,
  };
  const ref: VaultNoteRef = {
    id: item.id,
    title: item.title,
    path: item.source.path ?? item.source.label,
    type: "app-note",
    reason: item.inclusionReason,
    selected: true,
    exists: true,
    contentPreview: item.contentPreview,
    contextQuality: item.contextQuality,
  };
  const contextQualitySummary = summaryWithSupplement(result.contextQualitySummary);
  const contextDiagnostics = diagnosticsWithSupplement(result.contextDiagnostics, supplement.text);
  const contextPack = {
    ...result.contextPack,
    items: [...result.contextPack.items, item],
    tokenBudget: {
      ...result.contextPack.tokenBudget,
      estimatedTokens: result.contextPack.tokenBudget.estimatedTokens + item.tokenEstimate,
    },
    contextQualitySummary,
  };

  return {
    ...result,
    contextPack,
    contextUsed: [...result.contextUsed, ref],
    contextDiagnostics,
    contextQualitySummary,
    contextPackage: {
      ...result.contextPackage,
      contextPack,
      selectedContext: [...result.contextPackage.selectedContext, note],
      contextQualitySummary,
    },
  };
}

export const __indexedContextCanaryTest = {
  compactText,
  canaryEnabledForApp,
  previewIndexedRecordsForCanary,
  supplementText,
};
