import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const h3ExamplesDir = path.join(rootDir, "docs", "hermes-cmo", "examples", "h3-dry-run");
const schemasDir = path.join(rootDir, "docs", "hermes-cmo", "schemas");
const dryRunSourceDir = path.join(rootDir, "src", "lib", "hermes-cmo", "dry-run");

const expectedCases = [
  "strategy_only",
  "needs_clarification",
  "assumption_based_strategy",
  "needs_surf",
  "needs_echo",
  "needs_surf_then_echo",
  "needs_vault_agent",
  "mixed_workflow",
];

const expectedDelegationTargets = new Map([
  ["strategy_only", []],
  ["needs_clarification", []],
  ["assumption_based_strategy", []],
  ["needs_surf", ["surf"]],
  ["needs_echo", ["echo"]],
  ["needs_surf_then_echo", ["surf", "echo"]],
  ["needs_vault_agent", ["vault_agent"]],
  ["mixed_workflow", ["surf", "echo", "vault_agent"]],
]);

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

const listFilesRecursive = async (dir, suffixes) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath, suffixes)));
      continue;
    }

    if (entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix))) {
      files.push(fullPath);
    }
  }

  return files.sort();
};

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const deepEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const matchesType = (value, type) => {
  switch (type) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
};

const typeName = (value) => {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  return typeof value;
};

const validateSchemaValue = (value, schema, label, errors) => {
  if (!isPlainObject(schema)) {
    return;
  }

  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((subschema, index) => validateSchemaValue(value, subschema, `${label}.allOf[${index}]`, errors));
  }

  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf.filter((subschema) => {
      const nestedErrors = [];
      validateSchemaValue(value, subschema, label, nestedErrors);
      return nestedErrors.length === 0;
    });

    if (matches.length === 0) {
      errors.push(`${label} must match at least one anyOf schema`);
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((subschema) => {
      const nestedErrors = [];
      validateSchemaValue(value, subschema, label, nestedErrors);
      return nestedErrors.length === 0;
    });

    if (matches.length !== 1) {
      errors.push(`${label} must match exactly one oneOf schema; matched ${matches.length}`);
    }
  }

  if (isPlainObject(schema.not)) {
    const nestedErrors = [];
    validateSchemaValue(value, schema.not, label, nestedErrors);

    if (nestedErrors.length === 0) {
      errors.push(`${label} must not match prohibited schema`);
    }
  }

  if (isPlainObject(schema.if)) {
    const nestedErrors = [];
    validateSchemaValue(value, schema.if, label, nestedErrors);

    if (nestedErrors.length === 0 && isPlainObject(schema.then)) {
      validateSchemaValue(value, schema.then, label, errors);
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, "const") && !deepEqual(value, schema.const)) {
    errors.push(`${label} must equal ${JSON.stringify(schema.const)}`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(value, candidate))) {
    errors.push(`${label} must be one of ${schema.enum.map((candidate) => JSON.stringify(candidate)).join(", ")}`);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const validType = types.some((type) => matchesType(value, type));

    if (!validType) {
      errors.push(`${label} must be ${types.join(" or ")}, got ${typeName(value)}`);
      return;
    }
  }

  if (isPlainObject(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          errors.push(`${label}.${key} is required`);
        }
      }
    }

    if (isPlainObject(schema.properties)) {
      for (const [key, subschema] of Object.entries(schema.properties)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          validateSchemaValue(value[key], subschema, `${label}.${key}`, errors);
        }
      }
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      errors.push(`${label} must contain at least ${schema.minItems} items`);
    }

    if (schema.uniqueItems === true) {
      const serialized = value.map((item) => JSON.stringify(item));
      assert.equal(new Set(serialized).size, serialized.length, `${label} must contain unique items`);
    }

    if (isPlainObject(schema.items)) {
      value.forEach((item, index) => validateSchemaValue(item, schema.items, `${label}[${index}]`, errors));
    }
  }

  if (typeof value === "string") {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      errors.push(`${label} must have length >= ${schema.minLength}`);
    }

    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      errors.push(`${label} must be a valid date-time`);
    }
  }

  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
    errors.push(`${label} must be >= ${schema.minimum}`);
  }
};

