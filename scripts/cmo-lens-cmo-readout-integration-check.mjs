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

async function loadHermesChatV11Builder() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-lens-cmo-readout-shape-"));
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

function fakeLensReadoutContext() {
  const metricHighlights = [
    {
      key: "ga4.active_users",
      label: "Active Users",
      value: 1210,
      displayValue: "1,210",
      unit: "users",
      role: "audience",
      source: "Lens GA4",
    },
    {
      key: "ga4.new_users",
      label: "New Users",
      value: 850,
      displayValue: "850",
      unit: "users",
      role: "acquisition",
      source: "Lens GA4",
    },
    {
      key: "ga4.sessions",
      label: "Sessions",
      value: 20468,
      displayValue: "20,468",
      unit: "sessions",
      role: "traffic",
      source: "Lens GA4",
    },
    {
      key: "ga4.event_count",
      label: "Event Count",
      value: 383400,
      displayValue: "383,400",
      unit: "events",
      role: "engagement",
      source: "Lens GA4",
    },
    {
      key: "ga4.engagement_rate",
      label: "Engagement Rate",
      value: 0.945,
      displayValue: "94.5%",
      unit: "ratio",
      role: "engagement",
      source: "Lens GA4",
    },
  ];

  return {
    contract: "lens.readout_context.v1",
    readoutContract: "lens.readout.v1",
    appId: "holdstation-mini-app",
    workspaceId: "holdstation-mini-app",
    tenantId: "holdstation",
    rangeKey: "this_week",
    generatedAt: "2026-06-16T00:00:00.000Z",
    sourceSnapshotIds: ["snapshot_this_week"],
    status: {
      overall: "ready",
      dataStatus: "fresh",
      canAnswerBasicPerformance: true,
      canAnswerActivation: false,
      canAnswerRetention: false,
      canCompareTrend: false,
    },
    headline: {
      title: "GA4 performance readout is ready",
      summary: "Lens can summarize cached GA4 performance metrics for the selected range.",
      confidence: "high",
    },
    metricHighlights,
    deterministicFindings: [
      {
        key: "activation_not_configured",
        type: "configuration_gap",
        severity: "warning",
        title: "Activation is not configured",
      },
    ],
    recommendedActions: [],
    limitations: ["Activation and retention are blocked until definitions are configured."],
    factsForModel: [
      "For this_week, GA4 New Users = 850.",
      "For this_week, GA4 Sessions = 20.5K.",
      "For this_week, GA4 Event Count = 383.4K.",
      "For this_week, GA4 Engagement Rate = 94.5%.",
      "Activation metrics are not configured.",
      "D1/D7 retention metrics are not configured.",
    ],
    groundingRules: [
      "Use Lens readout facts as evidence for app performance questions.",
      "Do not treat Active Users as Activated Users.",
      "Do not treat Engagement Rate as Activation Rate.",
      "Do not invent activation or retention metrics when definition_needed.",
    ],
  };
}

function fakeHermesInput() {
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
    tokenBudget: {
      maxInputTokens: 8000,
      estimatedTokens: 120,
      maxItemChars: 4000,
    },
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
      lensReadoutContext: fakeLensReadoutContext(),
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
      context: {
        selectedNotes: [],
        mode: "app_context",
      },
    },
    contextUsed: [],
    missingContext: [],
    sessionId: "session_lens_shape",
    userMessageId: "msg_lens_shape",
    createdAt: "2026-06-16T00:00:00.000Z",
    userIdentity: {
      userId: "user_lens_shape",
      userEmail: "lens-shape@example.com",
    },
  };
}

