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

const contextHelperPath = "src/lib/cmo/lens-readout-context.ts";
const readoutHelperPath = "src/lib/cmo/lens-readout.ts";
const diagnosticsPackPath = "src/lib/cmo/lens-diagnostics-pack.ts";
const chatStorePath = "src/lib/cmo/app-chat-store.ts";
const mapperPath = "src/lib/cmo/hermes-cmo-chat-mapper.ts";
const chatV11Path = "src/lib/cmo/hermes-cmo-chat-v11.ts";
const typesPath = "src/lib/cmo/app-workspace-types.ts";
const metricsPackPath = "src/lib/cmo/lens-metrics-pack.ts";
const forbiddenMetricFetchPattern = new RegExp(["run", "Report"].join(""), "i");
const forbiddenRealtimePattern = new RegExp(["run", "Realtime", "Report"].join(""), "i");
const forbiddenNewProductLlmPattern = new RegExp([
  ["stream", "Text"].join(""),
  ["generate", "Text"].join(""),
  ["open", "ai"].join(""),
  ["anth", "ropic"].join(""),
  ["gr", "oq"].join(""),
].join("|"), "i");

for (const file of [contextHelperPath, readoutHelperPath, diagnosticsPackPath, chatStorePath, mapperPath, chatV11Path, typesPath, metricsPackPath]) {
  assertFileExists(file, `${file} is missing`);
}

assertIncludes(contextHelperPath, 'contract: "lens.readout_context.v1"', "Lens readout context helper must emit lens.readout_context.v1");
assertIncludes(contextHelperPath, 'readoutContract: readout.contract', "Lens readout context must carry source readout contract");
assertIncludes(contextHelperPath, "getLensReadoutForApp", "Lens readout context must use existing readout helper");
assertIncludes(contextHelperPath, "getLensReadoutContextForAppSafe", "Lens readout context must expose fail-soft builder");
assertIncludes(contextHelperPath, "lens_readout_context_unavailable", "Lens readout context helper must degrade gracefully");

assertIncludes(chatStorePath, "getLensReadoutContextForAppSafe", "CMO chat path must build Lens readout context");
assertIncludes(chatStorePath, "rangeKey: request.rangeKey ?? \"this_week\"", "CMO chat Lens integration must default rangeKey to this_week");
assertIncludes(chatStorePath, "lensReadoutContextWarning", "CMO chat path must retain safe Lens warning metadata");
assertIncludes(chatStorePath, "lensReadoutMetadata", "CMO chat path must attach compact Lens metadata");
assertIncludes(chatStorePath, "lensReadoutAttached", "CMO chat metadata must include Lens attached marker");
assertIncludes(chatStorePath, "lens_readout_attached", "CMO chat metadata must include snake_case Lens attached marker");