const validateAgainstSchema = (value, schema, label) => {
  const errors = [];
  validateSchemaValue(value, schema, label, errors);
  assert.deepEqual(errors, [], `${label} schema validation failed:\n${errors.join("\n")}`);
};

const compileDryRunSources = async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "hermes-cmo-h3-"));
  const tscPath = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
  const sourceFiles = await listFilesRecursive(dryRunSourceDir, [".ts"]);

  try {
    execFileSync(
      process.execPath,
      [
        tscPath,
        "--target",
        "ES2022",
        "--module",
        "CommonJS",
        "--moduleResolution",
        "Node",
        "--strict",
        "--skipLibCheck",
        "--esModuleInterop",
        "--noEmitOnError",
        "true",
        "--rootDir",
        dryRunSourceDir,
        "--outDir",
        tmpDir,
        ...sourceFiles,
      ],
      {
        cwd: rootDir,
        stdio: "pipe",
      },
    );
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    throw new Error(`Failed to compile H3 dry-run sources:\n${stdout}\n${stderr}`);
  }

  return {
    tmpDir,
    runnerPath: path.join(tmpDir, "dry-run-runner.js"),
  };
};

const importPathsFromSource = (source) => {
  const imports = [];
  const importRegex =
    /(?:import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\))/g;
  let match = importRegex.exec(source);

  while (match) {
    imports.push(match[1] ?? match[2] ?? match[3]);
    match = importRegex.exec(source);
  }

  return imports;
};

const assertNoForbiddenDryRunImports = async () => {
  const sourceFiles = await listFilesRecursive(dryRunSourceDir, [".ts"]);
  const forbiddenImports = [
    { label: "live runtime", pattern: /(^|[/\\])runtime($|[./\\])|remote-client|hermes-client/i },
    { label: "OpenClaw client", pattern: /openclaw/i },
    { label: "Supabase", pattern: /supabase/i },
    { label: "Vault writer", pattern: /vault-capture-writer|vault-files|vault-auto-capture/i },
    { label: "session or raw capture writer", pattern: /app-chat-store|session|raw-capture|store/i },
    { label: "Kanban", pattern: /kanban|pipeline/i },
  ];

  for (const filePath of sourceFiles) {
    const source = await readFile(filePath, "utf8");
    const imports = importPathsFromSource(source);

    for (const importPath of imports) {
      for (const forbidden of forbiddenImports) {
        assert.equal(
          forbidden.pattern.test(importPath),
          false,
          `${path.relative(rootDir, filePath)} imports ${forbidden.label}: ${importPath}`,
        );
      }
    }
  }

  return sourceFiles.length;
};

const assertNoProductionDryRunWiring = async () => {
  const srcDir = path.join(rootDir, "src");
  const sourceFiles = (await listFilesRecursive(srcDir, [".ts", ".tsx"])).filter(
    (filePath) => !filePath.startsWith(dryRunSourceDir),
  );

  for (const filePath of sourceFiles) {
    const source = await readFile(filePath, "utf8");
    const imports = importPathsFromSource(source);
    const dryRunImports = imports.filter((importPath) => importPath.includes("hermes-cmo/dry-run"));

    assert.deepEqual(
      dryRunImports,
      [],
      `${path.relative(rootDir, filePath)} wires H3 dry-run into production source: ${dryRunImports.join(", ")}`,
    );
  }

  return sourceFiles.length;
};

const assertDelegationsAreSimulatedOnly = (result, fileName, delegationSchema) => {
  const expectedTargets = expectedDelegationTargets.get(result.classification.case_id);
  const actualTargets = result.response.delegations.map((delegation) => delegation.target.agent);

  assert.deepEqual(actualTargets, expectedTargets, `${fileName} delegation targets mismatch`);
  assert.equal(result.classification.simulated_only, true, `${fileName} classification must be simulation-only`);

  for (const delegation of result.response.delegations) {
    validateAgainstSchema(delegation, delegationSchema, `${fileName} ${delegation.delegation_id}`);
    assert.equal(delegation.simulation?.dry_run_only, true, `${fileName} delegation must be dry-run only`);
    assert.equal(delegation.simulation?.live_call_performed, false, `${fileName} delegation must not perform live call`);
    assert.equal(delegation.simulation?.no_vault_write, true, `${fileName} delegation must not write Vault`);
    assert.equal(delegation.simulation?.no_runtime_mutation, true, `${fileName} delegation must not mutate runtime state`);
  }
};

