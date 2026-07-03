import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function repoPath(...segments) {
  return path.join(root, ...segments);
}

function source(relativePath) {
  return fs.readFileSync(repoPath(relativePath), "utf8");
}

function assertFileExists(relativePath, message) {
  assert.ok(fs.existsSync(repoPath(relativePath)), message);
}

function assertIncludes(relativePath, expected, message) {
  assert.ok(source(relativePath).includes(expected), message);
}

function assertMatches(relativePath, pattern, message) {
  assert.match(source(relativePath), pattern, message);
}

function assertExcludes(relativePath, pattern, message) {
  assert.doesNotMatch(source(relativePath), pattern, message);
}

function sourceSection(relativePath, startNeedle, endNeedle) {
  const text = source(relativePath);
  const start = text.indexOf(startNeedle);
  assert.ok(start >= 0, `${relativePath} missing section start: ${startNeedle}`);
  const end = text.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, `${relativePath} missing section end: ${endNeedle}`);

  return text.slice(start, end);
}

const appStorePath = "src/lib/cmo/app-chat-store.ts";
const typesPath = "src/lib/cmo/app-workspace-types.ts";
const runnerPath = "src/lib/cmo/lens-measurement-runner.ts";
const resultPath = "src/lib/cmo/lens-measurement-result.ts";
const mapperPath = "src/lib/cmo/hermes-cmo-chat-mapper.ts";
const firstPath = "src/lib/cmo/hermes-first-cmo-chat.ts";
const v11Path = "src/lib/cmo/hermes-cmo-chat-v11.ts";
const runtimePath = "src/lib/cmo/hermes-cmo-runtime.ts";
const outboundSanitizerPath = "src/lib/cmo/hermes-outbound-payload-sanitizer.ts";
const runnerCheckPath = "scripts/cmo-lens-measurement-runner-check.mjs";

for (const file of [appStorePath, typesPath, runnerPath, resultPath, mapperPath, firstPath, v11Path, runtimePath, outboundSanitizerPath, runnerCheckPath]) {
  assertFileExists(file, `${file} is missing`);
}