assertIncludes(mapperPath, "lensReadoutContext", "Hermes CMO mapper must read Lens context from context package");
assertIncludes(mapperPath, "lens_readout_context", "Hermes CMO mapper may attach named Lens readout context only as duplicate metadata");
assertIncludes(mapperPath, 'LENS_READOUT_CONTEXT_CONTRACT = "lens.readout_context.v1"', "Mapper must define the Lens readout artifact contract");
assertIncludes(mapperPath, 'LENS_READOUT_CONTEXT_ARTIFACT_KIND = "lens_readout_context"', "Mapper must define the Lens readout artifact kind");
assertMatches(
  mapperPath,
  /function lensReadoutContextArtifact[\s\S]{0,700}contract:\s*LENS_READOUT_CONTEXT_CONTRACT[\s\S]{0,200}kind:\s*LENS_READOUT_CONTEXT_ARTIFACT_KIND[\s\S]{0,200}content:\s*context/,
  "Hermes CMO mapper must wrap Lens readout context as { contract, kind, content }",
);
assertMatches(
  mapperPath,
  /artifacts_in:\s*\[[\s\S]{0,220}lensReadoutArtifact[\s\S]{0,120}\]\.filter/,
  "Hermes CMO request artifacts_in must include wrapped Lens readout artifact",
);
assertMatches(
  mapperPath,
  /context_pack:\s*\{[\s\S]{0,900}artifacts_in:[\s\S]{0,260}lensReadoutArtifact[\s\S]{0,700}\.\.\.\(lensReadoutContext\s*\?\s*\{\s*lens_readout_context:\s*lensReadoutContext\s*\}/,
  "Top-level context_pack.lens_readout_context must remain secondary to artifacts_in, not the only Lens copy",
);
assertIncludes(typesPath, "lensReadoutContext?: Record<string, unknown>", "Context package type must allow Lens readout context");
assertIncludes(typesPath, "rangeKey?: CmoLensReadoutRangeKey", "App chat request type must allow rangeKey");
assertIncludes(chatV11Path, "LENS_READOUT_CONTEXT_CONTRACT", "Hermes CMO chat v1.1 sanitizer must know the Lens readout contract");
assertMatches(
  chatV11Path,
  /isLensReadoutArtifact[\s\S]{0,500}value\.contract === LENS_READOUT_CONTEXT_CONTRACT[\s\S]{0,260}value\.kind === LENS_READOUT_CONTEXT_ARTIFACT_KIND[\s\S]{0,260}value\.content\.contract === LENS_READOUT_CONTEXT_CONTRACT/,
  "Hermes CMO chat v1.1 sanitizer must identify wrapped Lens readout context artifacts",
);
assertMatches(
  chatV11Path,
  /key === "content"[\s\S]{0,220}isLensReadoutArtifact[\s\S]{0,220}safe\[key\] = lensContent/,
  "Hermes CMO chat v1.1 sanitizer must preserve object content for Lens readout artifacts",
);
assertExcludes(mapperPath, /schema_version:\s*["']lens\.readout_context\.v1["']/, "Product must not set unsupported schema_version on Lens readout artifact");
assertExcludes(chatV11Path, /schema_version:\s*["']lens\.readout_context\.v1["']/, "Product must not set unsupported schema_version on Lens readout artifact");
assertExcludes(contextHelperPath, /schema_version:\s*["']lens\.readout_context\.v1["']/, "Lens readout context must not carry unsupported schema_version");
assertIncludes(mapperPath, "A Lens readout context may be attached under lens.readout_context.v1 in artifacts_in", "Hermes request must carry a Lens grounding rule");
assertIncludes(chatV11Path, "context_grounding_rules", "Hermes CMO chat v1.1 request must carry context grounding rules");

assertMatches(
  mapperPath,
  /function answerFromHermes[\s\S]{0,1800}const body = answer\.body\.trim\(\)/,
  "Mapper must preserve Hermes answer.body as the answer source",
);
assertExcludes(chatStorePath, /answer\s*=\s*.*lensReadout|answer\s*=\s*.*Lens readout|mappedHermesResult\.answer\s*=/i, "CMO chat integration must not replace Hermes answer body with Lens readout text");
assertExcludes(chatStorePath, /performance tu\u1ea7n n\u00e0y|GA4 c\u00f3 g\u00ec|t\u00ecnh h\u00ecnh tu\u1ea7n n\u00e0y/i, "Product chat path must not contain exact hardcoded metric questions");
assertExcludes(mapperPath, /performance tu\u1ea7n n\u00e0y|GA4 c\u00f3 g\u00ec|t\u00ecnh h\u00ecnh tu\u1ea7n n\u00e0y/i, "Hermes mapper must not contain exact hardcoded metric questions");
assertExcludes(chatStorePath, /if\s*\([^)]*(?:message|query|prompt)[^)]*\)\s*\{[\s\S]{0,500}(?:Active Users|Engagement Rate|GA4|Lens readout)[\s\S]{0,500}answer\s*=/i, "Product chat path must not map exact user queries to fixed metric answers");

assertMatches(contextHelperPath, /key:\s*metric\.key[\s\S]{0,120}label:\s*metric\.label/, "Metric highlights must remain compact factual metric records");
assertIncludes(contextHelperPath, "recommendedActions", "Lens readout context must carry recommended actions including missing snapshot sync");
assertIncludes(readoutHelperPath, 'key: "ga4_snapshot_missing"', "Missing snapshot must be represented in readout");
assertIncludes(readoutHelperPath, "recommendedActions: input.diagnosticsPack.recommendedNextActions", "Readout must flow diagnostics recommended actions into context");
assertIncludes(diagnosticsPackPath, 'key: "sync_ga4_metrics"', "Missing snapshot must recommend syncing GA4 metrics");

assertMatches(metricsPackPath, /key:\s*"ga4\.active_users"[\s\S]{0,260}label:\s*"Active Users"[\s\S]{0,260}semanticRole:\s*"audience"/, "activeUsers must remain Active Users / audience");
assertExcludes(metricsPackPath, /key:\s*"ga4\.active_users"[\s\S]{0,220}semanticRole:\s*"activation"|key:\s*"activation\.activated_users"[\s\S]{0,260}sourceMetric:\s*"activeUsers"/, "activeUsers must not be treated as Activated Users / activation");
assertMatches(metricsPackPath, /key:\s*"ga4\.engagement_rate"[\s\S]{0,260}label:\s*"Engagement Rate"[\s\S]{0,260}semanticRole:\s*"engagement"/, "engagementRate must remain Engagement Rate / engagement");
assertExcludes(metricsPackPath, /key:\s*"ga4\.engagement_rate"[\s\S]{0,260}semanticRole:\s*"activation"|key:\s*"activation\.activation_rate"[\s\S]{0,260}sourceMetric:\s*"engagementRate"/, "engagementRate must not be treated as Activation Rate / activation");

for (const file of [contextHelperPath, mapperPath, chatV11Path]) {
  assertExcludes(file, forbiddenMetricFetchPattern, `${file} must not call GA4 Data API metric fetch`);
  assertExcludes(file, forbiddenRealtimePattern, `${file} must not call GA4 realtime metrics`);
  assertExcludes(file, forbiddenNewProductLlmPattern, `${file} must not add Product-side LLM calls`);
  assertExcludes(file, /\/agents\/lens|hermes[-_ ]?lens/i, `${file} must not call Hermes Lens`);
  assertExcludes(file, /\/api\/cmo\/vault|\/agents\/vault-agent/i, `${file} must not call Vault routes`);
  assertExcludes(file, /\b(access_token|refresh_token|encrypted_refresh_token)\b/i, `${file} must not expose token fields`);
  assertExcludes(file, /\b(importGBrain|syncGBrain|embedGBrain|dreamGBrain|extractGBrain|queryGBrain|callGBrain)\b/, `${file} must not call GBrain`);
}

assertExcludes(contextHelperPath, /\b(importGBrain|syncGBrain|embedGBrain|dreamGBrain|extractGBrain|queryGBrain|callGBrain)\b/, "Lens readout context helper must not call GBrain");

for (const file of [chatStorePath]) {
  assertExcludes(file, forbiddenMetricFetchPattern, `${file} integration must not call GA4 Data API metric fetch`);
  assertExcludes(file, forbiddenRealtimePattern, `${file} integration must not call GA4 realtime metrics`);
  assertExcludes(file, /\/agents\/lens|hermes[-_ ]?lens/i, `${file} must not call Hermes Lens`);
  assertExcludes(file, /\b(access_token|refresh_token|encrypted_refresh_token)\b/i, `${file} must not expose token fields`);
}

execFileSync(process.execPath, [repoPath("scripts", "cmo-lens-readout-check.mjs")], {
  cwd: root,
  stdio: "pipe",
  env: process.env,
});

console.log("CMO Lens CMO readout integration check passed.");
