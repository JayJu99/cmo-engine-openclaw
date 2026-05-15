import { createHash } from "crypto";
import { readdir, readFile } from "fs/promises";
import path from "path";

import type {
  AppWorkspace,
  CMOContextBrief,
  CMOContextDiagnostics,
  CMOContextNote,
  CMOContextPackage,
  CMOContextQuality,
  CMOContextQualitySummary,
  CMOMissingContextNote,
  ContextExclusion,
  ContextItem,
  ContextPack,
  ContextPackRuntimeMode,
  VaultNoteRef,
} from "@/lib/cmo/app-workspace-types";
import { appNoteTemplates, getAppWorkspace, HOLDSTATION_WORKSPACE_ID } from "@/lib/cmo/app-workspaces";
import { getOpenClawWorkspaceId } from "@/lib/cmo/config";
import { analyzeContextQuality, summarizeContextQuality } from "@/lib/cmo/context-quality";
import { CmoAdapterError } from "@/lib/cmo/errors";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

const VAULT_ROOT = path.resolve(process.cwd(), "knowledge", "holdstation");
const APP_CHAT_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "app-chat");
const DEFAULT_MAX_ITEM_CHARS = 6_000;
const DEFAULT_MAX_INPUT_TOKENS = 12_000;
const APP_MEMORY_NOTE_IDS = new Set(["positioning", "audience", "product-notes", "content-notes", "decisions", "tasks", "learnings"]);

interface StoredSession {
  id: string;
  appId: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  savedToVault: boolean;
  sessionNotePath?: string;
  rawCapturePath?: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  suggestedActions: Array<{
    label: string;
  }>;
  contextUsed: VaultNoteRef[];
}

interface RawCaptureEntry {
  appName: string;
  topic: string;
  timestamp?: string;
  appId?: string;
  summary?: string;
}

interface PendingCandidate {
  id: string;
  sourcePath: string;
  topic: string;
  summary: string;
  sourceType: "cmo-session" | "raw-capture" | "daily-note";
  createdAt?: string;
}

export interface BuildContextPackOptions {
  workspaceId?: string;
  appId: string;
  runtimeMode?: ContextPackRuntimeMode;
  maxInputTokens?: number;
  maxItemChars?: number;
}

