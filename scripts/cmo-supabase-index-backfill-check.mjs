import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const APP_CHAT_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "app-chat");
const CMO_ENGINE_VAULT_PATH = process.env.CMO_ENGINE_VAULT_PATH || "/home/ju/.openclaw/workspace/knowledge/cmo-engine-vault";
const SUPPORTED_CAPTURE_FOLDERS = [
  "03 Sessions/Raw",
  "04 Research/Surf Packs",
  "05 Social Signals/Surf X",
  "06 Trend Signals/Last30Days",
  "07 Content Outputs/Echo",
  "08 Decisions/Draft Decisions",
];
const WORKSPACE_KEY_BY_APP_ID = {
  "holdstation-wallet": "holdstation-wallet",
  "hold-pay": "hold-pay",
  tickx: "tickx",
  "holdstation-mini-app": "world-app-holdstation-mini-app",
  "world-app-holdstation-mini-app": "world-app-holdstation-mini-app",
  "world-app-aion": "world-app-aion",
  "world-app-winance": "world-app-winance",
  "world-app-feeback": "world-app-feeback",
};
const SOURCE_ID_BY_APP_ID = {
  "holdstation-mini-app": "holdstation__holdstation-mini-app",
  "world-app-holdstation-mini-app": "holdstation__holdstation-mini-app",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const FORBIDDEN_CONTENT_KEYS = new Set([
  "content",
  "body",
  "markdown",
  "summary",
  "answer",
  "question",
  "messages",
  "context_used",
  "payload",
]);

function parseArgs(argv) {
  const options = {
    limit: Number.POSITIVE_INFINITY,
    workspace: undefined,
    source: "all",
    since: undefined,
    write: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") {
      options.write = true;
    } else if (arg === "--limit") {
      const raw = argv[++i];
      const limit = Number.parseInt(raw, 10);
      if (!Number.isFinite(limit) || limit < 1) throw new Error(`Invalid --limit value: ${raw}`);
      options.limit = limit;
    } else if (arg === "--workspace") {
      options.workspace = argv[++i];
      if (!options.workspace) throw new Error("--workspace requires a value");
    } else if (arg === "--source") {
      options.source = argv[++i];
      if (!["sessions", "captures", "all"].includes(options.source)) throw new Error(`Invalid --source value: ${options.source}`);
    } else if (arg === "--since") {
      options.since = argv[++i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.since)) throw new Error(`Invalid --since value: ${options.since}`);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function envPresent(name) {
  return Boolean((process.env[name] ?? "").trim());
}

function adminEnvReady() {
  return envPresent("NEXT_PUBLIC_SUPABASE_URL") &&
    envPresent("NEXT_PUBLIC_SUPABASE_ANON_KEY") &&
    envPresent("SUPABASE_SERVICE_ROLE_KEY");
}

function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function slash(value) {
  return value.replaceAll("\\", "/");
}

function relativeSlash(root, filePath) {
  return slash(path.relative(root, filePath));
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function uuidOrNull(value) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function datePasses(value, since) {
  if (!since) return true;
  if (!value) return true;
  return value.slice(0, 10) >= since;
}

function workspaceKeyFor(input) {
  if (input.workspaceKey && WORKSPACE_KEY_BY_APP_ID[input.workspaceKey]) return WORKSPACE_KEY_BY_APP_ID[input.workspaceKey];
  if (input.appId && WORKSPACE_KEY_BY_APP_ID[input.appId]) return WORKSPACE_KEY_BY_APP_ID[input.appId];
  if (input.workspaceId && WORKSPACE_KEY_BY_APP_ID[input.workspaceId]) return WORKSPACE_KEY_BY_APP_ID[input.workspaceId];
  if (/holdstation mini app/i.test(input.project ?? "")) return "world-app-holdstation-mini-app";
  return null;
}

function inferAppId(input) {
  if (input.appId === "world-app-holdstation-mini-app") return "holdstation-mini-app";
  if (input.appId) return input.appId;
  if (input.workspaceId === "world-app-holdstation-mini-app" || /holdstation mini app/i.test(input.project ?? "")) {
    return "holdstation-mini-app";
  }
  return input.workspaceId && WORKSPACE_KEY_BY_APP_ID[input.workspaceId] ? input.workspaceId : undefined;
}

function sourceIdFor(appId) {
  return SOURCE_ID_BY_APP_ID[appId] ?? (appId ? `cmo-engine__${appId}` : undefined);
}

function normalizeVisibility(value) {
  return ["private", "workspace", "organization", "system"].includes(value) ? value : "workspace";
}

function safeStatus(value, fallback) {
  return stringValue(value) ?? fallback;
}

function parseSimpleFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) return { ok: false, frontmatter: {} };
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return { ok: false, frontmatter: {} };
  const frontmatter = {};
  const raw = markdown.slice(4, end);
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[match[1]] = value;
  }
  return { ok: true, frontmatter };
}