async function assertSerializedLensRequestShape() {
  const { tmpDir, chatV11 } = await loadHermesChatV11Builder();

  try {
    const request = chatV11.buildHermesCmoChatV11Request(fakeHermesInput());
    const artifact = request.context_pack.artifacts_in.find((item) =>
      item.contract === "lens.readout_context.v1" &&
      item.kind === "lens_readout_context"
    );

    strictAssert.ok(Array.isArray(request.context_pack.artifacts_in), "context_pack.artifacts_in[] must exist");
    strictAssert.ok(artifact, "Lens readout artifact must be present in context_pack.artifacts_in[]");
    strictAssert.equal(artifact.contract, "lens.readout_context.v1");
    strictAssert.equal(artifact.kind, "lens_readout_context");
    strictAssert.ok(artifact.content, "Lens readout artifact must retain content");
    strictAssert.ok(Array.isArray(artifact.content.metricHighlights), "Lens content.metricHighlights must exist");
    strictAssert.ok(
      artifact.content.metricHighlights.some((metric) => metric.key === "ga4.new_users" && metric.label === "New Users"),
      "Lens content.metricHighlights must include ga4.new_users",
    );
    strictAssert.ok(Array.isArray(artifact.content.factsForModel), "Lens content.factsForModel must exist");
    strictAssert.ok(Array.isArray(artifact.content.groundingRules), "Lens content.groundingRules must exist");

    const serialized = JSON.stringify(request);

    for (const expected of [
      "lens.readout_context.v1",
      "metricHighlights",
      "ga4.new_users",
      "New Users",
      "factsForModel",
    ]) {
      strictAssert.ok(serialized.includes(expected), `serialized outbound request must include ${expected}`);
    }

    for (const forbidden of [
      "schema_version\":\"lens.readout_context.v1",
      "access_token",
      "refresh_token",
      "encrypted_refresh_token",
    ]) {
      strictAssert.ok(!serialized.includes(forbidden), `serialized outbound request must not include ${forbidden}`);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

const contextHelperPath = "src/lib/cmo/lens-readout-context.ts";
const readoutHelperPath = "src/lib/cmo/lens-readout.ts";
const diagnosticsPackPath = "src/lib/cmo/lens-diagnostics-pack.ts";
const chatStorePath = "src/lib/cmo/app-chat-store.ts";
const mapperPath = "src/lib/cmo/hermes-cmo-chat-mapper.ts";
const chatV11Path = "src/lib/cmo/hermes-cmo-chat-v11.ts";
const chatRoutePath = "src/app/api/cmo/chat/route.ts";
const hermesRuntimePath = "src/lib/cmo/hermes-cmo-runtime.ts";
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

for (const file of [contextHelperPath, readoutHelperPath, diagnosticsPackPath, chatStorePath, mapperPath, chatV11Path, chatRoutePath, hermesRuntimePath, typesPath, metricsPackPath]) {
  assertFileExists(file, `${file} is missing`);
}

assertIncludes(contextHelperPath, 'contract: "lens.readout_context.v1"', "Lens readout context helper must emit lens.readout_context.v1");
assertIncludes(contextHelperPath, 'readoutContract: readout.contract', "Lens readout context must carry source readout contract");
assertIncludes(contextHelperPath, "getLensReadoutForApp", "Lens readout context must use existing readout helper");
assertIncludes(contextHelperPath, "getLensReadoutContextForAppSafe", "Lens readout context must expose fail-soft builder");
assertIncludes(contextHelperPath, "lens_readout_context_unavailable", "Lens readout context helper must degrade gracefully");
assertIncludes(contextHelperPath, "factsForModel", "Lens readout context must expose model-readable facts");
assertIncludes(contextHelperPath, "groundingRules", "Lens readout context must expose grounding rules");
assertIncludes(contextHelperPath, "Use Lens readout facts as evidence for app performance questions.", "Lens grounding rules must require using Lens facts as evidence");
assertIncludes(contextHelperPath, "Do not treat Active Users as Activated Users.", "Lens grounding rules must prevent Active Users / Activated Users confusion");
assertIncludes(contextHelperPath, "Do not treat Engagement Rate as Activation Rate.", "Lens grounding rules must prevent Engagement Rate / Activation Rate confusion");
assertIncludes(contextHelperPath, "Do not invent activation or retention metrics when definition_needed.", "Lens grounding rules must prevent invented activation or retention metrics");
assertMatches(contextHelperPath, /For \$\{readout\.range\.key\}, GA4 \$\{metric\.label\} = \$\{factDisplayValue\(metric\)\}\./, "Lens facts must be derived from real metric highlights");
assertIncludes(contextHelperPath, "Activation metrics are not configured.", "Lens facts must state activation is not configured");
assertIncludes(contextHelperPath, "D1/D7 retention metrics are not configured.", "Lens facts must state retention is not configured");

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
assertIncludes(chatV11Path, "buildHermesCmoChatV11Request", "Hermes CMO chat v1.1 must expose request construction for request-shape tests");
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
assertExcludes(chatStorePath, /Tu\u1ea7n n\u00e0y c\u00f3 bao nhi\u00eau user m\u1edbi v\u1eady/i, "Product chat path must not contain the exact production metric question");
assertExcludes(mapperPath, /Tu\u1ea7n n\u00e0y c\u00f3 bao nhi\u00eau user m\u1edbi v\u1eady/i, "Hermes mapper must not contain the exact production metric question");
assertExcludes(chatStorePath, /if\s*\([^)]*(?:message|query|prompt)[^)]*\)\s*\{[\s\S]{0,500}(?:Active Users|Engagement Rate|GA4|Lens readout)[\s\S]{0,500}answer\s*=/i, "Product chat path must not map exact user queries to fixed metric answers");

assertMatches(contextHelperPath, /key:\s*metric\.key[\s\S]{0,120}label:\s*metric\.label/, "Metric highlights must remain compact factual metric records");
assertIncludes(contextHelperPath, "recommendedActions", "Lens readout context must carry recommended actions including missing snapshot sync");
assertIncludes(readoutHelperPath, '"ga4.active_users"', "Readout highlights must include Active Users");
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

for (const file of [chatStorePath, chatRoutePath, hermesRuntimePath]) {
  assertExcludes(file, forbiddenMetricFetchPattern, `${file} integration must not call GA4 Data API metric fetch`);
  assertExcludes(file, forbiddenRealtimePattern, `${file} integration must not call GA4 realtime metrics`);
  assertExcludes(file, /\/agents\/lens|hermes[-_ ]?lens/i, `${file} must not call Hermes Lens`);
  assertExcludes(file, /\b(access_token|refresh_token|encrypted_refresh_token)\b/i, `${file} must not expose token fields`);
}

await assertSerializedLensRequestShape();

execFileSync(process.execPath, [repoPath("scripts", "cmo-lens-readout-check.mjs")], {
  cwd: root,
  stdio: "pipe",
  env: process.env,
});

console.log("CMO Lens CMO readout integration check passed.");
