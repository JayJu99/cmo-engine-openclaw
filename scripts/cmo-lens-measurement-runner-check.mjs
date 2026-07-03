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

async function transpile(sourcePath, outputPath) {
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText
    .replace(/require\("server-only"\);?\n?/g, "")
    .replace(/require\("@\/lib\/cmo\/([^"]+)"\)/g, (_match, modulePath) =>
      `require("./${path.basename(modulePath)}.js")`
    );

  await writeFile(outputPath, output, "utf8");
}

async function loadRunnerHarness() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-lens-measurement-runner-"));
  const cmoDir = repoPath("src", "lib", "cmo");

  await transpile(path.join(cmoDir, "lens-measurement-result.ts"), path.join(tmpDir, "lens-measurement-result.js"));
  await transpile(path.join(cmoDir, "lens-measurement-runner.ts"), path.join(tmpDir, "lens-measurement-runner.js"));
  await writeFile(
    path.join(tmpDir, "workspace-metric-sources.js"),
    `let mapping = null;
exports.__setMapping = (value) => { mapping = value; };
exports.getWorkspaceGa4MetricSourceMapping = async () => mapping;
`,
    "utf8",
  );
  await writeFile(
    path.join(tmpDir, "workspace-metric-snapshots.js"),
    `let snapshot = null;
exports.__setSnapshot = (value) => { snapshot = value; };
exports.getLatestWorkspaceGa4MetricSnapshot = async () => snapshot;
`,
    "utf8",
  );
  await writeFile(
    path.join(tmpDir, "lens-metric-definitions.js"),
    `exports.getLatestProductMetricDefinitionSnapshots = async () => ({ snapshots: [] });\n`,
    "utf8",
  );
  await writeFile(
    path.join(tmpDir, "lens-metrics-pack.js"),
    `exports.createLensMetricsPackFromSnapshot = (input) => ({
  contract: "lens.metrics_pack.v1",
  tenantId: input.scope.tenantId,
  workspaceId: input.scope.workspaceId,
  appId: input.scope.appId,
  range: {
    key: input.rangeKey,
    dateStart: input.snapshot.dateStart,
    dateEnd: input.snapshot.dateEnd,
    timezone: input.snapshot.timezone,
  },
  generatedAt: "2026-06-17T00:00:00.000Z",
  sources: [{
    sourceType: "ga4",
    sourceId: "ga4_native",
    provider: "ga4_native",
    propertyId: input.mapping.propertyId,
    propertyDisplayName: input.mapping.propertyDisplayName,
    accountDisplayName: input.mapping.accountDisplayName,
    snapshotId: input.snapshot.snapshotId,
    syncedAt: input.snapshot.syncedAt,
    status: input.snapshot.status,
  }],
  metrics: [
    {
      key: "ga4.active_users",
      label: "Active Users",
      value: input.snapshot.metrics.activeUsers,
      unit: "users",
      displayValue: "123",
      sourceType: "ga4",
      sourceId: "ga4_native",
      sourceMetric: "activeUsers",
      mappingStatus: "mapped",
      confidence: "high",
      semanticRole: "audience",
      definition: { prompt: "must not persist" },
    },
    {
      key: "ga4.sessions",
      label: "Sessions",
      value: input.snapshot.metrics.sessions,
      unit: "sessions",
      sourceType: "ga4",
      sourceId: "ga4_native",
      sourceMetric: "sessions",
      mappingStatus: "mapped",
      confidence: "high",
      semanticRole: "traffic",
      unavailableReason: "Bearer unsafe-token-value",
    },
    {
      key: "activation.activated_users",
      label: "Activated Users",
      value: null,
      unit: "users",
      mappingStatus: "definition_needed",
      confidence: "none",
      semanticRole: "activation",
      missingDefinition: "activation_event",
    },
  ],
  quality: {
    status: "ready",
    isStale: false,
    staleThresholdHours: 24,
    missingDefinitions: ["activation_event"],
    warnings: ["ok", "secret token should be redacted", "file:C:/unsafe/path"],
  },
});\n`,
    "utf8",
  );

  const requireFromTmp = createRequire(path.join(tmpDir, "lens-measurement-runner.js"));

  return {
    tmpDir,
    runner: requireFromTmp(path.join(tmpDir, "lens-measurement-runner.js")),
    sources: requireFromTmp(path.join(tmpDir, "workspace-metric-sources.js")),
    snapshots: requireFromTmp(path.join(tmpDir, "workspace-metric-snapshots.js")),
  };
}

