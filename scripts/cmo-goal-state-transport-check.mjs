import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const transportPath = path.join(root, "src", "lib", "cmo", "goal-state-transport.ts");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertIncludes(relativePath, expected, message) {
  assert.ok(source(relativePath).includes(expected), message);
}

function assertExcludes(relativePath, pattern, message) {
  assert.doesNotMatch(source(relativePath), pattern, message);
}

function transpileTs(filePath) {
  return ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: filePath,
  }).outputText;
}

async function loadTransportHarness() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-goal-state-transport-"));
  const outputPath = path.join(tmpDir, "goal-state-transport.cjs");

  await writeFile(outputPath, transpileTs(transportPath), "utf8");

  return {
    tmpDir,
    transport: createRequire(import.meta.url)(outputPath),
  };
}

function sampleGoal() {
  return {
    goal_id: "goal_transport_1",
    contract: "cmo.goal.v1",
    raw_user_message: "Increase website traffic this week.",
    normalized_goal_kind: "traffic",
    resolved_metric: "website_traffic",
    workspace_id: "workspace_1",
    app_id: "app_1",
    user_id: "user_1",
    session_id: "session_1",
    target_window: {
      label: "this week",
      timezone: "Asia/Saigon",
    },
    metric_source_resolution: {
      contract: "lens.metric_source_resolution.v1",
      goal_kind: "traffic",
      resolved_metric: "website_traffic",
      primary_source: {
        source_type: "ga4_utm",
        source_id: "ga4_native",
        label: "GA4 + UTM",
        status: "ready",
        required: true,
        blocking: true,
      },
      enrichment_sources: [],
      fallback_sources: [],
      confidence: "high",
      baseline_status: "available",
      missing_requirements: [],
    },
    status: "source_resolution_ready",
    approvals: {
      execution: { approved: false, approved_at: null, approved_by: null },
      publish: { approved: false, approved_at: null, approved_by: null },
      schedule: { approved: false, approved_at: null, approved_by: null },
      paid_generation: { approved: false, approved_at: null, approved_by: null },
      plan: { approved: false, approved_at: null, approved_by: null },
    },
    created_at: "2026-07-08T00:00:00.000Z",
    updated_at: "2026-07-08T00:00:00.000Z",
  };
}

function assertNoFakeMetricValues(value, label) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /\b(?:baseline_value|current_value|target_value|baselineValue|currentValue|targetValue|baseline_metric_value|current_metric_value)\b/i,
    `${label}: transport must not fabricate baseline/current/target metric values`,
  );
}

function assertNoUnsafeActionFields(value, label) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /\b(?:publisher_job|publish_job|schedule_job|execution_run|execution_action_id|side_effect_action_ids|agent_execution|social_publish|daily_runner|review_queue|vault_write|gbrain_write|approval_auto_grant|auto_grant)\b/i,
    `${label}: transport must not introduce publisher, scheduler, execution, review queue, Vault, GBrain, or approval auto-grant fields`,
  );
}

function assertApprovalsRemainNotGranted(goal, label) {
  for (const approvalName of ["execution", "publish", "schedule", "paid_generation", "plan"]) {
    assert.equal(goal.approvals[approvalName].approved, false, `${label}: ${approvalName} approval must not be auto-granted`);
  }
}

