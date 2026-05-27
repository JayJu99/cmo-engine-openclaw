import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = path.join(rootDir, "docs", "hermes-cmo", "examples");
const schemasDir = path.join(rootDir, "docs", "hermes-cmo", "schemas");

const expectedSchemaVersions = new Map([
  ["activity-event.schema.json", "hermes.activity.event.v1"],
  ["cmo-request.schema.json", "hermes.cmo.request.v1"],
  ["cmo-response.schema.json", "hermes.cmo.response.v1"],
  ["delegation.schema.json", "hermes.delegation.request.v1"],
  ["echo-request.schema.json", "hermes.echo.request.v1"],
  ["surf-request.schema.json", "hermes.surf.request.v1"],
  ["vault-agent-request.schema.json", "hermes.vault_agent.request.v1"],
]);

const allowedAgents = new Set(["echo", "surf", "vault_agent"]);
const allowedSurfModes = new Set(["surf.default", "surf.x", "surf.trend", "surf.pulse"]);
const allowedResponseStatuses = new Set([
  "completed",
  "partial",
  "needs_user_input",
  "delegated",
  "failed",
  "cancelled",
]);
const allowedAnswerBasisModes = new Set(["fully_grounded", "assumption_based", "needs_user_input"]);
const allowedActivityTypes = new Set([
  "run.started",
  "run.heartbeat",
  "stage.started",
  "stage.completed",
  "context.loaded",
  "assumption.notice",
  "clarification.required",
  "clarification.asked",
  "plan.created",
  "delegation.created",
  "delegation.started",
  "delegation.waiting",
  "delegation.completed",
  "artifact.created",
  "memory_suggestion.created",
  "vault_agent.delegation.created",
  "vault_agent.delegation.started",
  "vault_agent.delegation.completed",
  "vault_agent.delegation.failed",
  "run.completed",
  "run.failed",
]);
const allowedActivityStatuses = new Set(["queued", "running", "waiting", "completed", "failed", "cancelled"]);
const allowedActivityAgents = new Set(["cmo", "echo", "surf", "vault_agent"]);

const readJson = async (filePath) => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const listFiles = async (dir, suffix) => {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => entry.name)
    .sort();
};

