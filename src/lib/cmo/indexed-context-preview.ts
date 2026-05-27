import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  IndexedChatSessionRecord,
  IndexedContextResolverOutput,
  IndexedGBrainCandidateRecord,
  IndexedVaultCaptureRecord,
} from "@/lib/cmo/indexed-context-resolver";
import { CMO_ENGINE_VAULT_PATH } from "@/lib/cmo/vault-capture-paths";

const APP_CHAT_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "app-chat");
const APP_CHAT_PREFIX = "data/cmo-dashboard/app-chat/";
const SESSION_EXCERPT_CHARS = 560;
const CAPTURE_EXCERPT_CHARS = 700;
const CANDIDATE_EXCERPT_CHARS = 520;

export interface IndexedContextPreviewInput {
  resolverOutput: IndexedContextResolverOutput;
  vaultRoot?: string;
  appChatRoot?: string;
}

export interface IndexedContextPreviewItem {
  sourceType: "session_json" | "vault_capture" | "gbrain_candidate";
  id: string;
  path: string | null;
  sourceAgent?: string | null;
  mode?: string | null;
  sourceClass?: string | null;
  visibility?: string | null;
  createdAt?: string | null;
  excerpt: string;
  whySelected: string;
}

export interface IndexedContextPreviewOutput {
  ok: boolean;
  dryRun: true;
  workspaceId?: string;
  organizationId?: string;
  contextPreview: {
    sessions: IndexedContextPreviewItem[];
    captures: IndexedContextPreviewItem[];
    candidates: IndexedContextPreviewItem[];
  };
  warnings: string[];
}

function compactText(value: string | undefined | null, maxChars: number): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeResolveUnder(root: string, requestedPath: string | null | undefined): string | null {
  if (!requestedPath) {
    return null;
  }

  if (path.isAbsolute(requestedPath)) {
    return null;
  }

  const normalized = requestedPath.replaceAll("\\", "/");
  const resolved = path.resolve(root, normalized);
  return isInside(root, resolved) ? resolved : null;
}

function safeResolveSessionJson(appChatRoot: string, requestedPath: string | null | undefined): string | null {
  if (!requestedPath) {
    return null;
  }

  if (path.isAbsolute(requestedPath)) {
    const resolved = path.resolve(requestedPath);
    return isInside(appChatRoot, resolved) ? resolved : null;
  }

  const normalized = requestedPath.replaceAll("\\", "/");
  const repoRelativePath = normalized.startsWith(APP_CHAT_PREFIX) ? normalized : `${APP_CHAT_PREFIX}${normalized}`;
  const resolved = path.resolve(process.cwd(), repoRelativePath);
  return isInside(appChatRoot, resolved) ? resolved : null;
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

    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[match[1]] = value;
  }

  return { frontmatter, body: markdown.slice(end + 5).trim() };
}

function markdownSection(body: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`^##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?:\\n##\\s+|$)`, "im"));
  return match?.[1]?.trim() ?? null;
}

function recentConversationExcerpt(session: Record<string, unknown>): string {
  const topic = typeof session.topic === "string" ? session.topic : "";
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const recent = messages
    .slice(-4)
    .map((message) => {
      if (!message || typeof message !== "object") {
        return null;
      }
      const role = "role" in message && typeof message.role === "string" ? message.role : "message";
      const content = "content" in message && typeof message.content === "string" ? message.content : "";
      return content ? `${role}: ${compactText(content, 180)}` : null;
    })
    .filter((item): item is string => Boolean(item));

  return compactText([topic ? `Topic: ${topic}` : "", ...recent].filter(Boolean).join("\n"), SESSION_EXCERPT_CHARS);
}

function captureExcerpt(markdown: string): { title?: string; excerpt: string } {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const summary = markdownSection(body, "Summary");
  const source = markdownSection(body, "Source / Provenance");
  const findings = markdownSection(body, "Key Findings / Outputs");
  const excerpt = [summary, source, findings]
    .filter(Boolean)
    .map((section) => section?.replace(/^[-*]\s+/gm, ""))
    .join("\n");
  return {
    title: frontmatter.title,
    excerpt: compactText(excerpt || body, CAPTURE_EXCERPT_CHARS),
  };
}

function candidateExcerpt(markdown: string): { title?: string; excerpt: string } {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const proposed = markdownSection(body, "Proposed Memory") ?? markdownSection(body, "Candidate") ?? body;
  return {
    title: frontmatter.title,
    excerpt: compactText(proposed, CANDIDATE_EXCERPT_CHARS),
  };
}

