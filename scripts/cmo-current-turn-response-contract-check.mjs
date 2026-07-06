import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();

function repoPath(...segments) {
  return path.join(root, ...segments);
}

function source(relativePath) {
  return fs.readFileSync(repoPath(relativePath), "utf8");
}

function assertFileExists(relativePath) {
  assert.ok(fs.existsSync(repoPath(relativePath)), `${relativePath} is missing`);
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

async function transpileTsModule(sourcePath, outputPath) {
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText
    .replace(/require\("server-only"\);?\n?/g, "");

  await writeFile(outputPath, output, "utf8");
}

async function loadContractHarness() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-current-turn-contract-"));
  const contractOut = path.join(tmpDir, "current-turn-response-contract.js");

  await transpileTsModule(repoPath("src", "lib", "cmo", "current-turn-response-contract.ts"), contractOut);

  return {
    tmpDir,
    contract: createRequire(contractOut)(contractOut),
  };
}

function assertContractPlacement(relativePath, label) {
  assertIncludes(relativePath, "createCurrentTurnResponseContract()", `${label} must construct the generic current-turn contract`);
  assertIncludes(relativePath, "CURRENT_TURN_RESPONSE_INSTRUCTION", `${label} must include the high-priority current-turn instruction`);
  assertMatches(
    relativePath,
    /intent:\s*\{[\s\S]{0,180}user_message:\s*input\.message,[\s\S]{0,240}latest_user_message_primacy:\s*LATEST_USER_MESSAGE_PRIMACY_RULE,[\s\S]{0,240}current_turn_instruction:\s*CURRENT_TURN_RESPONSE_INSTRUCTION,[\s\S]{0,240}current_turn_response_contract:\s*currentTurnResponseContract/,
    `${label} must attach current_turn_response_contract directly near intent.user_message`,
  );
}

const contractPath = "src/lib/cmo/current-turn-response-contract.ts";
const mapperPath = "src/lib/cmo/hermes-cmo-chat-mapper.ts";
const v11Path = "src/lib/cmo/hermes-cmo-chat-v11.ts";
const firstPath = "src/lib/cmo/hermes-first-cmo-chat.ts";
const runnerCheckPath = "scripts/cmo-lens-measurement-runner-check.mjs";
const appStorePath = "src/lib/cmo/app-chat-store.ts";
const runtimePath = "src/lib/cmo/hermes-cmo-runtime.ts";
const sanitizerPath = "src/lib/cmo/hermes-outbound-payload-sanitizer.ts";

for (const file of [contractPath, mapperPath, v11Path, firstPath, runnerCheckPath, appStorePath, runtimePath, sanitizerPath]) {
  assertFileExists(file);
}

assertContractPlacement(mapperPath, "Legacy Hermes mapper");
assertContractPlacement(v11Path, "Hermes chat v1.1");
assertContractPlacement(firstPath, "Hermes-first");
assertMatches(
  firstPath,
  /fallbackCurrentTurnResponseContract[\s\S]*?intent:\s*\{[\s\S]{0,180}user_message:\s*input\.message,[\s\S]{0,320}current_turn_response_contract:\s*fallbackCurrentTurnResponseContract/,
  "Hermes-first fallback request must preserve the current-turn contract",
);

assertIncludes(contractPath, 'CURRENT_TURN_RESPONSE_CONTRACT_SCHEMA = "cmo.current_turn_response_contract.v1"', "Contract schema must be stable");
assertIncludes(contractPath, 'source: "latest_user_message"', "Contract source must be latest_user_message");
assertIncludes(contractPath, 'interpretation_owner: "hermes_cmo"', "Hermes CMO must own interpretation");
assertIncludes(contractPath, 'semantic_task_inference: "infer_from_latest_user_message"', "Contract must require semantic task inference from latest user message");
assertIncludes(contractPath, "must_answer_latest_user_message: true", "Contract must require answering the latest user message");
assertIncludes(contractPath, "latest_user_message_is_deliverable_authority: true", "Latest user message must own deliverable authority");
assertIncludes(contractPath, 'context_role: "enrich_only"', "Context role must be enrich_only");
assertIncludes(contractPath, 'history_role: "background_only"', "History role must be background_only");
assertIncludes(contractPath, 'session_summary_role: "background_only"', "Session summary role must be background_only");
assertIncludes(contractPath, 'if_latest_message_requests_new_deliverable: "latest_user_message_wins"', "Latest user message must win new-deliverable conflicts");
assertIncludes(contractPath, "previous_topic_must_not_replace_current_deliverable: true", "Previous topic must not replace current deliverable");
assertIncludes(contractPath, "lens_or_metric_context_must_not_replace_non_metric_deliverable: true", "Lens/metric context must not replace non-metric deliverables");
assertIncludes(contractPath, "infer_requested_output_type_semantically: true", "Hermes must infer requested output type semantically");
assertIncludes(contractPath, "honor_explicit_count_if_present: true", "Hermes must honor explicit counts when present");
assertIncludes(contractPath, "return_user_visible_artifact_when_requested: true", "Hermes must return user-visible artifacts when requested");
assertIncludes(contractPath, "ask_clarification_only_if_blocked: true", "Hermes must ask clarification only if blocked");
assertIncludes(contractPath, "no_publish_without_explicit_execution_approval: true", "Publish must require explicit execution approval");
assertIncludes(contractPath, "no_vault_write_without_explicit_save_approval: true", "Vault writes must require explicit save approval");
assertIncludes(contractPath, "no_paid_generation_without_explicit_approval: true", "Paid generation must require explicit approval");
assertIncludes(contractPath, "Lens or metric context", "Instruction must mention Lens/metric context cannot own the turn");

for (const file of [contractPath, mapperPath, v11Path, firstPath]) {
  assertExcludes(
    file,
    /drafting verbs|bai social|social post|caption|content_drafting|required_count/i,
    `${file} must not contain Product-side current-turn task hardcodes`,
  );
}

assertIncludes(
  runnerCheckPath,
  'runner.shouldRunLensMeasurementForMessage("Viết giúp 3 bài social để tăng awareness tuần này"), false',
  "Regression must keep the second-turn content request non-Lens",
);
assertIncludes(
  runnerCheckPath,
  'runner.shouldRunLensMeasurementForMessage("tuần này muốn tăng traffic social"), true',
  "Regression must keep the traffic metric turn Lens-eligible",
);
assertExcludes(appStorePath, /source_agent:\s*["']lens["']|sourceAgent:\s*["']lens["']/i, "Product must not create fake Lens activity");
assertExcludes(runtimePath, /"lens"\s*\||allowedAgents[\s\S]{0,120}"lens"/, "Lens must not be added as executable runtime delegation agent");
assertIncludes(sanitizerPath, "sanitizeOutboundHermesPayload", "Sanitizer path should remain present and unchanged by this check");

const { tmpDir, contract } = await loadContractHarness();

try {
  const value = contract.createCurrentTurnResponseContract();

  assert.deepEqual(value, {
    schema_version: "cmo.current_turn_response_contract.v1",
    source: "latest_user_message",
    interpretation_owner: "hermes_cmo",
    semantic_task_inference: "infer_from_latest_user_message",
    must_answer_latest_user_message: true,
    latest_user_message_is_deliverable_authority: true,
    context_role: "enrich_only",
    history_role: "background_only",
    session_summary_role: "background_only",
    conflict_resolution: {
      if_latest_message_requests_new_deliverable: "latest_user_message_wins",
      previous_topic_must_not_replace_current_deliverable: true,
      lens_or_metric_context_must_not_replace_non_metric_deliverable: true,
    },
    deliverable_policy: {
      infer_requested_output_type_semantically: true,
      honor_explicit_count_if_present: true,
      return_user_visible_artifact_when_requested: true,
      ask_clarification_only_if_blocked: true,
    },
    side_effect_policy: {
      no_publish_without_explicit_execution_approval: true,
      no_vault_write_without_explicit_save_approval: true,
      no_paid_generation_without_explicit_approval: true,
    },
  });
  assert.match(contract.CURRENT_TURN_RESPONSE_INSTRUCTION, /Infer the requested output semantically from intent\.user_message/);
  assert.match(contract.CURRENT_TURN_RESPONSE_INSTRUCTION, /return the user-visible deliverable requested by the latest user message/);
  assert.match(contract.CURRENT_TURN_RESPONSE_INSTRUCTION, /Lens or metric context/);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log("CMO current-turn response contract check passed.");
