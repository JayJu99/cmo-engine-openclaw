import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const runtimePath = path.join(root, "src", "lib", "cmo", "hermes-cmo-runtime.ts");

function runtimeWithoutImports() {
  const importedRuntimeStubs = `
const CMO_CREATIVE_LIFECYCLE_STATES = [];
const CMO_STRATEGIC_MODES = [];
const CMO_DECISION_LABELS = [];
`;

  return importedRuntimeStubs + fs.readFileSync(runtimePath, "utf8")
    .replace(/^import\s+(?:type\s+)?[\s\S]*?\s+from\s+["'][^"']+["'];\r?\n/gm, "");
}

const ordinaryRequest = {
  schema_version: "hermes.cmo.request.v1",
  request_id: "req_weekly_fixture_ordinary",
  session_id: "session_weekly_fixture",
  turn_id: "turn_weekly_fixture",
  created_at: "2026-07-10T00:00:00.000Z",
  workspace: { workspace_id: "workspace_1", app_id: "app_1", app_name: "App One" },
  user: { user_id: "user_1", display_name: null },
  intent: { mode: "cmo.default", user_message: "What should we prioritize this week?", explicit_command: null },
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
    mode: "cmo.weekly_campaign_plan",
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
    allowed_lens_modes: ["lens.measurement"],
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
  const { validateHermesCmoRuntimeRequest } = createRequire(outputPath)(outputPath);

  assert.equal(validateHermesCmoRuntimeRequest(ordinaryRequest), true, "ordinary Hermes request must remain valid");
  assert.equal(validateHermesCmoRuntimeRequest(weeklyGoalRequest), true, "exact /goal weekly workflow request must be valid for M1 runtime");
  assert.equal(
    validateHermesCmoRuntimeRequest({ ...weeklyGoalRequest, workflow: { ...weeklyGoalRequest.workflow, stages: ["lens", "echo"] } }),
    false,
    "weekly intent must reject a malformed workflow contract",
  );
  assert.equal(
    validateHermesCmoRuntimeRequest({ ...weeklyGoalRequest, intent: { ...weeklyGoalRequest.intent, mode: "cmo.default" } }),
    false,
    "ordinary intent must not accept a weekly workflow envelope",
  );

  console.log("cmo-weekly-campaign-request-validation-check: exact /goal fixture and ordinary request both validate for M1 runtime");
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}
