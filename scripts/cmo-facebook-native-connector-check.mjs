import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function assertIncludes(text, needle, message) {
  assert.ok(text.includes(needle), message);
}

function assertMatch(text, pattern, message) {
  assert.match(text, pattern, message);
}

function assertNoMatch(text, pattern, message) {
  assert.doesNotMatch(text, pattern, message);
}

function tableBlock(sql, tableName) {
  const pattern = new RegExp(`create table if not exists public\\.${tableName}[\\s\\S]*?;`, "i");
  const match = sql.match(pattern);
  assert.ok(match, `${tableName} migration block must exist`);
  return match[0];
}

function packBlock(sourceText, packKey) {
  const pattern = new RegExp(`pack_key:\\s*"${packKey}"[\\s\\S]*?(?=\\n\\s*},\\n\\s*\\{|\\n\\s*},\\n\\s*\\],)`);
  const match = sourceText.match(pattern);
  assert.ok(match, `${packKey} pack block must exist`);
  return match[0];
}

const envExample = await source(".env.example");
const config = await source("src/lib/cmo/config.ts");
const migration = await source("supabase/migrations/202606200001_workspace_social_facebook_native.sql");
const helper = await source("src/lib/cmo/facebook-channel-metrics.ts");
const channelMetrics = await source("src/lib/cmo/channel-metrics.ts");
const workspaceTypes = await source("src/lib/cmo/app-workspace-types.ts");
const workspaceView = await source("src/components/cmo-apps/app-workspace-view.tsx");
const evidenceDisplay = await source("src/lib/cmo/cmo-chat-evidence-display.ts");
const evidenceCheck = await source("scripts/cmo-chat-evidence-ux-check.mjs");
const service = await source("ops/systemd/cmo-facebook-channel-sync.service");
const timer = await source("ops/systemd/cmo-facebook-channel-sync.timer");

for (const key of [
  "META_APP_ID=",
  "META_APP_SECRET=",
  "META_REDIRECT_URI=",
  "CMO_FACEBOOK_NATIVE_ENABLED=false",
  "CMO_FACEBOOK_NATIVE_DASHBOARD_ENABLED=false",
]) {
  assertIncludes(envExample, key, `.env.example must document ${key}`);
}
assertNoMatch(envExample, /NEXT_PUBLIC_.*(?:META|FACEBOOK)/i, "Meta/Facebook env vars must stay server-only");
assertIncludes(config, "isCmoFacebookNativeEnabled", "config must expose native connector flag");
assertIncludes(config, "isCmoFacebookNativeDashboardEnabled", "config must expose dashboard cutover flag");
assertIncludes(config, "getMetaAppSecret", "config must expose server-only Meta app secret accessor");

for (const table of [
  "workspace_social_oauth_accounts",
  "workspace_channel_sources",
  "workspace_social_metric_snapshots",
]) {
  assertMatch(migration, new RegExp(`alter table public\\.${table}\\s+enable row level security`, "i"), `${table} must enable RLS`);
  assertMatch(migration, new RegExp(`grant .* on (?:table )?public\\.${table} to service_role`, "i"), `${table} must grant service_role`);
}
const snapshotTable = tableBlock(migration, "workspace_social_metric_snapshots");
assertNoMatch(snapshotTable, /\b(?:access_token|refresh_token|encrypted_access_token|raw_response|raw_meta_response)\b/i, "metric snapshots must not store tokens or raw Meta responses");
assertMatch(snapshotTable, /\bmetrics_json\b[\s\S]*\bseries_json\b[\s\S]*\bposts_json\b/i, "metric snapshots must store normalized metrics, series, and posts");

const routePaths = [
  "src/app/api/cmo/apps/[appId]/social-sources/facebook/connect/route.ts",
  "src/app/api/cmo/oauth/meta/callback/route.ts",
  "src/app/api/cmo/apps/[appId]/social-sources/facebook/pages/route.ts",
  "src/app/api/cmo/apps/[appId]/social-sources/facebook/route.ts",
  "src/app/api/cmo/apps/[appId]/social-sources/facebook/verify/route.ts",
  "src/app/api/internal/lens/apps/[appId]/social/facebook/sync/route.ts",
  "src/app/api/internal/lens/apps/[appId]/social/facebook/snapshots/route.ts",
  "src/app/api/internal/lens/apps/[appId]/social/facebook/report-packs/route.ts",
];
const routeSources = await Promise.all(routePaths.map((routePath) => source(routePath)));
for (const [index, routeSource] of routeSources.entries()) {
  assertIncludes(routeSource, 'runtime = "nodejs"', `${routePaths[index]} must run in nodejs runtime`);
}
for (const internalRoute of routeSources.slice(-3)) {
  assertIncludes(internalRoute, "authorizeLensInternalRequest", "internal Facebook routes must require bearer auth");
}

