import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function includes(relativePath, value, message) {
  assert.ok(source(relativePath).includes(value), message);
}

function excludes(relativePath, pattern, message) {
  assert.doesNotMatch(source(relativePath), pattern, message);
}

const appStore = "src/lib/cmo/app-chat-store.ts";
const mapper = "src/lib/cmo/hermes-cmo-chat-mapper.ts";
const runtime = "src/lib/cmo/hermes-cmo-runtime.ts";
const executor = "src/lib/cmo/hermes-cmo-delegation-executor.ts";

includes(appStore, "const weeklyCampaignWorkflowRequested = isCmoGoalWorkflowSmokeRequest(request.message);", "Qualifying /goal must have an explicit weekly workflow guard.");
includes(appStore, "weeklyCampaignWorkflowRequested\n    ? null\n    : maybeCreateCmoGoalWorkflowSmokeResponse", "Qualifying /goal must bypass the deterministic smoke response.");
includes(appStore, "const hermesFirstNormalChatRequested = !weeklyCampaignWorkflowRequested", "Ordinary Hermes-first chat must stay separate from the weekly workflow.");
includes(appStore, "weeklyCampaignWorkflow: { commandText: weeklyCampaignCommandText }", "Product must transport command text rather than author campaign strategy or copy.");

includes(mapper, 'CMO_WEEKLY_CAMPAIGN_WORKFLOW_CONTRACT = "cmo.weekly_campaign_workflow.v1"', "Weekly workflow contract must be stable.");
includes(mapper, 'mode: weeklyCampaignWorkflow ? "cmo.weekly_campaign_plan" : "cmo.default"', "Weekly workflow must use a distinct CMO intent.");
includes(mapper, 'stages: ["lens", "surf", "echo", "cmo_synthesis"]', "Weekly workflow must declare Lens, Surf, Echo, and synthesis stages.");
includes(mapper, 'required_artifacts: [', "Weekly workflow must declare required artifacts.");
includes(mapper, 'weeklyCampaignArtifactsFromHermes', "Campaign packs must be safely transported from Hermes output.");
includes(mapper, 'suggestedUpdatesFromWeeklyCampaign', "Suggested updates must be provenance-gated to campaign pack artifacts.");
includes(mapper, 'HERMES_CMO_WEEKLY_CAMPAIGN_DELEGATIONS = "weekly_campaign_lens_surf_echo_bounded"', "Weekly workflow must preserve its distinct delegation mode through response mapping.");
includes(mapper, 'delegations_mode: requestedDelegationsMode', "Weekly workflow must not carry a conflicting proposals-only policy.");

includes(runtime, 'request.workflow.contract === "cmo.weekly_campaign_workflow.v1"', "Lens delegation must require the weekly workflow contract.");
includes(runtime, 'request.intent.explicit_command === "/goal"', "Lens delegation must require explicit /goal.");
includes(runtime, 'weeklyCampaignWorkflow || isCmoHermesCmoOrchestrationEnabled()', "Weekly workflow must activate bounded orchestration without changing ordinary-chat flags.");
includes(runtime, 'weeklyCampaignWorkflow ? ["lens"] as const', "Lens must be added only to the workflow-specific delegation policy.");
includes(runtime, '!requestIsWeeklyCampaignWorkflow(request)', "Weekly workflow must bypass the read-only tool_execute endpoint.");
includes(runtime, 'requiredWeeklyCampaignDelegations', "Weekly workflow must attempt Lens, Surf, and Echo even if CMO omits delegation proposals.");
includes(runtime, 'responseWithWeeklyCampaignWorkflowArtifact', "Weekly workflow must return an incomplete campaign artifact instead of silently omitting provenance.");

includes(executor, 'export type HermesCmoExecutableAgent = "echo" | "surf" | "lens"', "Executor must support Lens as a bounded delegate.");
includes(executor, 'runLensMeasurementRequest', "Lens delegate must call the bounded measurement runner.");
includes(executor, 'contract: "lens.measurement_result.v1"', "Lens delegate must return a structured measurement artifact.");
includes(executor, 'Lens measurement is unavailable for this scope.', "Lens unavailable state must be explicit.");
excludes(executor, /executeHermesCmoDelegations[\s\S]{0,400}\bwriteFile\b/, "Lens delegation executor must not write files.");

console.log("cmo-weekly-campaign-workflow-check: contract, bounded Lens delegation, artifact provenance, and ordinary-chat isolation passed");