function assertLatestUserMessagePrimacyUse(relativePath, message) {
  const text = source(relativePath);
  assertIncludes(relativePath, "LATEST_USER_MESSAGE_PRIMACY_RULE", `${message}: missing stable primacy rule constant/use`);
  assert.ok(
    /context_grounding_rules:\s*\[[\s\S]{0,180}LATEST_USER_MESSAGE_PRIMACY_RULE/.test(text) ||
      (
        /const contextGroundingRules\s*=\s*\[[\s\S]{0,180}LATEST_USER_MESSAGE_PRIMACY_RULE/.test(text) &&
        /context_grounding_rules:\s*contextGroundingRules/.test(text)
      ),
    `${message}: primacy rule must be sent in context_grounding_rules`,
  );
}

function assertLatestUserMessagePrimacyDefinition(relativePath, message) {
  const text = source(relativePath);
  assertLatestUserMessagePrimacyUse(relativePath, message);
  assert.ok(
    text.includes("intent.user_message") &&
      text.includes("Conversation history") &&
      text.includes("prior assistant messages") &&
      text.includes("latest user explicitly asks to continue") &&
      text.includes("drafts, posts, copy, scripts, or content") &&
      text.includes("requested content/drafts instead of measurement advice"),
    `${message}: primacy rule must make latest intent.user_message source of truth and protect content drafting turns`,
  );
}

assertLatestUserMessagePrimacyDefinition(mapperPath, "Legacy Hermes mapper");
assertLatestUserMessagePrimacyDefinition(firstPath, "Hermes-first request");
assertLatestUserMessagePrimacyUse(v11Path, "Hermes v1.1 request");
assertIncludes(
  runnerCheckPath,
  'runner.shouldRunLensMeasurementForMessage("Viết giúp 3 bài social để tăng awareness tuần này"), false',
  "Generic social drafting prompt must stay a non-Lens turn after metric history",
);
assertIncludes(
  runnerCheckPath,
  'runner.shouldRunLensMeasurementForMessage("tuần này muốn tăng traffic social"), true',
  "Goal/measurement traffic prompt must still trigger Lens",
);

assertIncludes(runnerPath, "export function shouldRunLensMeasurementForMessage", "Runner must expose conservative measurement detector");
assertIncludes(runnerPath, '"conversion"', "Metric intent must support conversion");
assertIncludes(runnerPath, '"retention"', "Metric intent must support retention");
assertMatches(runnerPath, /tang\)\s*\\s\+\(\?:\\w\+\\s\+\)\{0,3\}traffic|increase\|grow\|growth\|tang/, "Detector must support obvious Vietnamese traffic growth intent");
assertIncludes(runnerPath, "so lieu", "Detector must support Vietnamese measurement wording");
assertIncludes(runnerPath, "activation", "Detector must support activation metric intent");

assertIncludes(appStorePath, "shouldRunLensMeasurementForMessage", "Product app chat must use Lens measurement detector");
assertIncludes(appStorePath, "runLensMeasurementRequest", "Product app chat must call Lens measurement runner");
assertMatches(
  appStorePath,
  /shouldRunLensMeasurementForMessage\(request\.message\)[\s\S]{0,220}runLensMeasurementRequest\(\{[\s\S]{0,260}tenantId:\s*request\.tenantId[\s\S]{0,180}workspaceId:\s*request\.workspaceId[\s\S]{0,180}appId:\s*request\.appId[\s\S]{0,180}rangeKey:\s*request\.rangeKey\s*\?\?\s*"last_7_days"[\s\S]{0,180}metricIntent:\s*request\.message/,
  "Product app chat must call runner only for detected measurement turns with request identity",
);
assertIncludes(appStorePath, "lensMeasurementResult ? { lensMeasurementResult }", "Product app chat must attach/persist lensMeasurementResult");
assertIncludes(appStorePath, "normalizeLensMeasurementResult", "Persisted sessions must normalize LensMeasurementResult");

assertIncludes(typesPath, "lensMeasurementResult?: LensMeasurementResult", "Types must allow lensMeasurementResult on context/message/session/response");
assertMatches(typesPath, /export interface CMOContextPackage[\s\S]*?lensMeasurementResult\?: LensMeasurementResult[\s\S]*?contextQualitySummary/, "Context package must carry LensMeasurementResult");
assertMatches(typesPath, /export interface CMOChatMessage[\s\S]*?lensMeasurementResult\?: LensMeasurementResult[\s\S]*?strategyMode/, "Assistant messages must persist LensMeasurementResult");
assertMatches(typesPath, /export interface CMOChatSession[\s\S]*?lensMeasurementResult\?: LensMeasurementResult[\s\S]*?strategyMode/, "Session must persist LensMeasurementResult");
assertMatches(typesPath, /export interface CMOAppChatResponse[\s\S]*?lensMeasurementResult\?: LensMeasurementResult[\s\S]*?strategyMode/, "API response must expose LensMeasurementResult");

assertIncludes(resultPath, "export function compactLensMeasurementResultForHermesContext", "Lens result contract must expose outbound-safe compaction helper");
assertIncludes(resultPath, 'contract: "lens.metrics_summary.v1"', "Completed Lens results must use compact metrics summary for Hermes context");
assertIncludes(resultPath, "metrics_summary", "Outbound-safe Lens result must use metrics_summary instead of full metrics_pack");
assertExcludes(resultPath, /metrics_summary[\s\S]{0,2200}\b(propertyId|propertyDisplayName|accountDisplayName|snapshotId|sources)\b/, "Outbound metrics summary must not include GA4 property/account/snapshot/source fields");
assertIncludes(mapperPath, "compactLensMeasurementResultForHermesContext", "Legacy mapper must compact LensMeasurementResult before outbound serialization");
assertIncludes(mapperPath, "lensMeasurementResultArtifact", "Legacy mapper must wrap compact LensMeasurementResult as a request artifact");
assertIncludes(mapperPath, "lens_measurement_result: lensMeasurementResult", "Legacy mapper must attach compact context_pack.lens_measurement_result");
assertIncludes(mapperPath, "LENS_MEASUREMENT_GROUNDING_RULE", "Legacy mapper must add grounding rule for Lens result");
assertMatches(mapperPath, /artifacts_in:[\s\S]{0,260}lensMeasurementArtifact/, "Legacy artifacts_in must include Lens measurement artifact");
assertExcludes(mapperPath, /lens_measurement_result:\s*input\.contextPackage\.lensMeasurementResult|result:\s*input\.contextPackage\.lensMeasurementResult|result:\s*safeRecord\(input\.contextPackage\.lensMeasurementResult/i, "Legacy mapper must not serialize raw LensMeasurementResult");

assertIncludes(firstPath, "lens_measurement_result", "Hermes-first request must carry Lens measurement result");
assertIncludes(firstPath, "cmo.lens_measurement_result_ref.v1", "Hermes-first artifacts must include Lens measurement result ref");
assertIncludes(firstPath, "LENS_MEASUREMENT_GROUNDING_RULE", "Hermes-first request must include measurement grounding rule");
assertIncludes(firstPath, "compactLensMeasurementResultForHermesContext", "Hermes-first request must compact LensMeasurementResult before outbound serialization");
assertExcludes(firstPath, /lens_measurement_result:\s*input\.contextPackage\.lensMeasurementResult|result:\s*input\.contextPackage\.lensMeasurementResult|result:\s*safeRecord\(input\.contextPackage\.lensMeasurementResult/i, "Hermes-first path must not serialize raw LensMeasurementResult");

assertIncludes(v11Path, "lens_measurement_result", "Hermes v1.1 request must carry Lens measurement result");
assertIncludes(v11Path, "hasLensMeasurementArtifact", "Hermes v1.1 request must detect Lens measurement artifact");
assertIncludes(v11Path, "LENS_MEASUREMENT_GROUNDING_RULE", "Hermes v1.1 request must include measurement grounding rule");
assertIncludes(v11Path, "compactLensMeasurementResultForHermesContext", "Hermes v1.1 request must compact LensMeasurementResult before outbound serialization");
assertExcludes(v11Path, /lens_measurement_result:\s*input\.contextPackage\.lensMeasurementResult|result:\s*input\.contextPackage\.lensMeasurementResult/i, "Hermes v1.1 path must not serialize raw LensMeasurementResult");

assertExcludes(appStorePath, /answer\s*=\s*[^;\n]*(lensMeasurementResult|lens_measurement_result|safe_user_message|metrics_pack)/i, "Product must not replace CMO answer with Lens measurement result");
assertExcludes(mapperPath, /answer\s*=\s*[^;\n]*(lensMeasurementResult|lens_measurement_result|safe_user_message|metrics_pack)/i, "Mapper must not create canned metric answers");
assertExcludes(appStorePath, /source_agent:\s*["']lens["']|sourceAgent:\s*["']lens["']/i, "Product must not create fake Lens activity rows");
assertExcludes(appStorePath, /createProductChatRunLifecycleEvent\([\s\S]{0,320}(?:lensMeasurementResult|lens_measurement_result|source_agent:\s*["']lens["']|sourceAgent:\s*["']lens["'])/i, "Product must not create Lens lifecycle activity events for measurement context");
assertExcludes(mapperPath, /source_agent:\s*["']lens["']|sourceAgent:\s*["']lens["']/i, "Mapper must not create fake Lens activity rows");
assertExcludes(firstPath, /source_agent:\s*["']lens["']|sourceAgent:\s*["']lens["']/i, "Hermes-first path must not create fake Lens activity rows");
assertExcludes(v11Path, /source_agent:\s*["']lens["']|sourceAgent:\s*["']lens["']/i, "Hermes v1.1 path must not create fake Lens activity rows");
assertExcludes(runtimePath, /"lens"\s*\||allowedAgents[\s\S]{0,120}"lens"/, "Lens must not be added as executable runtime delegation agent");
assertExcludes(runnerPath, /getLensReadoutContextForAppSafe|lens-readout-context|lensReadoutContext/i, "Lens measurement runner must not depend on Product readout prefetch");
assertExcludes(appStorePath, /runLensMeasurementRequest\(\{[\s\S]{0,420}lensReadoutContext/i, "Product app chat must not feed Product readout prefetch into Lens measurement runner");
assert.doesNotMatch(sourceSection(firstPath, "function buildSafeHistory", "function sessionSummaryRecord"), /lensMeasurementResult|lens_measurement_result|metrics_pack/i, "Hermes-first history must not serialize previous Lens measurement payloads");
assert.doesNotMatch(sourceSection(v11Path, "function sanitizedMessages", "function stringListFromUnknown"), /lensMeasurementResult|lens_measurement_result|metrics_pack/i, "Hermes v1.1 history must not serialize previous Lens measurement payloads");
assert.doesNotMatch(sourceSection(mapperPath, "function replayableChatHistory", "function recentSessionSummary"), /lensMeasurementResult|lens_measurement_result|metrics_pack/i, "Legacy Hermes history must not serialize previous Lens measurement payloads");
assertIncludes(outboundSanitizerPath, "export function sanitizeOutboundHermesContextText", "Outbound sanitizer must expose targeted context text redaction");
assertIncludes(outboundSanitizerPath, "OUTBOUND_HERMES_LOCAL_PATH_REDACTION", "Outbound sanitizer must use stable local path redaction marker");
assertIncludes(outboundSanitizerPath, "tmp|Users|home|var|mnt|private|Volumes", "Outbound sanitizer must keep these local path roots guarded");
assertIncludes(outboundSanitizerPath, ".replace(/file:", "Outbound sanitizer must redact file URLs");
assertIncludes(outboundSanitizerPath, ".replace(/[A-Za-z]:", "Outbound sanitizer must redact absolute Windows paths");
assertIncludes(outboundSanitizerPath, "creative-agent-images|cmo-creative-execute|conversion_h_|Creative_image_asset_Refine", "Outbound sanitizer must redact known local artifact literals");
assertIncludes(outboundSanitizerPath, "sanitizeOutboundHermesContextText(value)", "Outbound sanitizer must run targeted context redaction before final guard replacement");
assertExcludes(outboundSanitizerPath, /12 Knowledge|13 Sources|Apps\/Holdstation Mini App/, "Outbound sanitizer must not target logical Vault/project paths");
assert.doesNotMatch(sourceSection(outboundSanitizerPath, "const sanitizedSnippetAroundLiteral", "const collectCallsiteBlockedStringFields"), /file:\[local_path_redacted\]|\/(?:tmp|Users|home|var|mnt|private|Volumes)\/\[local_path_redacted\]/, "Outbound diagnostics snippets must not preserve forbidden local path prefixes");

assertExcludes(runnerPath, /\b(access_token|refresh_token|encrypted_refresh_token|authorization|headers|cookie|rawGa4Response|raw_ga4_response|answer_body|prompt)\b/i, "Runner must not expose secrets/raw GA4/prompt/answer in Lens measurement path");
assert.doesNotMatch(sourceSection(resultPath, "function safeMetricsSummary", "export function compactLensMeasurementResultForHermesContext"), /\b(access_token|refresh_token|encrypted_refresh_token|authorization|headers|cookie|rawGa4Response|raw_ga4_response|answer_body|prompt|local_path|file_path)\b/i, "Outbound metrics summary must not expose secrets/raw GA4/prompt/answer/local paths");
assertExcludes(mapperPath, /lens_measurement_result[\s\S]{0,260}\b(access_token|refresh_token|encrypted_refresh_token|authorization|headers|cookie|rawGa4Response|raw_ga4_response|answer_body|prompt)\b/i, "Mapper Lens measurement path must not expose secrets/raw GA4/prompt/answer");
assertExcludes(firstPath, /lens_measurement_result[\s\S]{0,260}\b(access_token|refresh_token|encrypted_refresh_token|authorization|headers|cookie|rawGa4Response|raw_ga4_response|answer_body|prompt)\b/i, "Hermes-first Lens measurement path must not expose secrets/raw GA4/prompt/answer");
assertExcludes(v11Path, /lens_measurement_result[\s\S]{0,260}\b(access_token|refresh_token|encrypted_refresh_token|authorization|headers|cookie|rawGa4Response|raw_ga4_response|answer_body|prompt)\b/i, "Hermes v1.1 Lens measurement path must not expose secrets/raw GA4/prompt/answer");

console.log("CMO Lens CMO consumption check passed.");
