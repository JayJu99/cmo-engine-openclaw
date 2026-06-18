import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const cmoDir = path.join(root, "src", "lib", "cmo");

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function compileDisplayMapper(tmpDir) {
  const sourcePath = path.join(cmoDir, "cmo-chat-evidence-display.ts");
  const outputPath = path.join(tmpDir, "cmo-chat-evidence-display.js");
  const output = ts.transpileModule(await readFile(sourcePath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText;

  await writeFile(outputPath, output, "utf8");

  return createRequire(outputPath)(outputPath);
}

function assistantMessage(overrides = {}) {
  return {
    id: "assistant_m11a",
    role: "assistant",
    content: "Original Hermes answer.body stays exactly here.",
    createdAt: "2026-06-18T08:00:00.000Z",
    cmoRunStatus: "completed",
    hermesCmoMetadata: {
      runtimeMode: "hermes_cmo",
      runtimeStatus: "live",
      calledHermesCmo: true,
      delegationsMode: "proposals_only",
      counters: {
        surfCalls: 0,
        echoCalls: 0,
        vaultAgentCalls: 0,
        vaultWrites: 0,
        directSupabaseMutations: 0,
        openclawCalls: 0,
      },
      forbiddenCounters: {
        vaultAgentCalls: 0,
        vaultWrites: 0,
        directSupabaseMutations: 0,
        openclawCalls: 0,
      },
      requestId: "req_m11a",
      responseStatus: "completed",
      activityEventsCount: 1,
      toolsUsed: ["cmo_call_lens"],
      tools_used: ["cmo_call_lens"],
      ...overrides.hermesCmoMetadata,
    },
    ...overrides,
  };
}

const forbiddenRenderedPattern =
  /access_token|refresh_token|id_token|encrypted_refresh_token|CMO_LENS_INTERNAL_API_KEY|Authorization|Bearer|raw_ga4_response|raw connector payload|stack trace|C:\\Users\\ADMIN/i;

function renderedText(value) {
  return JSON.stringify(value);
}

const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-chat-evidence-ux-"));

try {
  const mapper = await compileDisplayMapper(tmpDir);
  const ga4Message = assistantMessage({
    hermesCmoMetadata: {
      toolTraceSummary: {
        source_label: "Lens / GA4 ad-hoc query",
        range_key: "this_week",
        date_start: "2026-06-15",
        date_end: "2026-06-18",
        metrics: ["activeUsers", "sessions"],
        dimensions: ["sessionDefaultChannelGroup"],
        top_dimension: "sessionDefaultChannelGroup",
        rows: 4,
        cache: "miss",
        warning: "sample caveat",
      },
      tool_trace_summary: {
        source_label: "Lens / GA4 ad-hoc query",
        range_key: "this_week",
        date_start: "2026-06-15",
        date_end: "2026-06-18",
        metrics: ["activeUsers", "sessions"],
        dimensions: ["sessionDefaultChannelGroup"],
        top_dimension: "sessionDefaultChannelGroup",
        rows: 4,
        cache: "miss",
      },
    },
  });
  const metricMessage = assistantMessage({
    hermesCmoMetadata: {
      toolTraceSummary: {
        source_label: "Lens / Product metric-definition snapshot",
        range_key: "yesterday",
        date_start: "2026-06-17",
        date_end: "2026-06-17",
        activation_status: "computed",
        activated_users: 4586,
        activation_rate: 0.22099074787972245,
        activation_events: ["Start-Mining", "Swap-Submit", "Swap-Success"],
        denominator: "active_users",
        retention_status: "not_matured",
      },
    },
  });
  const vaultMessage = assistantMessage({
    hermesCmoMetadata: {
      toolsUsed: ["cmo_read_vault_daily_report"],
      toolTraceSummary: {
        source_label: "Vault / Lens Daily Report",
        report_date: "2026-06-17",
        workspace_id: "holdstation-mini-app",
        path: "90 Runtime/Daily Notes/2026-06-17.md",
        sections: ["Core metrics", "Acquisition", "Behavior", "Activation", "Retention"],
        truth_status: "auto_observed",
      },
    },
  });
  const unsafeMessage = assistantMessage({
    hermesCmoMetadata: {
      toolTraceSummary: {
        source_label: "Lens / GA4 ad-hoc query",
        range_key: "this_week",
        warning: "Bearer secret-token Authorization CMO_LENS_INTERNAL_API_KEY raw_ga4_response",
        path: "C:\\Users\\ADMIN\\secret.json",
      },
    },
  });
  const cachedMessage = assistantMessage({
    hermesCmoMetadata: {
      lensReadoutAttached: true,
      lens_readout_attached: true,
      lensReadoutRangeKey: "this_week",
      lensReadoutStatus: "ready",
      lensReadoutDataStatus: "synced",
      toolTraceSummary: {
        source_label: "Lens / GA4 cached snapshot",
        current_range: "this_week",
        comparison_range: "last_7_days",
        metric: "activeUsers",
        delta: "+12.4%",
      },
    },
  });

  assert.equal(ga4Message.content, "Original Hermes answer.body stays exactly here.", "Hermes answer.body fixture must be unchanged");
  assert.equal(mapper.buildCmoEvidenceSources(ga4Message)[0].sourceLabel, "Lens / GA4 ad-hoc query");
  assert.match(renderedText(mapper.buildCmoActivitySteps(ga4Message)), /CMO analyzed[\s\S]*Lens queried[\s\S]*GA4 query[\s\S]*CMO answered/);

  const metricEvidence = mapper.buildCmoEvidenceSources(metricMessage)[0];
  assert.equal(metricEvidence.sourceLabel, "Lens / Product metric-definition snapshot");
  assert.match(renderedText(metricEvidence), /4,586 users · 22\.10%/);
  assert.match(renderedText(metricEvidence), /Start-Mining, Swap-Submit, Swap-Success/);
  assert.match(renderedText(metricEvidence), /Activation is not conversion unless explicitly defined/);

  const vaultEvidence = mapper.buildCmoEvidenceSources(vaultMessage)[0];
  assert.equal(vaultEvidence.sourceLabel, "Vault / Lens Daily Report");
  assert.match(renderedText(vaultEvidence), /2026-06-17/);
  assert.match(renderedText(vaultEvidence), /90 Runtime\/Daily Notes\/2026-06-17\.md/);

  const cachedEvidence = mapper.buildCmoEvidenceSources(cachedMessage)[0];
  assert.equal(cachedEvidence.sourceLabel, "Lens / GA4 cached snapshot");
  assert.match(renderedText(cachedEvidence), /this_week/);
  assert.match(renderedText(cachedEvidence), /last_7_days/);

  const unsafeRendered = renderedText(mapper.buildCmoEvidenceSources(unsafeMessage));
  assert.doesNotMatch(unsafeRendered, forbiddenRenderedPattern, "unsafe markers must not survive display mapping");
  assert.doesNotMatch(unsafeRendered, /\{\\?"source_label\\?":/, "raw JSON/tool payload must not be rendered directly");

  const panelSource = await source("src/components/cmo-apps/cmo-chat-panel.tsx");
  const activitySource = await source("src/components/cmo-apps/cmo-agent-activity-panel.tsx");
  const mapperSource = await source("src/lib/cmo/cmo-chat-evidence-display.ts");
  const chatMapperSource = await source("src/lib/cmo/hermes-cmo-chat-mapper.ts");
  const storeSource = await source("src/lib/cmo/app-chat-store.ts");
  const workspaceViewSource = await source("src/components/cmo-apps/app-workspace-view.tsx");

  assert.match(panelSource, /renderAssistantContent\(message\.content\)/, "Product UI must render Hermes answer body from message.content");
  assert.doesNotMatch(panelSource, /fetch\([^)]*evidence|\/api\/internal\/lens|\/api\/cmo\/apps\/\[appId\]\/metric-definitions/, "UI must not fetch Product/Lens evidence for already returned traces");
  assert.match(panelSource, /buildCmoEvidenceSources/, "Chat panel must render mapped evidence");
  assert.match(panelSource, /<details/, "Evidence UI must be collapsible");
  assert.match(activitySource, /buildCmoActivitySteps/, "Activity panel must use compact display steps");
  assert.match(activitySource, /<details/, "Activity UI must be collapsible");
  assert.match(mapperSource, /SENSITIVE_TEXT_PATTERN/, "Mapper must include sanitizer");
  assert.doesNotMatch(mapperSource, /JSON\.stringify|dangerouslySetInnerHTML|fetch\(/, "Mapper must not render raw JSON or call endpoints");
  assert.doesNotMatch(panelSource, /dangerouslySetInnerHTML/, "Chat panel must not render arbitrary HTML");
  assert.match(chatMapperSource, /toolTraceSummary, tool_trace_summary/, "Hermes mapper must preserve safe trace summary");
  assert.match(storeSource, /normalizeSafeTraceSummary/, "Store normalizer must sanitize trace summary");
  assert.match(workspaceViewSource, /function workspaceTabFromParam/, "Workspace view must normalize tab params");
  assert.match(workspaceViewSource, /value === "chat"[\s\S]{0,80}return "sessions"/, "tab=chat must alias to sessions");
  assert.doesNotMatch(mapperSource + panelSource + activitySource, /save-to-vault|capture-save|gbrain|GBrain|vault_write_performed:\s*true/i, "M11A UI must not add Vault or GBrain writes");

  console.log("CMO chat evidence UX check passed.");
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}
