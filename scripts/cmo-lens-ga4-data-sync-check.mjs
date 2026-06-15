import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function repoPath(...segments) {
  return path.join(root, ...segments);
}

function source(relativePath) {
  return fs.readFileSync(repoPath(relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFileExists(relativePath, message) {
  assert(fs.existsSync(repoPath(relativePath)), message);
}

function assertIncludes(relativePath, expected, message) {
  assert(source(relativePath).includes(expected), message);
}

function assertMatches(relativePath, pattern, message) {
  assert(pattern.test(source(relativePath)), message);
}

function assertExcludes(relativePath, pattern, message) {
  assert(!pattern.test(source(relativePath)), message);
}

const dataHelperPath = "src/lib/cmo/lens-ga4-data.ts";
const snapshotHelperPath = "src/lib/cmo/workspace-metric-snapshots.ts";
const syncRoutePath = "src/app/api/cmo/apps/[appId]/metric-sources/ga4/sync/route.ts";
const snapshotRoutePath = "src/app/api/cmo/apps/[appId]/metric-sources/ga4/snapshots/route.ts";
const uiPath = "src/components/cmo-apps/app-workspace-view.tsx";
const migrationPath = "supabase/migrations/202606150003_workspace_metric_snapshots.sql";

for (const file of [
  dataHelperPath,
  snapshotHelperPath,
  syncRoutePath,
  snapshotRoutePath,
  uiPath,
  migrationPath,
]) {
  assertFileExists(file, `${file} is missing`);
}

assertIncludes(dataHelperPath, ":runReport", "GA4 Data API helper must call runReport");
assertExcludes(dataHelperPath, /runRealtimeReport/i, "GA4 Data API helper must not call runRealtimeReport");
assertIncludes(dataHelperPath, "getLensGoogleAccessToken", "GA4 Data API helper must use server-only Google token helper");
assertIncludes(dataHelperPath, "activeUsers", "GA4 Data API helper must request activeUsers");
assertIncludes(dataHelperPath, "newUsers", "GA4 Data API helper must request newUsers");
assertIncludes(dataHelperPath, "sessions", "GA4 Data API helper must request sessions");
assertIncludes(dataHelperPath, "eventCount", "GA4 Data API helper must request eventCount");
assertIncludes(dataHelperPath, "userEngagementDuration", "GA4 Data API helper must request userEngagementDuration");
assertIncludes(dataHelperPath, "rolling_calendar_days", "GA4 date range helper must document rolling last_7_days mode");

assertIncludes(syncRoutePath, "requireWorkspaceRegistryEntry(appId)", "Sync route must resolve appId through workspace registry");
assertIncludes(syncRoutePath, "tenantId: entry.tenantId", "Sync route must derive tenantId from registry");
assertIncludes(syncRoutePath, "workspaceId: entry.workspaceId", "Sync route must derive workspaceId from registry");
assertIncludes(syncRoutePath, "appId: entry.appId", "Sync route must derive appId from registry");
assertIncludes(syncRoutePath, "getWorkspaceGa4MetricSourceMapping", "Sync route must read saved GA4 mapping");
assertIncludes(syncRoutePath, "mapping.verificationStatus !== \"verified\"", "Sync route must require verified source");
assertIncludes(syncRoutePath, "source_not_verified", "Sync route must return source_not_verified");
assertIncludes(syncRoutePath, "source_mapping_not_found", "Sync route must return clear missing mapping code");
assertIncludes(syncRoutePath, "source_auth_failed", "Sync route must map OAuth token failures safely");
assertIncludes(syncRoutePath, "ga4_data_api_unavailable", "Sync route must map GA4 Data API unavailable");
assertExcludes(syncRoutePath, /request\.json|body\.propertyId|propertyId:\s*body/i, "Sync route must not read propertyId from client body");
assertIncludes(dataHelperPath, "propertyId: mapping.propertyId", "Data helper must read propertyId from saved mapping");

assertIncludes(snapshotRoutePath, "requireWorkspaceRegistryEntry(appId)", "Snapshot route must resolve appId through workspace registry");
assertIncludes(snapshotRoutePath, "getLatestWorkspaceGa4MetricSnapshot", "Snapshot route must read latest cached snapshot");
assertIncludes(snapshotRoutePath, "unknown_app_id", "Snapshot route must reject unknown appId with stable code");

assertIncludes(snapshotHelperPath, "upsertWorkspaceGa4MetricSnapshot", "Snapshot helper must expose upsert");
assertIncludes(snapshotHelperPath, "getLatestWorkspaceGa4MetricSnapshot", "Snapshot helper must expose latest lookup");
assertIncludes(snapshotHelperPath, "toSafeWorkspaceGa4MetricSnapshot", "Snapshot helper must normalize safe response");
assertIncludes(snapshotHelperPath, "metrics_json", "Snapshot helper must store metrics in metrics_json");
assertIncludes(snapshotHelperPath, "source_meta_json", "Snapshot helper must store source metadata in source_meta_json");

assertIncludes(migrationPath, "create table if not exists public.workspace_metric_snapshots", "Snapshot migration must create workspace_metric_snapshots");
assertIncludes(migrationPath, "metrics_json jsonb not null default '{}'::jsonb", "Snapshot migration must include metrics_json");
assertIncludes(migrationPath, "source_meta_json jsonb not null default '{}'::jsonb", "Snapshot migration must include source_meta_json");
assertIncludes(migrationPath, "status text not null default 'synced'", "Snapshot migration must include status");
assertIncludes(migrationPath, "workspace_metric_snapshots_unique_range", "Snapshot migration must enforce unique snapshot range");
assertExcludes(migrationPath, /\b(access_token|refresh_token|encrypted_refresh_token|id_token)\b/i, "Snapshot migration must not define token fields");

assertIncludes(uiPath, "Sync GA4 metrics", "UI must expose Sync GA4 metrics action");
assertIncludes(uiPath, "GA4 core metrics synced. Lens interpretation comes later.", "UI must keep M6.4A interpretation copy");
assertIncludes(uiPath, "Active users", "UI must show active users raw metric");
assertIncludes(uiPath, "New users", "UI must show new users raw metric");
assertIncludes(uiPath, "Sessions", "UI must show sessions raw metric");
assertIncludes(uiPath, "Event count", "UI must show event count raw metric");
assertIncludes(uiPath, "Engagement rate", "UI must show engagement rate raw metric");
assertExcludes(uiPath, /Activated Users/, "UI must not label GA4 activeUsers as Activated Users");

for (const file of [dataHelperPath, syncRoutePath, snapshotRoutePath]) {
  assertExcludes(file, /\b(access_token|refresh_token|encrypted_refresh_token|id_token)\b/i, `${file} exposes raw token field names`);
  assertExcludes(file, /runRealtimeReport/i, `${file} must not use realtime metrics`);
  assertExcludes(file, /\/agents\/|\/api\/cmo\/vault|gbrain|GBrain|Hermes/i, `${file} references an out-of-scope Vault/GBrain/Hermes route`);
}

assertExcludes(snapshotHelperPath, /runRealtimeReport/i, `${snapshotHelperPath} must not use realtime metrics`);
assertExcludes(snapshotHelperPath, /\/agents\/|\/api\/cmo\/vault|gbrain|GBrain|Hermes/i, `${snapshotHelperPath} references an out-of-scope Vault/GBrain/Hermes route`);

assertMatches(dataHelperPath, /if \(status === 429 \|\| status >= 500\)[\s\S]*ga4_data_api_unavailable/, "GA4 API 429/5xx must map to ga4_data_api_unavailable");
assertMatches(syncRoutePath, /error instanceof LensGoogleAccessTokenError[\s\S]*source_auth_failed/, "Token failures must map to source_auth_failed");

for (const script of [
  "cmo-lens-oauth-foundation-check.mjs",
  "cmo-lens-ga4-property-discovery-check.mjs",
  "cmo-lens-ga4-source-verification-check.mjs",
]) {
  execFileSync(process.execPath, [repoPath("scripts", script)], {
    cwd: root,
    stdio: "pipe",
    env: process.env,
  });
}

console.log("CMO Lens GA4 data sync check passed.");