const assertString = (value, label) => {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must not be empty`);
};

const validateSchemaFiles = async () => {
  const schemaFiles = await listFiles(schemasDir, ".json");
  assert.deepEqual(schemaFiles, [...expectedSchemaVersions.keys()].sort(), "schema file set changed unexpectedly");

  for (const fileName of schemaFiles) {
    const schema = await readJson(path.join(schemasDir, fileName));
    const expectedVersion = expectedSchemaVersions.get(fileName);
    assertString(schema.$schema, `${fileName} $schema`);
    assert.equal(schema.type, "object", `${fileName} should describe an object`);
    assert.equal(
      schema.properties?.schema_version?.const,
      expectedVersion,
      `${fileName} schema_version const should be ${expectedVersion}`,
    );
  }

  return schemaFiles.length;
};

const validateCmoRequest = (example, fileName) => {
  assert.equal(example.schema_version, "hermes.cmo.request.v1", `${fileName} schema_version mismatch`);
  assertString(example.request_id, `${fileName} request_id`);
  assertString(example.session_id, `${fileName} session_id`);
  assertString(example.turn_id, `${fileName} turn_id`);
  assertString(example.intent?.user_message, `${fileName} intent.user_message`);
  assert.equal(example.intent?.mode, "cmo.default", `${fileName} intent.mode must be cmo.default`);
  assert.equal(example.constraints?.no_direct_vault_write, true, `${fileName} must forbid direct Vault writes`);
  assert.equal(example.constraints?.no_direct_memory_mutation, true, `${fileName} must forbid direct memory mutation`);
  assert.equal(
    example.constraints?.vault_agent_requires_save_intent,
    true,
    `${fileName} must require save intent for Vault Agent`,
  );

  for (const agent of example.constraints?.allowed_agents ?? []) {
    assert.ok(allowedAgents.has(agent), `${fileName} has unsupported allowed agent ${agent}`);
  }

  for (const mode of example.constraints?.allowed_surf_modes ?? []) {
    assert.ok(allowedSurfModes.has(mode), `${fileName} has unsupported Surf mode ${mode}`);
  }
};

const validateCmoResponse = (example, fileName) => {
  assert.equal(example.schema_version, "hermes.cmo.response.v1", `${fileName} schema_version mismatch`);
  assertString(example.request_id, `${fileName} request_id`);
  assertString(example.session_id, `${fileName} session_id`);
  assertString(example.turn_id, `${fileName} turn_id`);
  assert.ok(allowedResponseStatuses.has(example.status), `${fileName} has unsupported status ${example.status}`);
  assert.ok(
    allowedAnswerBasisModes.has(example.answer_basis?.mode),
    `${fileName} has unsupported answer_basis.mode ${example.answer_basis?.mode}`,
  );

  if (example.status === "needs_user_input") {
    assert.equal(example.answer, null, `${fileName} needs_user_input response must not include answer`);
    assert.equal(example.structured_output, null, `${fileName} needs_user_input response must not include output`);
    assert.equal(example.clarifying_question?.required, true, `${fileName} must require clarification`);
  }

  if (example.answer_basis?.mode === "assumption_based") {
    assert.ok(example.answer_basis.missing_inputs?.length > 0, `${fileName} must list missing inputs`);
    assert.ok(example.answer_basis.assumptions_used?.length > 0, `${fileName} must list assumptions`);
  }

  assert.equal(Array.isArray(example.delegations), true, `${fileName} delegations must be an array`);
  assert.equal(Array.isArray(example.artifacts), true, `${fileName} artifacts must be an array`);
  assert.equal(Array.isArray(example.memory_suggestions), true, `${fileName} memory_suggestions must be an array`);
};

const validateJsonExamples = async () => {
  const exampleFiles = await listFiles(examplesDir, ".json");

  for (const fileName of exampleFiles) {
    const example = await readJson(path.join(examplesDir, fileName));

    if (fileName.startsWith("request.")) {
      validateCmoRequest(example, fileName);
      continue;
    }

    if (fileName.startsWith("response.")) {
      validateCmoResponse(example, fileName);
      continue;
    }

    throw new Error(`Unexpected JSON example file: ${fileName}`);
  }

  return exampleFiles.length;
};

const validateActivityEvent = (event, fileName, lineNumber) => {
  const label = `${fileName}:${lineNumber}`;
  assert.equal(event.schema_version, "hermes.activity.event.v1", `${label} schema_version mismatch`);
  assertString(event.event_id, `${label} event_id`);
  assertString(event.request_id, `${label} request_id`);
  assertString(event.session_id, `${label} session_id`);
  assertString(event.turn_id, `${label} turn_id`);
  assert.equal(Number.isInteger(event.seq), true, `${label} seq must be an integer`);
  assert.ok(event.seq > 0, `${label} seq must be positive`);
  assert.ok(allowedActivityAgents.has(event.source?.agent), `${label} has unsupported source agent`);
  assert.ok(allowedActivityTypes.has(event.type), `${label} has unsupported activity type ${event.type}`);
  assert.ok(allowedActivityStatuses.has(event.status), `${label} has unsupported status ${event.status}`);
  assert.equal(typeof event.user_visible, "boolean", `${label} user_visible must be boolean`);
  assertString(event.message, `${label} message`);
  assert.equal(typeof event.data, "object", `${label} data must be an object`);
  assert.notEqual(event.data, null, `${label} data must not be null`);
};

const validateActivityStream = async () => {
  const fileName = "activity-stream.jsonl";
  const raw = await readFile(path.join(examplesDir, fileName), "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  assert.ok(lines.length > 0, `${fileName} must contain at least one event`);

  lines.forEach((line, index) => {
    const event = JSON.parse(line);
    validateActivityEvent(event, fileName, index + 1);
  });

  return lines.length;
};

try {
  const schemaCount = await validateSchemaFiles();
  const jsonExampleCount = await validateJsonExamples();
  const activityEventCount = await validateActivityStream();

  console.log("Hermes CMO H2 validation passed");
  console.log(`Schemas parsed: ${schemaCount}`);
  console.log(`JSON examples parsed: ${jsonExampleCount}`);
  console.log(`Activity events parsed: ${activityEventCount}`);
} catch (error) {
  console.error("Hermes CMO H2 validation failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

