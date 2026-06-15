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

const helperPath = "src/lib/cmo/lens-diagnostics-pack.ts";
const routePath = "src/app/api/cmo/apps/[appId]/lens/diagnostics/route.ts";
const metricsPackPath = "src/lib/cmo/lens-metrics-pack.ts";
const forbiddenMetricFetchPattern = new RegExp(["run", "Report"].join(""), "i");
const forbiddenRealtimePattern = new RegExp(["run", "Realtime", "Report"].join(""), "i");
const forbiddenSideEffectPattern = new RegExp([
  "\\/agents\\/",
  "\\/api\\/cmo\\/vault",
  "gbrain",
  "GBrain",
  "Hermes",
  ["stream", "Text"].join(""),
  ["generate", "Text"].join(""),
  ["open", "ai"].join(""),
  ["anth", "ropic"].join(""),
  ["gr", "oq"].join(""),
].join("|"), "i");

for (const file of [helperPath, routePath, metricsPackPath]) {
  assertFileExists(file, `${file} is missing`);
}

assertIncludes(helperPath, 'contract: "lens.diagnostics_pack.v1"', "Diagnostics helper must emit lens.diagnostics_pack.v1");
assertIncludes(helperPath, "getLensMetricsPackForApp", "Diagnostics helper must derive from metrics pack helper");
assertIncludes(helperPath, 'metricsPackContract: "lens.metrics_pack.v1"', "Diagnostics basis must reference lens.metrics_pack.v1");
assertIncludes(helperPath, 'interpretationMode: "deterministic_readiness"', "Diagnostics must be deterministic readiness only");
assertIncludes(routePath, "getLensDiagnosticsPackForApp", "Diagnostics route must use diagnostics helper");
assertIncludes(routePath, "rangeKeyFromRequest", "Diagnostics route must accept selected rangeKey");
assertIncludes(routePath, "requireRequestUserIfAuthRequired", "Diagnostics route must preserve auth gate");
assertIncludes(routePath, "Response.json(diagnostics)", "Diagnostics route must return the contract object directly");

assertIncludes(helperPath, 'return "missing_snapshot"', "Missing snapshot must return summary.status missing_snapshot");
assertIncludes(helperPath, 'key: "sync_ga4_metrics"', "Missing snapshot recommended action must include syncing GA4 metrics");
assertIncludes(helperPath, 'key: "definition.activation_missing"', "Activation missing diagnostic must exist");
assertIncludes(helperPath, 'status: "needs_definition"', "Definition diagnostics must use needs_definition status");
assertMatches(helperPath, /affectedMetricKeys:\s*activationMetricKeys[\s\S]{0,120}missingDefinition:\s*"activation_event"/, "Activation diagnostics must require activation_event");
assertIncludes(helperPath, 'key: "definition.retention_missing"', "Retention missing diagnostic must exist");
assertMatches(helperPath, /affectedMetricKeys:\s*retentionMetricKeys[\s\S]{0,120}missingDefinition:\s*"cohort_retention_logic"/, "Retention diagnostics must require cohort_retention_logic");
assertIncludes(helperPath, 'canCompareTrend: false as const', "M6.6A must not enable trend comparison");
assertIncludes(helperPath, 'key: "data.ga4_snapshot_stale"', "Stale snapshot diagnostic must exist");
assertIncludes(helperPath, 'key: "data.ga4_snapshot_ready"', "Ready snapshot diagnostic must exist");

assertMatches(metricsPackPath, /key:\s*"ga4\.active_users"[\s\S]{0,260}label:\s*"Active Users"[\s\S]{0,260}semanticRole:\s*"audience"/, "activeUsers must remain Active Users / audience in metrics basis");
assertExcludes(metricsPackPath, /key:\s*"ga4\.active_users"[\s\S]{0,220}semanticRole:\s*"activation"|key:\s*"activation\.activated_users"[\s\S]{0,260}sourceMetric:\s*"activeUsers"/, "activeUsers must not be treated as Activated Users / activation");
assertMatches(metricsPackPath, /key:\s*"ga4\.engagement_rate"[\s\S]{0,260}label:\s*"Engagement Rate"[\s\S]{0,260}semanticRole:\s*"engagement"/, "engagementRate must remain Engagement Rate / engagement in metrics basis");
assertExcludes(metricsPackPath, /key:\s*"ga4\.engagement_rate"[\s\S]{0,260}semanticRole:\s*"activation"|key:\s*"activation\.activation_rate"[\s\S]{0,260}sourceMetric:\s*"engagementRate"/, "engagementRate must not be treated as Activation Rate / activation");

for (const file of [helperPath, routePath]) {
  assertExcludes(file, forbiddenMetricFetchPattern, `${file} must not call GA4 Data API metric fetch`);
  assertExcludes(file, forbiddenRealtimePattern, `${file} must not call GA4 realtime metrics`);
  assertExcludes(file, forbiddenSideEffectPattern, `${file} references an out-of-scope Hermes/Vault/GBrain/LLM system`);
  assertExcludes(file, /\b(access_token|refresh_token|encrypted_refresh_token|id_token)\b/i, `${file} must not expose token fields`);
}

for (const script of [
  "cmo-lens-oauth-foundation-check.mjs",
  "cmo-lens-ga4-property-discovery-check.mjs",
  "cmo-lens-ga4-source-verification-check.mjs",
  "cmo-lens-ga4-data-sync-check.mjs",
  "cmo-lens-ga4-dashboard-mapping-check.mjs",
  "cmo-lens-metrics-pack-check.mjs",
]) {
  execFileSync(process.execPath, [repoPath("scripts", script)], {
    cwd: root,
    stdio: "pipe",
    env: process.env,
  });
}

console.log("CMO Lens diagnostics pack check passed.");
