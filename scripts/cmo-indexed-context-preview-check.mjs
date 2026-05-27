import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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
const APP_CHAT_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "app-chat");
const APP_CHAT_PREFIX = "data/cmo-dashboard/app-chat/";
const CMO_ENGINE_VAULT_PATH = process.env.CMO_ENGINE_VAULT_PATH || "/home/ju/.openclaw/workspace/knowledge/cmo-engine-vault";
const FORBIDDEN_CONTENT_KEYS = new Set(["content", "body", "markdown", "messages", "payload", "contextUsed", "context_used"]);
const DEFAULT_USER_ID = "00000000-0000-4000-8000-000000000007";

function parseArgs(argv) {
  const options = {
    appId: "holdstation-mini-app",
    workspaceKey: undefined,
    limit: 5,
    includeSystem: false,
    userId: process.env.CMO_CONTEXT_RESOLVER_USER_ID || undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--app") options.appId = argv[++i];
    else if (arg === "--workspace") options.workspaceKey = argv[++i];
    else if (arg === "--limit") {
      const limit = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(limit) || limit < 1) throw new Error("Invalid --limit value");
      options.limit = Math.min(limit, 25);
    } else if (arg === "--include-system") options.includeSystem = true;
    else if (arg === "--user-id") options.userId = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
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
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function workspaceKeyFor(input) {
  if (input.workspaceKey && WORKSPACE_KEY_BY_APP_ID[input.workspaceKey]) return WORKSPACE_KEY_BY_APP_ID[input.workspaceKey];
  if (input.appId && WORKSPACE_KEY_BY_APP_ID[input.appId]) return WORKSPACE_KEY_BY_APP_ID[input.appId];
  return null;
}

function normalizeVisibility(value) {
  return value === "private" || value === "organization" || value === "system" ? value : "workspace";
}

function filterByVisibility(records, input) {
  return records.filter((record) => {
    const visibility = normalizeVisibility(record.visibility);
    if (visibility === "private") return Boolean(record.user_id) && record.user_id === input.userId;
    if (visibility === "system") return Boolean(input.includeSystem) && input.isOwnerOrAdmin;
    return true;
  });
}

function compactText(value, maxChars) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeResolveUnder(root, requestedPath) {
  if (!requestedPath || path.isAbsolute(requestedPath)) return null;
  const resolved = path.resolve(root, requestedPath.replaceAll("\\", "/"));
  return isInside(root, resolved) ? resolved : null;
}

function safeResolveSessionJson(appChatRoot, requestedPath) {
  if (!requestedPath) return null;
  if (path.isAbsolute(requestedPath)) {
    const resolved = path.resolve(requestedPath);
    return isInside(appChatRoot, resolved) ? resolved : null;
  }
  const normalized = requestedPath.replaceAll("\\", "/");
  const repoRelativePath = normalized.startsWith(APP_CHAT_PREFIX) ? normalized : `${APP_CHAT_PREFIX}${normalized}`;
  const resolved = path.resolve(process.cwd(), repoRelativePath);
  return isInside(appChatRoot, resolved) ? resolved : null;
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) return { frontmatter: {}, body: markdown };
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: markdown };
  const frontmatter = {};
  for (const line of markdown.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    frontmatter[match[1]] = value;
  }
  return { frontmatter, body: markdown.slice(end + 5).trim() };
}

function markdownSection(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.match(new RegExp(`^##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?:\\n##\\s+|$)`, "im"))?.[1]?.trim() ?? null;
}

function sessionExcerpt(session) {
  const topic = typeof session.topic === "string" ? session.topic : "";
  const recent = Array.isArray(session.messages) ? session.messages.slice(-4).map((message) => {
    const role = typeof message?.role === "string" ? message.role : "message";
    const content = typeof message?.content === "string" ? message.content : "";
    return content ? `${role}: ${compactText(content, 180)}` : null;
  }).filter(Boolean) : [];
  return compactText([topic ? `Topic: ${topic}` : "", ...recent].filter(Boolean).join("\n"), 560);
}