assertIncludes(helper, "FACEBOOK_CHANNEL_SAFETY", "helper must declare safety flags");
assertMatch(helper, /no_tokens_returned:\s*true/, "safety must declare no tokens returned");
assertMatch(helper, /raw_meta_response_included:\s*false/, "safety must declare no raw Meta response");
assertMatch(helper, /vault_write_performed:\s*false/, "safety must declare no Vault writes");
assertMatch(helper, /gbrain_used:\s*false/, "safety must declare no GBrain use");
assertMatch(helper, /hermes_called:\s*false/, "safety must declare no Hermes calls");
assert.ok(helper.indexOf("if (input.dryRun === true)") < helper.indexOf("fetchPageInsights({"), "dryRun must return before any Meta insights fetch call");
assertIncludes(helper, "would_call_meta: false", "dryRun response must state no Meta call");
assertMatch(helper, /id:\s*"facebook_link_clicks"[\s\S]*?value:\s*null/, "link clicks must remain missing until confirmed");
assertMatch(helper, /id:\s*"facebook_ctr"[\s\S]*?value:\s*null/, "CTR must remain missing until confirmed");
assertIncludes(helper, "product.facebook_channel_sync_result.v1", "sync contract must be declared");
assertIncludes(helper, "product.facebook_channel_snapshots.v1", "snapshots contract must be declared");
assertIncludes(helper, "product.lens_facebook_channel_pack.v1", "report pack contract must be declared");

for (const packKey of ["page_summary", "top_posts", "followers"]) {
  const block = packBlock(helper, packKey);
  assertMatch(block, /pack_key:/, `${packKey} must include pack_key`);
  assertMatch(block, /status:/, `${packKey} must include status`);
  assertMatch(block, /synced_at:/, `${packKey} must include synced_at`);
  assertMatch(block, /syncedAt:/, `${packKey} must include syncedAt`);
  assertMatch(block, /date_range:/, `${packKey} must include date_range`);
  assertMatch(block, /metrics:/, `${packKey} must include metrics array`);
  assertMatch(block, /series:/, `${packKey} must include series array`);
  assertMatch(block, /tables:/, `${packKey} must include tables array`);
}
assertIncludes(helper, "request_context", "report pack must preserve requested range context");
assertIncludes(helper, "selected_range", "report pack must expose selected range metadata");

assertIncludes(workspaceTypes, '"facebook_native"', "channel snapshot type must accept facebook_native");
assertIncludes(workspaceTypes, "sourceMeta", "channel snapshot type must expose safe source metadata");
assertIncludes(channelMetrics, "isCmoFacebookNativeDashboardEnabled", "dashboard reader must be flag-gated");
assertIncludes(channelMetrics, "readNativeFacebookChannelMetricsSnapshot", "dashboard reader must read native snapshots");
assertIncludes(channelMetrics, "readMetricsFile", "dashboard reader must keep legacy Lens file fallback");
assertIncludes(channelMetrics, "Fallback: Facebook handoff", "dashboard reader must tag native fallback");
assertIncludes(workspaceView, "Facebook Native", "dashboard must label native source");
assertIncludes(workspaceView, "Fallback: Facebook handoff", "dashboard must show legacy fallback badge");
assertIncludes(workspaceView, "Product-owned source for Page/channel metrics", "dashboard must include native cutover copy");

for (const fragment of [
  "Facebook\\s+channel\\s+metrics",
  "Product\\s+native\\s+Facebook\\s+connector",
  "Facebook\\s+Native",
  "Meta\\s+Page\\s+Insights",
  "Channel\\s+Performance",
]) {
  assertIncludes(evidenceDisplay, fragment, `evidence mapper must recognize ${fragment}`);
}
for (const label of [
  "Lens / Facebook channel metrics",
  "Product native Facebook connector",
  "Facebook Native",
  "Meta Page Insights",
  "Channel Performance",
]) {
  assertIncludes(evidenceCheck, label, `evidence UX check must cover ${label}`);
}
assertNoMatch(evidenceDisplay, /fetch\(|dangerouslySetInnerHTML/, "evidence mapper must not fetch or render raw HTML");

assertIncludes(service, "EnvironmentFile=/home/ju/.config/cmo-engine-openclaw/dashboard.env", "service must use dashboard env file");
assertIncludes(service, "Environment=CMO_PUBLIC_APP_URL=http://127.0.0.1:3002", "service must pin local dashboard URL");
assertIncludes(service, "/api/internal/lens/apps/holdstation-mini-app/social/facebook/sync", "service must call internal sync route");
assertIncludes(service, "CMO_LENS_INTERNAL_API_KEY", "service must use internal bearer key");
assertNoMatch(service + timer, /systemctl\s+enable|systemctl\s+start/i, "templates must not enable or start timers");
assertIncludes(timer, "OnCalendar=*-*-* 00:20:00", "timer must run daily at 00:20");
assertNoMatch(timer, /^Timezone=/m, "timer must not set systemd Timezone");

console.log("CMO Facebook native connector check passed.");
