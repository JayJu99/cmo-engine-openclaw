import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();

function repoPath(...segments) {
  return path.join(root, ...segments);
}

function source(relativePath) {
  return fs.readFileSync(repoPath(relativePath), "utf8");
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

async function loadMeasurementHelper() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-lens-measurement-contract-"));
  const sourcePath = repoPath("src", "lib", "cmo", "lens-measurement-result.ts");
  const outputPath = path.join(tmpDir, "lens-measurement-result.cjs");
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText;

  await writeFile(outputPath, output, "utf8");

  return {
    tmpDir,
    helper: createRequire(import.meta.url)(outputPath),
  };
}

async function assertMissingCapabilityHelperSanitizes() {
  const { tmpDir, helper } = await loadMeasurementHelper();

  try {
    const capability = helper.createLensCapabilityContext({
      tenantId: "holdstation",
      workspaceId: "holdstation-mini-app",
      appId: "holdstation-mini-app",
    });

    assert.equal(capability.enabled, true);
    assert.equal(capability.scope.tenant_id, "holdstation");
    assert.equal(capability.scope.workspace_id, "holdstation-mini-app");
    assert.equal(capability.scope.app_id, "holdstation-mini-app");
    assert.equal(capability.scope.range_key, "last_7_days");
    assert.deepEqual(capability.contracts, ["lens.metrics_pack.v1", "lens.measurement_result.v1"]);

    const missingTenantCapability = helper.createLensCapabilityContext({
      workspaceId: "workspace-without-tenant",
      appId: "app-without-tenant",
    });
    assert.equal(missingTenantCapability.scope.tenant_id, "workspace-without-tenant");
    assert.equal(missingTenantCapability.scope.workspace_id, "workspace-without-tenant");
    assert.equal(missingTenantCapability.scope.app_id, "app-without-tenant");

    const result = helper.createLensMissingCapabilityResult({
      scope: capability.scope,
      safeUserMessage: "Connect GA4 before Lens can answer.",
      requirements: [
        {
          key: "ga4.source_mapping",
          type: "connector",
          severity: "blocking",
          action: "connect_ga4_property",
          safe_user_message: "Connect and verify a GA4 property.",
          token: "sk-proj-should-not-copy",
          headers: { authorization: "Bearer nope" },
          prompt: "should not copy",
        },
        {
          key: "authorization",
          type: "headers",
          severity: "warning",
          action: "file:C:/unsafe/path",
          safe_user_message: "Bearer unsafe-token-value",
        },
      ],
    });
    const serialized = JSON.stringify(result);

    assert.equal(result.contract, "lens.measurement_result.v1");
    assert.equal(result.status, "missing_capability");
    assert.equal(result.scope.tenant_id, "holdstation");
    assert.equal(result.missing_requirements.length, 2);
    assert.equal(result.missing_requirements[0].key, "ga4.source_mapping");
    assert.equal(result.missing_requirements[0].type, "connector");
    assert.equal(result.missing_requirements[0].action, "connect_ga4_property");
    assert.equal(result.missing_requirements[1].key, "lens.capability_missing");
    assert.equal(result.missing_requirements[1].type, "configuration");
    assert.equal(result.missing_requirements[1].action, "configure_lens_capability");
    assert.doesNotMatch(serialized, /sk-proj|authorization|Bearer|headers|cookie|refresh_token|rawGa4Response|raw_ga4_response|prompt|answer body|file:|C:[\\/]/i);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

const helperPath = "src/lib/cmo/lens-measurement-result.ts";
const typesPath = "src/lib/cmo/app-workspace-types.ts";
const mapperPath = "src/lib/cmo/hermes-cmo-chat-mapper.ts";
const hermesFirstPath = "src/lib/cmo/hermes-first-cmo-chat.ts";
const chatV11Path = "src/lib/cmo/hermes-cmo-chat-v11.ts";
const runtimePath = "src/lib/cmo/hermes-cmo-runtime.ts";
const appChatStorePath = "src/lib/cmo/app-chat-store.ts";

for (const file of [helperPath, typesPath, mapperPath, hermesFirstPath, chatV11Path, runtimePath, appChatStorePath]) {
  assert.ok(fs.existsSync(repoPath(file)), `${file} is missing`);
}

assertIncludes(helperPath, 'LENS_METRICS_PACK_CONTRACT = "lens.metrics_pack.v1"', "Lens capability must advertise metrics pack contract");
assertIncludes(helperPath, 'LENS_MEASUREMENT_RESULT_CONTRACT = "lens.measurement_result.v1"', "Lens measurement result contract must exist");
assertIncludes(helperPath, 'export type LensMeasurementResultStatus = "missing_capability" | "no_data" | "completed" | "failed"', "Measurement result statuses must be explicit");
assertIncludes(helperPath, 'DEFAULT_LENS_MEASUREMENT_RANGE_KEY: LensMeasurementRangeKey = "last_7_days"', "Lens scope must default to last_7_days");
assertIncludes(helperPath, "createLensCapabilityContext", "Lens capability helper must exist");
assertIncludes(helperPath, "createLensMissingCapabilityResult", "Missing capability helper must exist");
assertIncludes(helperPath, "UNSAFE_TEXT_PATTERN", "Missing capability helper must sanitize unsafe text");
assertExcludes(helperPath, /\.\.\.requirement|\.\.\.input|Record<string,\s*unknown>.*missing/i, "Missing capability helper must not copy arbitrary requirement payloads");
assertExcludes(helperPath, /DEFAULT_TENANT_ID|tenant_id:\s*safeId\(input\.tenantId,\s*["']holdstation["']\)/, "Lens capability helper must not invent holdstation tenant when tenantId is missing");

assertIncludes(typesPath, "LensCapabilityContext", "Workspace types must expose Lens capability context");
assertIncludes(typesPath, "LensMeasurementResult", "Workspace types must expose Lens measurement result");

assertIncludes(mapperPath, "createLensCapabilityContext", "Legacy Hermes mapper must build Lens capability context");
assertExcludes(mapperPath, /tenantId:\s*input\.request\.tenantId\s*\?\?\s*["']holdstation["']/, "Legacy mapper must not hardcode holdstation as tenant fallback");
assertMatches(mapperPath, /tenant_id:\s*lensCapabilityContext\.scope\.tenant_id[\s\S]{0,180}workspace_id:\s*lensCapabilityContext\.scope\.workspace_id[\s\S]{0,180}app_id:\s*lensCapabilityContext\.scope\.app_id/, "Legacy Hermes request must carry top-level Lens identity");
assertMatches(mapperPath, /workspace:\s*\{[\s\S]{0,160}tenant_id:\s*lensCapabilityContext\.scope\.tenant_id[\s\S]{0,160}workspace_id:\s*input\.request\.workspaceId[\s\S]{0,160}app_id:\s*input\.request\.appId/, "Legacy workspace block must retain tenant/workspace/app identity");
assertMatches(mapperPath, /capabilities:\s*hermesCapabilities/, "Legacy Hermes request must include top-level capabilities");
assertMatches(mapperPath, /lens_request_context:\s*lensCapabilityContext/, "Legacy Hermes context_pack must include lens_request_context");
assertMatches(mapperPath, /const hermesCapabilities = \{[\s\S]{0,180}lens:\s*lensCapabilityContext/, "Legacy capabilities must include Lens without replacing Creative");

assertIncludes(hermesFirstPath, "createLensCapabilityContext", "Hermes-first request must build Lens capability context");
assertMatches(hermesFirstPath, /capabilities:\s*\{[\s\S]{0,80}lens:\s*lensCapabilityContext/, "Hermes-first request must include capabilities.lens");
assertMatches(hermesFirstPath, /lens_request_context:\s*lensCapabilityContext/, "Hermes-first context_pack must include lens_request_context");

assertIncludes(chatV11Path, "createLensCapabilityContext", "Hermes chat v1.1 request must build Lens capability context");
assertMatches(chatV11Path, /capabilities:\s*\{[\s\S]{0,80}lens:\s*lensCapabilityContext/, "Hermes chat v1.1 request must include capabilities.lens");
assertMatches(chatV11Path, /lens_request_context:\s*lensCapabilityContext/, "Hermes chat v1.1 context_pack must include lens_request_context");

assertIncludes(runtimePath, "LensCapabilityContext", "Runtime request type must allow typed Lens capability");
assertMatches(runtimePath, /capabilities\?:\s*\{[\s\S]{0,120}lens\?:\s*LensCapabilityContext/, "Legacy runtime request type must include optional capabilities.lens");

assertIncludes(appChatStorePath, "getLensReadoutContextForAppSafe", "Product Lens readout prefetch remains available as optional evidence");
assertIncludes(appChatStorePath, "isCmoLensDirectContextEnabled()", "Product Lens readout prefetch must remain env-gated");
assertExcludes(mapperPath, /source_agent:\s*["']lens["']|sourceAgent:\s*["']lens["']/, "Legacy mapper must not synthesize Lens activity rows");
assertExcludes(hermesFirstPath, /source_agent:\s*["']lens["']|sourceAgent:\s*["']lens["']/, "Hermes-first path must not synthesize Lens activity rows");
assertExcludes(chatV11Path, /source_agent:\s*["']lens["']|sourceAgent:\s*["']lens["']/, "Hermes v1.1 path must not synthesize Lens activity rows");

await assertMissingCapabilityHelperSanitizes();

console.log("CMO Lens CMO capability contract check passed.");