function captureExcerpt(markdown) {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const excerpt = [markdownSection(body, "Summary"), markdownSection(body, "Source / Provenance"), markdownSection(body, "Key Findings / Outputs")]
    .filter(Boolean)
    .join("\n");
  return compactText([frontmatter.title, excerpt || body].filter(Boolean).join("\n"), 700);
}

function candidateExcerpt(markdown) {
  const { frontmatter, body } = parseFrontmatter(markdown);
  return compactText([frontmatter.title, markdownSection(body, "Proposed Memory") ?? markdownSection(body, "Candidate") ?? body].filter(Boolean).join("\n"), 520);
}

function assertNoFullContent(value, location = "output") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoFullContent(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    assert.ok(!FORBIDDEN_CONTENT_KEYS.has(key), `${location}.${key} contains forbidden full-content field`);
    assertNoFullContent(nested, `${location}.${key}`);
  }
}

function runPathSafetyAssertions() {
  const root = mkdtempSync(path.join(tmpdir(), "cmo-preview-safe-"));
  assert.equal(safeResolveUnder(root, "../outside.md"), null);
  assert.equal(safeResolveUnder(root, "/etc/passwd"), null);
  assert.ok(safeResolveUnder(root, "nested/file.md")?.startsWith(root));
  const appRoot = path.resolve(process.cwd(), "data", "cmo-dashboard", "app-chat");
  assert.equal(
    safeResolveSessionJson(appRoot, "data/cmo-dashboard/app-chat/session_test.json"),
    path.join(appRoot, "session_test.json"),
  );
  assert.equal(safeResolveSessionJson(appRoot, "session_test.json"), path.join(appRoot, "session_test.json"));
  assert.equal(safeResolveSessionJson(appRoot, "../session_test.json"), null);
}

async function resolveUserContext(supabase, options) {
  if (!supabase) return { userId: options.userId || DEFAULT_USER_ID, userEmail: null, isOwnerOrAdmin: false, source: "fallback_test_user" };
  if (options.userId) {
    const { data, error } = await supabase.from("workspace_memberships").select("role").eq("user_id", options.userId).eq("status", "active");
    if (error) throw error;
    return {
      userId: options.userId,
      userEmail: null,
      isOwnerOrAdmin: (data ?? []).some((row) => row.role === "owner" || row.role === "admin"),
      source: "cli_or_env",
    };
  }
  if (process.env.CMO_OWNER_EMAIL) {
    const { data, error } = await supabase.from("profiles").select("id,email").eq("email", process.env.CMO_OWNER_EMAIL).maybeSingle();
    if (error) throw error;
    if (data?.id) return { userId: data.id, userEmail: data.email ?? null, isOwnerOrAdmin: true, source: "CMO_OWNER_EMAIL" };
  }
  return { userId: DEFAULT_USER_ID, userEmail: null, isOwnerOrAdmin: false, source: "fallback_test_user" };
}

async function resolveWorkspaceScope(supabase, options) {
  const workspaceKey = workspaceKeyFor({ appId: options.appId, workspaceKey: options.workspaceKey });
  if (!workspaceKey) return { workspaceKey: null, scope: null, warning: `Unsupported app/workspace: ${options.appId}` };
  if (!supabase) return { workspaceKey, scope: null, warning: "Supabase admin env missing; resolver DB scope not resolved." };
  const { data, error } = await supabase.from("workspaces").select("id,organization_id,workspace_key").eq("workspace_key", workspaceKey).maybeSingle();
  if (error) throw error;
  if (!data?.id) return { workspaceKey, scope: null, warning: `Workspace not found in Supabase: ${workspaceKey}` };
  return { workspaceKey, scope: { workspaceId: data.id, organizationId: data.organization_id, workspaceKey: data.workspace_key }, warning: null };
}