function assertTransportSourceShape() {
  assertIncludes(
    "src/lib/cmo/app-workspace-types.ts",
    "activeGoalState?: CmoGoalV1 | null;",
    "CMOContextPackage must expose activeGoalState?: CmoGoalV1 | null",
  );
  assertIncludes(
    "src/lib/cmo/context-pack-builder.ts",
    "activeGoalState: null,",
    "Context package construction must default activeGoalState to null",
  );

  for (const relativePath of [
    "src/lib/cmo/hermes-first-cmo-chat.ts",
    "src/lib/cmo/hermes-cmo-chat-v11.ts",
    "src/lib/cmo/hermes-cmo-chat-mapper.ts",
  ]) {
    assertIncludes(relativePath, "activeGoalStateForHermesContext(input.contextPackage.activeGoalState)", `${relativePath}: expected active goal serializer`);
    assertIncludes(relativePath, "active_goal_state", `${relativePath}: expected first-class context_pack.active_goal_state`);
    assertIncludes(relativePath, "user_message: input.message", `${relativePath}: latest user message must remain intent.user_message`);
  }

  for (const relativePath of [
    "src/lib/cmo/context-pack-builder.ts",
    "src/lib/cmo/goal-state-transport.ts",
    "src/lib/cmo/hermes-first-cmo-chat.ts",
    "src/lib/cmo/hermes-cmo-chat-v11.ts",
    "src/lib/cmo/hermes-cmo-chat-mapper.ts",
  ]) {
    assertExcludes(
      relativePath,
      /\b(?:readCmoGoal|createCmoGoalDraft|createAndStoreCmoGoalDraft|resolveLensMetricSourceResolution)\b/,
      `${relativePath}: transport patch must not load, create, infer, or resolve goals`,
    );
    assertExcludes(
      relativePath,
      /\b(?:allow_publish:\s*true|publish_allowed:\s*true|publisher_job|publish_job|schedule_job|execution_run|execution_action_id|approval_auto_grant|auto_grant)\b/i,
      `${relativePath}: transport patch must not add execution, publish, schedule, or approval auto-grant behavior`,
    );
  }

  assertExcludes(
    "src/lib/cmo/goal-state-transport.ts",
    /\b(?:ga4_utm|meta_page_insights|x_post_insights|x_api|manual_input|estimated)\b/,
    "Goal-state transport must not hardcode Product-side metric source selection",
  );
  assertExcludes(
    "src/lib/cmo/goal-state-transport.ts",
    /raw_user_message[\s\S]{0,160}(?:\.includes|\.match|\.test|RegExp)/,
    "Goal-state transport must not parse raw user messages",
  );
}

async function assertTransportBehavior() {
  const { tmpDir, transport } = await loadTransportHarness();

  try {
    const activeGoalState = sampleGoal();
    const contextPackage = {
      workspaceId: activeGoalState.workspace_id,
      sourceId: "holdstation-mini-app",
      mode: "app_context",
      activeGoalState,
    };
    const serialized = transport.activeGoalStateForHermesContext(contextPackage.activeGoalState);
    const outboundPayload = {
      intent: {
        user_message: "Latest turn asks for a fresh campaign plan.",
      },
      context_pack: {
        active_goal_state: serialized,
      },
    };

    assert.equal(transport.CMO_GOAL_STATE_TRANSPORT_CONTRACT, "cmo.goal.v1", "Expected cmo.goal.v1 transport contract");
    assert.ok(serialized, "Expected active goal state to serialize");
    assert.equal(serialized.contract, "cmo.goal.v1", "Serialized goal must preserve cmo.goal.v1");
    assert.equal(serialized.goal_id, activeGoalState.goal_id, "Serialized goal must preserve goal_id");
    assert.equal(serialized.status, activeGoalState.status, "Serialized goal must preserve status");
    assert.equal(serialized.normalized_goal_kind, activeGoalState.normalized_goal_kind, "Serialized goal must preserve normalized_goal_kind");
    assert.equal(serialized.resolved_metric, activeGoalState.resolved_metric, "Serialized goal must preserve resolved_metric");
    assert.deepEqual(serialized.metric_source_resolution, activeGoalState.metric_source_resolution, "Serialized goal must preserve metric_source_resolution");
    assert.deepEqual(serialized.approvals, activeGoalState.approvals, "Serialized goal must preserve approvals");
    assert.equal(serialized.created_at, activeGoalState.created_at, "Serialized goal must preserve created_at");
    assert.equal(serialized.updated_at, activeGoalState.updated_at, "Serialized goal must preserve updated_at");
    assert.equal(outboundPayload.context_pack.active_goal_state.contract, "cmo.goal.v1", "Outbound payload must expose context_pack.active_goal_state");
    assert.equal(outboundPayload.intent.user_message, "Latest turn asks for a fresh campaign plan.", "Latest user message must remain current-turn authority");
    assertApprovalsRemainNotGranted(serialized, "serialized active goal");
    assertNoFakeMetricValues(serialized, "serialized active goal");
    assertNoUnsafeActionFields(serialized, "serialized active goal");
    assertNoFakeMetricValues(outboundPayload, "outbound payload");
    assertNoUnsafeActionFields(outboundPayload, "outbound payload");
    assert.equal(transport.activeGoalStateForHermesContext(null), null, "Null active goal state must stay absent");
    assert.equal(transport.activeGoalStateForHermesContext({ contract: "other.goal.v1" }), null, "Wrong contract must not serialize");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

assert.ok(fs.existsSync(transportPath), "src/lib/cmo/goal-state-transport.ts is missing");
assertTransportSourceShape();
await assertTransportBehavior();

console.log(JSON.stringify({
  ok: true,
  contract: "cmo.goal.v1",
  transport: "context_pack.active_goal_state",
  cases: 8,
}, null, 2));
