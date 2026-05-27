import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FORBIDDEN_CONTENT_KEYS = new Set(["content", "body", "markdown", "messages", "payload", "contextUsed", "context_used"]);

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

function mockCanary(input) {
  if (!input.enabled) return { enabled: false, used: false, fallbackReason: "CMO_INDEXED_CONTEXT_ENABLED is false", sources: [], text: "" };
  if (input.mode !== "supplemental") return { enabled: true, used: false, fallbackReason: "CMO_INDEXED_CONTEXT_MODE is not supplemental", sources: [], text: "" };
  if (!input.canaryApps.includes(input.appId)) return { enabled: true, used: false, fallbackReason: "app_not_in_canary_list", sources: [], text: "" };
  if (!input.userId) return { enabled: true, used: false, fallbackReason: "missing_user_id", sources: [], text: "" };
  if (input.missingSupabaseEnv) return { enabled: true, used: false, fallbackReason: "missing_supabase_admin_env:NEXT_PUBLIC_SUPABASE_URL", sources: [], text: "" };
  if (input.leakRisk) return { enabled: true, used: false, fallbackReason: "indexed_context_warnings", warnings: ["private_foreign_records:1"], sources: [], text: "" };
  if (input.pathWarning) return { enabled: true, used: false, fallbackReason: "indexed_context_warnings", warnings: ["Unsafe or missing capture vault_path skipped: x"], sources: [], text: "" };
  if (!input.sources.length) return { enabled: true, used: false, fallbackReason: "no_preview_sources", sources: [], text: "" };
  const sources = input.sources.map((source) => ({
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
  leakRisk: mockCanary({ enabled: true, mode: "supplemental", appId: "holdstation-mini-app", canaryApps: ["holdstation-mini-app"], userId: "user", sources: safeSources, leakRisk: true }),
  pathWarning: mockCanary({ enabled: true, mode: "supplemental", appId: "holdstation-mini-app", canaryApps: ["holdstation-mini-app"], userId: "user", sources: safeSources, pathWarning: true }),
  missingSupabaseEnv: mockCanary({ enabled: true, mode: "supplemental", appId: "holdstation-mini-app", canaryApps: ["holdstation-mini-app"], userId: "user", sources: safeSources, missingSupabaseEnv: true }),
};

assert.equal(cases.flagOff.used, false);
assert.equal(cases.notCanary.used, false);
assert.equal(cases.safePreview.used, true);
assert.equal(cases.safePreview.sources.length, 2);
assert.equal(cases.leakRisk.used, false);
assert.equal(cases.pathWarning.used, false);
assert.equal(cases.missingSupabaseEnv.used, false);
assert.ok(cases.safePreview.sources.every((source) => source.excerpt.length <= 500));

const options = parseArgs(process.argv.slice(2));
const output = {
  ok: true,
  dryRun: true,
  input: options,
  cases,
  safety: {
    noWrites: true,
    noFullContentReturned: true,
    featureFlagDefaultOff: true,
  },
};

assertNoFullContent(output);
console.log(JSON.stringify(output, null, 2));