async function resolveIndexedRecords(supabase, options, userContext, scope) {
  if (!supabase || !scope) return { sessions: [], captures: [], candidates: [] };
  const sessionQuery = await supabase
    .from("chat_sessions_index")
    .select("id,app_id,source_id,user_id,status,runtime_mode,json_path,created_at,updated_at")
    .eq("workspace_id", scope.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(options.limit);
  if (sessionQuery.error) throw sessionQuery.error;
  const captureQuery = await supabase
    .from("vault_captures_index")
    .select("id,app_id,user_id,visibility,vault_path,source_agent,mode,skill,source_class,capture_origin,review_status,gbrain_status,created_at")
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false })
    .limit(options.limit * 2);
  if (captureQuery.error) throw captureQuery.error;
  const candidateQuery = await supabase
    .from("gbrain_candidates_index")
    .select("id,capture_id,app_id,user_id,visibility,candidate_type,review_status,source_path,candidate_hash,created_at")
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false })
    .limit(options.limit * 2);
  if (candidateQuery.error) throw candidateQuery.error;

  return {
    sessions: (sessionQuery.data ?? []).slice(0, options.limit).map((row) => ({
      id: row.id,
      appId: row.app_id ?? null,
      sourceId: row.source_id ?? null,
      userId: row.user_id ?? null,
      status: row.status ?? null,
      runtimeMode: row.runtime_mode ?? null,
      jsonPath: row.json_path ?? null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    })),
    captures: filterByVisibility(captureQuery.data ?? [], {
      userId: userContext.userId,
      isOwnerOrAdmin: userContext.isOwnerOrAdmin,
      includeSystem: options.includeSystem,
    }).slice(0, options.limit).map((row) => ({
      id: row.id,
      appId: row.app_id ?? null,
      userId: row.user_id ?? null,
      visibility: normalizeVisibility(row.visibility),
      vaultPath: row.vault_path ?? null,
      sourceAgent: row.source_agent ?? null,
      mode: row.mode ?? null,
      skill: row.skill ?? null,
      sourceClass: row.source_class ?? null,
      captureOrigin: row.capture_origin ?? null,
      reviewStatus: row.review_status ?? null,
      gbrainStatus: row.gbrain_status ?? null,
      createdAt: row.created_at ?? null,
    })),
    candidates: filterByVisibility(candidateQuery.data ?? [], {
      userId: userContext.userId,
      isOwnerOrAdmin: userContext.isOwnerOrAdmin,
      includeSystem: options.includeSystem,
    }).slice(0, options.limit).map((row) => ({
      id: row.id,
      captureId: row.capture_id ?? null,
      appId: row.app_id ?? null,
      userId: row.user_id ?? null,
      visibility: normalizeVisibility(row.visibility),
      candidateType: row.candidate_type ?? null,
      reviewStatus: row.review_status ?? null,
      sourcePath: row.source_path ?? null,
      candidateHash: row.candidate_hash ?? null,
      createdAt: row.created_at ?? null,
    })),
  };
}