async function previewSession(
  record: IndexedChatSessionRecord,
  input: { appChatRoot: string; warnings: string[] },
): Promise<IndexedContextPreviewItem | null> {
  const safePath = safeResolveSessionJson(input.appChatRoot, record.jsonPath);
  if (!safePath) {
    input.warnings.push(`Unsafe or missing session json_path skipped: ${record.id}`);
    return null;
  }

  try {
    const parsed = JSON.parse(await readFile(safePath, "utf8")) as Record<string, unknown>;
    return {
      sourceType: "session_json",
      id: record.id,
      path: record.jsonPath,
      visibility: record.userId ? "private_or_user_scoped" : "legacy_or_workspace",
      createdAt: record.createdAt,
      excerpt: recentConversationExcerpt(parsed),
      whySelected: "Selected by Supabase chat_sessions_index metadata for this workspace.",
    };
  } catch (error) {
    input.warnings.push(`Session preview failed for ${record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    return null;
  }
}

async function previewCapture(
  record: IndexedVaultCaptureRecord,
  input: { vaultRoot: string; warnings: string[] },
): Promise<IndexedContextPreviewItem | null> {
  const safePath = safeResolveUnder(input.vaultRoot, record.vaultPath);
  if (!safePath) {
    input.warnings.push(`Unsafe or missing capture vault_path skipped: ${record.id}`);
    return null;
  }

  try {
    const preview = captureExcerpt(await readFile(safePath, "utf8"));
    return {
      sourceType: "vault_capture",
      id: record.id,
      path: record.vaultPath,
      sourceAgent: record.sourceAgent,
      mode: record.mode,
      sourceClass: record.sourceClass,
      visibility: record.visibility,
      createdAt: record.createdAt,
      excerpt: preview.title ? `${preview.title}\n${preview.excerpt}` : preview.excerpt,
      whySelected: "Selected by Supabase vault_captures_index metadata after visibility filtering.",
    };
  } catch (error) {
    input.warnings.push(`Capture preview failed for ${record.vaultPath ?? record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    return null;
  }
}

async function previewCandidate(
  record: IndexedGBrainCandidateRecord,
  input: { vaultRoot: string; warnings: string[] },
): Promise<IndexedContextPreviewItem | null> {
  const safePath = safeResolveUnder(input.vaultRoot, record.sourcePath);
  if (!safePath) {
    input.warnings.push(`Unsafe or missing candidate source_path skipped: ${record.id}`);
    return null;
  }

  try {
    const preview = candidateExcerpt(await readFile(safePath, "utf8"));
    return {
      sourceType: "gbrain_candidate",
      id: record.id,
      path: record.sourcePath,
      visibility: record.visibility,
      createdAt: record.createdAt,
      excerpt: preview.title ? `${preview.title}\n${preview.excerpt}` : preview.excerpt,
      whySelected: "Selected by Supabase gbrain_candidates_index metadata after visibility filtering.",
    };
  } catch (error) {
    input.warnings.push(`Candidate preview failed for ${record.sourcePath ?? record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    return null;
  }
}

export async function buildIndexedContextPreview(
  input: IndexedContextPreviewInput,
): Promise<IndexedContextPreviewOutput> {
  const warnings = [...input.resolverOutput.warnings];
  const appChatRoot = path.resolve(input.appChatRoot ?? APP_CHAT_DIR);
  const vaultRoot = path.resolve(input.vaultRoot ?? process.env.CMO_ENGINE_VAULT_PATH ?? CMO_ENGINE_VAULT_PATH);

  const sessions = (
    await Promise.all(input.resolverOutput.records.sessions.map((record) => previewSession(record, { appChatRoot, warnings })))
  ).filter((item): item is IndexedContextPreviewItem => Boolean(item));
  const captures = (
    await Promise.all(input.resolverOutput.records.captures.map((record) => previewCapture(record, { vaultRoot, warnings })))
  ).filter((item): item is IndexedContextPreviewItem => Boolean(item));
  const candidates = (
    await Promise.all(input.resolverOutput.records.candidates.map((record) => previewCandidate(record, { vaultRoot, warnings })))
  ).filter((item): item is IndexedContextPreviewItem => Boolean(item));

  return {
    ok: input.resolverOutput.ok && warnings.length === 0,
    dryRun: true,
    workspaceId: input.resolverOutput.workspaceId,
    organizationId: input.resolverOutput.organizationId,
    contextPreview: {
      sessions,
      captures,
      candidates,
    },
    warnings,
  };
}

export const __indexedContextPreviewTest = {
  compactText,
  safeResolveUnder,
  safeResolveSessionJson,
  parseFrontmatter,
  recentConversationExcerpt,
  captureExcerpt,
  candidateExcerpt,
};
