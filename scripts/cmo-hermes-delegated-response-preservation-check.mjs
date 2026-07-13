import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const fixture = JSON.parse(fs.readFileSync(path.join(root, "scripts", "fixtures", "hermes-cmo-delegated-weekly-campaign.json"), "utf8"));

function compileModule(relativePath, requireStub = () => ({})) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  const execute = new Function("module", "exports", "require", "__filename", "__dirname", output);
  execute(loaded, loaded.exports, requireStub, filename, path.dirname(filename));
  return loaded.exports;
}

function sourceAgent(event) {
  return event?.sourceAgent ?? event?.source?.agent;
}

function sourceMode(event) {
  return event?.sourceMode ?? event?.source?.mode;
}

const activityModule = {
  normalizeCmoActivityEvents(events) {
    return (Array.isArray(events) ? events : []).map((event) => ({
      ...event,
      eventId: event.event_id,
      sourceAgent: event.source?.agent,
      sourceMode: event.source?.mode,
      userVisible: event.user_visible,
    }));
  },
  cmoActivityEventSourceAgent: sourceAgent,
  cmoActivityEventSourceMode: sourceMode,
};

const mapper = compileModule("src/lib/cmo/hermes-cmo-chat-mapper.ts", (id) => {
  if (id === "@/lib/cmo/activity-events") return activityModule;
  if (id === "@/lib/cmo/lens-measurement-result") {
    return {
      compactLensMeasurementResultForHermesContext: () => undefined,
      createLensCapabilityContext: () => ({}),
    };
  }
  if (id.endsWith("app-routing-intent")) return { isExplicitCreativeExecutionIntent: () => false };
  if (id.endsWith("current-turn-response-contract")) {
    return { CURRENT_TURN_RESPONSE_INSTRUCTION: "fixture", createCurrentTurnResponseContract: () => ({}) };
  }
  if (id.endsWith("session-working-memory")) {
    return { resolveSessionWorkingMemory: () => ({ workingMemory: undefined, scopedResearchResults: [] }) };
  }
  if (id.endsWith("goal-state-transport")) return { activeGoalStateForHermesContext: () => undefined };
  throw new Error(`Unexpected mapper dependency: ${id}`);
});

const mapped = mapper.mapHermesCmoResponseToChatResult(fixture);
const expectedAnswer = fixture.response.answer.body;
const summaryOrder = mapped.hermesCmoMetadata.delegationSummary.map((item) => `${item.targetAgent}:${item.mode}`);

assert.equal(mapped.answer, expectedAnswer, "Product must render Hermes answer.body verbatim as the final answer");
assert.match(mapped.answer, /Weekly Referral Activation Campaign Pack/);
assert.match(mapped.answer, /Referral mechanics/);
assert.match(mapped.answer, /Activation plan/);
assert.doesNotMatch(mapped.answer, /^## Dune \/ Worldchain Business Metrics/m, "Lens evidence title must not replace the Hermes campaign answer");
assert.deepEqual(summaryOrder, ["lens:lens.query", "surf:surf.default", "echo:echo.default"], "delegation summary order must be Lens -> Surf -> Echo");
assert.deepEqual(mapped.hermesCmoMetadata.agentsUsed, ["cmo", "lens", "surf", "echo"], "agentsUsed must retain Lens, Surf, and Echo");
assert.equal(mapped.hermesCmoMetadata.activityEvents.length, 6, "all specialist activity events must be retained");
assert.deepEqual(
  [...new Set(mapped.hermesCmoMetadata.activityEvents.map(sourceAgent))],
  ["lens", "surf", "echo"],
  "activity events must retain all three specialist sources",
);
assert.deepEqual(
  mapped.sessionArtifacts.map((artifact) => artifact.contract),
  ["lens.measurement_result.v1", "hermes.surf.response.v1", "hermes.echo.response.v1", "cmo.weekly_campaign_pack.v1"],
  "all Hermes artifacts/evidence must be preserved",
);
assert.notEqual(mapped.delegationsMode, "proposals_only", "executed delegations must not be collapsed to proposals_only");
assert.equal(mapped.isRuntimeFallback, false);
assert.equal(mapped.hermesCmoMetadata.fallback_used, false);

const executor = compileModule("src/lib/cmo/hermes-cmo-delegation-executor.ts", (id) => {
  if (id === "./hermes-client") return { executeHermesEcho: async () => ({}), executeHermesSurf: async () => ({}) };
  throw new Error(`Unexpected executor dependency: ${id}`);
});
const deliberatelyUnsorted = [fixture.response.delegations[2], fixture.response.delegations[0], fixture.response.delegations[1]];
const executable = executor.executableDelegations(deliberatelyUnsorted, 3);
assert.deepEqual(
  executable.map((item) => `${item.targetAgent}:${item.mode}`),
  ["echo:echo.default", "lens:lens.query", "surf:surf.default"],
  "executor must preserve Hermes delegation order instead of sorting by agent",
);

const evidence = compileModule("src/lib/cmo/cmo-chat-evidence-display.ts");
const evidenceSources = evidence.buildCmoEvidenceSources({
  role: "assistant",
  content: mapped.answer,
  sessionArtifacts: mapped.sessionArtifacts,
  hermesCmoMetadata: mapped.hermesCmoMetadata,
});
assert.ok(evidenceSources.some((item) => item.sourceLabel.startsWith("Lens /")), "UI evidence must render Lens artifacts");
assert.ok(evidenceSources.some((item) => item.sourceLabel.startsWith("Surf /")), "UI evidence must render Surf artifacts");
assert.ok(evidenceSources.some((item) => item.sourceLabel.startsWith("Echo /")), "UI evidence must render Echo artifacts");

const appStoreSource = fs.readFileSync(path.join(root, "src", "lib", "cmo", "app-chat-store.ts"), "utf8");
const runtimeSource = fs.readFileSync(path.join(root, "src", "lib", "cmo", "hermes-cmo-runtime.ts"), "utf8");
assert.match(appStoreSource, /turnHermesArtifacts = mappedHermesResult\.sessionArtifacts \?\? \[\]/, "sync mapping must retain current-turn Hermes artifacts");
assert.match(appStoreSource, /sessionArtifacts: turnSessionArtifacts/, "assistant persistence must attach current-turn Hermes artifacts");
assert.doesNotMatch(runtimeSource, /requiredWeeklyCampaignDelegations|weekly_campaign_pack_incomplete|cmo_engine_m1_workflow_boundary/, "Product must not synthesize weekly delegation stages or campaign artifacts");
assert.match(runtimeSource, /HERMES_CMO_AGENT_PATH = "\/agents\/cmo\/execute"/, "Product execute transport must use /agents/cmo/execute");

console.log(JSON.stringify({
  status: "passed",
  answerTitle: fixture.response.answer.title,
  delegationSummary: summaryOrder,
  agentsUsed: mapped.hermesCmoMetadata.agentsUsed,
  activityEvents: mapped.hermesCmoMetadata.activityEvents.length,
  sessionArtifacts: mapped.sessionArtifacts.length,
  evidenceSources: evidenceSources.map((item) => item.sourceLabel),
}, null, 2));
