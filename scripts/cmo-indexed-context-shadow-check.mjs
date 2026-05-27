import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APP_CHAT_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "app-chat");
const CMO_ENGINE_VAULT_PATH = process.env.CMO_ENGINE_VAULT_PATH || "/home/ju/.openclaw/workspace/knowledge/cmo-engine-vault";
const APP_CHAT_PREFIX = "data/cmo-dashboard/app-chat/";
const DEFAULT_USER_ID = "00000000-0000-4000-8000-000000000007";
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
const FORBIDDEN_CONTENT_KEYS = new Set(["content", "body", "markdown", "messages", "payload", "contextUsed", "context_used"]);

function parseArgs(argv) {
  const options = {
    appId: "holdstation-mini-app",
    workspaceKey: undefined,
    query: "",
    limit: 5,
    includeSystem: false,
    userId: process.env.CMO_CONTEXT_RESOLVER_USER_ID || undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--app") options.appId = argv[++i];
    else if (arg === "--workspace") options.workspaceKey = argv[++i];
    else if (arg === "--query") options.query = argv[++i] ?? "";
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

function compactText(value, maxChars = 420) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3).trimEnd()}...`;
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

function queryMatches(query, fields) {
  const needle = query?.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => typeof field === "string" && field.toLowerCase().includes(needle));
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

function sourceKey(source) {
  return [source.sourceType, source.path ?? source.id].join(":").toLowerCase();
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

function currentPipelineSnapshot(options) {
  const warnings = [];
  const sources = [
    {
      id: `${options.appId}-current-priority`,
      sourceType: "current_priority",
      title: "Current Priority",
      status: "snapshot",
      whySelected: "Canonical current context pipeline source.",
      origin: "current_pipeline",
    },
    {
      id: `${options.appId}-app-memory`,
      sourceType: "app_memory",
      title: "App Memory",
      status: "snapshot",
      whySelected: "Canonical current context pipeline source.",
      origin: "current_pipeline",
    },
    {
      id: `${options.appId}-business-metrics`,
      sourceType: "business_metrics",
      title: "Business Metrics",
      status: "snapshot",
      whySelected: "Canonical current context pipeline source when metrics JSON exists.",
      origin: "current_pipeline",
    },
    {
      id: `${options.appId}-promotion-candidates`,
      sourceType: "promotion_candidates",
      title: "Memory Candidates",
      status: "snapshot",
      whySelected: "Canonical current context pipeline source.",
      origin: "current_pipeline",
    },
  ];

  if (existsSync(APP_CHAT_DIR)) {
    const sessions = readdirSync(APP_CHAT_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(APP_CHAT_DIR, entry.name))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, options.limit);
    for (const filePath of sessions) {
      try {
        const session = JSON.parse(readFileSync(filePath, "utf8"));
        if (session.appId !== options.appId) continue;
        const excerpt = [
          session.topic ? `Topic: ${session.topic}` : "",
          ...(Array.isArray(session.messages) ? session.messages.slice(-2).map((message) => `${message.role}: ${compactText(message.content, 160)}`) : []),
        ].filter(Boolean).join("\n");
        sources.push({
          id: session.id ?? path.basename(filePath, ".json"),
          sourceType: "latest_sessions",
          title: session.topic ?? "Latest Session",
          path: `data/cmo-dashboard/app-chat/${path.basename(filePath)}`,
          status: session.status ?? null,
          createdAt: session.createdAt ?? null,
          excerpt: compactText(excerpt),
          whySelected: "Current pipeline includes recent app sessions.",
          origin: "current_pipeline",
        });
      } catch (error) {
        warnings.push(`Current session snapshot skipped invalid JSON ${path.basename(filePath)}: ${error instanceof Error ? error.message : "invalid"}`);
      }
    }
  } else {
    warnings.push(`App chat directory missing: ${APP_CHAT_DIR}`);
  }

  return { sources, warnings };
}

function canonicalIndexedSources(currentSources, options) {
  const canonicalTypes = ["current_priority", "app_memory", "business_metrics", "promotion_candidates"];
  const warnings = [];
  const sources = currentSources
    .filter((source) => canonicalTypes.includes(source.sourceType))
    .map((source) => ({
      ...source,
      id: `canonical:${source.id}`,
      status: source.status === "missing" ? "missing" : "included",
      whySelected: `Canonical context adapter: ${source.whySelected}`,
      origin: "canonical_context",
    }));
  const presentTypes = new Set(sources.map((source) => source.sourceType));

  for (const sourceType of canonicalTypes) {
    if (!presentTypes.has(sourceType)) {
      sources.push({
        id: `${options.appId}-canonical-${sourceType}`,
        sourceType,
        title: sourceType.replaceAll("_", " "),
        status: "missing",
        excerpt: "",
        whySelected: "Canonical context adapter expected this source, but it was unavailable in the current context snapshot.",
        warning: `canonical_${sourceType}_missing`,
        origin: "canonical_context",
      });
      warnings.push(`canonical_${sourceType}_missing`);
    }
  }

  return { sources, warnings };
}

async function resolveUserContext(supabase, options) {
  if (!supabase) return { userId: options.userId || DEFAULT_USER_ID, userEmail: null, isOwnerOrAdmin: false, source: "fallback_test_user" };
  if (options.userId) {
    const { data, error } = await supabase.from("workspace_memberships").select("role").eq("user_id", options.userId).eq("status", "active");
    if (error) throw error;
    return { userId: options.userId, userEmail: null, isOwnerOrAdmin: (data ?? []).some((row) => row.role === "owner" || row.role === "admin"), source: "cli_or_env" };
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
  if (!supabase) return { workspaceKey, scope: null, warning: "Supabase admin env missing; indexed DB scope not resolved." };
  const { data, error } = await supabase.from("workspaces").select("id,organization_id,workspace_key").eq("workspace_key", workspaceKey).maybeSingle();
  if (error) throw error;
  if (!data?.id) return { workspaceKey, scope: null, warning: `Workspace not found in Supabase: ${workspaceKey}` };
  return { workspaceKey, scope: { workspaceId: data.id, organizationId: data.organization_id, workspaceKey: data.workspace_key }, warning: null };
}

async function indexedRecords(supabase, options, userContext, scope, queryOverride = options.query) {
  if (!supabase || !scope) return { sessions: [], captures: [], candidates: [] };
  const sessions = await supabase.from("chat_sessions_index").select("id,app_id,source_id,user_id,status,runtime_mode,json_path,created_at,updated_at").eq("workspace_id", scope.workspaceId).order("updated_at", { ascending: false }).limit(options.limit);
  if (sessions.error) throw sessions.error;
  const captures = await supabase.from("vault_captures_index").select("id,app_id,user_id,visibility,vault_path,source_agent,mode,skill,source_class,capture_origin,review_status,gbrain_status,created_at").eq("workspace_id", scope.workspaceId).order("created_at", { ascending: false }).limit(options.limit * 2);
  if (captures.error) throw captures.error;
  const candidates = await supabase.from("gbrain_candidates_index").select("id,capture_id,app_id,user_id,visibility,candidate_type,review_status,source_path,candidate_hash,created_at").eq("workspace_id", scope.workspaceId).order("created_at", { ascending: false }).limit(options.limit * 2);
  if (candidates.error) throw candidates.error;
  return {
    sessions: (sessions.data ?? []).filter((row) => queryMatches(queryOverride, [row.id, row.app_id, row.source_id, row.status, row.runtime_mode, row.json_path])).slice(0, options.limit),
    captures: filterByVisibility(captures.data ?? [], { userId: userContext.userId, isOwnerOrAdmin: userContext.isOwnerOrAdmin, includeSystem: options.includeSystem }).filter((row) => queryMatches(queryOverride, [row.vault_path, row.app_id, row.source_agent, row.mode, row.skill, row.source_class, row.review_status])).slice(0, options.limit),
    candidates: filterByVisibility(candidates.data ?? [], { userId: userContext.userId, isOwnerOrAdmin: userContext.isOwnerOrAdmin, includeSystem: options.includeSystem }).filter((row) => queryMatches(queryOverride, [row.source_path, row.app_id, row.candidate_type, row.review_status, row.candidate_hash])).slice(0, options.limit),
  };
}

function sessionExcerpt(filePath) {
  const session = JSON.parse(readFileSync(filePath, "utf8"));
  return compactText([
    session.topic ? `Topic: ${session.topic}` : "",
    ...(Array.isArray(session.messages) ? session.messages.slice(-4).map((message) => `${message.role}: ${compactText(message.content, 160)}`) : []),
  ].filter(Boolean).join("\n"));
}

function captureExcerpt(filePath) {
  const { frontmatter, body } = parseFrontmatter(readFileSync(filePath, "utf8"));
  return compactText([frontmatter.title, markdownSection(body, "Summary"), markdownSection(body, "Source / Provenance"), markdownSection(body, "Key Findings / Outputs")].filter(Boolean).join("\n"));
}

function indexedPreview(records, warnings) {
  const sources = [];
  for (const record of records.sessions) {
    const safePath = safeResolveSessionJson(APP_CHAT_DIR, record.json_path);
    if (!safePath) {
      warnings.push(`Unsafe or missing indexed session path: ${record.id}`);
      continue;
    }
    try {
      sources.push({
        id: record.id,
        sourceType: "session_json",
        path: record.json_path,
        visibility: record.user_id ? "private_or_user_scoped" : "legacy_or_workspace",
        createdAt: record.created_at ?? null,
        excerpt: sessionExcerpt(safePath),
        whySelected: "Selected by indexed resolver metadata.",
        legacyContext: !record.user_id,
        origin: "indexed_preview",
      });
    } catch (error) {
      warnings.push(`Indexed session preview failed ${record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    }
  }
  for (const record of records.captures) {
    const safePath = safeResolveUnder(CMO_ENGINE_VAULT_PATH, record.vault_path);
    if (!safePath) {
      warnings.push(`Unsafe or missing indexed capture path: ${record.id}`);
      continue;
    }
    try {
      sources.push({
        id: record.id,
        sourceType: "vault_capture",
        path: record.vault_path,
        visibility: normalizeVisibility(record.visibility),
        sourceAgent: record.source_agent ?? null,
        mode: record.mode ?? null,
        sourceClass: record.source_class ?? null,
        createdAt: record.created_at ?? null,
        excerpt: captureExcerpt(safePath),
        whySelected: "Selected by indexed resolver metadata after visibility filtering.",
        legacyContext: !record.user_id,
        origin: "indexed_preview",
      });
    } catch (error) {
      warnings.push(`Indexed capture preview failed ${record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    }
  }
  for (const record of records.candidates) {
    const safePath = safeResolveUnder(CMO_ENGINE_VAULT_PATH, record.source_path);
    if (!safePath) {
      warnings.push(`Unsafe or missing indexed candidate path: ${record.id}`);
      continue;
    }
    try {
      sources.push({
        id: record.id,
        sourceType: "gbrain_candidate",
        path: record.source_path,
        visibility: normalizeVisibility(record.visibility),
        createdAt: record.created_at ?? null,
        excerpt: captureExcerpt(safePath),
        whySelected: "Selected by indexed resolver metadata after visibility filtering.",
        legacyContext: !record.user_id,
        origin: "indexed_preview",
      });
    } catch (error) {
      warnings.push(`Indexed candidate preview failed ${record.id}: ${error instanceof Error ? error.message : "read failed"}`);
    }
  }
  return sources;
}

function summarize(label, sources, warnings) {
  const counts = sources.reduce((acc, source) => {
    acc[source.sourceType] = (acc[source.sourceType] ?? 0) + 1;
    return acc;
  }, {});
  return `${label}: ${sources.length} source(s)${Object.keys(counts).length ? ` (${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ")})` : ""}${warnings.length ? `; ${warnings.length} warning(s)` : ""}.`;
}

function compare(currentSources, indexedSources, userContext, indexedRecords, indexedWarnings) {
  const currentKeys = new Set(currentSources.map(sourceKey));
  const indexedKeys = new Set(indexedSources.map(sourceKey));
  const overlap = [...indexedKeys].filter((key) => currentKeys.has(key));
  const indexedOnly = [...indexedKeys].filter((key) => !currentKeys.has(key));
  const currentOnly = [...currentKeys].filter((key) => !indexedKeys.has(key));
  const missingRisks = [];
  const indexedTypes = new Set(indexedSources.filter((source) => source.status !== "missing").map((source) => source.sourceType));
  const currentTypes = new Set(currentSources.filter((source) => source.status !== "missing").map((source) => source.sourceType));
  for (const required of ["current_priority", "app_memory", "business_metrics"]) {
    if (currentTypes.has(required) && !indexedTypes.has(required)) missingRisks.push(`indexed_missing_${required}`);
  }
  if (!indexedSources.length) missingRisks.push("indexed_selected_no_preview_sources");
  const leakRisks = [];
  const privateForeign = [...indexedRecords.captures, ...indexedRecords.candidates].filter((record) => record.visibility === "private" && record.user_id && record.user_id !== userContext.userId);
  if (privateForeign.length) leakRisks.push(`private_foreign_records:${privateForeign.length}`);
  const systemForMember = [...indexedRecords.captures, ...indexedRecords.candidates].filter((record) => record.visibility === "system" && !userContext.isOwnerOrAdmin);
  if (systemForMember.length) leakRisks.push(`system_records_for_non_admin:${systemForMember.length}`);
  const legacy = indexedSources.filter((source) => source.legacyContext).length;
  if (legacy) leakRisks.push(`legacy_context_null_user:${legacy}`);
  let recommendation = "needs_more_data";
  if (leakRisks.some((risk) => !risk.startsWith("legacy_context_null_user"))) recommendation = "keep_current";
  else if (
    !indexedWarnings.length &&
    !missingRisks.length &&
    indexedSources.length >= 2 &&
    indexedSources.some((source) => ["session_json", "vault_capture", "gbrain_candidate"].includes(source.sourceType))
  ) recommendation = "canary_indexed";
  return { overlap, indexedOnly, currentOnly, missingRisks, leakRisks, recommendation };
}

function runShadowFallbackAssertion() {
  const warnings = [];
  const fallbackSources = [
    {
      id: "session_fixture",
      sourceType: "session_json",
      path: "data/cmo-dashboard/app-chat/session_fixture.json",
      whySelected: "Selected by indexed resolver metadata.",
    },
    {
      id: "capture_fixture",
      sourceType: "vault_capture",
      path: "03 Sessions/Raw/capture_fixture.md",
      visibility: "workspace",
      whySelected: "Selected by indexed resolver metadata after visibility filtering.",
    },
  ];
  const query = "activation strategy";
  const queryFilteredSources = [];
  let selectedSources = queryFilteredSources;
  if (query.trim() && !selectedSources.length && fallbackSources.length) {
    warnings.push(`query_filter_no_matches:${query}; using recent indexed records for shadow comparison`);
    selectedSources = fallbackSources;
  }
  assert.ok(selectedSources.length > 0, "shadow fallback should keep U7B preview sources when query metadata has no matches");
  assert.ok(warnings.some((warning) => warning.startsWith("query_filter_no_matches:")));
}

function runCanonicalShadowAssertion() {
  const currentSources = [
    { id: "priority", sourceType: "current_priority", status: "snapshot", whySelected: "Current priority" },
    { id: "memory", sourceType: "app_memory", status: "snapshot", whySelected: "App memory" },
    { id: "metrics", sourceType: "business_metrics", status: "snapshot", whySelected: "Business metrics" },
  ];
  const canonical = canonicalIndexedSources(currentSources, { appId: "holdstation-mini-app" });
  const sourceTypes = new Set(canonical.sources.map((source) => source.sourceType));
  assert.ok(sourceTypes.has("current_priority"), "canonical adapter should expose current priority");
  assert.ok(sourceTypes.has("app_memory"), "canonical adapter should expose app memory");
  assert.ok(sourceTypes.has("business_metrics"), "canonical adapter should expose business metrics");
  const comparison = compare(currentSources, canonical.sources, { userId: DEFAULT_USER_ID, isOwnerOrAdmin: false }, { captures: [], candidates: [] }, []);
  assert.ok(!comparison.missingRisks.includes("indexed_missing_current_priority"));
  assert.ok(!comparison.missingRisks.includes("indexed_missing_app_memory"));
  assert.ok(!comparison.missingRisks.includes("indexed_missing_business_metrics"));
}

const shadowSource = readFileSync("src/lib/cmo/indexed-context-shadow.ts", "utf8");
assert.match(shadowSource, /buildContextPack/);
assert.match(shadowSource, /resolveIndexedContextDryRun/);
assert.match(shadowSource, /buildIndexedContextPreview/);
assert.match(shadowSource, /resolveCanonicalContextPreview/);
assert.doesNotMatch(shadowSource, /writeFile|insert\(|upsert\(|delete\(/);
runShadowFallbackAssertion();
runCanonicalShadowAssertion();

const options = parseArgs(process.argv.slice(2));
const supabase = adminEnvReady() ? createAdminClient() : null;
const userContext = await resolveUserContext(supabase, options);
const workspace = await resolveWorkspaceScope(supabase, options);
const current = currentPipelineSnapshot(options);
const canonical = canonicalIndexedSources(current.sources, options);
const indexedWarnings = workspace.warning ? [workspace.warning] : [];
let records = await indexedRecords(supabase, options, userContext, workspace.scope);
let indexedSources = indexedPreview(records, indexedWarnings);
if (options.query.trim() && !indexedSources.length && supabase && workspace.scope) {
  const fallbackRecords = await indexedRecords(supabase, options, userContext, workspace.scope, "");
  const fallbackWarnings = [];
  const fallbackSources = indexedPreview(fallbackRecords, fallbackWarnings);
  if (fallbackSources.length) {
    indexedWarnings.push(`query_filter_no_matches:${options.query.trim()}; using recent indexed records for shadow comparison`);
    indexedWarnings.push(...fallbackWarnings);
    records = fallbackRecords;
    indexedSources = fallbackSources.map((source) => ({
      ...source,
      whySelected: `${source.whySelected} Query filter had no metadata matches; included as recent indexed context for shadow comparison.`,
    }));
  }
}
for (const warning of canonical.warnings) {
  if (!indexedWarnings.includes(warning)) indexedWarnings.push(warning);
}
indexedSources = [...canonical.sources, ...indexedSources];
const comparison = compare(current.sources, indexedSources, userContext, records, indexedWarnings);
const output = {
  ok: true,
  dryRun: true,
  env: { supabaseAdminConfigured: Boolean(supabase) },
  input: {
    appId: options.appId,
    workspaceKey: workspace.workspaceKey,
    query: options.query,
    limit: options.limit,
  },
  userContext,
  currentPipeline: {
    sources: current.sources,
    summary: summarize("Current context snapshot", current.sources, current.warnings),
    warnings: current.warnings,
  },
  indexedPipeline: {
    sources: indexedSources,
    summary: summarize("Indexed context preview", indexedSources, indexedWarnings),
    warnings: indexedWarnings,
  },
  comparison,
  safety: {
    noWrites: true,
    noRuntimeInjection: true,
    permissionFiltered: true,
  },
};

assertNoFullContent(output);
console.log(JSON.stringify(output, null, 2));