const assertActivityDelegationEventsAreSimulated = (result, fileName) => {
  const delegationEvents = result.activity_events.filter(
    (event) => event.type.includes("delegation") || Object.prototype.hasOwnProperty.call(event.data, "delegation_id"),
  );

  for (const event of delegationEvents) {
    assert.equal(event.data?.simulation?.dry_run_only, true, `${fileName} ${event.event_id} must be marked dry-run`);
    assert.equal(
      event.data?.simulation?.live_call_performed,
      false,
      `${fileName} ${event.event_id} must not represent a live call`,
    );
  }
};

try {
  const [requestSchema, responseSchema, activityEventSchema, delegationSchema] = await Promise.all([
    readJson(path.join(schemasDir, "cmo-request.schema.json")),
    readJson(path.join(schemasDir, "cmo-response.schema.json")),
    readJson(path.join(schemasDir, "activity-event.schema.json")),
    readJson(path.join(schemasDir, "delegation.schema.json")),
  ]);

  const requestFiles = await listFiles(h3ExamplesDir, ".json");
  const expectedRequestFiles = expectedCases.map((caseId) => `request.${caseId}.json`).sort();
  assert.deepEqual(requestFiles, expectedRequestFiles, "H3 sample request file set mismatch");

  const dryRunImportScanCount = await assertNoForbiddenDryRunImports();
  const productionSourceScanCount = await assertNoProductionDryRunWiring();
  const { tmpDir, runnerPath } = await compileDryRunSources();
  const requireFromValidator = createRequire(import.meta.url);
  const { runHermesCmoDryRun } = requireFromValidator(runnerPath);

  let responseCount = 0;
  let activityEventCount = 0;
  let delegationCount = 0;
  const classifications = [];

  try {
    for (const fileName of requestFiles) {
      const caseId = fileName.replace(/^request\./, "").replace(/\.json$/, "");
      const request = await readJson(path.join(h3ExamplesDir, fileName));

      validateAgainstSchema(request, requestSchema, fileName);

      const result = runHermesCmoDryRun(request);

      assert.equal(result.boundary, "H3 is dry-run contract harness only, not used by live runtime.", `${fileName} boundary mismatch`);
      assert.equal(result.classification.case_id, caseId, `${fileName} classification mismatch`);
      validateAgainstSchema(result.response, responseSchema, `${fileName} response`);
      assert.equal(
        result.response.activity_summary.events_count,
        result.activity_events.length,
        `${fileName} response activity count mismatch`,
      );

      result.activity_events.forEach((event, index) => {
        validateAgainstSchema(event, activityEventSchema, `${fileName} activity[${index}]`);
      });

      assertDelegationsAreSimulatedOnly(result, fileName, delegationSchema);
      assertActivityDelegationEventsAreSimulated(result, fileName);

      responseCount += 1;
      activityEventCount += result.activity_events.length;
      delegationCount += result.response.delegations.length;
      classifications.push(`${caseId}:${result.classification.case_id}`);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  console.log("Hermes CMO H3 validation passed");
  console.log(`Sample requests parsed: ${requestFiles.length}`);
  console.log(`Input requests schema-valid: ${requestFiles.length}`);
  console.log(`Dry-run responses schema-valid: ${responseCount}`);
  console.log(`Activity events schema-valid: ${activityEventCount}`);
  console.log(`Simulated delegations validated: ${delegationCount}`);
  console.log(`Dry-run source files import-scanned: ${dryRunImportScanCount}`);
  console.log(`Production source files checked for dry-run wiring: ${productionSourceScanCount}`);
  console.log(`Classifications: ${classifications.join(", ")}`);
} catch (error) {
  console.error("Hermes CMO H3 validation failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
