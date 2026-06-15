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

const helperPath = "src/lib/cmo/lens-readout.ts";
const routePath = "src/app/api/cmo/apps/[appId]/lens/readout/route.ts";
const metricsPackPath = "src/lib/cmo/lens-metrics-pack.ts";
const diagnosticsPackPath = "src/lib/cmo/lens-diagnostics-pack.ts";
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

for (const file of [helperPath, routePath, metricsPackPath, diagnosticsPackPath]) {
  assertFileExists(file, `${file} is missing`);
}

assertIncludes(helperPath, 'contract: "lens.readout.v1"', "Readout helper must emit lens.readout.v1");
assertIncludes(helperPath, "getLensMetricsPackForApp", "Readout helper must use metrics pack helper");
assertIncludes(helperPath, "createLensDiagnosticsPack", "Readout helper must use diagnostics pack helper");
assertIncludes(helperPath, 'metricsPackContract: input.metricsPack.contract', "Readout basis must reference metrics pack contract");
assertIncludes(helperPath, 'diagnosticsPackContract: input.diagnosticsPack.contract', "Readout basis must reference diagnostics pack contract");
assertIncludes(helperPath, 'interpretationMode: "deterministic_readout"', "Readout must be deterministic");
assertIncludes(helperPath, "liveFetchUsed: false", "Readout basis must state live fetch is disabled");
assertIncludes(helperPath, "llmUsed: false", "Readout basis must state LLM usage is disabled");
assertIncludes(routePath, "getLensReadoutForApp", "Readout route must use readout helper");
assertIncludes(routePath, "rangeKeyFromRequest", "Readout route must accept selected rangeKey");
assertIncludes(routePath, "requireRequestUserIfAuthRequired", "Readout route must preserve auth gate");
assertIncludes(routePath, "Response.json(readout)", "Readout route must return the contract object directly");

assertIncludes(helperPath, 'return "missing_snapshot"', "Missing snapshot must return status.overall missing_snapshot");
assertIncludes(helperPath, 'key: "ga4_snapshot_missing"', "Missing snapshot finding must exist");
assertIncludes(helperPath, "recommendedActions: input.diagnosticsPack.recommendedNextActions", "Readout actions must flow through diagnostics pack");
assertIncludes(diagnosticsPackPath, 'key: "sync_ga4_metrics"', "Missing snapshot recommended action must flow through diagnostics pack");
assertIncludes(helperPath, 'key: "activation_not_configured"', "Activation configuration gap must exist");
assertIncludes(helperPath, 'key: "retention_not_configured"', "Retention configuration gap must exist");
assertIncludes(helperPath, 'canAnswerBasicPerformance', "Readout must expose basic performance readiness");
assertIncludes(helperPath, 'canAnswerActivation', "Readout must expose activation readiness");
assertIncludes(helperPath, 'canAnswerRetention', "Readout must expose retention readiness");
assertIncludes(helperPath, 'canGenerateReadout', "Readout may expose readout generation readiness");
assertExcludes(helperPath, /canGenerateInsight/, "Readout must not use semantic name canGenerateInsight");
assertIncludes(helperPath, 'comparisonReadiness', "Readout should expose multi-range comparison readiness");
assertIncludes(helperPath, 'availableRanges', "Comparison readiness must expose available ranges");
assertIncludes(helperPath, 'missingRanges', "Comparison readiness must expose missing ranges");
assertIncludes(helperPath, '"last_7_days"', "Comparison readiness must check last_7_days");
assertIncludes(helperPath, '"last_30_days"', "Comparison readiness must check last_30_days");
assertIncludes(helperPath, '"this_month"', "Comparison readiness must check this_month");

assertMatches(metricsPackPath, /key:\s*"ga4\.active_users"[\s\S]{0,260}label:\s*"Active Users"[\s\S]{0,260}semanticRole:\s*"audience"/, "activeUsers must remain Active Users / audience in metrics basis");
assertExcludes(metricsPackPath, /key:\s*"ga4\.active_users"[\s\S]{0,220}semanticRole:\s*"activation"|key:\s*"activation\.activated_users"[\s\S]{0,260}sourceMetric:\s*"activeUsers"/, "activeUsers must not be treated as Activated Users / activation");
assertMatches(metricsPackPath, /key:\s*"ga4\.engagement_rate"[\s\S]{0,260}label:\s*"Engagement Rate"[\s\S]{0,260}semanticRole:\s*"engagement"/, "engagementRate must remain Engagement Rate / engagement in metrics basis");
assertExcludes(metricsPackPath, /key:\s*"ga4\.engagement_rate"[\s\S]{0,260}semanticRole:\s*"activation"|key:\s*"activation\.activation_rate"[\s\S]{0,260}sourceMetric:\s*"engagementRate"/, "engagementRate must not be treated as Activation Rate / activation");

assertIncludes(helperPath, '"ga4.new_users"', "Readout highlights must include New Users");
assertIncludes(helperPath, '"ga4.sessions"', "Readout highlights must include Sessions");
assertIncludes(helperPath, '"ga4.event_count"', "Readout highlights must include Event Count");
assertIncludes(helperPath, '"ga4.engagement_rate"', "Readout highlights must include Engagement Rate");
assertIncludes(diagnosticsPackPath, 'key: "define_activation_event"', "Definition action must include define_activation_event");
assertIncludes(diagnosticsPackPath, 'key: "define_retention_logic"', "Definition action must include define_retention_logic");

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
  "cmo-lens-diagnostics-pack-check.mjs",
]) {
  execFileSync(process.execPath, [repoPath("scripts", script)], {
    cwd: root,
    stdio: "pipe",
    env: process.env,
  });
}

console.log("CMO Lens readout check passed.");
