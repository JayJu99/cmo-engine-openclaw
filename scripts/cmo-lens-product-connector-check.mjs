import { execFileSync } from "node:child_process";
import strictAssert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

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

async function transpile(sourcePath, outputPath) {
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText.replace(/require\("@\/lib\/cmo\/([^"]+)"\)/g, (_match, modulePath) =>
    `require("./${path.basename(modulePath)}.js")`
  );

  await writeFile(outputPath, output, "utf8");
}

async function assertInternalRouteAuth() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-lens-product-connector-route-"));
  const routeSource = repoPath("src", "app", "api", "internal", "lens", "apps", "[appId]", "metrics", "route.ts");

  try {
    await writeFile(
      path.join(tmpDir, "lens-product-connector.js"),
      `exports.calls = [];
exports.getProductLensConnectorMetrics = async (input) => {
  exports.calls.push(input);
  return {
    schema_version: "product.lens_connector_metrics.v1",
    tenant_id: "holdstation",
    workspace_id: "holdstation-mini-app",
    app_id: "holdstation-mini-app",
    range: { key: input.rangeKey, date_start: "2026-06-15", date_end: "2026-06-17", timezone: "Asia/Saigon" },
    source: { provider: "ga4", source_type: "ga4", source_id: "ga4_native", property_id: "487138147", property_display_name: "world.holdstation.com", snapshot_id: "snapshot_this_week", synced_at: "2026-06-17T00:00:00.000Z" },
    metrics: { active_users: 34300, new_users: 3891, sessions: 83100, event_count: 1500000, engagement_rate: 0.946 },
    definitions: { activation_event: null, retention_logic: null },
    quality: { status: "synced", confidence: "high", warnings: [] },
    safety: { no_tokens_returned: true, raw_ga4_response_included: false, vault_write_performed: false, gbrain_used: false },
  };
};\n`,
      "utf8",
    );
    await writeFile(
      path.join(tmpDir, "workspace-metric-snapshots.js"),
      `exports.isWorkspaceGa4MetricRangeKey = (value) => ["this_week", "last_7_days", "last_30_days", "this_month"].includes(value);\n`,
      "utf8",
    );
    await transpile(routeSource, path.join(tmpDir, "route.js"));

    const requireFromTmp = createRequire(path.join(tmpDir, "route.js"));
    const route = requireFromTmp(path.join(tmpDir, "route.js"));
    const connector = requireFromTmp(path.join(tmpDir, "lens-product-connector.js"));
    const ctx = { params: Promise.resolve({ appId: "holdstation-mini-app" }) };
    const previousKey = process.env.CMO_LENS_INTERNAL_API_KEY;

    try {
      delete process.env.CMO_LENS_INTERNAL_API_KEY;
      let response = await route.GET(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/metrics"), ctx);
      strictAssert.equal(response.status, 503, "missing CMO_LENS_INTERNAL_API_KEY must fail closed");

      process.env.CMO_LENS_INTERNAL_API_KEY = "internal-test-key";
      response = await route.GET(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/metrics"), ctx);
      strictAssert.equal(response.status, 401, "missing bearer token must be rejected");

      response = await route.GET(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/metrics", {
        headers: { Authorization: "Bearer wrong-key" },
      }), ctx);
      strictAssert.equal(response.status, 401, "wrong bearer token must be rejected");

      response = await route.GET(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/metrics?rangeKey=this_week&mode=cache_only", {
        headers: { Authorization: "Bearer internal-test-key" },
      }), ctx);
      strictAssert.equal(response.status, 200, "correct bearer token must be accepted");

      const payload = await response.json();
      strictAssert.equal(payload.schema_version, "product.lens_connector_metrics.v1");
      strictAssert.equal(payload.tenant_id, "holdstation");
      strictAssert.equal(payload.workspace_id, "holdstation-mini-app");
      strictAssert.equal(payload.app_id, "holdstation-mini-app");
      strictAssert.equal(payload.source.property_id, "487138147");
      strictAssert.equal(payload.metrics.new_users, 3891);
      strictAssert.equal(payload.safety.no_tokens_returned, true);
      strictAssert.equal(payload.safety.vault_write_performed, false);
      strictAssert.equal(payload.safety.gbrain_used, false);
      strictAssert.deepEqual(connector.calls.at(-1), {
        appId: "holdstation-mini-app",
        rangeKey: "this_week",
        mode: "cache_only",
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.CMO_LENS_INTERNAL_API_KEY;
      } else {
        process.env.CMO_LENS_INTERNAL_API_KEY = previousKey;
      }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function loadHermesChatV11Builder() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-lens-product-connector-chat-"));
  const cmoDir = repoPath("src", "lib", "cmo");

  for (const file of [
    "config",
    "app-routing-intent",
    "session-working-memory",
    "user-metadata",
    "hermes-cmo-chat-router",
    "hermes-cmo-chat-mapper",
    "hermes-cmo-chat-v11",
  ]) {
    await transpile(path.join(cmoDir, `${file}.ts`), path.join(tmpDir, `${file}.js`));
  }

  const requireFromTmp = createRequire(path.join(tmpDir, "hermes-cmo-chat-v11.js"));

  return {
    tmpDir,
    chatV11: requireFromTmp(path.join(tmpDir, "hermes-cmo-chat-v11.js")),
  };
}

