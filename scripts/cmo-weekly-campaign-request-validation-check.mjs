import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const runtimePath = path.join(root, "src", "lib", "cmo", "hermes-cmo-runtime.ts");
const delegatedFixture = JSON.parse(fs.readFileSync(path.join(root, "scripts", "fixtures", "hermes-cmo-delegated-weekly-campaign.json"), "utf8"));

function runtimeWithoutImports() {
const importedRuntimeStubs = `
const CMO_CREATIVE_LIFECYCLE_STATES = [];
const CMO_STRATEGIC_MODES = [];
const CMO_DECISION_LABELS = [];
const redactSensitiveText = (value) => String(value);
const redactedLocalArtifactPath = () => null;
const getCmoHermesCmoMaxDelegations = () => 3;
const getCmoHermesCmoToolEndpoint = () => "/agents/cmo/tool-execute";
const getCmoHermesCmoToolChatCanaryApps = () => [];
const getCmoHermesCmoToolTimeoutMs = () => 5_000;
const getCmoHermesUnifiedAgentCanaryApps = () => [];
const getCmoHermesUnifiedAgentEndpoint = () => "/agents/cmo/agent";
const getCmoHermesUnifiedAgentTimeoutMs = () => 5_000;
const getCmoHermesCreativeCallMode = () => "disabled";
const getCmoHermesCreativeExecuteTimeoutMs = () => 5_000;
const getCmoHermesCreativeProfile = () => "default";
const isCmoHermesCmoOrchestrationEnabled = () => false;
const isCmoHermesCmoToolChatEnabled = () => false;
const isCmoHermesCmoToolExecuteEnabled = () => true;
const isCmoHermesCreativeEnabled = () => false;
const isCmoHermesUnifiedAgentEnabled = () => false;
const buildCleanCmoSkillKernel = () => ({});
const stableDelegationKey = (delegation) => delegation.target.agent + ":" + delegation.target.mode + ":" + delegation.delegation_id;
const executableDelegations = (delegations, maxDelegations) => delegations.flatMap((delegation, index) => {
  const target = delegation && delegation.target || {};
  const agent = target.agent;
  const mode = target.mode;
  if (!["lens", "surf", "echo"].includes(agent)) return [];
  if (agent === "lens" && !["lens.query", "lens.measurement"].includes(mode)) return [];
  if (agent === "surf" && !["surf.default", "surf.x", "surf.trend", "surf.pulse"].includes(mode)) return [];
  if (agent === "echo" && !["echo.default", "echo.source_translate"].includes(mode)) return [];
  return [{ raw: delegation, delegationId: delegation.delegation_id || "del_" + index, targetAgent: agent, mode }];
}).slice(0, maxDelegations);
`;

  return importedRuntimeStubs + fs.readFileSync(runtimePath, "utf8")
    .replace(/^import\s+(?:type\s+)?[\s\S]*?\s+from\s+["'][^"']+["'];\r?\n/gm, "") + `
module.exports.__weeklyLiveContract = {
  buildHermesCmoLiveRequest,
  extractLiveResponsePayload,
  selectedHermesCmoConfig,
  agentsUsedFrom,
};
`;
}

const ordinaryRequest = {
  schema_version: "hermes.cmo.request.v1",
  request_id: "req_weekly_fixture_ordinary",
  session_id: "session_weekly_fixture",
  turn_id: "turn_weekly_fixture",
  created_at: "2026-07-10T00:00:00.000Z",
  workspace: { workspace_id: "workspace_1", app_id: "app_1", app_name: "App One" },
  user: { user_id: "user_1", display_name: null },
  intent: { mode: "cmo.default", user_message: "Create a weekly campaign plan for social traffic.", explicit_command: null },
  context_pack: {
    current_priority: [],
    selected_context: [],
    recent_session_summary: null,
    indexed_context_supplement: [],
    artifacts_in: [],
  },
  constraints: {
    no_direct_vault_write: true,
    no_direct_memory_mutation: true,
    vault_agent_delegation_allowed: false,
    vault_agent_requires_save_intent: true,
    kanban_enabled: false,
    demo_mode: true,
    allowed_agents: ["echo", "surf"],
    allowed_surf_modes: ["surf.default", "surf.x", "surf.trend", "surf.pulse"],
  },
  ui: { activity_stream_required: true, heartbeat_required: true },
};