function readJsonSession(filePath) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(filePath, "utf8")) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON" };
  }
}

function walkMarkdown(root) {
  const out = [];
  if (!existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        out.push(fullPath);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function captureFiles(options) {
  if (!existsSync(CMO_ENGINE_VAULT_PATH)) return [];
  const files = [];
  for (const folder of SUPPORTED_CAPTURE_FOLDERS) {
    files.push(...walkMarkdown(path.join(CMO_ENGINE_VAULT_PATH, ...folder.split("/"))));
  }
  return files
    .filter((filePath) => {
      const relativePath = relativeSlash(CMO_ENGINE_VAULT_PATH, filePath);
      return SUPPORTED_CAPTURE_FOLDERS.some((folder) => relativePath === folder || relativePath.startsWith(`${folder}/`));
    })
    .slice(0, Number.isFinite(options.limit) ? options.limit : undefined);
}

function sessionFiles(options) {
  if (!existsSync(APP_CHAT_DIR)) return [];
  return readdirSync(APP_CHAT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(APP_CHAT_DIR, entry.name))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, Number.isFinite(options.limit) ? options.limit : undefined);
}

function assertMetadataOnly(table, payload) {
  for (const key of Object.keys(payload)) {
    assert.ok(!FORBIDDEN_CONTENT_KEYS.has(key), `${table} payload includes forbidden content key: ${key}`);
  }
}

async function loadWorkspaceScopes(supabase) {
  if (!supabase) return new Map();
  const keys = [...new Set(Object.values(WORKSPACE_KEY_BY_APP_ID))];
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, organization_id, workspace_key")
    .in("workspace_key", keys);
  if (error) throw error;
  return new Map((data ?? []).map((workspace) => [workspace.workspace_key, {
    workspaceId: workspace.id,
    organizationId: workspace.organization_id,
    workspaceKey: workspace.workspace_key,
  }]));
}

async function loadIndexedSets(supabase, sessionIds, messageIds, capturePaths) {
  const sets = {
    sessions: new Set(),
    messages: new Set(),
    captures: new Set(),
  };
  if (!supabase) return sets;

  for (const chunk of chunks(sessionIds, 500)) {
    if (!chunk.length) continue;
    const { data, error } = await supabase.from("chat_sessions_index").select("id").in("id", chunk);
    if (error) throw error;
    for (const row of data ?? []) sets.sessions.add(row.id);
  }
  for (const chunk of chunks(messageIds, 500)) {
    if (!chunk.length) continue;
    const { data, error } = await supabase.from("chat_messages_index").select("id").in("id", chunk);
    if (error) throw error;
    for (const row of data ?? []) sets.messages.add(row.id);
  }
  for (const chunk of chunks(capturePaths, 500)) {
    if (!chunk.length) continue;
    const { data, error } = await supabase.from("vault_captures_index").select("vault_path").in("vault_path", chunk);
    if (error) throw error;
    for (const row of data ?? []) sets.captures.add(row.vault_path);
  }
  return sets;
}

function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function classifySessionFile(filePath, options, scopeByKey) {
  const parsed = readJsonSession(filePath);
  if (!parsed.ok) {
    return {
      kind: "session",
      id: path.basename(filePath, ".json"),
      jsonPath: slash(path.relative(process.cwd(), filePath)),
      invalidJson: true,
      reason: parsed.error,
      messages: [],
    };
  }

  const session = parsed.value && typeof parsed.value === "object" ? parsed.value : {};
  const id = stringValue(session.id) ?? path.basename(filePath, ".json");
  const appId = stringValue(session.appId);
  const workspaceKey = workspaceKeyFor({
    appId,
    workspaceId: stringValue(session.workspaceId),
    project: stringValue(session.appName),
  });
  const scope = workspaceKey ? scopeByKey.get(workspaceKey) : null;
  const userId = stringValue(session.userId) ?? stringValue(session.createdByUserId);
  const createdAt = stringValue(session.createdAt) ?? statSync(filePath).mtime.toISOString();
  const updatedAt = stringValue(session.updatedAt) ?? createdAt;
  const messages = Array.isArray(session.messages) ? session.messages : [];

  if (!datePasses(createdAt, options.since)) return null;
  if (options.workspace && workspaceKey !== workspaceKeyFor({ workspaceKey: options.workspace })) return null;

  return {
    kind: "session",
    id,
    appId,
    sourceId: sourceIdFor(appId),
    workspaceKey,
    scope,
    userId,
    status: stringValue(session.status) ?? "completed",
    runtimeMode: stringValue(session.runtimeMode),
    jsonPath: slash(path.relative(process.cwd(), filePath)),
    createdAt,
    updatedAt,
    invalidJson: false,
    missingUserId: !userId,
    unresolvedWorkspace: !scope,
    messageCount: messages.length,
    messages: messages.map((message, index) => ({
      id: stringValue(message?.id) ?? `${id}__message_${index + 1}`,
      sessionId: id,
      role: stringValue(message?.role) ?? "assistant",
      userId: stringValue(message?.userId) ?? stringValue(message?.sourceUserId) ?? userId,
      createdAt: stringValue(message?.createdAt) ?? createdAt,
      missingUserId: !(stringValue(message?.userId) ?? stringValue(message?.sourceUserId) ?? userId),
    })),
  };
}

function classifyCaptureFile(filePath, options, scopeByKey) {
  const relativePath = relativeSlash(CMO_ENGINE_VAULT_PATH, filePath);
  const markdown = readFileSync(filePath, "utf8");
  const parsed = parseSimpleFrontmatter(markdown);
  if (!parsed.ok) {
    return {
      kind: "capture",
      vaultPath: relativePath,
      invalidFrontmatter: true,
      unresolvedWorkspace: true,
      missingUserId: true,
    };
  }

  const fm = parsed.frontmatter;
  const createdAt = stringValue(fm.created_at) ?? statSync(filePath).mtime.toISOString();
  const appId = inferAppId({
    appId: stringValue(fm.app_id),
    workspaceId: stringValue(fm.workspace_id),
    project: stringValue(fm.project),
  });
  const workspaceKey = workspaceKeyFor({
    appId,
    workspaceId: stringValue(fm.workspace_id),
    project: stringValue(fm.project),
  });
  const scope = workspaceKey ? scopeByKey.get(workspaceKey) : null;
  const userId = stringValue(fm.user_id);

  if (!datePasses(createdAt, options.since)) return null;
  if (options.workspace && workspaceKey !== workspaceKeyFor({ workspaceKey: options.workspace })) return null;

  return {
    kind: "capture",
    vaultPath: relativePath,
    appId,
    workspaceKey,
    scope,
    userId,
    visibility: normalizeVisibility(stringValue(fm.visibility)),
    sourceAgent: stringValue(fm.source_agent),
    mode: stringValue(fm.mode),
    skill: stringValue(fm.skill),
    sourceClass: stringValue(fm.source_class),
    captureOrigin: stringValue(fm.capture_origin),
    reviewStatus: stringValue(fm.review_status),
    gbrainStatus: stringValue(fm.gbrain_status),
    createdAt,
    invalidFrontmatter: false,
    missingUserId: !userId,
    unresolvedWorkspace: !scope,
  };
}

function sessionPayload(item) {
  const payload = {
    id: item.id,
    organization_id: item.scope.organizationId,
    workspace_id: item.scope.workspaceId,
    app_id: item.appId,
    source_id: item.sourceId,
    user_id: uuidOrNull(item.userId),
    status: item.status,
    runtime_mode: item.runtimeMode,
    json_path: item.jsonPath,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
  assertMetadataOnly("chat_sessions_index", payload);
  return payload;
}

function messagePayload(message) {
  const payload = {
    id: message.id,
    session_id: message.sessionId,
    user_id: uuidOrNull(message.userId),
    role: message.role,
    created_at: message.createdAt,
  };
  assertMetadataOnly("chat_messages_index", payload);
  return payload;
}

function capturePayload(item) {
  const payload = {
    organization_id: item.scope.organizationId,
    workspace_id: item.scope.workspaceId,
    app_id: item.appId,
    user_id: uuidOrNull(item.userId),
    visibility: item.visibility,
    vault_path: item.vaultPath,
    source_agent: item.sourceAgent,
    mode: item.mode,
    skill: item.skill,
    source_class: item.sourceClass,
    capture_origin: safeStatus(item.captureOrigin, "auto"),
    review_status: safeStatus(item.reviewStatus, "raw"),
    gbrain_status: safeStatus(item.gbrainStatus, "pending"),
    created_at: item.createdAt,
  };
  assertMetadataOnly("vault_captures_index", payload);
  return payload;
}

async function writeRows(supabase, plan) {
  const results = {
    sessionsWritten: 0,
    messagesWritten: 0,
    capturesWritten: 0,
    skipped: 0,
    errors: [],
  };

  for (const item of plan.sessionsToWrite) {
    if (!item.scope) {
      results.skipped += 1;
      continue;
    }
    const { error } = await supabase.from("chat_sessions_index").upsert(sessionPayload(item), { onConflict: "id" });
    if (error) results.errors.push({ table: "chat_sessions_index", id: item.id, message: error.message });
    else results.sessionsWritten += 1;
  }

  for (const item of plan.messagesToWrite) {
    const { error } = await supabase.from("chat_messages_index").upsert(messagePayload(item), { onConflict: "id" });
    if (error) results.errors.push({ table: "chat_messages_index", id: item.id, message: error.message });
    else results.messagesWritten += 1;
  }

  for (const item of plan.capturesToWrite) {
    if (!item.scope) {
      results.skipped += 1;
      continue;
    }
    const { error } = await supabase.from("vault_captures_index").insert(capturePayload(item));
    if (error) results.errors.push({ table: "vault_captures_index", id: item.vaultPath, message: error.message });
    else results.capturesWritten += 1;
  }

  return results;
}

const options = parseArgs(process.argv.slice(2));
const supabase = adminEnvReady() ? createAdminClient() : null;
if (options.write && !supabase) {
  throw new Error("Supabase admin env is required for --write backfill mode.");
}

const scopeByKey = await loadWorkspaceScopes(supabase);
const localSessions = options.source === "captures"
  ? []
  : sessionFiles(options).map((filePath) => classifySessionFile(filePath, options, scopeByKey)).filter(Boolean);
const localCaptures = options.source === "sessions"
  ? []
  : captureFiles(options).map((filePath) => classifyCaptureFile(filePath, options, scopeByKey)).filter(Boolean);

const allMessageItems = localSessions.flatMap((session) => session.messages ?? []);
const indexedSets = await loadIndexedSets(
  supabase,
  localSessions.filter((item) => !item.invalidJson).map((item) => item.id),
  allMessageItems.map((message) => message.id),
  localCaptures.filter((item) => !item.invalidFrontmatter).map((item) => item.vaultPath),
);

for (const item of localSessions) {
  item.indexStatus = item.invalidJson ? "invalid_json" : indexedSets.sessions.has(item.id) ? "already_indexed" : "missing_from_index";
  for (const message of item.messages ?? []) {
    message.indexStatus = indexedSets.messages.has(message.id) ? "already_indexed" : "missing_from_index";
  }
}
for (const item of localCaptures) {
  item.indexStatus = item.invalidFrontmatter ? "invalid_frontmatter" : indexedSets.captures.has(item.vaultPath) ? "already_indexed" : "missing_from_index";
}

const sessionsToWrite = localSessions.filter((item) => !item.invalidJson && !item.unresolvedWorkspace && item.indexStatus === "missing_from_index");
const messagesToWrite = localSessions
  .filter((item) => !item.invalidJson && !item.unresolvedWorkspace)
  .flatMap((item) => (item.messages ?? []).filter((message) => message.indexStatus === "missing_from_index"));
const capturesToWrite = localCaptures.filter((item) => !item.invalidFrontmatter && !item.unresolvedWorkspace && item.indexStatus === "missing_from_index");

const summary = {
  ok: true,
  mode: options.write ? "write" : "dry_run",
  filters: {
    limit: Number.isFinite(options.limit) ? options.limit : "all",
    workspace: options.workspace ?? "all",
    source: options.source,
    since: options.since ?? null,
  },
  env: {
    supabaseAdminConfigured: Boolean(supabase),
    indexComparison: supabase ? "completed" : "skipped_missing_admin_env",
  },
  safety: {
    dryRunDoesNotWrite: !options.write,
    writeRequiresExplicitFlag: true,
    fullContentStoredInSupabase: false,
    jsonMutation: false,
    vaultMutation: false,
  },
  sessions: {
    scanned: localSessions.length,
    alreadyIndexed: localSessions.filter((item) => item.indexStatus === "already_indexed").length,
    missingFromIndex: localSessions.filter((item) => item.indexStatus === "missing_from_index").length,
    missingUserId: localSessions.filter((item) => item.missingUserId).length,
    unresolvedWorkspace: localSessions.filter((item) => item.unresolvedWorkspace).length,
    invalidJson: localSessions.filter((item) => item.invalidJson).length,
  },
  messages: {
    scanned: allMessageItems.length,
    alreadyIndexed: allMessageItems.filter((item) => item.indexStatus === "already_indexed").length,
    missingFromIndex: allMessageItems.filter((item) => item.indexStatus === "missing_from_index").length,
    missingUserId: allMessageItems.filter((item) => item.missingUserId).length,
  },
  captures: {
    scanned: localCaptures.length,
    alreadyIndexed: localCaptures.filter((item) => item.indexStatus === "already_indexed").length,
    missingFromIndex: localCaptures.filter((item) => item.indexStatus === "missing_from_index").length,
    missingUserId: localCaptures.filter((item) => item.missingUserId).length,
    unresolvedWorkspace: localCaptures.filter((item) => item.unresolvedWorkspace).length,
    invalidFrontmatter: localCaptures.filter((item) => item.invalidFrontmatter).length,
  },
  rowsThatWouldBeWritten: {
    chatSessions: sessionsToWrite.length,
    chatMessages: messagesToWrite.length,
    vaultCaptures: capturesToWrite.length,
    total: sessionsToWrite.length + messagesToWrite.length + capturesToWrite.length,
  },
  examples: {
    missingSessions: sessionsToWrite.slice(0, 5).map((item) => ({ id: item.id, appId: item.appId, jsonPath: item.jsonPath })),
    missingCaptures: capturesToWrite.slice(0, 5).map((item) => ({ path: item.vaultPath, appId: item.appId, sourceClass: item.sourceClass })),
    unresolvedSessions: localSessions.filter((item) => item.unresolvedWorkspace).slice(0, 5).map((item) => ({ id: item.id, appId: item.appId, workspaceKey: item.workspaceKey ?? null })),
    unresolvedCaptures: localCaptures.filter((item) => item.unresolvedWorkspace).slice(0, 5).map((item) => ({ path: item.vaultPath, workspaceKey: item.workspaceKey ?? null })),
  },
  notes: [],
};

if (!existsSync(APP_CHAT_DIR) && options.source !== "captures") {
  summary.notes.push(`App chat directory missing: ${APP_CHAT_DIR}`);
}
if (!existsSync(CMO_ENGINE_VAULT_PATH) && options.source !== "sessions") {
  summary.notes.push(`CMO Engine Vault path missing: ${CMO_ENGINE_VAULT_PATH}`);
}
if (!options.write) {
  summary.notes.push("Dry-run only. Re-run with --write to upsert metadata-only index rows.");
}

if (options.write) {
  const writeResult = await writeRows(supabase, { sessionsToWrite, messagesToWrite, capturesToWrite });
  summary.writeResult = writeResult;
  summary.ok = writeResult.errors.length === 0;
}

console.log(JSON.stringify(summary, null, 2));