async function buildPreview(records, warnings) {
  const sessions = [];
  for (const record of records.sessions) {
    const safePath = safeResolveSessionJson(APP_CHAT_DIR, record.jsonPath);
    if (!safePath) {
      warnings.push(`Unsafe or missing session json_path skipped: ${record.id}`);
      continue;
    }
    try {
      sessions.push({
        sourceType: "session_json",
        id: record.id,
        path: record.jsonPath,
        createdAt: record.createdAt,
        visibility: record.userId ? "private_or_user_scoped" : "legacy_or_workspace",
        excerpt: sessionExcerpt(JSON.parse(readFileSync(safePath, "utf8"))),
        whySelected: "Selected by chat_sessions_index metadata.",
      });
    } catch (error) {
      warnings.push(`Session preview failed for ${record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    }
  }

  const captures = [];
  for (const record of records.captures) {
    const safePath = safeResolveUnder(CMO_ENGINE_VAULT_PATH, record.vaultPath);
    if (!safePath) {
      warnings.push(`Unsafe or missing capture vault_path skipped: ${record.id}`);
      continue;
    }
    try {
      captures.push({
        sourceType: "vault_capture",
        id: record.id,
        path: record.vaultPath,
        sourceAgent: record.sourceAgent,
        mode: record.mode,
        sourceClass: record.sourceClass,
        visibility: record.visibility,
        createdAt: record.createdAt,
        excerpt: captureExcerpt(readFileSync(safePath, "utf8")),
        whySelected: "Selected by vault_captures_index metadata after visibility filtering.",
      });
    } catch (error) {
      warnings.push(`Capture preview failed for ${record.vaultPath ?? record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    }
  }

  const candidates = [];
  for (const record of records.candidates) {
    const safePath = safeResolveUnder(CMO_ENGINE_VAULT_PATH, record.sourcePath);
    if (!safePath) {
      warnings.push(`Unsafe or missing candidate source_path skipped: ${record.id}`);
      continue;
    }
    try {
      candidates.push({
        sourceType: "gbrain_candidate",
        id: record.id,
        path: record.sourcePath,
        visibility: record.visibility,
        createdAt: record.createdAt,
        excerpt: candidateExcerpt(readFileSync(safePath, "utf8")),
        whySelected: "Selected by gbrain_candidates_index metadata after visibility filtering.",
      });
    } catch (error) {
      warnings.push(`Candidate preview failed for ${record.sourcePath ?? record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    }
  }

  return { sessions, captures, candidates };
}

function runOfflinePreviewAssertions() {
  runPathSafetyAssertions();
  const appRoot = mkdtempSync(path.join(tmpdir(), "cmo-preview-chat-"));
  const vaultRoot = mkdtempSync(path.join(tmpdir(), "cmo-preview-vault-"));
  writeFileSync(path.join(appRoot, "session.json"), JSON.stringify({
    topic: "Preview smoke",
    messages: [
      { role: "user", content: "What should we do next?" },
      { role: "assistant", content: "Focus on activation, then save a review-only recap." },
    ],
  }));
  writeFileSync(path.join(vaultRoot, "capture.md"), `---\ntitle: "Preview Capture"\n---\n\n## Summary\nShort capture summary.\n\n## Key Findings / Outputs\n- One useful finding.\n`);
  assert.match(sessionExcerpt(JSON.parse(readFileSync(path.join(appRoot, "session.json"), "utf8"))), /Preview smoke/);
  assert.match(captureExcerpt(readFileSync(path.join(vaultRoot, "capture.md"), "utf8")), /Short capture summary/);
}

runOfflinePreviewAssertions();
const moduleSource = readFileSync("src/lib/cmo/indexed-context-preview.ts", "utf8");
assert.match(moduleSource, /safeResolveUnder/);
assert.match(moduleSource, /readFile/);
assert.doesNotMatch(moduleSource, /writeFile|insert\(|upsert\(|delete\(/);

const options = parseArgs(process.argv.slice(2));
const supabase = adminEnvReady() ? createAdminClient() : null;
const userContext = await resolveUserContext(supabase, options);
const workspaceResolution = await resolveWorkspaceScope(supabase, options);
const resolverWarnings = workspaceResolution.warning ? [workspaceResolution.warning] : [];
const records = await resolveIndexedRecords(supabase, options, userContext, workspaceResolution.scope);
const previewWarnings = [...resolverWarnings];
const contextPreview = await buildPreview(records, previewWarnings);
const output = {
  ok: previewWarnings.length === 0 || !supabase,
  dryRun: true,
  env: {
    supabaseAdminConfigured: Boolean(supabase),
  },
  input: {
    appId: options.appId,
    workspaceKey: workspaceResolution.workspaceKey,
    limit: options.limit,
    includeSystem: options.includeSystem,
  },
  userContext: {
    userId: userContext.userId,
    userEmail: userContext.userEmail,
    isOwnerOrAdmin: userContext.isOwnerOrAdmin,
    source: userContext.source,
  },
  workspaceId: workspaceResolution.scope?.workspaceId,
  organizationId: workspaceResolution.scope?.organizationId,
  selectedRecords: {
    sessions: records.sessions.length,
    captures: records.captures.length,
    candidates: records.candidates.length,
  },
  contextPreview,
  samples: {
    sessions: contextPreview.sessions.slice(0, 2),
    captures: contextPreview.captures.slice(0, 2),
    candidates: contextPreview.candidates.slice(0, 2),
  },
  safety: {
    selectedRecordsOnly: true,
    pathTraversalRejected: true,
    noFullContentReturned: true,
    noWrites: true,
  },
  warnings: previewWarnings,
};

assertNoFullContent(output.contextPreview);
assertNoFullContent(output.samples);

console.log(JSON.stringify(output, null, 2));