const weeklyGoalRequest = {
  ...ordinaryRequest,
  request_id: "req_weekly_fixture_goal",
  intent: {
    mode: "cmo.default",
    explicit_command: "/goal",
    user_message: "increase social traffic this week",
  },
  workflow: {
    contract: "cmo.weekly_campaign_workflow.v1",
    trigger: "explicit_goal_command",
    plan_only: true,
    stages: ["lens", "surf", "echo", "cmo_synthesis"],
    required_artifacts: [
      "lens.measurement_result.v1",
      "hermes.surf.response.v1",
      "hermes.echo.response.v1",
      "cmo.weekly_campaign_pack.v1",
    ],
    specialist_policy: {
      lens: "required_if_available",
      surf: "required_if_available",
      echo: "required_if_available",
    },
  },
  constraints: {
    ...ordinaryRequest.constraints,
    allowed_agents: ["lens", "echo", "surf"],
    allowed_lens_modes: ["lens.query", "lens.measurement"],
    delegations_mode: "weekly_campaign_lens_surf_echo_bounded",
  },
};

const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-weekly-request-validation-"));

try {
  const outputPath = path.join(tmpDir, "hermes-cmo-runtime.cjs");
  const output = ts.transpileModule(runtimeWithoutImports(), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: runtimePath,
  }).outputText;
  await writeFile(outputPath, output, "utf8");
  const runtime = createRequire(outputPath)(outputPath);
  const { validateHermesCmoRuntimeRequest, __weeklyLiveContract } = runtime;

  assert.equal(validateHermesCmoRuntimeRequest(ordinaryRequest), true, "ordinary Hermes request must remain valid");
  assert.equal(validateHermesCmoRuntimeRequest(weeklyGoalRequest), true, "exact /goal weekly workflow request must be valid for M1 runtime");
  const delegatedResponse = {
    ...delegatedFixture.response,
    request_id: weeklyGoalRequest.request_id,
    session_id: weeklyGoalRequest.session_id,
    turn_id: weeklyGoalRequest.turn_id,
  };
  assert.equal(delegatedResponse.classification, "needs_surf_then_echo", "fixture must use the live Hermes weekly orchestration classification");
  assert.equal(delegatedResponse.structured_output.classification, "needs_surf_then_echo", "fixture structured output must preserve the live classification");
  assert.equal(
    runtime.validateHermesCmoRuntimeResponse(delegatedResponse, weeklyGoalRequest, { allowExecutableDelegations: true, maxDelegations: 3 }),
    true,
    "M1 response validator must accept the live Lens lens.query -> Surf -> Echo delegation protocol",
  );
  const acceptedWeeklyPayload = __weeklyLiveContract.extractLiveResponsePayload(
    {
      ...delegatedFixture,
      response: delegatedResponse,
      activity_events: delegatedFixture.activity_events.map((event) => ({
        ...event,
        request_id: weeklyGoalRequest.request_id,
        session_id: weeklyGoalRequest.session_id,
        turn_id: weeklyGoalRequest.turn_id,
      })),
    },
    weeklyGoalRequest,
    { allowExecutableDelegations: true, maxDelegations: 3 },
    { allowExecutableDelegationActivity: true },
  );
  assert.equal(acceptedWeeklyPayload.response.classification, "needs_surf_then_echo", "accepted strict Hướng A response must not enter fallback");
  assert.deepEqual(
    acceptedWeeklyPayload.response.delegations.map((delegation) => delegation.target.agent),
    ["lens", "surf", "echo"],
    "accepted strict Hướng A response must preserve Lens -> Surf -> Echo order",
  );

  const echoOnlyActivityEvents = delegatedFixture.activity_events
    .filter((event) => event.source.agent === "echo")
    .map((event, index) => ({
      ...event,
      event_id: `evt_existing_evidence_echo_${index + 1}`,
      request_id: weeklyGoalRequest.request_id,
      session_id: weeklyGoalRequest.session_id,
      turn_id: weeklyGoalRequest.turn_id,
      seq: index + 1,
    }));
  const needsEchoResponse = {
    ...delegatedResponse,
    classification: "needs_echo",
    structured_output: {
      ...delegatedResponse.structured_output,
      classification: "needs_echo",
    },
    delegations: delegatedResponse.delegations.filter((delegation) => delegation.target.agent === "echo"),
    artifacts: delegatedResponse.artifacts.filter((artifact) => artifact.source_agent === "lens" || artifact.source_agent === "surf"),
    activity_summary: {
      ...delegatedResponse.activity_summary,
      events_count: echoOnlyActivityEvents.length,
    },
  };
  const acceptedNeedsEchoPayload = __weeklyLiveContract.extractLiveResponsePayload(
    {
      response: needsEchoResponse,
      activity_events: echoOnlyActivityEvents,
      side_effects: false,
    },
    weeklyGoalRequest,
    { allowExecutableDelegations: true, maxDelegations: 3 },
    { allowExecutableDelegationActivity: true },
  );
  assert.equal(acceptedNeedsEchoPayload.response.classification, "needs_echo", "existing Lens+Surf evidence requesting Echo only must not enter fallback");
  assert.deepEqual(
    acceptedNeedsEchoPayload.response.artifacts.map((artifact) => artifact.source_agent),
    ["lens", "surf"],
    "needs_echo fixture must retain existing Lens and Surf artifacts",
  );
  assert.deepEqual(
    acceptedNeedsEchoPayload.response.delegations.map((delegation) => delegation.target.agent),
    ["echo"],
    "needs_echo fixture must request Echo only",
  );
  assert.equal(
    runtime.validateHermesCmoRuntimeResponse(
      { ...delegatedResponse, classification: "arbitrary_runtime_value" },
      weeklyGoalRequest,
      { allowExecutableDelegations: true, maxDelegations: 3 },
    ),
    false,
    "M1 response validator must continue rejecting arbitrary classification strings",
  );
  assert.equal(
    validateHermesCmoRuntimeRequest({ ...weeklyGoalRequest, workflow: { ...weeklyGoalRequest.workflow, stages: ["lens", "echo"] } }),
    false,
    "weekly intent must reject a malformed workflow contract",
  );
  assert.equal(
    validateHermesCmoRuntimeRequest({ ...weeklyGoalRequest, intent: { ...weeklyGoalRequest.intent, explicit_command: null } }),
    false,
    "a workflow envelope without explicit /goal must not activate or validate as weekly",
  );
  assert.equal(
    validateHermesCmoRuntimeRequest({ ...ordinaryRequest, workflow: { contract: "unrelated.workflow.v1" } }),
    false,
    "ordinary cmo.default chat must reject random workflow fields",
  );

  const liveWeeklyRequest = __weeklyLiveContract.buildHermesCmoLiveRequest(weeklyGoalRequest, { orchestrationEnabled: true });
  assert.equal(liveWeeklyRequest.constraints.delegations_mode, "weekly_campaign_lens_surf_echo_bounded", "valid /goal must enable weekly bounded delegations in the live payload");
  assert.deepEqual(liveWeeklyRequest.constraints.allowed_agents, ["lens", "echo", "surf"], "live /goal must expose Lens, Echo, and Surf only for the workflow");
  assert.deepEqual(liveWeeklyRequest.constraints.allowed_lens_modes, ["lens.query", "lens.measurement"], "live /goal must advertise the Lens protocol modes Hermes can delegate");
  assert.equal(liveWeeklyRequest.constraints.allowLensExecution, true, "live /goal must enable Lens execution");
  const liveOrdinaryRequest = __weeklyLiveContract.buildHermesCmoLiveRequest(ordinaryRequest, { orchestrationEnabled: false });
  assert.equal(liveOrdinaryRequest.constraints.delegations_mode, "proposals_only", "ordinary cmo.default chat without workflow must remain proposals-only");

  const previousEnv = {
    CMO_HERMES_EXECUTION_ENABLED: process.env.CMO_HERMES_EXECUTION_ENABLED,
    CMO_HERMES_BASE_URL: process.env.CMO_HERMES_BASE_URL,
    CMO_HERMES_API_KEY: process.env.CMO_HERMES_API_KEY,
  };
  process.env.CMO_HERMES_EXECUTION_ENABLED = "true";
  process.env.CMO_HERMES_BASE_URL = "http://127.0.0.1:9911";
  process.env.CMO_HERMES_API_KEY = "weekly-test-key";
  try {
    const config = __weeklyLiveContract.selectedHermesCmoConfig(liveWeeklyRequest);
    assert.equal(config.endpointKind, "execute", "valid /goal must bypass the read-only tool_execute endpoint");
    assert.equal(config.routeDecision, "execute", "valid /goal must use the delegation-compatible execute route");
  } finally {
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  assert.deepEqual(
    __weeklyLiveContract.agentsUsedFrom({ agentsUsed: ["lens", "surf", "echo"] }),
    ["cmo", "lens", "surf", "echo"],
    "weekly specialist attempts must retain CMO, Lens, Surf, and Echo provenance",
  );
  assert.doesNotMatch(fs.readFileSync(runtimePath, "utf8"), /requiredWeeklyCampaignDelegations|weekly_campaign_pack_incomplete/, "Product must execute only Hermes-returned delegations and must not synthesize campaign artifacts");

  console.log("cmo-weekly-campaign-request-validation-check: strict needs_surf_then_echo and needs_echo responses validate M1 without fallback; /goal still uses Hermes-owned orchestration");
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}