function fakeHermesInputWithoutLens() {
  const contextPack = {
    policyVersion: "context-pack-v1",
    workspaceId: "holdstation-mini-app",
    appId: "holdstation-mini-app",
    sourceId: "holdstation-mini-app__holdstation-mini-app",
    logicalAppPath: "02 Apps/World Mini App/Holdstation Mini App",
    physicalAppVaultPath: "knowledge/holdstation/02 Apps/World Mini App/Holdstation Mini App",
    appVaultPath: "02 Apps/World Mini App/Holdstation Mini App",
    physicalVaultPath: "knowledge/holdstation",
    runtimeMode: "live",
    tokenBudget: { maxInputTokens: 8000, estimatedTokens: 120, maxItemChars: 4000 },
    items: [],
    exclusions: [],
    contextQualitySummary: {
      selectedCount: 0,
      existingCount: 0,
      missingCount: 0,
      confirmedCount: 0,
      draftCount: 0,
      placeholderCount: 0,
      placeholderOrDraftCount: 0,
    },
  };

  return {
    contextPack,
    contextPackage: {
      workspaceId: "holdstation-mini-app",
      sourceId: "holdstation-mini-app__holdstation-mini-app",
      mode: "app_context",
      contextPack,
      app: {
        id: "holdstation-mini-app",
        name: "Holdstation Mini App",
        vaultPath: "knowledge/holdstation/02 Apps/World Mini App/Holdstation Mini App",
        logicalAppPath: "02 Apps/World Mini App/Holdstation Mini App",
        physicalAppVaultPath: "knowledge/holdstation/02 Apps/World Mini App/Holdstation Mini App",
        appVaultPath: "02 Apps/World Mini App/Holdstation Mini App",
      },
      userMessage: "How many new users this week?",
      selectedContext: [],
      missingContext: [],
      contextQualitySummary: contextPack.contextQualitySummary,
      instructions: {
        role: "strategic CMO",
        doNotOverpromise: true,
        answerStyle: "operator-grade, concise, decision-oriented",
        mustStateAssumptions: true,
        mustReferenceContextUsed: true,
        useSelectedNotesOnly: true,
        doNotClaimAllVaultRag: true,
        doNotPretendDurableMemoryComplete: true,
        mustStatePlaceholderLimitations: true,
        askForConfirmationWhenContextIsDraft: true,
        suggestFillingAppMemoryWhenRelevant: true,
      },
    },
    message: "How many new users this week?",
    history: [],
    request: {
      tenantId: "holdstation",
      workspaceId: "holdstation-mini-app",
      appId: "holdstation-mini-app",
      appName: "Holdstation Mini App",
      message: "How many new users this week?",
      context: { selectedNotes: [], mode: "app_context" },
    },
    contextUsed: [],
    missingContext: [],
    sessionId: "session_no_lens",
    userMessageId: "msg_no_lens",
    createdAt: "2026-06-17T00:00:00.000Z",
    userIdentity: { userId: "user_no_lens", userEmail: "no-lens@example.com" },
  };
}