export interface BuildContextPackResult {
  app: AppWorkspace;
  contextPack: ContextPack;
  contextBrief: CMOContextBrief;
  contextPackage: CMOContextPackage;
  contextUsed: VaultNoteRef[];
  missingContext: VaultNoteRef[];
  contextDiagnostics: CMOContextDiagnostics;
  contextQualitySummary: CMOContextQualitySummary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeVaultRelativePath(relativeVaultPath: string): string {
  const trimmed = relativeVaultPath.trim().replaceAll("\\", "/").replace(/^\/+/, "");

  if (
    !trimmed ||
    trimmed.includes("\0") ||
    path.isAbsolute(trimmed) ||
    /^[A-Za-z]:/.test(trimmed) ||
    trimmed.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new CmoAdapterError("Vault note paths must be relative to knowledge/holdstation", 400, "context_pack_invalid_path");
  }

  const segments = trimmed.split("/").filter(Boolean);
  const resolved = path.resolve(VAULT_ROOT, ...segments);
  const rootWithSep = `${VAULT_ROOT}${path.sep}`;

  if (resolved !== VAULT_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new CmoAdapterError("Vault note path resolved outside knowledge/holdstation", 400, "context_pack_invalid_path");
  }

  return segments.join("/");
}

function vaultFilePath(relativeVaultPath: string): string {
  return path.resolve(VAULT_ROOT, ...normalizeVaultRelativePath(relativeVaultPath).split("/"));
}

async function readVaultText(relativeVaultPath: string): Promise<string | null> {
  try {
    return await readFile(vaultFilePath(relativeVaultPath), "utf8");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function stripFrontmatter(content: string): string {
  return content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function compactText(value: string, limit = 700): string {
  const compacted = stripFrontmatter(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return compacted.length > limit ? `${compacted.slice(0, limit - 3)}...` : compacted;
}

function limitedContent(content: string, maxItemChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxItemChars) {
    return { content, truncated: false };
  }

  return {
    content: `${content.slice(0, maxItemChars)}\n\n[Truncated by context-pack-v1.]`,
    truncated: true,
  };
}

function tokenEstimate(content: string): number {
  return Math.ceil(content.length / 4);
}

function itemQuality(title: string, content: string | null): ReturnType<typeof analyzeContextQuality> {
  return analyzeContextQuality({
    title,
    exists: content !== null,
    content,
  });
}

function contextItemToVaultRef(item: ContextItem): VaultNoteRef {
  return {
    id: item.id,
    title: item.title,
    path: item.source.path ?? item.source.label,
    type: "app-note",
    reason: item.inclusionReason,
    selected: true,
    exists: item.exists,
    contentPreview: item.contentPreview,
    contextQuality: item.contextQuality,
  };
}

function contextItemToNote(item: ContextItem): CMOContextNote {
  return {
    title: item.title,
    path: item.source.path ?? item.source.label,
    type: "app-note",
    exists: true,
    content: item.content,
    truncated: item.truncated,
    contextQuality: item.contextQuality,
    qualityReason: item.inclusionReason,
  };
}

function missingItemToNote(item: ContextItem): CMOMissingContextNote {
  return {
    title: item.title,
    path: item.source.path ?? item.source.label,
    type: "app-note",
    exists: false,
    content: "",
    truncated: false,
    reason: "file_not_found",
    contextQuality: "missing",
    qualityReason: item.inclusionReason,
  };
}

function fixedExclusions(): ContextExclusion[] {
  return [
    {
      id: "full-raw-capture",
      label: "Full Raw Capture.md",
      reason: "Raw captures stay available for audit and promotion, but full raw text is not injected into executive CMO context by default.",
      policy: "excluded_by_context_pack_v1",
    },
    {
      id: "unrelated-app-notes",
      label: "Unrelated app notes",
      reason: "The context pack is scoped to the resolved workspace app.",
      policy: "excluded_by_context_pack_v1",
    },
    {
      id: "archived-notes",
      label: "Archived notes",
      reason: "Archived material is excluded from default executive context until explicitly promoted back into active app memory.",
      policy: "excluded_by_context_pack_v1",
    },
    {
      id: "all-vault-rag",
      label: "All-Vault RAG",
      reason: "Phase 1.75 uses deterministic workspace/app/path policy only.",
      policy: "excluded_by_context_pack_v1",
    },
    {
      id: "fake-metrics",
      label: "Fake metrics",
      reason: "Metrics are only included when a real app-scoped source is provided.",
      policy: "excluded_by_context_pack_v1",
    },
    {
      id: "fake-task-tracker",
      label: "Fake Task Tracker",
      reason: "Task Tracker is not treated as connected unless a real integration is available.",
      policy: "excluded_by_context_pack_v1",
    },
  ];
}

function physicalAppPath(app: AppWorkspace, fileName = ""): string {
  return fileName ? `${app.physicalAppVaultPath}/${fileName}` : app.physicalAppVaultPath;
}

function logicalAppPath(app: AppWorkspace, fileName = ""): string {
  return fileName ? `${app.logicalAppPath}/${fileName}` : app.logicalAppPath;
}

async function priorityItem(app: AppWorkspace, maxItemChars: number): Promise<ContextItem> {
  const canonicalPhysicalPath = physicalAppPath(app, "C-Level Priority.md");
  const canonicalLogicalPath = logicalAppPath(app, "C-Level Priority.md");
  const fallbackPhysicalPath = physicalAppPath(app, "C-Level Priorities.md");
  const fallbackLogicalPath = logicalAppPath(app, "C-Level Priorities.md");
  const canonicalContent = await readVaultText(canonicalPhysicalPath);
  const fallbackContent = canonicalContent === null ? await readVaultText(fallbackPhysicalPath) : null;
  const content = canonicalContent ?? fallbackContent;
  const quality = itemQuality("Current Priority", content);
  const limited = limitedContent(content ?? "", maxItemChars);

  return {
    id: `${app.id}-current-priority`,
    kind: "current_priority",
    title: "Current Priority",
    source: {
      sourceId: app.sourceId,
      type: "vault_note",
      label: "C-Level Priority",
      path: canonicalContent !== null ? canonicalLogicalPath : fallbackLogicalPath,
    },
    inclusionReason: "Current executive priority is always included for app-scoped CMO turns.",
    exists: content !== null,
    content: limited.content,
    contentPreview: content ? compactText(content, 420) : "No active priority note found.",
    contextQuality: quality.contextQuality,
    tokenEstimate: tokenEstimate(limited.content),
    truncated: limited.truncated,
  };
}

async function appMemoryItem(app: AppWorkspace, maxItemChars: number): Promise<ContextItem> {
  const canonicalPhysicalPath = physicalAppPath(app, "App Memory.md");
  const canonicalLogicalPath = logicalAppPath(app, "App Memory.md");
  const canonicalContent = await readVaultText(canonicalPhysicalPath);
  const memoryNotes = appNoteTemplates.filter((note) => APP_MEMORY_NOTE_IDS.has(note.id));
  const loaded = await Promise.all(
    memoryNotes.map(async (note) => {
      const physicalPath = physicalAppPath(app, note.fileName);
      const logicalPath = logicalAppPath(app, note.fileName);
      const content = await readVaultText(physicalPath);
      const quality = itemQuality(note.title, content);

      return {
        note,
        logicalPath,
        content,
        quality,
      };
    }),
  );
  const noteSections = loaded.map((entry) => [
    `## ${entry.note.title}`,
    `Source: ${entry.logicalPath}`,
    `Quality: ${entry.quality.contextQuality}`,
    "",
    entry.content ? stripFrontmatter(entry.content) : "Missing app memory note.",
  ].join("\n"));
  const sections = canonicalContent
    ? [
        [
          "## Canonical App Memory",
          `Source: ${canonicalLogicalPath}`,
          "",
          stripFrontmatter(canonicalContent),
        ].join("\n"),
        "## Supporting App Memory Notes",
        ...noteSections,
      ]
    : noteSections;
  const combined = sections.join("\n\n");
  const limited = limitedContent(combined, maxItemChars);
  const qualitySummary = summarizeContextQuality(
    [
      ...(canonicalContent
        ? [
            {
              exists: true,
              contextQuality: itemQuality("App Memory", canonicalContent).contextQuality,
            },
          ]
        : []),
      ...loaded.map((entry) => ({
        exists: entry.content !== null,
        contextQuality: entry.quality.contextQuality,
      })),
    ],
  );
  const quality: CMOContextQuality =
    qualitySummary.confirmedCount > 0
      ? "confirmed"
      : qualitySummary.draftCount > 0
        ? "draft"
        : qualitySummary.placeholderCount > 0
          ? "placeholder"
          : "missing";

  return {
    id: `${app.id}-app-memory`,
    kind: "app_memory",
    title: "App Memory",
    source: {
      sourceId: app.sourceId,
      type: "vault_bundle",
      label: "App Memory",
      path: canonicalContent !== null ? canonicalLogicalPath : app.logicalAppPath,
    },
    inclusionReason: "Durable app memory notes are included as the CMO baseline.",
    exists: canonicalContent !== null || loaded.some((entry) => entry.content !== null),
    content: limited.content,
    contentPreview: compactText(combined || "No app memory notes found.", 420),
    contextQuality: quality,
    tokenEstimate: tokenEstimate(limited.content),
    truncated: limited.truncated,
    itemCount: loaded.length,
  };
}

function normalizeSession(value: unknown): StoredSession | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringValue(value.id);
  const appId = stringValue(value.appId);

  if (!id || !appId) {
    return null;
  }

  const messages = Array.isArray(value.messages)
    ? value.messages
        .map((message) => {
          if (!isRecord(message)) {
            return null;
          }

          return {
            role: stringValue(message.role),
            content: stringValue(message.content),
          };
        })
        .filter((message): message is StoredSession["messages"][number] => Boolean(message))
    : [];
  const suggestedActions = Array.isArray(value.suggestedActions)
    ? value.suggestedActions
        .map((action) => (isRecord(action) ? { label: stringValue(action.label) } : null))
        .filter((action): action is StoredSession["suggestedActions"][number] => Boolean(action?.label))
    : [];

  return {
    id,
    appId,
    topic: stringValue(value.topic, "CMO session"),
    createdAt: stringValue(value.createdAt, new Date(0).toISOString()),
    updatedAt: stringValue(value.updatedAt, stringValue(value.createdAt, new Date(0).toISOString())),
    savedToVault: value.savedToVault === true,
    sessionNotePath: stringValue(value.sessionNotePath) || undefined,
    rawCapturePath: stringValue(value.rawCapturePath) || undefined,
    messages,
    suggestedActions,
    contextUsed: Array.isArray(value.contextUsed) ? (value.contextUsed as VaultNoteRef[]) : [],
  };
}

async function readStoredSessions(appId: string, limit: number): Promise<StoredSession[]> {
  try {
    const files = await readdir(APP_CHAT_DIR, { withFileTypes: true });
    const sessions = await Promise.all(
      files
        .filter((file) => file.isFile() && file.name.endsWith(".json"))
        .map(async (file) => normalizeSession(JSON.parse(await readFile(path.join(APP_CHAT_DIR, file.name), "utf8")) as unknown)),
    );

    return sessions
      .filter((session): session is StoredSession => Boolean(session))
      .filter((session) => session.appId === appId)
      .sort((left, right) => Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function sessionSummary(session: StoredSession): string {
  const userMessage = session.messages.find((message) => message.role === "user")?.content ?? "";
  const assistantMessage = [...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
  const actions = session.suggestedActions.length ? session.suggestedActions.map((action) => action.label).join("; ") : "No suggested actions captured.";
  const context = session.contextUsed.length ? session.contextUsed.map((note) => note.title).join(", ") : "No context refs captured.";

  return [
    `## ${session.topic}`,
    `Session: ${session.id}`,
    `Created: ${session.createdAt}`,
    `Saved to Vault: ${session.savedToVault ? "yes" : "no"}`,
    `Context refs: ${context}`,
    `User asked: ${compactText(userMessage, 420) || "No user message captured."}`,
    `CMO answered: ${compactText(assistantMessage, 700) || "No assistant answer captured."}`,
    `Suggested actions: ${actions}`,
  ].join("\n");
}

async function latestSessionsItem(app: AppWorkspace, maxItemChars: number): Promise<ContextItem> {
  const sessions = await readStoredSessions(app.id, 3);
  const content = sessions.map(sessionSummary).join("\n\n");
  const limited = limitedContent(content, maxItemChars);

  return {
    id: `${app.id}-latest-sessions`,
    kind: "latest_sessions",
    title: "Latest Sessions",
    source: {
      sourceId: app.sourceId,
      type: "session_store",
      label: "CMO Session summaries",
    },
    inclusionReason: "The latest one to three app CMO session summaries are included when available.",
    exists: sessions.length > 0,
    content: limited.content,
    contentPreview: content ? compactText(content, 420) : "No prior CMO sessions available.",
    contextQuality: sessions.length ? "draft" : "missing",
    tokenEstimate: tokenEstimate(limited.content),
    truncated: limited.truncated,
    itemCount: sessions.length,
  };
}

function rawVaultPath(date: string): string {
  return `06 Journal/Raw/${date}.md`;
}

function dailyVaultPath(date: string): string {
  return `06 Journal/Daily/${date}.md`;
}

function formatVaultDate(date = new Date(), timeZone = process.env.CMO_VAULT_TIME_ZONE ?? "Asia/Saigon"): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return `${parts.find((part) => part.type === "year")?.value ?? "1970"}-${parts.find((part) => part.type === "month")?.value ?? "01"}-${parts.find((part) => part.type === "day")?.value ?? "01"}`;
}

function markdownTopLevelSection(content: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^##\\s+${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n##\\s+|(?![\\s\\S]))`, "im"));

  return match?.[1]?.trim() ?? "";
}

function parseRawCaptures(content: string | null): RawCaptureEntry[] {
  if (!content) {
    return [];
  }

  const captures: RawCaptureEntry[] = [];
  const headingPattern = /^##\s+(.+?)\s+(?:-|\u2014)\s+(.+)$/gm;
  const matches = Array.from(content.matchAll(headingPattern));

  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? content.length;
    const section = content.slice(start, end);

    captures.push({
      appName: match[1]?.trim() ?? "",
      topic: match[2]?.trim() ?? "",
      timestamp: section.match(/^Time:\s*(.+)$/m)?.[1]?.trim(),
      appId: section.match(/^App ID:\s*(.+)$/m)?.[1]?.trim(),
      summary: markdownTopLevelSection(section, "Session Summary"),
    });
  });

  return captures;
}

function candidateId(parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

function sourceAlreadyPromoted(appMemoryContents: string[], sourcePath: string): boolean {
  return appMemoryContents.some((content) => content.includes(`Source: [[${sourcePath}]]`) || content.includes(`Source: [[${sourcePath}|`));
}

async function readAppMemoryContents(app: AppWorkspace): Promise<string[]> {
  const memoryNotes = appNoteTemplates.filter((note) => APP_MEMORY_NOTE_IDS.has(note.id));
  const contents = await Promise.all(memoryNotes.map((note) => readVaultText(physicalAppPath(app, note.fileName))));

  return contents.filter((content): content is string => Boolean(content));
}

async function pendingPromotionCandidates(app: AppWorkspace): Promise<PendingCandidate[]> {
  const date = formatVaultDate();
  const promotedContents = await readAppMemoryContents(app);
  const sessions = await readStoredSessions(app.id, 12);
  const rawPath = rawVaultPath(date);
  const rawContent = await readVaultText(rawPath);
  const dailyPath = dailyVaultPath(date);
  const dailyContent = await readVaultText(dailyPath);
  const sessionCandidates: PendingCandidate[] = sessions.map((session) => {
    const sourcePath = session.sessionNotePath || `app-chat/${session.id}`;
    const assistantAnswer = [...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? "";

    return {
      id: candidateId(["cmo-session", sourcePath, session.id]),
      sourcePath,
      sourceType: "cmo-session",
      topic: session.topic,
      summary: compactText(assistantAnswer || session.topic, 420),
      createdAt: session.createdAt,
    };
  });
  const rawCandidates = parseRawCaptures(rawContent)
    .filter((capture) => capture.appId === app.id || capture.appName === app.name)
    .slice(0, 8)
    .map((capture, index): PendingCandidate => {
      const sourcePath = `${rawPath}#${capture.topic.replace(/[^A-Za-z0-9 -]/g, "").trim().replace(/\s+/g, "-").slice(0, 64) || `capture-${index + 1}`}`;

      return {
        id: candidateId(["raw-capture", sourcePath, capture.timestamp ?? "", capture.topic]),
        sourcePath,
        sourceType: "raw-capture",
        topic: capture.topic,
        summary: compactText(capture.summary || capture.topic, 420),
        createdAt: capture.timestamp,
      };
    });
  const dailySummary = dailyContent
    ? markdownTopLevelSection(dailyContent, "Suggested Promotions") || markdownTopLevelSection(dailyContent, "Summary") || compactText(dailyContent, 420)
    : "";
  const dailyCandidates: PendingCandidate[] = dailySummary
    ? [
        {
          id: candidateId(["daily-note", dailyPath, dailySummary]),
          sourcePath: dailyPath,
          sourceType: "daily-note",
          topic: "Daily note suggested promotions",
          summary: compactText(dailySummary, 420),
        },
      ]
    : [];

  return [...sessionCandidates, ...rawCandidates, ...dailyCandidates]
    .filter((candidate) => !sourceAlreadyPromoted(promotedContents, candidate.sourcePath))
    .filter((candidate, index, list) => list.findIndex((item) => item.id === candidate.id) === index)
    .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? ""));
}

async function promotionCandidatesItem(app: AppWorkspace, maxItemChars: number): Promise<ContextItem> {
  const canonicalPhysicalPath = physicalAppPath(app, "Promotion Candidates.md");
  const canonicalLogicalPath = logicalAppPath(app, "Promotion Candidates.md");
  const canonicalContent = await readVaultText(canonicalPhysicalPath);
  const candidates = await pendingPromotionCandidates(app);
  const derivedContent = candidates.slice(0, 6).map((candidate) => [
    `## ${candidate.topic}`,
    `Source type: ${candidate.sourceType}`,
    `Source: ${candidate.sourcePath}`,
    candidate.summary,
  ].join("\n")).join("\n\n");
  const content = canonicalContent
    ? [
        "## Canonical Promotion Candidates",
        `Source: ${canonicalLogicalPath}`,
        "",
        stripFrontmatter(canonicalContent),
        derivedContent ? "## Derived Open Candidates" : "",
        derivedContent,
      ].filter(Boolean).join("\n\n")
    : derivedContent;
  const limited = limitedContent(content, maxItemChars);

  return {
    id: `${app.id}-promotion-candidates`,
    kind: "promotion_candidates",
    title: "Memory Candidates",
    source: {
      sourceId: app.sourceId,
      type: "derived_candidates",
      label: "Open Promotion Candidates",
      ...(canonicalContent !== null ? { path: canonicalLogicalPath } : {}),
    },
    inclusionReason: "Open app-scoped promotion candidates are included when deterministic session, raw, or daily sources are available.",
    exists: canonicalContent !== null || candidates.length > 0,
    content: limited.content,
    contentPreview: content ? compactText(content, 420) : "No open memory candidates available.",
    contextQuality: canonicalContent !== null || candidates.length ? "draft" : "missing",
    tokenEstimate: tokenEstimate(limited.content),
    truncated: limited.truncated,
    itemCount: Math.max(candidates.length, canonicalContent !== null ? 1 : 0),
  };
}

function contextBrief(app: AppWorkspace, contextPack: ContextPack): CMOContextBrief {
  const sectionLabel: Record<ContextItem["kind"], string> = {
    current_priority: "Current Priority",
    app_memory: "App Memory",
    latest_sessions: "Latest Sessions",
    promotion_candidates: "Memory Candidates",
  };

  return {
    policyVersion: contextPack.policyVersion,
    workspaceId: contextPack.workspaceId,
    appId: contextPack.appId,
    appName: app.name,
    appVaultPath: contextPack.appVaultPath,
    logicalAppPath: contextPack.logicalAppPath,
    runtimeMode: contextPack.runtimeMode,
    contextQualitySummary: contextPack.contextQualitySummary,
    tokenBudget: contextPack.tokenBudget,
    exclusions: contextPack.exclusions,
    sections: contextPack.items.map((item) => ({
      id: item.kind,
      label: sectionLabel[item.kind],
      status: item.exists ? "included" : "missing",
      itemCount: item.itemCount ?? (item.exists ? 1 : 0),
      quality: item.contextQuality,
    })),
  };
}

export async function buildContextPack(options: BuildContextPackOptions): Promise<BuildContextPackResult> {
  const app = getAppWorkspace(options.appId);

  if (!app) {
    throw new CmoAdapterError(`Unknown appId: ${options.appId}`, 404, "context_pack_unknown_app");
  }

  const registryEntry = requireWorkspaceRegistryEntry(app.id);
  const workspaceId = options.workspaceId || registryEntry.workspaceId;

  if (workspaceId !== HOLDSTATION_WORKSPACE_ID || workspaceId !== registryEntry.workspaceId) {
    throw new CmoAdapterError(`Unsupported workspaceId: ${workspaceId}`, 400, "context_pack_unsupported_workspace");
  }

  const maxItemChars = options.maxItemChars ?? DEFAULT_MAX_ITEM_CHARS;
  const runtimeMode = options.runtimeMode ?? "fallback";
  const items = [
    await priorityItem(app, maxItemChars),
    await appMemoryItem(app, maxItemChars),
    await latestSessionsItem(app, maxItemChars),
    await promotionCandidatesItem(app, maxItemChars),
  ];
  const usedItems = items.filter((item) => item.exists);
  const missingItems = items.filter((item) => !item.exists);
  const contextUsed = usedItems.map(contextItemToVaultRef);
  const missingContext = missingItems.map(contextItemToVaultRef);
  const contextQualitySummary = summarizeContextQuality([...contextUsed, ...missingContext]);
  const estimatedTokens = items.reduce((total, item) => total + item.tokenEstimate, 0);
  const contextPack: ContextPack = {
    policyVersion: "context-pack-v1",
    workspaceId,
    appId: app.id,
    sourceId: registryEntry.sourceId,
    appVaultPath: registryEntry.appVaultPath,
    logicalAppPath: registryEntry.logicalAppPath,
    physicalAppVaultPath: registryEntry.physicalAppVaultPath,
    physicalVaultPath: registryEntry.physicalVaultPath,
    runtimeMode,
    tokenBudget: {
      maxInputTokens: options.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS,
      estimatedTokens,
      maxItemChars,
    },
    items,
    exclusions: fixedExclusions(),
    contextQualitySummary,
  };
  const runtimeWorkspaceId = getOpenClawWorkspaceId();
  const selectedContext = usedItems.map(contextItemToNote);
  const missingNotes = missingItems.map(missingItemToNote);
  const contextDiagnostics: CMOContextDiagnostics = {
    ...contextQualitySummary,
    totalChars: selectedContext.reduce((total, item) => total + item.content.length, 0),
  };

  return {
    app,
    contextPack,
    contextBrief: contextBrief(app, contextPack),
    contextUsed,
    missingContext,
    contextDiagnostics,
    contextQualitySummary,
    contextPackage: {
      workspaceId,
      sourceId: contextPack.sourceId,
      ...(runtimeWorkspaceId ? { runtimeWorkspaceId } : {}),
      mode: "app_context",
      contextPack,
      app: {
        id: app.id,
        name: app.name,
        vaultPath: app.physicalAppVaultPath,
        logicalAppPath: app.logicalAppPath,
        physicalAppVaultPath: app.physicalAppVaultPath,
        appVaultPath: app.appVaultPath,
        group: app.group,
        stage: app.stage,
        currentMission: app.currentMission,
        oneLiner: app.oneLiner,
        currentGoal: app.currentGoal,
        currentBottleneck: app.currentBottleneck,
      },
      userMessage: "",
      selectedContext,
      missingContext: missingNotes,
      contextQualitySummary,
      instructions: {
        role: "strategic CMO",
        doNotOverpromise: true,
        answerStyle: "operator-grade, concise, decision-oriented",
        mustStateAssumptions: true,
        mustReferenceContextUsed: true,
        useSelectedNotesOnly: true,
        doNotClaimAllVaultRag: true,
        doNotPretendDurableMemoryComplete: true,
        mustStatePlaceholderLimitations: true,
        askForConfirmationWhenContextIsDraft: true,
        suggestFillingAppMemoryWhenRelevant: true,
      },
    },
  };
}

export function withContextPackMessage(result: BuildContextPackResult, userMessage: string): BuildContextPackResult {
  return {
    ...result,
    contextPackage: {
      ...result.contextPackage,
      userMessage,
    },
  };
}