const verifiedMapping = {
  sourceType: "ga4",
  provider: "ga4_native",
  oauthAccountId: "oauth_safe_ref",
  propertyId: "487138147",
  propertyDisplayName: "world.holdstation.com",
  accountDisplayName: "Holdstation",
  timezone: "Asia/Saigon",
  enabled: true,
  verificationStatus: "verified",
};

const syncedSnapshot = {
  snapshotId: "snapshot_last_7_days",
  sourceType: "ga4",
  sourceId: "ga4_native",
  rangeKey: "last_7_days",
  dateStart: "2026-06-11",
  dateEnd: "2026-06-17",
  timezone: "Asia/Saigon",
  status: "synced",
  syncedAt: "2026-06-17T00:00:00.000Z",
  metrics: {
    activeUsers: 123,
    sessions: 456,
  },
  sourceMeta: {},
};

async function assertRunnerBehavior() {
  const { tmpDir, runner, sources, snapshots } = await loadRunnerHarness();

  try {
    const baseInput = {
      workspaceId: "workspace_without_product_prefetch",
      appId: "app_without_product_prefetch",
      rangeKey: "last_7_days",
      metricIntent: "social traffic",
      requestId: "req_safe",
    };

    sources.__setMapping(null);
    snapshots.__setSnapshot(null);
    let result = await runner.runLensMeasurementRequest(baseInput);
    assert.equal(result.status, "missing_capability");
    assert.equal(result.scope.tenant_id, "workspace_without_product_prefetch");
    assert.equal(result.missing_requirements[0].key, "ga4.source_mapping");
    assert.equal(result.missing_requirements[0].action, "connect_ga4_property");

    sources.__setMapping({ ...verifiedMapping, oauthAccountId: null });
    result = await runner.runLensMeasurementRequest(baseInput);
    assert.equal(result.status, "missing_capability");
    assert.equal(result.missing_requirements[0].key, "ga4.oauth_account");
    assert.equal(result.missing_requirements[0].action, "connect_or_verify_google_analytics");

    sources.__setMapping({ ...verifiedMapping, verificationStatus: "property_inaccessible" });
    result = await runner.runLensMeasurementRequest(baseInput);
    assert.equal(result.status, "missing_capability");
    assert.equal(result.missing_requirements[0].key, "ga4.source_verification");

    sources.__setMapping(verifiedMapping);
    snapshots.__setSnapshot(null);
    result = await runner.runLensMeasurementRequest(baseInput);
    assert.equal(result.status, "no_data");
    assert.equal(result.safe_user_message.includes("no cached metrics snapshot"), true);

    snapshots.__setSnapshot({
      ...syncedSnapshot,
      status: "error",
      lastError: "Bearer sk-proj-secret file:C:/unsafe/path",
    });
    result = await runner.runLensMeasurementRequest(baseInput);
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "ga4_snapshot_error");
    assert.doesNotMatch(JSON.stringify(result), /sk-proj|Bearer|file:|C:[\\/]/i);

    snapshots.__setSnapshot(syncedSnapshot);
    result = await runner.runLensMeasurementRequest(baseInput);
    const serialized = JSON.stringify(result);

    assert.equal(result.status, "completed");
    assert.equal(result.contract, "lens.measurement_result.v1");
    assert.equal(result.scope.tenant_id, "workspace_without_product_prefetch");
    assert.equal(result.scope.workspace_id, "workspace_without_product_prefetch");
    assert.equal(result.scope.app_id, "app_without_product_prefetch");
    assert.equal(result.scope.range_key, "last_7_days");
    assert.equal(result.metrics_pack.contract, "lens.metrics_pack.v1");
    assert.equal(result.metrics_pack.metrics.some((metric) => metric.key === "ga4.sessions"), true);
    assert.equal(result.metric_intent.resolved_key, "social_traffic");
    assert.deepEqual(result.metric_intent.matched_metric_keys, ["ga4.sessions"]);
    assert.doesNotMatch(serialized, /access_token|refresh_token|encrypted_refresh_token|authorization|headers|cookie|rawGa4Response|raw_ga4_response|prompt|answer body|secret token|Bearer|file:|C:[\\/]/i);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

const resultPath = "src/lib/cmo/lens-measurement-result.ts";
const runnerPath = "src/lib/cmo/lens-measurement-runner.ts";
const runtimePath = "src/lib/cmo/hermes-cmo-runtime.ts";
const mapperPath = "src/lib/cmo/hermes-cmo-chat-mapper.ts";
const appChatStorePath = "src/lib/cmo/app-chat-store.ts";

for (const file of [resultPath, runnerPath, runtimePath, mapperPath, appChatStorePath]) {
  assertFileExists(file, `${file} is missing`);
}

assertIncludes(runnerPath, "export async function runLensMeasurementRequest", "Lens measurement runner must export runLensMeasurementRequest");
assertIncludes(runnerPath, "export function resolveLensMeasurementMetricIntent", "Lens measurement runner must expose metric intent resolver");
assertIncludes(resultPath, "metrics_pack?: LensMetricsPack", "Lens measurement result must be able to carry a safe metrics pack");
assertIncludes(resultPath, "error?: LensMeasurementSafeError", "Lens measurement result must carry safe error payloads");
assertIncludes(resultPath, "sanitizeLensMeasurementSafeText", "Lens measurement result must expose safe text sanitizer");
assertIncludes(runnerPath, "createLensCapabilityContext", "Runner must normalize scope with Lens capability context");
assertIncludes(runnerPath, "getWorkspaceGa4MetricSourceMapping", "Runner must resolve GA4 source mapping");
assertIncludes(runnerPath, "getLatestWorkspaceGa4MetricSnapshot", "Runner must use cached GA4 snapshots");
assertIncludes(runnerPath, "createLensMetricsPackFromSnapshot", "Runner must build lens.metrics_pack.v1 from cached snapshot");
assertIncludes(runnerPath, 'key: "ga4.source_mapping"', "Missing connector must use ga4.source_mapping");
assertIncludes(runnerPath, 'key: "ga4.oauth_account"', "Missing OAuth must use ga4.oauth_account");
assertIncludes(runnerPath, 'key: "ga4.source_verification"', "Unverified source must use ga4.source_verification");
assertIncludes(runnerPath, 'status: "no_data"', "Runner must return no_data when configured source has no cached snapshot");
assertIncludes(runnerPath, 'status: "completed"', "Runner must return completed for cached synced snapshots");
assertIncludes(runnerPath, 'status: "failed"', "Runner must support safe failed results");
assertIncludes(runnerPath, "safeMetricsPack", "Runner must sanitize metrics pack output");

assertExcludes(runnerPath, /fetchLensGa4CoreMetrics|runReport|runRealtimeReport|analyticsdata\.googleapis/i, "Runner must not perform live GA4 query in M5.6B");
assertExcludes(runnerPath, /\.\.\.(?:metric|source|pack)(?!\.)|\bdefinition\s*:/, "Runner must not copy raw metrics pack fields or definitions");
assertExcludes(runnerPath, /getLensReadoutContextForAppSafe|lens-readout-context|app-chat-store|Product prefetch/i, "Runner must not depend on Product readout prefetch");
assertExcludes(runnerPath, /source_agent:\s*["']lens["']|activityEvents|createProductChatRunLifecycleEvent/i, "Runner must not create fake Lens activity rows");
assertExcludes(runtimePath, /"lens"\s*\|/, "Runtime allowed-agent union must not add Lens executable delegation");
assertExcludes(runtimePath, /allowedAgents[\s\S]{0,120}"lens"/, "Runtime allowedAgents must not include Lens");
assertMatches(mapperPath, /capabilities:\s*hermesCapabilities/, "Product-to-CMO capability metadata must remain request metadata");
assertIncludes(appChatStorePath, "getLensReadoutContextForAppSafe", "Existing Product readout prefetch remains available");

await assertRunnerBehavior();

console.log("CMO Lens measurement runner check passed.");