async function assertNoDirectLensContextByDefault() {
  const { tmpDir, chatV11 } = await loadHermesChatV11Builder();

  try {
    const request = chatV11.buildHermesCmoChatV11Request(fakeHermesInputWithoutLens());
    const serialized = JSON.stringify(request);

    strictAssert.ok(Array.isArray(request.context_pack.artifacts_in), "context_pack.artifacts_in[] must exist");
    strictAssert.ok(
      !request.context_pack.artifacts_in.some((item) => item.contract === "lens.readout_context.v1" || item.kind === "lens_readout_context"),
      "default Hermes CMO chat request must not attach Lens readout artifacts",
    );
    strictAssert.ok(!serialized.includes("lens.readout_context.v1"), "serialized request must not include lens.readout_context.v1 by default");
    strictAssert.deepEqual(request.tool_policy.context_grounding_rules, [], "Lens grounding rules must be absent without Lens artifact");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

const routePath = "src/app/api/internal/lens/apps/[appId]/metrics/route.ts";
const connectorPath = "src/lib/cmo/lens-product-connector.ts";
const chatStorePath = "src/lib/cmo/app-chat-store.ts";
const contextHelperPath = "src/lib/cmo/lens-readout-context.ts";
const mapperPath = "src/lib/cmo/hermes-cmo-chat-mapper.ts";
const chatV11Path = "src/lib/cmo/hermes-cmo-chat-v11.ts";

for (const file of [routePath, connectorPath, chatStorePath, contextHelperPath, mapperPath, chatV11Path]) {
  assertFileExists(file, `${file} is missing`);
}

assertIncludes(routePath, "CMO_LENS_INTERNAL_API_KEY", "Internal connector route must require CMO_LENS_INTERNAL_API_KEY");
assertIncludes(routePath, "authorization", "Internal connector route must read Authorization header");
assertIncludes(routePath, "Bearer", "Internal connector route must require bearer auth");
assertIncludes(routePath, "timingSafeEqual", "Internal connector auth must compare keys safely");
assertIncludes(routePath, "getProductLensConnectorMetrics", "Internal connector route must use Product connector helper");
assertExcludes(routePath, /requireRequestUserIfAuthRequired|cookies\(|next\/headers/i, "Internal connector route must not use frontend cookies/user auth");

assertIncludes(connectorPath, 'schema_version: "product.lens_connector_metrics.v1"', "Connector helper must emit product.lens_connector_metrics.v1");
assertIncludes(connectorPath, "requireWorkspaceRegistryEntry(input.appId)", "Connector helper must resolve appId via workspace registry");
assertIncludes(connectorPath, "tenant_id: entry.tenantId", "Connector helper must derive tenant_id from registry");
assertIncludes(connectorPath, "workspace_id: entry.workspaceId", "Connector helper must derive workspace_id from registry");
assertIncludes(connectorPath, "app_id: entry.appId", "Connector helper must derive app_id from registry");
assertIncludes(connectorPath, "getWorkspaceGa4MetricSourceMapping", "Connector helper must read workspace_metric_sources via safe helper");
assertIncludes(connectorPath, "getLatestWorkspaceGa4MetricSnapshot", "Connector helper must read workspace_metric_snapshots cache");
assertMatches(connectorPath, /metrics:\s*connectorMetrics\(snapshot\?\.metrics\)/, "Connector helper must use cached snapshot metrics");
assertIncludes(connectorPath, "activation_event: null", "Connector helper must not invent activation metrics");
assertIncludes(connectorPath, "retention_logic: null", "Connector helper must not invent retention metrics");
assertIncludes(connectorPath, "no_tokens_returned: true", "Connector helper must assert no tokens returned");
assertIncludes(connectorPath, "raw_ga4_response_included: false", "Connector helper must not return raw GA4 response");
assertIncludes(connectorPath, "vault_write_performed: false", "Connector helper must not write Vault");
assertIncludes(connectorPath, "gbrain_used: false", "Connector helper must not use GBrain");
assertExcludes(connectorPath, /\b(access_token|refresh_token|encrypted_refresh_token|id_token)\b/i, "Connector helper must not expose token fields");
assertExcludes(connectorPath, /\/agents\/|Hermes|hermes[-_ ]?lens|vault-agent|\/api\/cmo\/vault|\b(importGBrain|syncGBrain|embedGBrain|dreamGBrain|extractGBrain|queryGBrain|callGBrain)\b/i, "Connector helper must not call Hermes, Vault, or GBrain");
assertExcludes(connectorPath, /runReport|runRealtimeReport|analyticsdata\.googleapis/i, "Connector helper must not call GA4 live in M8R-A");
assertExcludes(connectorPath, /activated_users|activation_rate|retention\.d1|retention\.d7/i, "Connector helper must not return invented activation/retention metrics");

assertIncludes(contextHelperPath, "CMO_LENS_DIRECT_CONTEXT_ENABLED", "Direct Lens context must be controlled by env flag");
assertIncludes(contextHelperPath, "process.env.CMO_LENS_DIRECT_CONTEXT_ENABLED === \"true\"", "Direct Lens context default must be false");
assertIncludes(chatStorePath, "isCmoLensDirectContextEnabled()", "CMO chat store must gate direct Lens context");
assertMatches(
  chatStorePath,
  /isCmoLensDirectContextEnabled\(\)[\s\S]{0,180}getLensReadoutContextForAppSafe[\s\S]{0,180}:\s*\{\s*context:\s*null,\s*warning:\s*undefined\s*\}/,
  "CMO chat store must skip Lens context when direct flag is absent/false",
);
assertIncludes(mapperPath, "const contextGroundingRules = lensReadoutArtifact ? [LENS_READOUT_GROUNDING_RULE] : []", "Legacy Hermes mapper must only send Lens grounding rules with Lens artifact");
assertIncludes(chatV11Path, "hasLensReadoutArtifact ? [LENS_READOUT_GROUNDING_RULE] : []", "Hermes chat v1.1 must only send Lens grounding rules with Lens artifact");
assertMatches(
  mapperPath,
  /function answerFromHermes[\s\S]{0,900}const body = answer\.body\.trim\(\)[\s\S]{0,120}return body \|\| answer\.summary\.trim\(\)/,
  "Product must preserve Hermes answer.body instead of synthesizing final answers",
);
assertExcludes(chatStorePath, /answer\s*=\s*.*lensReadout|answer\s*=\s*.*Lens readout|mappedHermesResult\.answer\s*=/i, "CMO chat integration must not replace Hermes answer body with Lens readout text");

await assertInternalRouteAuth();
await assertNoDirectLensContextByDefault();

execFileSync(process.execPath, [repoPath("scripts", "cmo-lens-readout-check.mjs")], {
  cwd: root,
  stdio: "pipe",
  env: process.env,
});

console.log("CMO Lens Product connector check passed.");
