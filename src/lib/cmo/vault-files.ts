import { createHash } from "crypto";
import { access, appendFile, mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";

import type {
  AppMemoryNoteDetail,
  AppMemoryNoteKey,
  AppMemoryNoteSummary,
  AppMemoryUpdateRequest,
  AppDashboardSnapshot,
  AppPlan,
  AppPlanType,
  AppTaskSummary,
  AppWorkspacePlanState,
  AppWorkspace,
  CLevelPriority,
  CMOContextQuality,
  CMOContextBrief,
  CMORuntimeStatus,
  CMOSessionSummary,
  ContextPack,
  ContextPackRuntimeMode,
  CMOContextQualitySummary,
  DailyNoteGenerateRequest,
  DailyNoteGenerateResponse,
  PromotionCandidate,
  PromotionRequest,
  PromotionResponse,
  PromotionSourceType,
  PriorityLevel,
  PriorityNoteState,
  PriorityStatus,
  RawCaptureRequest,
  RawCaptureResponse,
  VaultFileStatus,
  VaultNoteRef,
} from "@/lib/cmo/app-workspace-types";
import { readDashboardStatus } from "@/lib/cmo/adapter";
import { buildAppContextNotes, getAppWorkspace, HOLDSTATION_WORKSPACE_ID, listAppWorkspaces } from "@/lib/cmo/app-workspaces";
import { readAppChatSession, readAppChatSessions, updateAppChatSessionMetadata } from "@/lib/cmo/app-chat-store";
import { buildContextPack } from "@/lib/cmo/context-pack-builder";
import { analyzeContextQuality, summarizeContextQuality } from "@/lib/cmo/context-quality";

const VAULT_ROOT = path.join(/*turbopackIgnore: true*/ process.cwd(), "knowledge", "holdstation");
const APP_NOTE_TITLES = [
  "Positioning",
  "Audience",
  "Product Notes",
  "Content Notes",
  "Decisions",
  "Tasks",
  "Learnings",
] as const;

const APP_MEMORY_NOTE_CONFIGS: Array<{
  noteKey: AppMemoryNoteKey;
  title: string;
  fileName: string;
  editable: boolean;
  templateSections: string[];
}> = [
  {
    noteKey: "positioning",
    title: "Positioning",
    fileName: "Positioning.md",
    editable: true,
    templateSections: ["Current Positioning", "Primary Promise", "Target User", "Differentiators", "Proof Points", "What This App Is Not", "Open Questions"],
  },
  {
    noteKey: "audience",
    title: "Audience",
    fileName: "Audience.md",
    editable: true,
    templateSections: ["Primary Audience", "Secondary Audience", "Jobs To Be Done", "Pain Points", "Activation Moment", "Open Questions"],
  },
  {
    noteKey: "product",
    title: "Product Notes",
    fileName: "Product Notes.md",
    editable: true,
    templateSections: ["Product Summary", "Core Features", "User Flow", "Activation Event", "Constraints", "Open Questions"],
  },
  {
    noteKey: "content",
    title: "Content Notes",
    fileName: "Content Notes.md",
    editable: true,
    templateSections: ["Narrative Direction", "Content Pillars", "Channels", "Do / Don't", "Example Angles", "Open Questions"],
  },
  {
    noteKey: "decisions",
    title: "Decisions",
    fileName: "Decisions.md",
    editable: false,
    templateSections: ["Confirmed Decisions", "Decision Candidates", "Open Decisions"],
  },
  {
    noteKey: "tasks",
    title: "Tasks",
    fileName: "Tasks.md",
    editable: false,
    templateSections: ["Active Tasks", "Task Candidates from CMO Sessions", "Task Tracker Source of Truth", "Open Questions"],
  },
  {
    noteKey: "learnings",
    title: "Learnings",
    fileName: "Learnings.md",
    editable: true,
    templateSections: ["Confirmed Learnings", "Signals", "What Changed", "Evidence", "Open Questions"],
  },
];

const APP_MEMORY_NOTE_BY_KEY = new Map(APP_MEMORY_NOTE_CONFIGS.map((note) => [note.noteKey, note]));
const APP_MEMORY_STATUS_VALUES = new Set<CMOContextQuality>(["placeholder", "draft", "confirmed"]);
const PROMOTION_SOURCE_TYPES = new Set<PromotionSourceType>(["cmo-session", "raw-capture", "daily-note"]);

export interface RawCaptureEntry {
  appName: string;
  topic: string;
  timestamp?: string;
  runtimeStatus?: string;
  appId?: string;
  sessionId?: string;
  sessionNotePath?: string;
  fallback?: boolean;
  summary?: string;
}

export interface DailyNotesState {
  date: string;
  rawPath: string;
  dailyPath: string;
  rawExists: boolean;
  dailyExists: boolean;
  captures: RawCaptureEntry[];
}

export interface AppWorkspaceState {
  app: AppWorkspace;
  notes: VaultNoteRef[];
  contextNotes: VaultNoteRef[];
  recentCaptures: RawCaptureEntry[];
  priorityState: PriorityNoteState;
  projectDocStatuses: VaultFileStatus[];
  dashboardSnapshot: AppDashboardSnapshot;
  plans: AppWorkspacePlanState;
  taskSummary: AppTaskSummary;
  latestSessions: Awaited<ReturnType<typeof readAppChatSessions>>;
  sessionSummaries: CMOSessionSummary[];
  dailyNote?: VaultNoteRef;
  todayRawPath: string;
  todayDailyPath: string;
  todayRawExists: boolean;
  todayDailyExists: boolean;
  latestPromotion?: AppDashboardSnapshot["latestPromotion"];
  contextPack: ContextPack;
  contextBrief: CMOContextBrief;
  initialRuntimeStatus?: CMORuntimeStatus;
  initialRuntimeLabel?: string;
  initialRuntimeReason?: string;
}

export interface CommandCenterState {
  date: string;
  apps: AppWorkspace[];
  recentSessions: Awaited<ReturnType<typeof readAppChatSessions>>;
  rawPath: string;
  dailyPath: string;
  rawExists: boolean;
  dailyExists: boolean;
  rawCaptureCount: number;
}

export interface VaultVisibilityState {
  date: string;
  rawPath: string;
  dailyPath: string;
  rawExists: boolean;
  dailyExists: boolean;
  appNotes: Array<{
    app: AppWorkspace;
    notes: VaultNoteRef[];
  }>;
}

function isValidVaultDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function formatVaultDate(date = new Date(), timeZone = process.env.CMO_VAULT_TIME_ZONE ?? "Asia/Saigon"): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? String(date.getUTCFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}

function resolveDate(value?: string): string {
  return isValidVaultDate(value) ? value : formatVaultDate();
}

function normalizeVaultRelativePath(relativeVaultPath: string): string {
  return relativeVaultPath.replaceAll("\\", "/").replace(/^\/+/, "");
}

function normalizeRuntimeStatus(value: unknown): CMORuntimeStatus | undefined {
  return value === "connected" ||
    value === "live" ||
    value === "configured_but_unreachable" ||
    value === "live_failed_then_fallback" ||
    value === "development_fallback" ||
    value === "runtime_error" ||
    value === "not_configured"
    ? value
    : undefined;
}

function contextPackRuntimeMode(status: CMORuntimeStatus): ContextPackRuntimeMode {
  if (status === "connected" || status === "live") {
    return "live";
  }

  return status === "development_fallback" || status === "not_configured" || status === "live_failed_then_fallback"
    ? "fallback"
    : status;
}

async function readWorkspaceRuntimeStatus(): Promise<{
  status: CMORuntimeStatus;
  label: string;
  reason?: string;
}> {
  try {
    const status = await readDashboardStatus();
    const runtimeStatus = normalizeRuntimeStatus(status.runtime_status ?? status.openclaw_runtime) ?? "runtime_error";

    return {
      status: runtimeStatus,
      label: typeof status.adapter === "string" && status.adapter.trim() ? status.adapter : "CMO Adapter",
      reason: typeof status.runtime_reason === "string" ? status.runtime_reason : undefined,
    };
  } catch (error) {
    return {
      status: "configured_but_unreachable",
      label: "CMO Adapter",
      reason: error instanceof Error ? error.message : "Runtime status check failed.",
    };
  }
}

function vaultFilePath(relativeVaultPath: string): string {
  const normalized = normalizeVaultRelativePath(relativeVaultPath);
  const resolved = path.resolve(VAULT_ROOT, ...normalized.split("/").filter(Boolean));
  const rootWithSep = `${VAULT_ROOT}${path.sep}`;

  if (resolved !== VAULT_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error("Vault path resolved outside the Holdstation vault");
  }

  return resolved;
}

function rawVaultPath(date: string): string {
  return `06 Journal/Raw/${date}.md`;
}

function dailyVaultPath(date: string): string {
  return `06 Journal/Daily/${date}.md`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function vaultRelativeFileExists(relativeVaultPath: string): Promise<boolean> {
  return exists(vaultFilePath(relativeVaultPath));
}

async function readVaultText(relativeVaultPath: string): Promise<string | null> {
  try {
    return await readFile(vaultFilePath(relativeVaultPath), "utf8");
  } catch {
    return null;
  }
}

function stripFrontmatter(content: string): string {
  return content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function previewMarkdown(content: string): string {
  const preview = stripFrontmatter(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return preview.length > 420 ? `${preview.slice(0, 417)}...` : preview;
}

function markdownHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function parseFrontmatter(content: string): {
  frontmatter: string;
  body: string;
  values: Record<string, string>;
} {
  const normalized = content.startsWith("\uFEFF") ? content.slice(1) : content;

  if (!normalized.startsWith("---")) {
    return {
      frontmatter: "",
      body: normalized.trimStart(),
      values: {},
    };
  }

  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

  if (!match) {
    return {
      frontmatter: "",
      body: normalized.trimStart(),
      values: {},
    };
  }

  const values: Record<string, string> = {};

  match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line) => {
      const item = line.match(/^([A-Za-z0-9_-]+):\s*["']?([^"'].*?)["']?\s*$/);

      if (item?.[1]) {
        values[item[1]] = item[2]?.trim() ?? "";
      }
    });

  return {
    frontmatter: match[0],
    body: normalized.slice(match[0].length).trimStart(),
    values,
  };
}

function appMemoryNoteConfig(noteKey: string): (typeof APP_MEMORY_NOTE_CONFIGS)[number] {
  const config = APP_MEMORY_NOTE_BY_KEY.get(noteKey as AppMemoryNoteKey);

  if (!config) {
    throw new Error(`Invalid app memory note key: ${noteKey}`);
  }

  return config;
}

function appMemoryVaultPath(app: AppWorkspace, noteKey: AppMemoryNoteKey): string {
  return physicalAppVaultPath(app, appMemoryNoteConfig(noteKey).fileName);
}

function appMemoryFrontmatter(app: AppWorkspace, config: (typeof APP_MEMORY_NOTE_CONFIGS)[number], status: CMOContextQuality): string {
  const tag = config.noteKey === "product" ? "product" : config.noteKey === "content" ? "content" : config.noteKey;

  return [
    "---",
    `title: ${app.name} - ${config.title}`,
    "type: app-note",
    `status: ${status}`,
    "scope: holdstation",
    "vault: holdstation",
    `app: ${app.name}`,
    `app_id: ${app.id}`,
    "tags:",
    "  - holdstation",
    "  - app",
    `  - ${tag}`,
    "---",
    "",
  ].join("\n");
}

function openQuestionsForNote(config: (typeof APP_MEMORY_NOTE_CONFIGS)[number]): string[] {
  if (config.noteKey === "positioning") {
    return [
      "What is the primary positioning statement?",
      "Which target user should this app prioritize first?",
      "Which claims are supported by evidence?",
    ];
  }

  if (config.noteKey === "audience") {
    return [
      "Who is the primary audience?",
      "What situation makes this app immediately useful?",
      "Which users are out of scope for now?",
    ];
  }

  if (config.noteKey === "product") {
    return [
      "Which product capabilities are confirmed?",
      "What user flow should content support first?",
      "Which product constraints should marketing respect?",
    ];
  }

  if (config.noteKey === "content") {
    return [
      "Which channels matter first?",
      "Which message angles are approved?",
      "What should content avoid saying?",
    ];
  }

  if (config.noteKey === "learnings") {
    return [
      "What has been observed?",
      "What evidence supports the learning?",
      "What should change because of this learning?",
    ];
  }

  if (config.noteKey === "decisions") {
    return [
      "Which proposed decisions need explicit approval?",
      "What evidence is required before locking a decision in Phase 2?",
    ];
  }

  return [
    "Which proposed tasks should become Task Tracker items when connected?",
    "Who owns each proposed task?",
  ];
}

function appMemoryNoteBodyTemplate(app: AppWorkspace, config: (typeof APP_MEMORY_NOTE_CONFIGS)[number]): string {
  if (config.noteKey === "decisions") {
    return [
      `# ${app.name} - ${config.title}`,
      "",
      "## Confirmed Decisions",
      "",
      "No locked decisions are recorded in Phase 1. Decision Locking comes in Phase 2.",
      "",
      "## Decision Candidates",
      "",
      "- None yet.",
      "",
      "## Open Decisions",
      "",
      ...openQuestionsForNote(config).map((question) => `- ${question}`),
      "",
    ].join("\n");
  }

  if (config.noteKey === "tasks") {
    return [
      `# ${app.name} - ${config.title}`,
      "",
      "## Active Tasks",
      "",
      "Task Tracker is the source of truth when connected. This note stores CMO-readable task context only.",
      "",
      "## Task Candidates from CMO Sessions",
      "",
      "- None yet.",
      "",
      "## Task Tracker Source of Truth",
      "",
      "Task Tracker integration is not connected yet.",
      "",
      "## Open Questions",
      "",
      ...openQuestionsForNote(config).map((question) => `- ${question}`),
      "",
    ].join("\n");
  }

  const introByKey: Record<AppMemoryNoteKey, string> = {
    positioning: "No confirmed positioning has been provided yet.",
    audience: "No confirmed audience details have been provided yet.",
    product: "No confirmed product facts have been provided yet.",
    content: "No confirmed content direction has been provided yet.",
    learnings: "No confirmed learnings have been recorded yet.",
    decisions: "",
    tasks: "",
  };

  return [
    `# ${app.name} - ${config.title}`,
    "",
    ...config.templateSections.flatMap((section, index) => {
      if (section === "Open Questions") {
        return [`## ${section}`, "", ...openQuestionsForNote(config).map((question) => `- ${question}`), ""];
      }

      return [`## ${section}`, "", index === 0 ? introByKey[config.noteKey] : "Needs input.", ""];
    }),
  ].join("\n");
}

function appMemoryNoteTemplate(app: AppWorkspace, config: (typeof APP_MEMORY_NOTE_CONFIGS)[number], status: CMOContextQuality = "placeholder"): string {
  return `${appMemoryFrontmatter(app, config, status)}${appMemoryNoteBodyTemplate(app, config)}`;
}

function buildAppMemoryContent(
  app: AppWorkspace,
  config: (typeof APP_MEMORY_NOTE_CONFIGS)[number],
  currentContent: string,
  nextBody: string,
  nextStatus: CMOContextQuality,
): string {
  const parsed = parseFrontmatter(currentContent);
  const frontmatter = parsed.frontmatter || appMemoryFrontmatter(app, config, nextStatus);
  const withStatus = updateFrontmatterStatus(`${frontmatter}${nextBody.trimStart()}`, nextStatus);

  if (!parseFrontmatter(withStatus).frontmatter) {
    return `${appMemoryFrontmatter(app, config, nextStatus)}${nextBody.trimStart()}`.trimEnd() + "\n";
  }

  return withStatus.trimEnd() + "\n";
}

async function readVaultMtime(relativeVaultPath: string): Promise<string | undefined> {
  try {
    return (await stat(vaultFilePath(relativeVaultPath))).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function appMemoryNoteSummaryFromContent(
  config: (typeof APP_MEMORY_NOTE_CONFIGS)[number],
  relativePath: string,
  content: string | null,
  updatedAt?: string,
): AppMemoryNoteSummary {
  const quality = analyzeContextQuality({
    title: config.title,
    exists: content !== null,
    content,
  });
  const parsed = parseFrontmatter(content ?? "");

  return {
    noteKey: config.noteKey,
    title: config.title,
    path: relativePath,
    exists: content !== null,
    editable: config.editable,
    status: quality.contextQuality,
    contextQuality: quality.contextQuality,
    qualityReason: quality.qualityReason,
    preview: content !== null ? previewMarkdown(content) : "",
    frontmatter: parsed.values,
    frontmatterStatus: quality.frontmatterStatus,
    updatedAt,
    hash: content !== null ? markdownHash(content) : undefined,
  };
}

export async function readAppMemoryNotes(appId: string): Promise<AppMemoryNoteSummary[]> {
  const app = getAppWorkspace(appId);

  if (!app) {
    throw new Error(`Unknown appId: ${appId}`);
  }

  return Promise.all(
    APP_MEMORY_NOTE_CONFIGS.map(async (config) => {
      const relativePath = physicalAppVaultPath(app, config.fileName);
      const content = await readVaultText(relativePath);

      return appMemoryNoteSummaryFromContent(config, relativePath, content, await readVaultMtime(relativePath));
    }),
  );
}

export async function readAppMemoryNote(appId: string, noteKey: string): Promise<AppMemoryNoteDetail> {
  const app = getAppWorkspace(appId);

  if (!app) {
    throw new Error(`Unknown appId: ${appId}`);
  }

  const config = appMemoryNoteConfig(noteKey);
  const relativePath = physicalAppVaultPath(app, config.fileName);
  const content = await readVaultText(relativePath);
  const effectiveContent = content ?? appMemoryNoteTemplate(app, config);
  const summary = appMemoryNoteSummaryFromContent(config, relativePath, content, await readVaultMtime(relativePath));
  const parsed = parseFrontmatter(effectiveContent);

  return {
    ...summary,
    body: parsed.body,
    content: effectiveContent,
    suggestedBody: appMemoryNoteBodyTemplate(app, config),
  };
}

export async function updateAppMemoryNote(appId: string, noteKey: string, request: AppMemoryUpdateRequest): Promise<AppMemoryNoteDetail> {
  const app = getAppWorkspace(appId);

  if (!app) {
    throw new Error(`Unknown appId: ${appId}`);
  }

  const config = appMemoryNoteConfig(noteKey);
  const requestedStatus = request.status;

  if (requestedStatus && !APP_MEMORY_STATUS_VALUES.has(requestedStatus)) {
    throw new Error(`Invalid app memory status: ${requestedStatus}`);
  }

  const relativePath = physicalAppVaultPath(app, config.fileName);
  const existingContent = await readVaultText(relativePath);
  const currentContent = existingContent ?? appMemoryNoteTemplate(app, config);
  const currentHash = markdownHash(currentContent);

  if (request.expectedHash && request.expectedHash !== currentHash) {
    const error = new Error("App memory note changed after it was loaded. Refresh before saving.");
    error.name = "AppMemoryConflictError";
    throw error;
  }

  const parsed = parseFrontmatter(currentContent);
  const currentStatus = analyzeContextQuality({
    title: config.title,
    exists: existingContent !== null,
    content: currentContent,
  }).contextQuality;
  const fallbackStatus: CMOContextQuality = currentStatus === "missing" ? "draft" : currentStatus;
  const nextStatus: CMOContextQuality = request.resetToPlaceholder ? "placeholder" : requestedStatus ?? fallbackStatus;
  let nextBody = request.resetToPlaceholder ? appMemoryNoteBodyTemplate(app, config) : request.body ?? parsed.body;

  if (!config.editable && typeof request.body === "string" && request.body.trim() !== parsed.body.trim()) {
    throw new Error(`${config.title} is read-mostly in Phase 1.7`);
  }

  if (typeof nextBody !== "string") {
    nextBody = parsed.body;
  }

  const nextContent = buildAppMemoryContent(app, config, currentContent, nextBody, nextStatus);
  const filePath = vaultFilePath(relativePath);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, nextContent, "utf8");

  const written = await readFile(filePath, "utf8");

  if (markdownHash(written) !== markdownHash(nextContent)) {
    throw new Error("App memory note write could not be verified");
  }

  const readback = await readAppMemoryNote(app.id, config.noteKey);

  if (readback.status !== nextStatus) {
    throw new Error(`App memory note saved, but status readback returned ${readback.status}`);
  }

  return readback;
}

async function hydrateNote(note: VaultNoteRef): Promise<VaultNoteRef> {
  const content = await readVaultText(note.path);
  const quality = analyzeContextQuality({
    title: note.title,
    exists: content !== null,
    content,
  });

  return {
    ...note,
    exists: content !== null,
    contentPreview: content !== null ? previewMarkdown(content) : "",
    ...quality,
  };
}

function physicalAppVaultPath(app: AppWorkspace, fileName = ""): string {
  return fileName ? `${app.physicalAppVaultPath}/${fileName}` : app.physicalAppVaultPath;
}

function priorityVaultPath(app: AppWorkspace): string {
  return physicalAppVaultPath(app, "C-Level Priorities.md");
}

function canonicalPriorityVaultPath(app: AppWorkspace): string {
  return physicalAppVaultPath(app, "C-Level Priority.md");
}

function tasksVaultPath(app: AppWorkspace): string {
  return physicalAppVaultPath(app, "Tasks.md");
}

function metricsVaultPath(app: AppWorkspace): string {
  return physicalAppVaultPath(app, "Inputs/Metrics Snapshot.md");
}

function projectDocStatusPaths(app: AppWorkspace): Array<Pick<VaultFileStatus, "title" | "path" | "kind">> {
  return [
    { title: "Project Docs", path: physicalAppVaultPath(app, "Inputs/Project Docs.md"), kind: "file" },
    { title: "Meeting Inputs", path: physicalAppVaultPath(app, "Inputs/Meeting Inputs.md"), kind: "file" },
    { title: "Metrics Snapshot", path: metricsVaultPath(app), kind: "file" },
    { title: "Uploaded Docs", path: physicalAppVaultPath(app, "Inputs/Uploaded Docs"), kind: "folder" },
  ];
}

async function fileStatus(status: Pick<VaultFileStatus, "title" | "path" | "kind">): Promise<VaultFileStatus> {
  const filePath = vaultFilePath(status.path);
  const statusExists = await exists(filePath);

  if (!statusExists || status.kind === "folder") {
    return {
      ...status,
      exists: statusExists,
    };
  }

  const content = await readVaultText(status.path);
  const quality = analyzeContextQuality({
    title: status.title,
    exists: Boolean(content),
    content,
  });

  return {
    ...status,
    exists: true,
    contextQuality: quality.contextQuality,
    frontmatterStatus: quality.frontmatterStatus,
  };
}

function normalizePriorityLevel(value: string | undefined): PriorityLevel {
  return value === "P0" || value === "P1" || value === "P2" ? value : "P1";
}

function normalizePriorityStatus(value: string | undefined): PriorityStatus {
  return value === "active" || value === "paused" || value === "completed" || value === "archived" ? value : "active";
}

function markdownValue(section: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section.match(new RegExp(`^${escaped}:\\s*(.+)$`, "im"));

  return match?.[1]?.trim() ?? "";
}

function markdownSection(section: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section.match(new RegExp(`^#{3,4}\\s+${escaped}\\r?\\n([\\s\\S]*?)(?=\\r?\\n#{2,4}\\s+|(?![\\s\\S]))`, "im"));

  return match?.[1]?.trim() ?? "";
}

function markdownListSection(section: string, heading: string): string[] {
  return markdownSection(section, heading)
    .split(/\r?\n/)
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

function prioritySlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);
}

function markdownTopLevelSection(content: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^##\\s+${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n##\\s+|(?![\\s\\S]))`, "im"));

  return match?.[1] ?? "";
}

function priorityTimestamp(priority: CLevelPriority): number {
  const timestamp = Date.parse(priority.lastReviewedAt || priority.updatedAt || priority.createdAt || "");

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function latestPriorityFirst(left: CLevelPriority, right: CLevelPriority): number {
  return priorityTimestamp(right) - priorityTimestamp(left);
}

function parseLegacyPriorities(content: string): CLevelPriority[] {
  const matches = Array.from(content.matchAll(/^## Priority:\s*(.+)$/gm));

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? content.length;
    const section = content.slice(start, end);
    const now = new Date(0).toISOString();

    return {
      id: markdownValue(section, "Priority ID") || `priority_${index + 1}`,
      title: match[1]?.trim() || "Untitled priority",
      source: markdownValue(section, "Source"),
      priorityLevel: normalizePriorityLevel(markdownValue(section, "Priority Level")),
      timeframe: markdownValue(section, "Timeframe") || "this week",
      owner: markdownValue(section, "Owner"),
      successMetric: markdownValue(section, "Success Metric"),
      whyNow: markdownSection(section, "Why Now"),
      constraints: markdownSection(section, "Constraints"),
      mustDo: markdownSection(section, "Must Do"),
      mustNotDo: markdownSection(section, "Must Not Do"),
      status: normalizePriorityStatus(markdownValue(section, "Status")),
      linkedDocs: markdownListSection(section, "Linked Docs"),
      lastReviewedAt: markdownValue(section, "Last Reviewed At"),
      createdAt: markdownValue(section, "Created At") || now,
      updatedAt: markdownValue(section, "Updated At") || now,
    };
  });
}

function parseActivePriorities(content: string): CLevelPriority[] {
  const activeSection = markdownTopLevelSection(content, "Active Priorities");
  const headingPattern = new RegExp("^###\\s+(P[0-2])\\s+(?:\\u2014|\\u2013|\\u00e2\\u20ac\\u201d|-)\\s+(.+)$", "gm");
  const matches = Array.from(activeSection.matchAll(headingPattern));

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? activeSection.length;
    const section = activeSection.slice(start, end);
    const title = match[2]?.trim() || "Untitled priority";
    const lastReviewedAt = markdownValue(section, "Last Reviewed") || markdownValue(section, "Last Reviewed At") || new Date(0).toISOString();

    return {
      id: markdownValue(section, "Priority ID") || `priority_${prioritySlug(title) || index + 1}`,
      title,
      source: markdownValue(section, "Source"),
      priorityLevel: normalizePriorityLevel(match[1] ?? markdownValue(section, "Priority Level")),
      timeframe: markdownValue(section, "Timeframe") || "this week",
      owner: markdownValue(section, "Owner"),
      successMetric: markdownValue(section, "Success Metric"),
      whyNow: markdownSection(section, "Why This Matters") || markdownSection(section, "Why Now"),
      constraints: markdownSection(section, "Constraints"),
      mustDo: markdownSection(section, "Must Do"),
      mustNotDo: markdownSection(section, "Must Not Do"),
      status: normalizePriorityStatus(markdownValue(section, "Status")),
      linkedDocs: markdownListSection(section, "Linked Docs").filter((doc) => !/^none linked/i.test(doc)),
      lastReviewedAt,
      createdAt: markdownValue(section, "Created At") || lastReviewedAt,
      updatedAt: markdownValue(section, "Updated At") || lastReviewedAt,
    };
  }).sort(latestPriorityFirst);
}

function parsePriorities(content: string): CLevelPriority[] {
  const activePriorities = parseActivePriorities(content);
  const legacyPriorities = parseLegacyPriorities(content).filter(
    (legacyPriority) =>
      !activePriorities.some(
        (activePriority) =>
          activePriority.id === legacyPriority.id ||
          (activePriority.title === legacyPriority.title && activePriority.status === legacyPriority.status),
      ),
  );

  return [...activePriorities, ...legacyPriorities.sort(latestPriorityFirst)];
}

function cLevelPriorityTemplate(app: AppWorkspace): string {
  return [
    "---",
    `title: ${app.name} - C-Level Priorities`,
    "type: app-priority",
    "status: draft",
    "scope: holdstation",
    "vault: holdstation",
    `app: ${app.name}`,
    `app_id: ${app.id}`,
    "tags:",
    "  - holdstation",
    "  - app",
    "  - c-level-priority",
    "---",
    "",
    `# ${app.name} - C-Level Priorities`,
    "",
    "## Active Priorities",
    "",
    "No active priority confirmed yet.",
    "",
    "### Template",
    "",
    "Priority Level: P0 / P1 / P2  ",
    "Source:  ",
    "Timeframe:  ",
    "Owner:  ",
    "Status: active / paused / completed  ",
    "Success Metric:  ",
    "",
    "#### Why This Matters",
    "",
    "#### Constraints",
    "",
    "#### Must Do",
    "",
    "#### Must Not Do",
    "",
    "#### Linked Docs",
    "",
    "#### Related Sessions",
    "",
    "#### Review Notes",
    "",
  ].join("\n");
}

function cLevelPrioritySummaryTemplate(app: AppWorkspace, priority: CLevelPriority): string {
  return [
    "---",
    `title: ${app.name} - C-Level Priority`,
    "type: app-priority",
    `status: ${priority.status}`,
    "scope: holdstation",
    "vault: holdstation",
    `app: ${app.name}`,
    `app_id: ${app.id}`,
    "tags:",
    "  - holdstation",
    "  - app",
    "  - c-level-priority",
    "---",
    "",
    `# ${app.name} - C-Level Priority`,
    "",
    "## Current Priority",
    "",
    `Priority: ${priority.title || "No active priority confirmed yet."}`,
    `Priority Level: ${priority.priorityLevel}`,
    `Owner: ${priority.owner || "Not assigned"}`,
    `Source: ${priority.source || "Not captured"}`,
    "",
    "## Why It Matters",
    "",
    priority.whyNow || "Needs input.",
    "",
    "## Success Signals",
    "",
    priority.successMetric ? `- ${priority.successMetric}` : "- Needs input.",
    "",
    "## Constraints",
    "",
    priority.constraints || "Needs input.",
    "",
    "## Time Horizon",
    "",
    priority.timeframe || "Needs input.",
    "",
    "## Last Updated",
    "",
    priority.lastReviewedAt || priority.updatedAt || "Needs input.",
    "",
    "## Operating Guardrails",
    "",
    priority.mustDo ? `Must do: ${priority.mustDo}` : "Must do: Needs input.",
    "",
    priority.mustNotDo ? `Must not do: ${priority.mustNotDo}` : "Must not do: Needs input.",
    "",
  ].join("\n");
}

function prioritySection(priority: CLevelPriority): string {
  const linkedDocs = priority.linkedDocs.length ? priority.linkedDocs.map((doc) => `- ${doc}`).join("\n") : "- None linked yet.";

  return [
    `## Priority: ${priority.title || "Untitled priority"}`,
    "",
    `Priority ID: ${priority.id}`,
    `Priority Level: ${priority.priorityLevel}`,
    `Source: ${priority.source}`,
    `Timeframe: ${priority.timeframe}`,
    `Owner: ${priority.owner}`,
    `Status: ${priority.status}`,
    `Success Metric: ${priority.successMetric}`,
    `Last Reviewed At: ${priority.lastReviewedAt}`,
    `Created At: ${priority.createdAt}`,
    `Updated At: ${priority.updatedAt}`,
    "",
    "### Why Now",
    priority.whyNow || "No rationale captured yet.",
    "",
    "### Constraints",
    priority.constraints || "No constraints captured yet.",
    "",
    "### Must Do",
    priority.mustDo || "No must-do guidance captured yet.",
    "",
    "### Must Not Do",
    priority.mustNotDo || "No must-not-do guidance captured yet.",
    "",
    "### Linked Docs",
    linkedDocs,
    "",
  ].join("\n");
}

function activePrioritySection(priority: CLevelPriority): string {
  const linkedDocs = priority.linkedDocs.length ? priority.linkedDocs.map((doc) => `- ${doc}`).join("\n") : "- None linked yet.";

  return [
    `### ${priority.priorityLevel} \u2014 ${priority.title || "Untitled priority"}`,
    "",
    `Source: ${priority.source}`,
    `Timeframe: ${priority.timeframe}`,
    `Owner: ${priority.owner}`,
    `Status: ${priority.status}`,
    `Success Metric: ${priority.successMetric}`,
    `Last Reviewed: ${priority.lastReviewedAt}`,
    "",
    "#### Why This Matters",
    "",
    priority.whyNow || "No rationale captured yet.",
    "",
    "#### Constraints",
    "",
    priority.constraints || "No constraints captured yet.",
    "",
    "#### Must Do",
    "",
    priority.mustDo || "No must-do guidance captured yet.",
    "",
    "#### Must Not Do",
    "",
    priority.mustNotDo || "No must-not-do guidance captured yet.",
    "",
    "#### Linked Docs",
    "",
    linkedDocs,
    "",
  ].join("\n");
}

function replacePrioritySection(content: string, priority: CLevelPriority): { content: string; updatedExisting: boolean } {
  const matches = Array.from(content.matchAll(/^## Priority:\s*.+$/gm));
  const replacement = prioritySection(priority);

  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const end = matches[index + 1]?.index ?? content.length;
    const section = content.slice(start, end);

    if (section.includes(`Priority ID: ${priority.id}`)) {
      return {
        content: `${content.slice(0, start).trimEnd()}\n\n${replacement}\n${content.slice(end).trimStart()}`.trimEnd() + "\n",
        updatedExisting: true,
      };
    }
  }

  return {
    content: `${content.trimEnd()}\n\n${replacement}\n`,
    updatedExisting: false,
  };
}

function replaceActivePrioritySection(content: string, priority: CLevelPriority): { content: string; updatedExisting: boolean } {
  const activeHeading = content.match(/^## Active Priorities\s*$/m);
  const activeContent = activePrioritySection(priority).trimEnd();
  const replacement = `## Active Priorities\n\n${activeContent}\n`;

  if (activeHeading) {
    const start = activeHeading.index ?? 0;
    const nextHeading = content.slice(start + activeHeading[0].length).search(/\r?\n##\s+/);
    const end = nextHeading >= 0 ? start + activeHeading[0].length + nextHeading : content.length;
    const section = content.slice(start, end);
    const updatedExisting = new RegExp("^###\\s+P[0-2]\\s+(?:\\u2014|\\u2013|\\u00e2\\u20ac\\u201d|-)\\s+", "m").test(section);

    return {
      content: `${content.slice(0, start).trimEnd()}\n\n${replacement}\n${content.slice(end).trimStart()}`.trimEnd() + "\n",
      updatedExisting,
    };
  }

  const firstLegacyPriority = content.search(/^## Priority:/m);

  if (firstLegacyPriority >= 0) {
    return {
      content: `${content.slice(0, firstLegacyPriority).trimEnd()}\n\n${replacement}\n${content.slice(firstLegacyPriority).trimStart()}`.trimEnd() + "\n",
      updatedExisting: false,
    };
  }

  return {
    content: `${content.trimEnd()}\n\n${replacement}`,
    updatedExisting: false,
  };
}

function updateFrontmatterStatus(content: string, status: string): string {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = bom ? content.slice(1) : content;

  if (!body.startsWith("---")) {
    return content;
  }

  const end = body.indexOf("\n---", 3);

  if (end < 0) {
    return content;
  }

  const frontmatter = body.slice(0, end);
  const rest = body.slice(end);
  const nextFrontmatter = /^status:\s*.+$/m.test(frontmatter)
    ? frontmatter.replace(/^status:\s*.+$/m, `status: ${status}`)
    : `${frontmatter}\nstatus: ${status}`;

  return `${bom}${nextFrontmatter}${rest}`;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringListField(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => stringField(item)).filter(Boolean);
  }

  return stringField(value)
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePriorityPayload(value: unknown, existing?: CLevelPriority): CLevelPriority {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const now = new Date().toISOString();
  const title = stringField(record.title) || existing?.title || "Untitled priority";

  return {
    id: stringField(record.id) || existing?.id || `priority_${now.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    title,
    source: stringField(record.source) || existing?.source || "",
    priorityLevel: normalizePriorityLevel(stringField(record.priorityLevel) || existing?.priorityLevel),
    timeframe: stringField(record.timeframe) || existing?.timeframe || "this week",
    owner: stringField(record.owner) || existing?.owner || "",
    successMetric: stringField(record.successMetric) || existing?.successMetric || "",
    whyNow: stringField(record.whyNow) || existing?.whyNow || "",
    constraints: stringField(record.constraints) || existing?.constraints || "",
    mustDo: stringField(record.mustDo) || existing?.mustDo || "",
    mustNotDo: stringField(record.mustNotDo) || existing?.mustNotDo || "",
    status: normalizePriorityStatus(stringField(record.status) || existing?.status),
    linkedDocs: stringListField(record.linkedDocs).length ? stringListField(record.linkedDocs) : existing?.linkedDocs ?? [],
    lastReviewedAt: now,
    createdAt: existing?.createdAt || stringField(record.createdAt) || now,
    updatedAt: now,
  };
}

export async function readCLevelPriorityState(appId: string): Promise<PriorityNoteState> {
  const app = getAppWorkspace(appId);

  if (!app) {
    throw new Error(`Unknown appId: ${appId}`);
  }

  const notePath = priorityVaultPath(app);
  const content = (await readVaultText(notePath)) ?? "";
  const priorities = parsePriorities(content);

  return {
    path: notePath,
    exists: Boolean(content),
    content,
    priorities,
    activePriority: priorities.filter((priority) => priority.status === "active").sort(latestPriorityFirst)[0],
  };
}

export async function saveCLevelPriority(appId: string, payload: unknown): Promise<PriorityNoteState & { savedPriority: CLevelPriority; updatedExisting: boolean }> {
  const app = getAppWorkspace(appId);

  if (!app) {
    throw new Error(`Unknown appId: ${appId}`);
  }

  const existingState = await readCLevelPriorityState(app.id);
  const existingPriority =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? existingState.priorities.find((priority) => priority.id === stringField((payload as Record<string, unknown>).id))
      : undefined;
  const priority = normalizePriorityPayload(payload, existingPriority);
  const baseContent = existingState.content || cLevelPriorityTemplate(app);
  const next =
    priority.status === "active"
      ? replaceActivePrioritySection(updateFrontmatterStatus(baseContent, "active"), priority)
      : replacePrioritySection(baseContent, priority);
  const filePath = vaultFilePath(priorityVaultPath(app));

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, next.content, "utf8");

  const written = await readFile(filePath, "utf8");

  if (!written.includes(priority.title) || !written.includes(priority.lastReviewedAt)) {
    throw new Error("C-Level priority write could not be verified");
  }

  const readBack = await readCLevelPriorityState(app.id);
  const savedPriority =
    readBack.priorities.find((candidate) => candidate.id === priority.id) ??
    readBack.priorities.find((candidate) => candidate.title === priority.title && candidate.status === priority.status);

  if (!savedPriority || savedPriority.title !== priority.title || savedPriority.status !== priority.status) {
    throw new Error("C-Level priority readback could not be verified");
  }

  if (priority.status === "active" && readBack.activePriority?.title !== priority.title) {
    throw new Error("C-Level priority saved but latest active priority readback did not match");
  }

  if (priority.status === "active") {
    const canonicalPath = canonicalPriorityVaultPath(app);
    const canonicalContent = cLevelPrioritySummaryTemplate(app, priority);

    await mkdir(path.dirname(vaultFilePath(canonicalPath)), { recursive: true });
    await writeFile(vaultFilePath(canonicalPath), canonicalContent, "utf8");
  }

  return {
    ...readBack,
    savedPriority,
    updatedExisting: next.updatedExisting,
  };
}

function isoWeekPeriod(dateString = formatVaultDate()): string {
  const [year, month, day] = dateString.split("-").map((value) => Number.parseInt(value, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;

  date.setUTCDate(date.getUTCDate() + 4 - weekday);

  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);

  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

function monthPeriod(dateString = formatVaultDate()): string {
  return dateString.slice(0, 7);
}

function planPath(app: AppWorkspace, type: AppPlanType, dateValue?: string): { period: string; path: string } {
  const date = resolveDate(dateValue);
  const period = type === "weekly" ? isoWeekPeriod(date) : monthPeriod(date);
  const folder = type === "weekly" ? "Weekly" : "Monthly";

  return {
    period,
    path: physicalAppVaultPath(app, `Plans/${folder}/${period}.md`),
  };
}

function planStatusFromContent(content: string | null): AppPlan["status"] {
  const status = content ? analyzeContextQuality({ title: "Plan", exists: true, content }).frontmatterStatus : undefined;

  return status === "active" || status === "completed" ? status : "draft";
}

async function readPlan(app: AppWorkspace, type: AppPlanType, dateValue?: string): Promise<AppPlan> {
  const target = planPath(app, type, dateValue);
  const content = await readVaultText(target.path);

  return {
    id: `${app.id}-${type}-${target.period}`,
    appId: app.id,
    type,
    period: target.period,
    primaryObjective: "",
    linkedPriorityId: "",
    missions: [],
    tasks: [],
    risks: [],
    successMetrics: [],
    status: content ? planStatusFromContent(content) : "draft",
    path: target.path,
    exists: Boolean(content),
  };
}

export async function readAppPlans(appId: string, dateValue?: string): Promise<AppWorkspacePlanState> {
  const app = getAppWorkspace(appId);

  if (!app) {
    throw new Error(`Unknown appId: ${appId}`);
  }

  return {
    weekly: await readPlan(app, "weekly", dateValue),
    monthly: await readPlan(app, "monthly", dateValue),
  };
}

function weeklyPlanTemplate(app: AppWorkspace, plan: AppPlan, sourceSessionId?: string): string {
  return [
    "---",
    `title: ${app.name} Weekly Plan ${plan.period}`,
    "type: app-weekly-plan",
    "status: draft",
    "scope: holdstation",
    "vault: holdstation",
    `app: ${app.name}`,
    `app_id: ${app.id}`,
    `week: ${plan.period}`,
    sourceSessionId ? `created_from_session_id: ${sourceSessionId}` : "created_from_session_id:",
    "tags:",
    "  - holdstation",
    "  - app",
    "  - weekly-plan",
    "---",
    "",
    `# ${app.name} Weekly Plan ${plan.period}`,
    "",
    "## Primary Objective",
    "",
    "No active weekly objective confirmed yet.",
    "",
    "## Linked C-Level Priority",
    "",
    "None linked yet.",
    "",
    "## Missions",
    "",
    "- No missions confirmed yet.",
    "",
    "## Tasks",
    "",
    "- Task Tracker integration is pending.",
    "",
    "## Risks",
    "",
    "- No risks captured yet.",
    "",
    "## Success Metrics",
    "",
    "- No metrics connected yet.",
    "",
  ].join("\n");
}

function monthlyPlanTemplate(app: AppWorkspace, plan: AppPlan, sourceSessionId?: string): string {
  return [
    "---",
    `title: ${app.name} Monthly Plan ${plan.period}`,
    "type: app-monthly-plan",
    "status: draft",
    "scope: holdstation",
    "vault: holdstation",
    `app: ${app.name}`,
    `app_id: ${app.id}`,
    `month: ${plan.period}`,
    sourceSessionId ? `created_from_session_id: ${sourceSessionId}` : "created_from_session_id:",
    "tags:",
    "  - holdstation",
    "  - app",
    "  - monthly-plan",
    "---",
    "",
    `# ${app.name} Monthly Plan ${plan.period}`,
    "",
    "## Monthly Goal",
    "",
    "No active monthly goal confirmed yet.",
    "",
    "## Campaign Direction",
    "",
    "No campaign direction confirmed yet.",
    "",
    "## Milestones",
    "",
    "- No milestones confirmed yet.",
    "",
    "## Content Rhythm",
    "",
    "No content rhythm confirmed yet.",
    "",
    "## Experiments",
    "",
    "- No experiments confirmed yet.",
    "",
    "## Risks",
    "",
    "- No risks captured yet.",
    "",
    "## Success Metrics",
    "",
    "- No metrics connected yet.",
    "",
  ].join("\n");
}

export async function createAppPlanNote(appId: string, type: AppPlanType, sourceSessionId?: string): Promise<AppPlan> {
  const app = getAppWorkspace(appId);

  if (!app) {
    throw new Error(`Unknown appId: ${appId}`);
  }

  const currentPlans = await readAppPlans(app.id);
  const plan = type === "weekly" ? currentPlans.weekly : currentPlans.monthly;

  if (plan.exists) {
    const error = new Error(`${type} plan already exists at ${plan.path}`);
    error.name = "PlanAlreadyExistsError";
    throw error;
  }

  const filePath = vaultFilePath(plan.path);
  const content = type === "weekly" ? weeklyPlanTemplate(app, plan, sourceSessionId) : monthlyPlanTemplate(app, plan, sourceSessionId);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");

  const written = await readFile(filePath, "utf8");

  if (!written.includes(plan.period)) {
    throw new Error("Plan note write could not be verified");
  }

  return readPlan(app, type);
}

export async function readAppTaskSummary(appId: string): Promise<AppTaskSummary> {
  const app = getAppWorkspace(appId);

  if (!app) {
    throw new Error(`Unknown appId: ${appId}`);
  }

  return {
    appId: app.id,
    source: "placeholder",
    connected: false,
    status: "not_connected",
    sourcePath: tasksVaultPath(app),
    message: "Task Tracker integration not connected yet.",
    countsByStatus: {
      done: 0,
      inProgress: 0,
      needAction: 0,
      blocked: 0,
      backlog: 0,
    },
    blockers: [],
    assignees: [],
    tasks: [],
  };
}

function sessionSummary(session: Awaited<ReturnType<typeof readAppChatSessions>>[number]): CMOSessionSummary {
  return {
    sessionId: session.id,
    appId: session.appId,
    topic: session.topic || "CMO session",
    createdAt: session.createdAt,
    runtimeStatus: session.runtimeStatus,
    isDevelopmentFallback: session.isDevelopmentFallback === true,
    contextUsedCount: session.contextUsed.length,
    contextQualitySummary: session.contextQualitySummary,
    savedToVault: session.savedToVault === true,
    rawCapturePath: session.rawCapturePath,
    sessionNotePath: session.sessionNotePath,
  };
}

export async function readAppSessionSummaries(appId: string, limit = 50): Promise<CMOSessionSummary[]> {
  return (await readAppChatSessions(limit, appId)).map(sessionSummary);
}

function compactText(value: string, limit = 520): string {
  const compacted = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return compacted.length > limit ? `${compacted.slice(0, limit - 3)}...` : compacted;
}

function safeWikiSourcePath(sourcePath: string): string {
  const normalized = sourcePath.trim().replaceAll("\\", "/").replace(/[\r\n[\]]/g, "");

  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Promotion sourcePath must be a relative path or session reference");
  }

  return normalized;
}

function promotionSourceTypeLabel(sourceType: PromotionSourceType): string {
  if (sourceType === "cmo-session") {
    return "CMO Session";
  }

  if (sourceType === "raw-capture") {
    return "Raw Capture";
  }

  return "Daily Note";
}

function promotionTimestamp(date = new Date(), timeZone = process.env.CMO_VAULT_TIME_ZONE ?? "Asia/Saigon"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";

  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
}

function promotionDayFromTimestamp(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function promotionTopic(value: string | undefined): string {
  return compactText(value || "CMO session", 96) || "CMO session";
}

function suggestedTargetForText(sourceType: PromotionSourceType, topic: string, summary: string): AppMemoryNoteKey {
  const haystack = `${topic} ${summary}`.toLowerCase();

  if (/decision|approve|choose|commit/.test(haystack)) {
    return "decisions";
  }

  if (/task|todo|follow[- ]?up|owner|assignee/.test(haystack)) {
    return "tasks";
  }

  if (/position|promise|differentiat|proof|claim/.test(haystack)) {
    return "positioning";
  }

  if (/audience|persona|user|segment|job to be done|jtbd|pain/.test(haystack)) {
    return "audience";
  }

  if (/product|feature|flow|activation|constraint/.test(haystack)) {
    return "product";
  }

  if (/content|channel|narrative|angle|pillar|copy/.test(haystack)) {
    return "content";
  }

  return sourceType === "daily-note" ? "learnings" : "learnings";
}

function candidateId(parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

function timestampSortValue(value: string | undefined): number {
  const timestamp = Date.parse(value ?? "");

  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function readPromotedSourceMarkers(app: AppWorkspace): Promise<string[]> {
  const contents = await Promise.all(APP_MEMORY_NOTE_CONFIGS.map((config) => readVaultText(physicalAppVaultPath(app, config.fileName))));

  return contents.filter((content): content is string => Boolean(content));
}

function sourceAlreadyPromoted(contents: string[], sourcePath: string): boolean {
  const source = safeWikiSourcePath(sourcePath);

  return contents.some((content) => content.includes(`Source: [[${source}]]`) || content.includes(`Source: [[${source}|`));
}

function sessionCandidate(app: AppWorkspace, session: Awaited<ReturnType<typeof readAppChatSessions>>[number], promotedContents: string[]): PromotionCandidate {
  const firstUserMessage = session.messages.find((message) => message.role === "user")?.content ?? session.topic ?? "CMO session";
  const assistantAnswer = [...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
  const suggestedActions = session.suggestedActions?.length ? session.suggestedActions.map((action) => action.label).join("; ") : "No suggested actions captured.";
  const contextUsed = session.contextUsed.length ? session.contextUsed.map((note) => `${note.title} (${note.contextQuality ?? "draft"})`).join(", ") : "No selected context notes were included.";
  const topic = promotionTopic(session.topic || firstUserMessage);
  const summary = compactText(assistantAnswer || firstUserMessage, 520);
  const sourcePath = session.sessionNotePath || `app-chat/${session.id}`;

  return {
    id: candidateId(["cmo-session", session.id, sourcePath]),
    sourceType: "cmo-session",
    sourcePath,
    appId: app.id,
    appName: app.name,
    topic,
    summary: summary || "CMO session captured without a readable assistant summary.",
    context: compactText([`User message: ${firstUserMessage}`, `Suggested actions: ${suggestedActions}`, `Context used: ${contextUsed}`].join("\n"), 900),
    suggestedTargetNoteKey: suggestedTargetForText("cmo-session", topic, `${summary} ${suggestedActions}`),
    status: sourceAlreadyPromoted(promotedContents, sourcePath) ? "promoted" : "pending",
    createdAt: session.createdAt,
  };
}

function rawCaptureCandidate(app: AppWorkspace, rawPath: string, capture: RawCaptureEntry, promotedContents: string[], index: number): PromotionCandidate {
  const timestamp = capture.timestamp || "";
  const sourcePath = `${rawPath}#${capture.topic.replace(/[^A-Za-z0-9 -]/g, "").trim().replace(/\s+/g, "-").slice(0, 64) || `capture-${index + 1}`}`;
  const summary = compactText(capture.summary || capture.topic, 520);

  return {
    id: candidateId(["raw-capture", sourcePath, timestamp, capture.topic]),
    sourceType: "raw-capture",
    sourcePath,
    appId: app.id,
    appName: app.name,
    topic: promotionTopic(capture.topic),
    summary: summary || "Raw capture has no readable summary yet.",
    context: compactText(
      [
        `Runtime status: ${capture.runtimeStatus ?? "not captured"}.`,
        capture.sessionId ? `Session ID: ${capture.sessionId}.` : "",
        capture.sessionNotePath ? `Session note: ${capture.sessionNotePath}.` : "",
      ].join("\n"),
      700,
    ),
    suggestedTargetNoteKey: "learnings",
    status: sourceAlreadyPromoted(promotedContents, sourcePath) ? "promoted" : "pending",
    createdAt: timestamp,
  };
}

function dailyNoteCandidate(app: AppWorkspace, dailyPath: string, content: string, promotedContents: string[]): PromotionCandidate {
  const summary = markdownTopLevelSection(content, "Suggested Promotions") || markdownTopLevelSection(content, "Summary") || previewMarkdown(content);

  return {
    id: candidateId(["daily-note", dailyPath, summary]),
    sourceType: "daily-note",
    sourcePath: dailyPath,
    appId: app.id,
    appName: app.name,
    topic: "Daily note suggested promotions",
    summary: compactText(summary, 520) || "Daily note exists, but no suggested promotion summary was found.",
    context: compactText(markdownTopLevelSection(content, "Key Discussions") || markdownTopLevelSection(content, "Follow-ups") || "Review the daily note before promoting.", 700),
    suggestedTargetNoteKey: "learnings",
    status: sourceAlreadyPromoted(promotedContents, dailyPath) ? "promoted" : "pending",
  };
}

export async function readPromotionCandidates(appId: string, dateValue?: string): Promise<PromotionCandidate[]> {
  const app = getAppWorkspace(appId);

  if (!app) {
    throw new Error(`Unknown appId: ${appId}`);
  }

  const date = resolveDate(dateValue);
  const promotedContents = await readPromotedSourceMarkers(app);
  const sessions = await readAppChatSessions(12, app.id);
  const rawPath = rawVaultPath(date);
  const dailyPath = dailyVaultPath(date);
  const rawContent = await readVaultText(rawPath);
  const dailyContent = await readVaultText(dailyPath);
  const candidates: PromotionCandidate[] = [
    ...sessions.map((session) => sessionCandidate(app, session, promotedContents)),
    ...parseRawCaptures(rawContent)
      .filter((capture) => capture.appId === app.id || capture.appName === app.name)
      .slice(0, 8)
      .map((capture, index) => rawCaptureCandidate(app, rawPath, capture, promotedContents, index)),
  ];

  if (dailyContent) {
    candidates.push(dailyNoteCandidate(app, dailyPath, dailyContent, promotedContents));
  }

  return candidates
    .filter((candidate, index, list) => list.findIndex((item) => item.id === candidate.id) === index)
    .sort((left, right) => timestampSortValue(right.createdAt) - timestampSortValue(left.createdAt));
}

function promotionOpenQuestions(): string {
  return "- Review this candidate before marking the target note confirmed.";
}

function generalPromotionSection(request: PromotionRequest, timestamp: string): string {
  const sourcePath = safeWikiSourcePath(request.sourcePath);

  return [
    `## Promoted Context — ${timestamp}`,
    "",
    `Source: [[${sourcePath}]]`,
    `Source Type: ${promotionSourceTypeLabel(request.sourceType)}`,
    "Status: draft",
    "Promoted By: CMO UI",
    "",
    "### Summary",
    "",
    request.summary.trim() || "No summary provided.",
    "",
    "### Evidence / Context",
    "",
    request.context?.trim() || "No additional context captured. Review the source note before confirming.",
    "",
    "### Open Questions",
    "",
    promotionOpenQuestions(),
    "",
  ].join("\n");
}

function learningPromotionSection(request: PromotionRequest, timestamp: string): string {
  const sourcePath = safeWikiSourcePath(request.sourcePath);

  return [
    `## Learning Candidate — ${timestamp}`,
    "",
    `Source: [[${sourcePath}]]`,
    "Status: draft",
    "",
    "### Signal",
    "",
    request.summary.trim() || "No signal summary provided.",
    "",
    "### Interpretation",
    "",
    request.context?.trim() || "Needs review before becoming a confirmed learning.",
    "",
    "### Evidence",
    "",
    `Source: [[${sourcePath}]]`,
    "",
    "### Follow-up",
    "",
    "- Review and confirm whether this should become durable app memory.",
    "",
  ].join("\n");
}

function candidateSubsection(request: PromotionRequest, timestamp: string, kind: "decision" | "task"): string {
  const sourcePath = safeWikiSourcePath(request.sourcePath);
  const day = promotionDayFromTimestamp(timestamp);
  const topic = promotionTopic(request.topic || request.summary);

  return [
    `### ${day} — ${topic}`,
    "",
    "Status: proposed",
    `Source: [[${sourcePath}]]`,
    kind === "decision" ? "Note: Decision locking comes in Phase 2." : "Note: Task Tracker integration is not connected yet.",
    "",
    request.summary.trim() || "No summary provided.",
    request.context?.trim() ? `\n${request.context.trim()}` : "",
    "",
  ].join("\n");
}

function appendUnderHeading(content: string, heading: string, section: string): string {
  const headingPattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const match = content.match(headingPattern);

  if (!match || match.index === undefined) {
    return `${content.trimEnd()}\n\n## ${heading}\n\n${section}`.trimEnd() + "\n";
  }

  const sectionStart = match.index + match[0].length;
  const nextHeadingIndex = content.slice(sectionStart).search(/\r?\n##\s+/);
  const insertAt = nextHeadingIndex >= 0 ? sectionStart + nextHeadingIndex : content.length;

  return `${content.slice(0, insertAt).trimEnd()}\n\n${section}\n${content.slice(insertAt).trimStart()}`.trimEnd() + "\n";
}

function promotionSectionForTarget(request: PromotionRequest, targetNoteKey: AppMemoryNoteKey, timestamp: string): {
  section: string;
  containerHeading?: string;
} {
  if (targetNoteKey === "learnings") {
    return { section: learningPromotionSection(request, timestamp) };
  }

  if (targetNoteKey === "decisions") {
    return {
      section: candidateSubsection(request, timestamp, "decision"),
      containerHeading: "Decision Candidates",
    };
  }

  if (targetNoteKey === "tasks") {
    return {
      section: candidateSubsection(request, timestamp, "task"),
      containerHeading: "Task Candidates from CMO Sessions",
    };
  }

  return { section: generalPromotionSection(request, timestamp) };
}

function normalizePromotionRequest(value: unknown): PromotionRequest {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const sourceType = typeof record.sourceType === "string" && PROMOTION_SOURCE_TYPES.has(record.sourceType as PromotionSourceType) ? record.sourceType : "";
  const targetNoteKey = typeof record.targetNoteKey === "string" ? record.targetNoteKey : "";

  if (!record.candidateId || typeof record.candidateId !== "string") {
    throw new Error("candidateId is required");
  }

  if (!APP_MEMORY_NOTE_BY_KEY.has(targetNoteKey as AppMemoryNoteKey)) {
    throw new Error(`Invalid targetNoteKey: ${targetNoteKey}`);
  }

  if (!sourceType) {
    throw new Error("Invalid sourceType");
  }

  if (record.status !== "draft") {
    throw new Error("Promotions can only write draft memory in Phase 1.7");
  }

  const sourcePath = typeof record.sourcePath === "string" ? safeWikiSourcePath(record.sourcePath) : "";

  if (!sourcePath) {
    throw new Error("sourcePath is required");
  }

  return {
    candidateId: record.candidateId.trim(),
    targetNoteKey: targetNoteKey as AppMemoryNoteKey,
    summary: typeof record.summary === "string" ? record.summary.trim() : "",
    sourcePath,
    sourceType: sourceType as PromotionSourceType,
    status: "draft",
    topic: typeof record.topic === "string" ? record.topic.trim() : undefined,
    context: typeof record.context === "string" ? record.context.trim() : undefined,
  };
}

export async function promoteAppMemoryCandidate(appId: string, payload: unknown): Promise<PromotionResponse> {
  const app = getAppWorkspace(appId);

  if (!app) {
    throw new Error(`Unknown appId: ${appId}`);
  }

  const request = normalizePromotionRequest(payload);
  const targetConfig = appMemoryNoteConfig(request.targetNoteKey);
  const targetPath = appMemoryVaultPath(app, request.targetNoteKey);
  const targetFilePath = vaultFilePath(targetPath);
  const currentContent = (await readVaultText(targetPath)) ?? appMemoryNoteTemplate(app, targetConfig, "draft");
  const parsed = parseFrontmatter(currentContent);
  const timestamp = promotionTimestamp();
  const promotion = promotionSectionForTarget(request, request.targetNoteKey, timestamp);
  const bodyWithAppend = promotion.containerHeading
    ? appendUnderHeading(parsed.body, promotion.containerHeading, promotion.section)
    : `${parsed.body.trimEnd()}\n\n${promotion.section}`.trimEnd() + "\n";
  const nextContent = buildAppMemoryContent(app, targetConfig, currentContent, bodyWithAppend, "draft");

  await mkdir(path.dirname(targetFilePath), { recursive: true });
  await writeFile(targetFilePath, nextContent, "utf8");

  const written = await readFile(targetFilePath, "utf8");

  if (!written.includes(timestamp) || !written.includes(`Source: [[${request.sourcePath}]]`)) {
    throw new Error("Promotion write could not be verified");
  }

  const notes = await readAppMemoryNotes(app.id);
  const targetNote = notes.find((note) => note.noteKey === request.targetNoteKey);

  if (!targetNote || targetNote.contextQuality !== "draft") {
    throw new Error("Promotion saved, but target note did not read back as draft");
  }

  return {
    status: "promoted",
    targetPath,
    appended: true,
    updatedContextQuality: summarizeContextQuality(notes),
    targetNote,
  };
}

export async function readLatestAppPromotion(app: AppWorkspace): Promise<AppDashboardSnapshot["latestPromotion"] | undefined> {
  const candidates: Array<NonNullable<AppDashboardSnapshot["latestPromotion"]>> = [];

  for (const config of APP_MEMORY_NOTE_CONFIGS) {
    const targetPath = physicalAppVaultPath(app, config.fileName);
    const content = await readVaultText(targetPath);

    if (!content) {
      continue;
    }

    const headingMatches = Array.from(content.matchAll(/^##\s+(Promoted Context|Learning Candidate)\s+[—-]\s+(.+)$/gm));
    const subheadingMatches = Array.from(content.matchAll(/^###\s+(\d{4}-\d{2}-\d{2})\s+[—-]\s+(.+)$/gm)).filter((match) =>
      content.slice(Math.max(0, (match.index ?? 0) - 80), match.index).includes("Candidates"),
    );

    for (const match of headingMatches) {
      const start = match.index ?? 0;
      const section = content.slice(start, start + 900);
      const source = section.match(/^Source:\s+\[\[([^\]]+)\]\]/m)?.[1];

      candidates.push({
        title: `${match[1]} — ${config.title}`,
        targetPath,
        sourcePath: source,
        promotedAt: match[2]?.trim(),
      });
    }

    for (const match of subheadingMatches) {
      const start = match.index ?? 0;
      const section = content.slice(start, start + 700);
      const source = section.match(/^Source:\s+\[\[([^\]]+)\]\]/m)?.[1];

      candidates.push({
        title: `${config.title} candidate — ${match[2]?.trim() || "Untitled"}`,
        targetPath,
        sourcePath: source,
        promotedAt: match[1]?.trim(),
      });
    }
  }

  return candidates.sort((left, right) => timestampSortValue(right.promotedAt) - timestampSortValue(left.promotedAt))[0];
}

function safeFileName(value: string): string {
  return value
    .trim()
    .replace(/[/\\:*?"<>|#\r\n]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim() || "CMO Session";
}

async function uniqueVaultMarkdownPath(relativePath: string): Promise<string> {
  if (!(await vaultRelativeFileExists(relativePath))) {
    return relativePath;
  }

  const parsed = path.posix.parse(relativePath.replaceAll("\\", "/"));
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const stampedPath = `${parsed.dir}/${parsed.name} ${stamp}${parsed.ext}`;

  if (!(await vaultRelativeFileExists(stampedPath))) {
    return stampedPath;
  }

  for (let index = 2; index < 100; index += 1) {
    const candidate = `${parsed.dir}/${parsed.name} ${stamp}-${index}${parsed.ext}`;

    if (!(await vaultRelativeFileExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Could not find a unique Vault path for ${relativePath}`);
}

function formatNoteLinks(notes: VaultNoteRef[]): string {
  return notes.length ? notes.map((note) => `- [[${note.path}|${note.title}]]`).join("\n") : "- None.";
}

function formatMessagesByRole(session: Awaited<ReturnType<typeof readAppChatSession>>): {
  userInputs: string;
  cmoResponse: string;
  allMessages: string;
} {
  const messages = session?.messages ?? [];
  const userInputs = messages.filter((message) => message.role === "user").map((message) => `- ${message.content}`).join("\n") || "- None.";
  const cmoResponse = [...messages].reverse().find((message) => message.role === "assistant")?.content || "No CMO response captured.";
  const allMessages = messages.map((message) => `**${messageLabel(message.role)}:** ${message.content}`).join("\n\n") || "No messages captured.";

  return { userInputs, cmoResponse, allMessages };
}

function sessionNoteMarkdown(app: AppWorkspace, session: NonNullable<Awaited<ReturnType<typeof readAppChatSession>>>, targetPath: string): string {
  const date = formatVaultDate(new Date(session.createdAt));
  const topic = session.topic || "CMO session";
  const messages = formatMessagesByRole(session);
  const assumptions = session.assumptions?.length ? session.assumptions.map((assumption) => `- ${assumption}`).join("\n") : "- None captured.";
  const suggestedActions = session.suggestedActions?.length ? session.suggestedActions.map((action) => `- ${action.label}`).join("\n") : "- None captured.";

  return [
    "---",
    `title: ${date} - ${topic}`,
    "type: cmo-session",
    "status: captured",
    "scope: holdstation",
    "vault: holdstation",
    `app: ${app.name}`,
    `app_id: ${app.id}`,
    `date: ${date}`,
    `runtime_status: ${session.runtimeStatus ?? "not_captured"}`,
    `runtime_mode: ${session.runtimeMode ?? "not_captured"}`,
    `attempted_runtime_mode: ${session.attemptedRuntimeMode ?? "not_captured"}`,
    session.runtimeErrorReason ? `runtime_error_reason: ${session.runtimeErrorReason}` : "runtime_error_reason: none",
    `fallback: ${session.isDevelopmentFallback ? "true" : "false"}`,
    `runtime_fallback: ${session.isRuntimeFallback ? "true" : "false"}`,
    "source:",
    "  - \"[[../C-Level Priorities]]\"",
    "tags:",
    "  - holdstation",
    "  - cmo",
    "  - cmo-session",
    "---",
    "",
    `# ${date} - ${topic}`,
    "",
    "## Topic",
    topic,
    "",
    "## Runtime Status",
    `Runtime status: ${session.runtimeStatus ?? "not captured"}`,
    `Runtime mode: ${session.runtimeMode ?? "not captured"}`,
    `Attempted runtime mode: ${session.attemptedRuntimeMode ?? "not captured"}`,
    `Fallback: ${session.isDevelopmentFallback ? "true" : "false"}`,
    `Runtime fallback: ${session.isRuntimeFallback ? "true" : "false"}`,
    session.runtimeErrorReason ? `Runtime error reason: ${session.runtimeErrorReason}` : "",
    session.runtimeError ? `Runtime error: ${session.runtimeError}` : "",
    "",
    "## Session ID",
    session.id,
    "",
    "## Related Priority",
    session.relatedPriority || "None linked yet.",
    "",
    "## Context Used",
    formatNoteLinks(session.contextUsed),
    "",
    "## Missing Context",
    formatNoteLinks(session.missingContext ?? []),
    "",
    "## User Inputs",
    messages.userInputs,
    "",
    "## CMO Response",
    messages.cmoResponse,
    "",
    "## Assumptions",
    assumptions,
    "",
    "## Suggested Actions",
    suggestedActions,
    "",
    "## Potential Decisions",
    "None locked. Decision locking comes in Phase 2.",
    "",
    "## Related Tasks",
    session.relatedTasks?.length ? session.relatedTasks.map((task) => `- ${task}`).join("\n") : "None linked yet.",
    "",
    "## Raw Capture Link",
    session.rawCapturePath ? `[[${session.rawCapturePath}]]` : "Not captured to Raw Vault yet.",
    "",
    "## Full Messages",
    messages.allMessages,
    "",
    "## Session Note Path",
    targetPath,
    "",
  ].join("\n");
}

export async function saveCmoSessionToVault(request: {
  appId: string;
  sessionId: string;
  topic?: string;
  relatedPriority?: string;
  relatedPlan?: string;
  relatedTasks?: string[];
}): Promise<{ status: "saved"; path: string; sessionId: string; alreadySaved: boolean }> {
  const app = getAppWorkspace(request.appId);

  if (!app) {
    throw new Error(`Unknown appId: ${request.appId}`);
  }

  const session = await readAppChatSession(request.sessionId);

  if (!session || session.appId !== app.id) {
    throw new Error(`No session found for ${request.sessionId} and app ${app.id}`);
  }

  if (session.savedToVault && session.sessionNotePath) {
    return {
      status: "saved",
      path: session.sessionNotePath,
      sessionId: session.id,
      alreadySaved: true,
    };
  }

  const date = formatVaultDate(new Date(session.createdAt));
  const topic = safeFileName(request.topic || session.topic || "CMO Session");
  const targetPath = await uniqueVaultMarkdownPath(physicalAppVaultPath(app, `Sessions/${date} - ${topic}.md`));
  const filePath = vaultFilePath(targetPath);
  const content = sessionNoteMarkdown(
    app,
    {
      ...session,
      topic,
      relatedPriority: request.relatedPriority || session.relatedPriority,
      relatedPlan: request.relatedPlan || session.relatedPlan,
      relatedTasks: request.relatedTasks ?? session.relatedTasks,
    },
    targetPath,
  );

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");

  const written = await readFile(filePath, "utf8");

  if (!written.includes(session.id)) {
    throw new Error("CMO session note write could not be verified");
  }

  await updateAppChatSessionMetadata(session.id, {
    savedToVault: true,
    sessionNotePath: targetPath,
    relatedPriority: request.relatedPriority || session.relatedPriority,
    relatedPlan: request.relatedPlan || session.relatedPlan,
    relatedTasks: request.relatedTasks ?? session.relatedTasks,
  });

  return {
    status: "saved",
    path: targetPath,
    sessionId: session.id,
    alreadySaved: false,
  };
}

function extractSection(section: string, heading: string): string {
  const pattern = new RegExp(`### ${heading}\\r?\\n([\\s\\S]*?)(?=\\r?\\n### |$)`, "i");
  const match = section.match(pattern);

  return match?.[1]?.trim() ?? "";
}

export function parseRawCaptures(content: string | null): RawCaptureEntry[] {
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
    const timestampMatch = section.match(/^Time:\s*(.+)$/m);
    const runtimeStatusMatch = section.match(/^Runtime Status:\s*(.+)$/m);
    const appIdMatch = section.match(/^App ID:\s*(.+)$/m);
    const sessionIdMatch = section.match(/^Session ID:\s*(.+)$/m);
    const sessionNotePathMatch = section.match(/^Session Note:\s*(.+)$/m);
    const fallbackMatch = section.match(/^Fallback:\s*(.+)$/m);

    captures.push({
      appName: match[1].trim(),
      topic: match[2].trim(),
      timestamp: timestampMatch?.[1]?.trim(),
      runtimeStatus: runtimeStatusMatch?.[1]?.trim(),
      appId: appIdMatch?.[1]?.trim(),
      sessionId: sessionIdMatch?.[1]?.trim(),
      sessionNotePath: sessionNotePathMatch?.[1]?.trim(),
      fallback: fallbackMatch?.[1]?.trim().toLowerCase() === "true",
      summary: extractSection(section, "Session Summary"),
    });
  });

  return captures;
}

function rawFrontmatter(date: string): string {
  return [
    "---",
    `title: Holdstation Raw Capture ${date}`,
    "type: journal",
    "status: active",
    "scope: holdstation",
    "vault: holdstation",
    `date: ${date}`,
    "tags:",
    "  - holdstation",
    "  - journal",
    "  - raw-capture",
    "---",
    "",
    `# Raw Capture \u2014 ${date}`,
    "",
  ].join("\n");
}

function dailyFrontmatter(date: string): string {
  return [
    "---",
    `title: ${date} \u2014 Holdstation Daily`,
    "type: daily-review",
    `date: ${date}`,
    "status: draft",
    "scope: holdstation",
    "vault: holdstation",
    "source:",
    `  - \"[[../Raw/${date}]]\"`,
    "tags:",
    "  - holdstation",
    "  - cmo",
    "  - daily",
    "  - review",
    "---",
    "",
    `# ${date} \u2014 Holdstation Daily`,
    "",
  ].join("\n");
}

function sourceLabel(source: string): string {
  if (source === "cmo-session") {
    return "CMO Session";
  }

  return source === "cmo-chat" ? "CMO Chat" : source;
}

function messageLabel(role: RawCaptureRequest["messages"][number]["role"]): string {
  if (role === "assistant") {
    return "CMO";
  }

  if (role === "system") {
    return "System";
  }

  return "User";
}

function formatQualifiedNoteList(notes: VaultNoteRef[] | undefined, emptyText: string): string {
  if (!notes?.length) {
    return `- ${emptyText}`;
  }

  return notes
    .map((note) => {
      const existsLabel = note.exists === false ? "file missing" : "file exists";
      const quality = note.contextQuality ?? (note.exists === false ? "missing" : "draft");
      const status = note.frontmatterStatus ? `; status: ${note.frontmatterStatus}` : "";
      const reason = note.qualityReason ? `; ${note.qualityReason}` : "";

      return `- [[${note.path}|${note.title}]] - ${existsLabel}; quality: ${quality}${status}${reason}`;
    })
    .join("\n");
}

function contextQualitySummaryFromRequest(request: RawCaptureRequest): CMOContextQualitySummary {
  if (request.contextQualitySummary) {
    return request.contextQualitySummary;
  }

  if (request.contextDiagnostics) {
    return {
      selectedCount: request.contextDiagnostics.selectedCount,
      existingCount: request.contextDiagnostics.existingCount,
      missingCount: request.contextDiagnostics.missingCount,
      confirmedCount: request.contextDiagnostics.confirmedCount ?? 0,
      draftCount: request.contextDiagnostics.draftCount ?? 0,
      placeholderCount: request.contextDiagnostics.placeholderCount ?? 0,
      placeholderOrDraftCount: request.contextDiagnostics.placeholderOrDraftCount ?? 0,
    };
  }

  const qualityNotes = request.selectedContextNotes?.length
    ? request.selectedContextNotes
    : [...request.contextUsed, ...(request.missingContext ?? [])];

  return summarizeContextQuality(qualityNotes);
}

function formatContextQuality(request: RawCaptureRequest): string {
  const qualityNotes = request.selectedContextNotes?.length
    ? request.selectedContextNotes
    : [...request.contextUsed, ...(request.missingContext ?? [])];
  const summary = contextQualitySummaryFromRequest(request);
  const noteLines = qualityNotes.length
    ? qualityNotes
        .map((note) => {
          const quality = note.contextQuality ?? (note.exists === false ? "missing" : "draft");
          const status = note.frontmatterStatus ? ` (status: ${note.frontmatterStatus})` : "";
          const reason = note.qualityReason ? ` - ${note.qualityReason}` : "";

          return `- ${note.title}: ${quality}${status}${reason}`;
        })
        .join("\n")
    : "- No selected context quality was captured.";

  return [
    noteLines,
    "",
    `- Confirmed notes: ${summary.confirmedCount}`,
    `- Draft notes: ${summary.draftCount}`,
    `- Placeholder notes: ${summary.placeholderCount}`,
    `- Placeholder/draft notes: ${summary.placeholderOrDraftCount}`,
    `- Missing notes: ${summary.missingCount}`,
  ].join("\n");
}

function rawCaptureDiagnostics(request: RawCaptureRequest) {
  const selectedCount = request.contextDiagnostics?.selectedCount ?? request.selectedContextNotes?.length ?? request.contextUsed.length + (request.missingContext?.length ?? 0);
  const existingCount = request.contextDiagnostics?.existingCount ?? request.contextUsed.length;
  const missingCount = request.contextDiagnostics?.missingCount ?? request.missingContext?.length ?? 0;
  const totalChars = request.contextDiagnostics?.totalChars ?? 0;
  const qualitySummary = contextQualitySummaryFromRequest(request);

  return [
    `- Selected notes: ${selectedCount}`,
    `- Context files found: ${existingCount} / ${selectedCount}`,
    `- Existing notes used: ${existingCount}`,
    `- Missing notes: ${missingCount}`,
    `- Confirmed notes: ${qualitySummary.confirmedCount}`,
    `- Placeholder notes: ${qualitySummary.placeholderCount}`,
    `- Draft notes: ${qualitySummary.draftCount}`,
    `- Placeholder/draft notes: ${qualitySummary.placeholderOrDraftCount}`,
    `- Context characters sent: ${totalChars}`,
  ].join("\n");
}

function formatRawCaptureSection(request: RawCaptureRequest, date: string, timestamp: string): string {
  const topic = request.topic?.trim() || "CMO session";
  const summary = request.summary?.trim() || "No session summary was provided.";
  const runtimeStatus = request.runtimeStatus ?? "not_captured";
  const runtimeMode = request.runtimeMode ?? "not_captured";
  const selectedContext = formatQualifiedNoteList(request.selectedContextNotes, "No selected context notes were captured.");
  const context = formatQualifiedNoteList(request.contextUsed, "No selected context notes were included in the CMO payload.");
  const missingContext = request.missingContext?.length
    ? request.missingContext
        .map((note) => {
          const quality = note.contextQuality ?? "missing";
          const reason = note.qualityReason || note.contentPreview || "Selected context note was missing.";

          return `- ${note.title}: ${note.path} - quality: ${quality}; ${reason}`;
        })
        .join("\n")
    : "- None.";
  const userMessages = request.messages.filter((message) => message.role === "user");
  const cmoAnswer = [...request.messages].reverse().find((message) => message.role === "assistant")?.content.trim() || "No CMO answer was captured.";
  const messages = request.messages.length
    ? request.messages
        .map((message) => `**${messageLabel(message.role)}:** ${message.content.trim() || "(empty)"}`)
        .join("\n\n")
    : "No messages were captured.";
  const assumptions = request.assumptions?.length
    ? request.assumptions.map((assumption) => `- ${assumption}`).join("\n")
    : "- None captured.";
  const suggestedActions = request.suggestedActions?.length
    ? request.suggestedActions.map((action) => `- ${action.label}`).join("\n")
    : "- None captured.";
  const questions = request.openQuestions?.length
    ? request.openQuestions.map((question) => `- ${question}`).join("\n")
    : "- None captured in this Phase 1 session.";

  return [
    `## ${request.appName} \u2014 ${topic}`,
    "",
    `Time: ${timestamp}`,
    `Source: ${sourceLabel(request.source)}`,
    `Related Source: ${request.relatedSource ?? request.source}`,
    `App: ${request.appName}`,
    `App ID: ${request.appId}`,
    request.sessionId ? `Session ID: ${request.sessionId}` : "Session ID: not_captured",
    request.sessionNotePath ? `Session Note: ${request.sessionNotePath}` : "Session Note: not_saved",
    request.relatedPriority ? `Related Priority: ${request.relatedPriority}` : "Related Priority: none",
    request.relatedPlan ? `Related Plan: ${request.relatedPlan}` : "Related Plan: none",
    "Status: captured",
    `Runtime: ${runtimeStatus}`,
    `Runtime Mode: ${runtimeMode}`,
    `Attempted Runtime Mode: ${request.attemptedRuntimeMode ?? "not_captured"}`,
    `Fallback: ${request.isDevelopmentFallback ? "true" : "false"}`,
    `Runtime Fallback: ${request.isRuntimeFallback ? "true" : "false"}`,
    `Runtime Status: ${runtimeStatus}`,
    `Runtime Error Reason: ${request.runtimeErrorReason ?? "none"}`,
    `Development Fallback: ${request.isDevelopmentFallback ? "yes" : "no"}`,
    "",
    "### Session Summary",
    summary,
    "",
    "### Selected Context Notes",
    selectedContext,
    "",
    "### Context Notes Actually Used",
    context,
    "",
    "### Missing Selected Context",
    missingContext,
    "",
    "### Context Diagnostics",
    rawCaptureDiagnostics(request),
    "",
    "### Context Quality",
    formatContextQuality(request),
    "",
    "### User Messages",
    userMessages.length ? userMessages.map((message) => `- ${message.content.trim() || "(empty)"}`).join("\n") : "- None captured.",
    "",
    "### CMO Answer",
    cmoAnswer,
    "",
    "### Runtime Assumptions",
    assumptions,
    "",
    "### Suggested Actions",
    suggestedActions,
    "",
    "### Messages",
    messages,
    "",
    "### Open Questions",
    questions,
    "",
  ].join("\n");
}

export async function saveRawCapture(request: RawCaptureRequest): Promise<RawCaptureResponse> {
  if (request.workspaceId !== HOLDSTATION_WORKSPACE_ID) {
    throw new Error(`Unsupported workspaceId: ${request.workspaceId}`);
  }

  const app = getAppWorkspace(request.appId);

  if (!app) {
    throw new Error(`Unknown appId: ${request.appId}`);
  }

  const normalizedRequest: RawCaptureRequest = {
    ...request,
    appId: app.id,
    appName: app.name,
  };
  const date = resolveDate(request.date);
  const relativePath = rawVaultPath(date);
  const filePath = vaultFilePath(relativePath);
  const timestamp = new Date().toISOString();
  const section = formatRawCaptureSection(normalizedRequest, date, timestamp);
  const fileAlreadyExists = await exists(filePath);

  await mkdir(path.dirname(filePath), { recursive: true });

  if (fileAlreadyExists) {
    await appendFile(filePath, `\n${section}`, "utf8");
  } else {
    await writeFile(filePath, `${rawFrontmatter(date)}${section}`, "utf8");
  }

  const written = await readFile(filePath, "utf8");

  if (!written.includes(timestamp)) {
    throw new Error("Raw capture write could not be verified");
  }

  if (normalizedRequest.sessionId) {
    await updateAppChatSessionMetadata(normalizedRequest.sessionId, {
      rawCapturePath: relativePath,
      ...(normalizedRequest.sessionNotePath ? { sessionNotePath: normalizedRequest.sessionNotePath, savedToVault: true } : {}),
      ...(normalizedRequest.relatedPriority ? { relatedPriority: normalizedRequest.relatedPriority } : {}),
      ...(normalizedRequest.relatedPlan ? { relatedPlan: normalizedRequest.relatedPlan } : {}),
    });
  }

  return {
    status: "saved",
    path: relativePath,
    appended: fileAlreadyExists,
  };
}

function listOrNone(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "- None captured.";
}

function deterministicDailyNote(date: string, rawPath: string, captures: RawCaptureEntry[]): string {
  const apps = Array.from(new Set(captures.map((capture) => capture.appName).filter(Boolean)));
  const runtimeStatuses = captures.map((capture) => `${capture.appName}: ${capture.runtimeStatus ?? "not captured"}`);
  const discussions = captures.map((capture) => {
    const summary = capture.summary ? `: ${capture.summary}` : "";
    return `${capture.appName} - ${capture.topic}${summary}`;
  });
  const promotions = captures.map((capture) => `${capture.appName}: review "${capture.topic}" for later App Memory promotion.`);

  return [
    dailyFrontmatter(date),
    "## Summary",
    captures.length
      ? `Generated from ${captures.length} raw capture(s) in [[../Raw/${date}]]. This is a deterministic Phase 1 summary from raw captures because the CMO summarization backend is not connected.`
      : `No raw captures were found in ${rawPath}.`,
    "",
    "## Apps Touched",
    listOrNone(apps),
    "",
    "## Runtime Statuses",
    listOrNone(runtimeStatuses),
    "",
    "## Key Discussions",
    listOrNone(discussions),
    "",
    "## Decisions Proposed",
    "- None explicitly captured.",
    "",
    "## Open Questions",
    "- Review the raw captures for unresolved questions before promoting anything into durable App Memory.",
    "",
    "## Follow-ups",
    captures.length ? "- Decide which app-specific notes should be refined tomorrow." : "- Start a CMO session from an App Workspace.",
    "",
    "## Suggested Promotions",
    "Items that may later be promoted to durable app memory:",
    listOrNone(promotions),
    "",
  ].join("\n");
}

export async function generateDailyNote(request: DailyNoteGenerateRequest): Promise<DailyNoteGenerateResponse> {
  const date = resolveDate(request.date);
  const sourceRawPath = request.sourceRawPath ? normalizeVaultRelativePath(request.sourceRawPath) : rawVaultPath(date);
  const dailyPath = dailyVaultPath(date);
  const rawContent = await readVaultText(sourceRawPath);

  if (!rawContent) {
    throw new Error(`No raw capture note found at ${sourceRawPath}`);
  }

  const dailyFilePath = vaultFilePath(dailyPath);

  if (await exists(dailyFilePath)) {
    const error = new Error(`Daily note already exists at ${dailyPath}`);
    error.name = "DailyNoteAlreadyExistsError";
    throw error;
  }

  const captures = parseRawCaptures(rawContent);
  const content = deterministicDailyNote(date, sourceRawPath, captures);

  await mkdir(path.dirname(dailyFilePath), { recursive: true });
  await writeFile(dailyFilePath, content, "utf8");

  const written = await readFile(dailyFilePath, "utf8");

  if (!written.includes(`Generated from ${captures.length} raw capture`)) {
    throw new Error("Daily note write could not be verified");
  }

  return {
    status: "saved",
    path: dailyPath,
    sourceRawPath,
    generatedFromRawCaptures: true,
  };
}

export async function readDailyNotesState(dateValue?: string): Promise<DailyNotesState> {
  const date = resolveDate(dateValue);
  const rawPath = rawVaultPath(date);
  const dailyPath = dailyVaultPath(date);
  const rawContent = await readVaultText(rawPath);

  return {
    date,
    rawPath,
    dailyPath,
    rawExists: Boolean(rawContent),
    dailyExists: await vaultRelativeFileExists(dailyPath),
    captures: parseRawCaptures(rawContent),
  };
}

export async function readAppWorkspaceState(appId: string, dateValue?: string): Promise<AppWorkspaceState | null> {
  const app = getAppWorkspace(appId);

  if (!app) {
    return null;
  }

  const date = resolveDate(dateValue);
  const appNotes = await Promise.all(buildAppContextNotes(app).map(hydrateNote));
  const dailyPath = dailyVaultPath(date);
  const rawPath = rawVaultPath(date);
  const dailyExists = await vaultRelativeFileExists(dailyPath);
  const dailyNote: VaultNoteRef | undefined = dailyExists
    ? await hydrateNote({
        id: `${app.id}-latest-daily`,
        title: "Latest Daily Note",
        path: dailyPath,
        type: "daily-note",
        reason: "Daily review context for today",
        selected: true,
        exists: true,
      })
    : undefined;
  const contextNotes = dailyNote ? [...appNotes, dailyNote] : appNotes;
  const rawContent = await readVaultText(rawPath);
  const recentCaptures = parseRawCaptures(rawContent).filter((capture) => capture.appName === app.name);
  const runtime = await readWorkspaceRuntimeStatus();
  const contextPackResult = await buildContextPack({
    workspaceId: app.workspaceId,
    appId: app.id,
    runtimeMode: contextPackRuntimeMode(runtime.status),
  });
  const notes = appNotes.filter((note) => APP_NOTE_TITLES.includes(note.title as (typeof APP_NOTE_TITLES)[number]));
  const priorityState = await readCLevelPriorityState(app.id);
  const projectDocStatuses = await Promise.all(projectDocStatusPaths(app).map(fileStatus));
  const plans = await readAppPlans(app.id, date);
  const taskSummary = await readAppTaskSummary(app.id);
  const latestSessions = await readAppChatSessions(50, app.id);
  const sessionSummaries = latestSessions.map(sessionSummary);
  const latestPromotion = await readLatestAppPromotion(app);
  const metricsStatus: AppDashboardSnapshot["metricsStatus"] =
    projectDocStatuses.find((status) => status.path === metricsVaultPath(app))?.contextQuality === "confirmed" ? "provided" : "missing";
  const dashboardSnapshot: AppDashboardSnapshot = {
    appId: app.id,
    currentPriority: priorityState.activePriority,
    currentMission: app.currentMission,
    metricsStatus,
    weekPlanStatus: plans.weekly.exists ? plans.weekly.status : "missing",
    taskTrackerStatus: taskSummary.status,
    latestSession: sessionSummaries[0],
    latestRecap: {
      title: "Latest Daily Note",
      path: dailyPath,
      exists: dailyExists,
    },
    runtimeStatus: runtime.status,
    contextQuality: summarizeContextQuality(notes),
    latestPromotion,
  };

  return {
    app,
    notes,
    contextNotes,
    recentCaptures,
    priorityState,
    projectDocStatuses,
    dashboardSnapshot,
    plans,
    taskSummary,
    latestSessions,
    sessionSummaries,
    dailyNote,
    todayRawPath: rawPath,
    todayDailyPath: dailyPath,
    todayRawExists: Boolean(rawContent),
    todayDailyExists: dailyExists,
    latestPromotion,
    contextPack: contextPackResult.contextPack,
    contextBrief: contextPackResult.contextBrief,
    initialRuntimeStatus: runtime.status,
    initialRuntimeLabel: runtime.label,
    initialRuntimeReason: runtime.reason,
  };
}

export async function readCommandCenterState(dateValue?: string): Promise<CommandCenterState> {
  const dailyState = await readDailyNotesState(dateValue);

  return {
    date: dailyState.date,
    apps: listAppWorkspaces(),
    recentSessions: await readAppChatSessions(5),
    rawPath: dailyState.rawPath,
    dailyPath: dailyState.dailyPath,
    rawExists: dailyState.rawExists,
    dailyExists: dailyState.dailyExists,
    rawCaptureCount: dailyState.captures.length,
  };
}

export async function readVaultVisibilityState(dateValue?: string): Promise<VaultVisibilityState> {
  const dailyState = await readDailyNotesState(dateValue);
  const appNotes = await Promise.all(
    listAppWorkspaces().map(async (app) => ({
      app,
      notes: await Promise.all(buildAppContextNotes(app).map(hydrateNote)),
    })),
  );

  return {
    date: dailyState.date,
    rawPath: dailyState.rawPath,
    dailyPath: dailyState.dailyPath,
    rawExists: dailyState.rawExists,
    dailyExists: dailyState.dailyExists,
    appNotes,
  };
}
