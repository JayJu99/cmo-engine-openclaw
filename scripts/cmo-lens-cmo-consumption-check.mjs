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

const appStorePath = "src/lib/cmo/app-chat-store.ts";
const typesPath = "src/lib/cmo/app-workspace-types.ts";
const runnerPath = "src/lib/cmo/lens-measurement-runner.ts";
const resultPath = "src/lib/cmo/lens-measurement-result.ts";
const mapperPath = "src/lib/cmo/hermes-cmo-chat-mapper.ts";
const firstPath = "src/lib/cmo/hermes-first-cmo-chat.ts";
const v11Path = "src/lib/cmo/hermes-cmo-chat-v11.ts";
const runtimePath = "src/lib/cmo/hermes-cmo-runtime.ts";

for (const file of [appStorePath, typesPath, runnerPath, resultPath, mapperPath, firstPath, v11Path, runtimePath]) {
  assertFileExists(file, `${file} is missing`);
}

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

assertIncludes(mapperPath, "lensMeasurementResultArtifact", "Legacy mapper must wrap LensMeasurementResult as a request artifact");
assertIncludes(mapperPath, "lens_measurement_result: lensMeasurementResult", "Legacy mapper must attach direct context_pack.lens_measurement_result");
assertIncludes(mapperPath, "LENS_MEASUREMENT_GROUNDING_RULE", "Legacy mapper must add grounding rule for Lens result");
assertMatches(mapperPath, /artifacts_in:[\s\S]{0,260}lensMeasurementArtifact/, "Legacy artifacts_in must include Lens measurement artifact");

assertIncludes(firstPath, "lens_measurement_result", "Hermes-first request must carry Lens measurement result");
assertIncludes(firstPath, "cmo.lens_measurement_result_ref.v1", "Hermes-first artifacts must include Lens measurement result ref");
assertIncludes(firstPath, "LENS_MEASUREMENT_GROUNDING_RULE", "Hermes-first request must include measurement grounding rule");

assertIncludes(v11Path, "lens_measurement_result", "Hermes v1.1 request must carry Lens measurement result");
assertIncludes(v11Path, "hasLensMeasurementArtifact", "Hermes v1.1 request must detect Lens measurement artifact");
assertIncludes(v11Path, "LENS_MEASUREMENT_GROUNDING_RULE", "Hermes v1.1 request must include measurement grounding rule");

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

assertExcludes(runnerPath, /\b(access_token|refresh_token|encrypted_refresh_token|authorization|headers|cookie|rawGa4Response|raw_ga4_response|answer_body|prompt)\b/i, "Runner must not expose secrets/raw GA4/prompt/answer in Lens measurement path");
assertExcludes(mapperPath, /lens_measurement_result[\s\S]{0,260}\b(access_token|refresh_token|encrypted_refresh_token|authorization|headers|cookie|rawGa4Response|raw_ga4_response|answer_body|prompt)\b/i, "Mapper Lens measurement path must not expose secrets/raw GA4/prompt/answer");
assertExcludes(firstPath, /lens_measurement_result[\s\S]{0,260}\b(access_token|refresh_token|encrypted_refresh_token|authorization|headers|cookie|rawGa4Response|raw_ga4_response|answer_body|prompt)\b/i, "Hermes-first Lens measurement path must not expose secrets/raw GA4/prompt/answer");
assertExcludes(v11Path, /lens_measurement_result[\s\S]{0,260}\b(access_token|refresh_token|encrypted_refresh_token|authorization|headers|cookie|rawGa4Response|raw_ga4_response|answer_body|prompt)\b/i, "Hermes v1.1 Lens measurement path must not expose secrets/raw GA4/prompt/answer");

console.log("CMO Lens CMO consumption check passed.");
