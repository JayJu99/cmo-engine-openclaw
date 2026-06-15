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

const helperPath = "src/lib/cmo/lens-metrics-pack.ts";
const routePath = "src/app/api/cmo/apps/[appId]/lens/metrics-pack/route.ts";
const snapshotHelperPath = "src/lib/cmo/workspace-metric-snapshots.ts";
const forbiddenGa4MetricCallPattern = new RegExp(["run", "Report"].join(""), "i");
const forbiddenGa4RealtimePattern = new RegExp(["run", "Realtime", "Report"].join(""), "i");
const forbiddenSideEffectPattern = /\/agents\/|\/api\/cmo\/vault|gbrain|GBrain|Hermes|streamText|generateText|openai|anthropic|groq/i;

for (const file of [helperPath, routePath, snapshotHelperPath]) {
  assertFileExists(file, `${file} is missing`);
}

assertIncludes(helperPath, 'contract: "lens.metrics_pack.v1"', "Metrics pack helper must emit lens.metrics_pack.v1");
assertIncludes(helperPath, "requireWorkspaceRegistryEntry(input.appId)", "Metrics pack helper must resolve appId through workspace registry");
assertIncludes(helperPath, "tenantId: entry.tenantId", "Metrics pack helper must derive tenantId from registry");
assertIncludes(helperPath, "workspaceId: entry.workspaceId", "Metrics pack helper must derive workspaceId from registry");
assertIncludes(helperPath, "appId: entry.appId", "Metrics pack helper must derive appId from registry");
assertIncludes(helperPath, "getLatestWorkspaceGa4MetricSnapshot", "Metrics pack helper must read latest GA4 snapshot");
assertIncludes(helperPath, "getWorkspaceGa4MetricSourceMapping", "Metrics pack helper must read safe GA4 source metadata");
assertIncludes(snapshotHelperPath, ".from(\"workspace_metric_snapshots\")", "Snapshot helper must use workspace_metric_snapshots cache");
assertIncludes(routePath, "getLensMetricsPackForApp", "Metrics pack route must use metrics pack helper");
assertIncludes(routePath, "rangeKeyFromRequest", "Metrics pack route must accept selected rangeKey");
assertIncludes(routePath, "requireRequestUserIfAuthRequired", "Metrics pack route must preserve auth gate");
assertIncludes(routePath, "Response.json(pack)", "Metrics pack route must return the contract object directly");

assertMatches(helperPath, /key:\s*"ga4\.active_users"[\s\S]{0,260}label:\s*"Active Users"[\s\S]{0,260}sourceMetric:\s*"activeUsers"/, "activeUsers must be labeled Active Users");
assertExcludes(helperPath, /key:\s*"ga4\.active_users"[\s\S]{0,500}Activated Users/, "GA4 activeUsers must not be labeled Activated Users");
assertMatches(helperPath, /key:\s*"ga4\.engagement_rate"[\s\S]{0,260}label:\s*"Engagement Rate"[\s\S]{0,260}sourceMetric:\s*"engagementRate"/, "engagementRate must be labeled Engagement Rate");
assertExcludes(helperPath, /key:\s*"ga4\.engagement_rate"[\s\S]{0,500}Activation Rate/, "GA4 engagementRate must not be labeled Activation Rate");
assertMatches(helperPath, /function definitionNeededMetric[\s\S]{0,700}mappingStatus:\s*"definition_needed"/, "Definition-needed metrics must be marked definition_needed");
assertMatches(helperPath, /key:\s*"activation\.activated_users"[\s\S]{0,220}label:\s*"Activated Users"[\s\S]{0,220}missingDefinition:\s*"activation_event"/, "Activated Users must require activation_event definition");
assertMatches(helperPath, /key:\s*"activation\.activation_rate"[\s\S]{0,220}label:\s*"Activation Rate"[\s\S]{0,220}missingDefinition:\s*"activation_event"/, "Activation Rate must require activation_event definition");
assertMatches(helperPath, /key:\s*"retention\.d1"[\s\S]{0,220}label:\s*"D1 Retention"[\s\S]{0,220}missingDefinition:\s*"cohort_retention_logic"/, "D1 Retention must require cohort retention definition");
assertMatches(helperPath, /key:\s*"retention\.d7"[\s\S]{0,220}label:\s*"D7 Retention"[\s\S]{0,220}missingDefinition:\s*"cohort_retention_logic"/, "D7 Retention must require cohort retention definition");
assertIncludes(helperPath, 'return "missing_snapshot"', "Missing snapshot must return quality.status missing_snapshot");
assertIncludes(helperPath, "status: snapshot?.status ?? \"missing_snapshot\"", "Source status must support missing_snapshot");
assertIncludes(helperPath, "snapshotId: snapshot?.snapshotId", "Metrics pack source must include safe snapshotId");
assertIncludes(snapshotHelperPath, "snapshotId: row.id", "Safe snapshot helper must expose snapshotId from id");

for (const file of [helperPath, routePath]) {
  assertExcludes(file, forbiddenGa4MetricCallPattern, `${file} must not call GA4 Data API metric fetch`);
  assertExcludes(file, forbiddenGa4RealtimePattern, `${file} must not call GA4 realtime metrics`);
  assertExcludes(file, forbiddenSideEffectPattern, `${file} references an out-of-scope Hermes/Vault/GBrain/LLM system`);
  assertExcludes(file, /\b(access_token|refresh_token|encrypted_refresh_token|id_token)\b/i, `${file} must not expose token fields`);
}

for (const script of [
  "cmo-lens-oauth-foundation-check.mjs",
  "cmo-lens-ga4-property-discovery-check.mjs",
  "cmo-lens-ga4-source-verification-check.mjs",
  "cmo-lens-ga4-data-sync-check.mjs",
  "cmo-lens-ga4-dashboard-mapping-check.mjs",
]) {
  execFileSync(process.execPath, [repoPath("scripts", script)], {
    cwd: root,
    stdio: "pipe",
    env: process.env,
  });
}

console.log("CMO Lens metrics pack check passed.");
