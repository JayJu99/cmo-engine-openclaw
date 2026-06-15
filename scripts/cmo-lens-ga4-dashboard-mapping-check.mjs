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

const uiPath = "src/components/cmo-apps/app-workspace-view.tsx";
const snapshotHelperPath = "src/lib/cmo/workspace-metric-snapshots.ts";
const snapshotRoutePath = "src/app/api/cmo/apps/[appId]/metric-sources/ga4/snapshots/route.ts";
const syncRoutePath = "src/app/api/cmo/apps/[appId]/metric-sources/ga4/sync/route.ts";
const dataHelperPath = "src/lib/cmo/lens-ga4-data.ts";
const forbiddenRealtimeName = ["run", "Realtime", "Report"].join("");
const forbiddenRealtimePattern = new RegExp(forbiddenRealtimeName, "i");

for (const file of [uiPath, snapshotHelperPath, snapshotRoutePath, syncRoutePath, dataHelperPath]) {
  assertFileExists(file, `${file} is missing`);
}

assertIncludes(snapshotHelperPath, ".from(\"workspace_metric_snapshots\")", "Snapshot helper must read workspace_metric_snapshots");
assertIncludes(snapshotHelperPath, "getLatestWorkspaceGa4MetricSnapshot", "Snapshot helper must expose latest snapshot lookup");
assertIncludes(snapshotHelperPath, ".eq(\"tenant_id\", input.tenantId)", "Snapshot lookup must scope by derived tenantId");
assertIncludes(snapshotHelperPath, ".eq(\"workspace_id\", input.workspaceId)", "Snapshot lookup must scope by derived workspaceId");
assertIncludes(snapshotHelperPath, ".eq(\"app_id\", input.appId)", "Snapshot lookup must scope by derived appId");
assertIncludes(snapshotHelperPath, ".eq(\"source_type\", \"ga4\")", "Snapshot lookup must scope by GA4 source type");
assertIncludes(snapshotHelperPath, ".eq(\"source_id\", \"ga4_native\")", "Snapshot lookup must scope by generic GA4 source id");
assertIncludes(snapshotHelperPath, ".order(\"synced_at\"", "Snapshot lookup must choose the latest synced snapshot");
assertIncludes(snapshotHelperPath, "toSafeWorkspaceGa4MetricSnapshot", "Snapshot helper must return a safe response shape");

assertIncludes(snapshotRoutePath, "requireWorkspaceRegistryEntry(appId)", "Snapshot route must derive workspace scope from appId");
assertIncludes(snapshotRoutePath, "tenantId: entry.tenantId", "Snapshot route must derive tenantId from registry");
assertIncludes(snapshotRoutePath, "workspaceId: entry.workspaceId", "Snapshot route must derive workspaceId from registry");
assertIncludes(snapshotRoutePath, "appId: entry.appId", "Snapshot route must derive appId from registry");
assertIncludes(snapshotRoutePath, "getLatestWorkspaceGa4MetricSnapshot", "Snapshot route must use latest snapshot helper");

assertIncludes(uiPath, "ga4DashboardRangeKey(dateRange)", "Dashboard must use the selected date range for GA4 snapshots");
assertIncludes(uiPath, "rangeKey=${ga4SnapshotRangeKey}", "GA4 snapshot fetch/sync must pass selected rangeKey");
assertIncludes(uiPath, "Source: Lens GA4", "Dashboard must show Lens GA4 source badge");
assertIncludes(uiPath, "Last synced:", "Dashboard must show last synced state");
assertIncludes(uiPath, "Sync GA4 metrics", "Dashboard must expose Sync GA4 metrics CTA");
assertIncludes(uiPath, "ga4SnapshotStaleThresholdMs", "Dashboard must define stale thresholds");
assertIncludes(uiPath, "48 * 60 * 60 * 1000", "Dashboard must use 48h stale threshold for long ranges");
assertIncludes(uiPath, "24 * 60 * 60 * 1000", "Dashboard must use 24h stale threshold for short ranges");

assertMatches(uiPath, /label:\s*"New Users"[\s\S]{0,220}compactMetricValue\(newUsers\)/, "New Users card must map from GA4 newUsers");
assertMatches(uiPath, /const newUsers = ga4MetricSnapshot\?\.metrics\.newUsers/, "New Users mapping must read ga4MetricSnapshot.metrics.newUsers");
assertMatches(uiPath, /label:\s*"Sessions"[\s\S]{0,240}ga4MetricSnapshot\?\.metrics\.sessions/, "Sessions card must map from GA4 sessions");
assertMatches(uiPath, /label:\s*"Event Count"[\s\S]{0,240}ga4MetricSnapshot\?\.metrics\.eventCount/, "Event Count card must map from GA4 eventCount");
assertMatches(uiPath, /label:\s*"Engagement Rate"[\s\S]{0,260}ga4MetricSnapshot\?\.metrics\.engagementRate/, "Engagement Rate card must map from GA4 engagementRate");
assertMatches(uiPath, /Requires activation\/retention definition\./, "Unmapped activation/retention cards must keep missing-definition copy");
assertMatches(uiPath, /Metric definition needed/, "Unmapped activation/retention cards must show definition-needed badge");

assertExcludes(uiPath, /Activated Users[\s\S]{0,800}activeUsers|activeUsers[\s\S]{0,800}Activated Users/, "activeUsers must not be displayed as Activated Users");
assertExcludes(uiPath, /Activation Rate[\s\S]{0,800}engagementRate|engagementRate[\s\S]{0,800}Activation Rate/, "engagementRate must not be displayed as Activation Rate");
assertExcludes(uiPath, /D1 Retention[\s\S]{0,800}ga4MetricSnapshot|D7 Retention[\s\S]{0,800}ga4MetricSnapshot/, "D1/D7 retention must not be populated from GA4 snapshot");

for (const file of [uiPath, snapshotRoutePath]) {
  assertExcludes(file, /\b(access_token|refresh_token|encrypted_refresh_token|id_token)\b/i, `${file} must not expose token fields in dashboard responses/UI`);
}

for (const file of [snapshotHelperPath, snapshotRoutePath, syncRoutePath, dataHelperPath]) {
  assertExcludes(file, /\/agents\/|\/api\/cmo\/vault|gbrain|GBrain|Hermes/i, `${file} references an out-of-scope Vault/GBrain/Hermes system`);
  assertExcludes(file, forbiddenRealtimePattern, `${file} must not call GA4 realtime metrics`);
}

for (const script of [
  "cmo-lens-oauth-foundation-check.mjs",
  "cmo-lens-ga4-property-discovery-check.mjs",
  "cmo-lens-ga4-source-verification-check.mjs",
  "cmo-lens-ga4-data-sync-check.mjs",
]) {
  execFileSync(process.execPath, [repoPath("scripts", script)], {
    cwd: root,
    stdio: "pipe",
    env: process.env,
  });
}

console.log("CMO Lens GA4 dashboard mapping check passed.");
