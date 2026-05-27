import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const FORBIDDEN_CONTENT_KEYS = new Set(["content", "body", "markdown", "messages", "payload", "contextUsed", "context_used"]);
const APP_CHAT_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "app-chat");
const APP_CHAT_PREFIX = "data/cmo-dashboard/app-chat/";
const CMO_ENGINE_VAULT_PATH = process.env.CMO_ENGINE_VAULT_PATH || "/home/ju/.openclaw/workspace/knowledge/cmo-engine-vault";
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
const DEFAULT_USER_ID = "00000000-0000-4000-8000-000000000007";

function parseArgs(argv) {
  const options = {
    appId: "holdstation-mini-app",
    query: "",
    limit: 5,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--app") options.appId = argv[++index];
    else if (arg === "--query") options.query = argv[++index] ?? "";
    else if (arg === "--limit") {
      const limit = Number.parseInt(argv[++index], 10);
      if (!Number.isFinite(limit) || limit < 1) throw new Error("Invalid --limit value");
      options.limit = Math.min(limit, 25);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
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

function compactText(value, maxChars = 500) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function workspaceKeyFor(input) {
  if (input.workspaceKey && WORKSPACE_KEY_BY_APP_ID[input.workspaceKey]) return WORKSPACE_KEY_BY_APP_ID[input.workspaceKey];
  if (input.appId && WORKSPACE_KEY_BY_APP_ID[input.appId]) return WORKSPACE_KEY_BY_APP_ID[input.appId];
  return null;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeResolveSessionJson(requestedPath) {
  if (!requestedPath) return null;
  if (path.isAbsolute(requestedPath)) {
    const resolved = path.resolve(requestedPath);
    return isInside(APP_CHAT_DIR, resolved) ? resolved : null;
  }
  const normalized = requestedPath.replaceAll("\\", "/");
  const repoRelativePath = normalized.startsWith(APP_CHAT_PREFIX) ? normalized : `${APP_CHAT_PREFIX}${normalized}`;
  const resolved = path.resolve(process.cwd(), repoRelativePath);
  return isInside(APP_CHAT_DIR, resolved) ? resolved : null;
}

function safeResolveVaultPath(requestedPath) {
  if (!requestedPath || path.isAbsolute(requestedPath)) return null;
  const resolved = path.resolve(CMO_ENGINE_VAULT_PATH, requestedPath.replaceAll("\\", "/"));
  return isInside(CMO_ENGINE_VAULT_PATH, resolved) ? resolved : null;
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) return { frontmatter: {}, body: markdown };
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: markdown };
  const frontmatter = {};
  for (const line of markdown.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) frontmatter[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return { frontmatter, body: markdown.slice(end + 5).trim() };
}

function markdownSection(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.match(new RegExp(`^##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?:\\n##\\s+|$)`, "im"))?.[1]?.trim() ?? null;
}

function sessionExcerpt(filePath) {
  const session = JSON.parse(readFileSync(filePath, "utf8"));
  const topic = typeof session.topic === "string" ? session.topic : "";
  const recent = Array.isArray(session.messages)
    ? session.messages.slice(-3).map((message) => `${message.role ?? "message"}: ${compactText(message.content, 180)}`)
    : [];
  return compactText([topic ? `Topic: ${topic}` : "", ...recent].filter(Boolean).join("\n"));
}

function captureExcerpt(filePath) {
  const { frontmatter, body } = parseFrontmatter(readFileSync(filePath, "utf8"));
  return compactText([
    frontmatter.title,
    markdownSection(body, "Summary"),
    markdownSection(body, "Source / Provenance"),
    markdownSection(body, "Key Findings / Outputs"),
    markdownSection(body, "Proposed Memory"),
    markdownSection(body, "Candidate"),
  ].filter(Boolean).join("\n") || body);
}

function queryMatches(query, fields) {
  const needle = query?.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => typeof field === "string" && field.toLowerCase().includes(needle));
}

function normalizeVisibility(value) {
  return value === "private" || value === "organization" || value === "system" ? value : "workspace";
}

function filterByVisibility(records, userContext) {
  return records.filter((record) => {
    const visibility = normalizeVisibility(record.visibility);
    if (visibility === "private") return Boolean(record.user_id) && record.user_id === userContext.userId;
    if (visibility === "system") return false;
    return true;
  });
}

async function resolveUserContext(supabase) {
  if (!supabase) return { userId: DEFAULT_USER_ID, isOwnerOrAdmin: false, source: "fallback_test_user" };
  if (process.env.CMO_OWNER_EMAIL) {
    const { data, error } = await supabase.from("profiles").select("id,email").eq("email", process.env.CMO_OWNER_EMAIL).maybeSingle();
    if (error) throw error;
    if (data?.id) return { userId: data.id, userEmail: data.email ?? null, isOwnerOrAdmin: true, source: "CMO_OWNER_EMAIL" };
  }
  return { userId: DEFAULT_USER_ID, isOwnerOrAdmin: false, source: "fallback_test_user" };
}

async function resolveWorkspaceScope(supabase, options) {
  const workspaceKey = workspaceKeyFor(options);
  if (!workspaceKey) return { workspaceKey: null, scope: null, warning: `Unsupported app/workspace: ${options.appId}` };
  if (!supabase) return { workspaceKey, scope: null, warning: "Supabase admin env missing; canary DB scope not resolved." };
  const { data, error } = await supabase.from("workspaces").select("id,organization_id,workspace_key").eq("workspace_key", workspaceKey).maybeSingle();
  if (error) throw error;
  if (!data?.id) return { workspaceKey, scope: null, warning: `Workspace not found in Supabase: ${workspaceKey}` };
  return { workspaceKey, scope: { workspaceId: data.id, organizationId: data.organization_id, workspaceKey: data.workspace_key }, warning: null };
}

async function indexedRecords(supabase, options, userContext, scope, queryOverride = options.query) {
  if (!supabase || !scope) return { sessions: [], captures: [], candidates: [] };
  const limit = Math.min(options.limit, 6);
  const sessions = await supabase.from("chat_sessions_index").select("id,app_id,source_id,user_id,status,runtime_mode,json_path,created_at,updated_at").eq("workspace_id", scope.workspaceId).order("updated_at", { ascending: false }).limit(limit);
  if (sessions.error) throw sessions.error;
  const captures = await supabase.from("vault_captures_index").select("id,app_id,user_id,visibility,vault_path,source_agent,mode,skill,source_class,capture_origin,review_status,gbrain_status,created_at").eq("workspace_id", scope.workspaceId).order("created_at", { ascending: false }).limit(limit * 2);
  if (captures.error) throw captures.error;
  const candidates = await supabase.from("gbrain_candidates_index").select("id,capture_id,app_id,user_id,visibility,candidate_type,review_status,source_path,candidate_hash,created_at").eq("workspace_id", scope.workspaceId).order("created_at", { ascending: false }).limit(limit * 2);
  if (candidates.error) throw candidates.error;
  return {
    sessions: (sessions.data ?? []).filter((row) => queryMatches(queryOverride, [row.id, row.app_id, row.source_id, row.status, row.runtime_mode, row.json_path])).slice(0, 3),
    captures: filterByVisibility(captures.data ?? [], userContext).filter((row) => queryMatches(queryOverride, [row.vault_path, row.app_id, row.source_agent, row.mode, row.skill, row.source_class, row.review_status])).slice(0, 3),
    candidates: filterByVisibility(candidates.data ?? [], userContext).filter((row) => queryMatches(queryOverride, [row.source_path, row.app_id, row.candidate_type, row.review_status, row.candidate_hash])).slice(0, 3),
  };
}

function previewRecords(records, warnings) {
  const sources = [];
  for (const record of records.sessions) {
    const safePath = safeResolveSessionJson(record.json_path);
    if (!safePath) {
      warnings.push(`Unsafe or missing session json_path skipped: ${record.id}`);
      continue;
    }
    try {
      sources.push({ id: record.id, sourceType: "session_json", path: record.json_path, excerpt: sessionExcerpt(safePath), whySelected: "Selected by Supabase chat_sessions_index metadata." });
    } catch (error) {
      warnings.push(`Session preview failed for ${record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    }
  }
  for (const record of records.captures) {
    const safePath = safeResolveVaultPath(record.vault_path);
    if (!safePath) {
      warnings.push(`Unsafe or missing capture vault_path skipped: ${record.id}`);
      continue;
    }
    try {
      sources.push({ id: record.id, sourceType: "vault_capture", path: record.vault_path, excerpt: captureExcerpt(safePath), whySelected: "Selected by Supabase vault_captures_index metadata." });
    } catch (error) {
      warnings.push(`Capture preview failed for ${record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    }
  }
  for (const record of records.candidates) {
    const safePath = safeResolveVaultPath(record.source_path);
    if (!safePath) {
      warnings.push(`Unsafe or missing candidate source_path skipped: ${record.id}`);
      continue;
    }
    try {
      sources.push({ id: record.id, sourceType: "gbrain_candidate", path: record.source_path, excerpt: captureExcerpt(safePath), whySelected: "Selected by Supabase gbrain_candidates_index metadata." });
    } catch (error) {
      warnings.push(`Candidate preview failed for ${record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    }
  }
  return sources;
}

async function realCanaryCheck(options) {
  const supabase = adminEnvReady() ? createAdminClient() : null;
  if (!supabase) return { enabled: true, used: false, fallbackReason: "missing_supabase_admin_env", sources: [], warnings: [] };
  const userContext = await resolveUserContext(supabase);
  const workspace = await resolveWorkspaceScope(supabase, options);
  if (!workspace.scope) return { enabled: true, used: false, fallbackReason: workspace.warning ?? "workspace_unresolved", sources: [], warnings: workspace.warning ? [workspace.warning] : [] };
  let records = await indexedRecords(supabase, options, userContext, workspace.scope);
  let warnings = [];
  let sources = previewRecords(records, warnings);
  let queryFallbackNotice;
  if (options.query.trim() && !sources.length && !warnings.length) {
    const fallbackRecords = await indexedRecords(supabase, options, userContext, workspace.scope, "");
    const fallbackWarnings = [];
    const fallbackSources = previewRecords(fallbackRecords, fallbackWarnings);
    if (fallbackSources.length && !fallbackWarnings.length) {
      queryFallbackNotice = `query_filter_no_matches:${options.query.trim()}; using recent indexed records for canary supplement`;
      records = fallbackRecords;
      sources = fallbackSources.map((source) => ({
        ...source,
        whySelected: `${source.whySelected} Query filter had no metadata matches; included as recent indexed context for canary supplement.`,
      }));
      warnings = [queryFallbackNotice];
    } else {
      warnings = fallbackWarnings;
    }
  }
  if (warnings.some((warning) => !warning.startsWith("query_filter_no_matches:"))) return { enabled: true, used: false, fallbackReason: "indexed_context_warnings", sources: [], warnings };
  if (!sources.length) return { enabled: true, used: false, fallbackReason: options.query.trim() ? "no_preview_sources_after_query_fallback" : "no_preview_sources", sources: [], warnings };
  return {
    enabled: true,
    used: true,
    fallbackReason: undefined,
    sources,
    warnings,
    selectedRecords: {
      sessions: records.sessions.length,
      captures: records.captures.length,
      candidates: records.candidates.length,
    },
  };
}

function mockCanary(input) {
  if (!input.enabled) return { enabled: false, used: false, fallbackReason: "CMO_INDEXED_CONTEXT_ENABLED is false", sources: [], text: "" };
  if (input.mode !== "supplemental") return { enabled: true, used: false, fallbackReason: "CMO_INDEXED_CONTEXT_MODE is not supplemental", sources: [], text: "" };
  if (!input.canaryApps.includes(input.appId)) return { enabled: true, used: false, fallbackReason: "app_not_in_canary_list", sources: [], text: "" };
  if (!input.userId) return { enabled: true, used: false, fallbackReason: "missing_user_id", sources: [], text: "" };
  if (input.missingSupabaseEnv) return { enabled: true, used: false, fallbackReason: "missing_supabase_admin_env:NEXT_PUBLIC_SUPABASE_URL", sources: [], text: "" };
  if (input.leakRisk) return { enabled: true, used: false, fallbackReason: "indexed_context_warnings", warnings: ["private_foreign_records:1"], sources: [], text: "" };
  if (input.pathWarning) return { enabled: true, used: false, fallbackReason: "indexed_context_warnings", warnings: ["Unsafe or missing capture vault_path skipped: x"], sources: [], text: "" };
  let sourceInput = input.sources;
  const warnings = [];
  if (!sourceInput.length && input.query && input.recentSources?.length) {
    sourceInput = input.recentSources;
    warnings.push(`query_filter_no_matches:${input.query}; using recent indexed records for canary supplement`);
  }
  if (!sourceInput.length) return { enabled: true, used: false, fallbackReason: input.query ? "no_preview_sources_after_query_fallback" : "no_preview_sources", sources: [], text: "" };
  const sources = sourceInput.map((source) => ({
    id: source.id,
    sourceType: source.sourceType,
    path: source.path,
    excerpt: source.excerpt.slice(0, 500),
    whySelected: source.whySelected,
  }));
  return {
    enabled: true,
    used: true,
    fallbackReason: undefined,
    warnings,
    sources,
    text: [
      "## Indexed Context Supplement",
      "Use these snippets as supporting context only.",
      ...sources.map((source) => `${source.sourceType}: ${source.excerpt}`),
    ].join("\n"),
  };
}

const canarySource = readFileSync("src/lib/cmo/indexed-context-canary.ts", "utf8");
const appChatSource = readFileSync("src/lib/cmo/app-chat-store.ts", "utf8");
const envExample = readFileSync(".env.example", "utf8");

assert.match(canarySource, /CMO_INDEXED_CONTEXT_ENABLED|isCmoIndexedContextEnabled/);
assert.match(canarySource, /resolveIndexedContextDryRun/);
assert.match(canarySource, /previewIndexedRecordsForCanary/);
assert.match(canarySource, /query_filter_no_matches/);
assert.match(canarySource, /applyIndexedContextSupplement/);
assert.doesNotMatch(canarySource, /writeFile|insert\(|upsert\(|delete\(/);
assert.match(appChatSource, /buildIndexedContextSupplement/);
assert.match(appChatSource, /applyIndexedContextSupplement/);
assert.match(appChatSource, /indexedContextStatus/);
assert.match(envExample, /CMO_INDEXED_CONTEXT_ENABLED=false/);
assert.match(envExample, /CMO_INDEXED_CONTEXT_CANARY_APPS=holdstation-mini-app/);
assert.match(envExample, /CMO_INDEXED_CONTEXT_MODE=supplemental/);

const safeSources = [
  {
    id: "session_1",
    sourceType: "session_json",
    path: "data/cmo-dashboard/app-chat/session_1.json",
    excerpt: "Recent activation discussion with no full transcript.",
    whySelected: "Selected by Supabase chat_sessions_index metadata.",
  },
  {
    id: "capture_1",
    sourceType: "vault_capture",
    path: "03 Sessions/Raw/capture.md",
    excerpt: "Short capture summary.",
    whySelected: "Selected by Supabase vault_captures_index metadata.",
  },
];

const cases = {
  flagOff: mockCanary({ enabled: false, mode: "supplemental", appId: "holdstation-mini-app", canaryApps: ["holdstation-mini-app"], userId: "user", sources: safeSources }),
  notCanary: mockCanary({ enabled: true, mode: "supplemental", appId: "other-app", canaryApps: ["holdstation-mini-app"], userId: "user", sources: safeSources }),
  safePreview: mockCanary({ enabled: true, mode: "supplemental", appId: "holdstation-mini-app", canaryApps: ["holdstation-mini-app"], userId: "user", sources: safeSources }),
  queryNoMatchRecent: mockCanary({ enabled: true, mode: "supplemental", appId: "holdstation-mini-app", canaryApps: ["holdstation-mini-app"], userId: "user", query: "activation strategy", sources: [], recentSources: safeSources }),
  queryNoMatchEmpty: mockCanary({ enabled: true, mode: "supplemental", appId: "holdstation-mini-app", canaryApps: ["holdstation-mini-app"], userId: "user", query: "activation strategy", sources: [], recentSources: [] }),
  leakRisk: mockCanary({ enabled: true, mode: "supplemental", appId: "holdstation-mini-app", canaryApps: ["holdstation-mini-app"], userId: "user", sources: safeSources, leakRisk: true }),
  pathWarning: mockCanary({ enabled: true, mode: "supplemental", appId: "holdstation-mini-app", canaryApps: ["holdstation-mini-app"], userId: "user", sources: safeSources, pathWarning: true }),
  missingSupabaseEnv: mockCanary({ enabled: true, mode: "supplemental", appId: "holdstation-mini-app", canaryApps: ["holdstation-mini-app"], userId: "user", sources: safeSources, missingSupabaseEnv: true }),
};

assert.equal(cases.flagOff.used, false);
assert.equal(cases.notCanary.used, false);
assert.equal(cases.safePreview.used, true);
assert.equal(cases.safePreview.sources.length, 2);
assert.equal(cases.queryNoMatchRecent.used, true);
assert.ok(cases.queryNoMatchRecent.warnings.some((warning) => warning.startsWith("query_filter_no_matches:")));
assert.equal(cases.queryNoMatchEmpty.used, false);
assert.equal(cases.queryNoMatchEmpty.fallbackReason, "no_preview_sources_after_query_fallback");
assert.equal(cases.leakRisk.used, false);
assert.equal(cases.pathWarning.used, false);
assert.equal(cases.missingSupabaseEnv.used, false);
assert.ok(cases.safePreview.sources.every((source) => source.excerpt.length <= 500));

const options = parseArgs(process.argv.slice(2));
const realCanary = await realCanaryCheck(options);
const output = {
  ok: true,
  dryRun: true,
  input: options,
  cases,
  realCanary,
  safety: {
    noWrites: true,
    noFullContentReturned: true,
    featureFlagDefaultOff: true,
  },
};

assertNoFullContent(output);
console.log(JSON.stringify(output, null, 2));
