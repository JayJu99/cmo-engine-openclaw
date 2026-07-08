import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const goalStatePath = path.join(root, "src", "lib", "cmo", "goal-state.ts");
const resolverPath = path.join(root, "src", "lib", "cmo", "lens-metric-source-resolution.ts");

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

async function loadGoalStateHarness() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-goal-state-"));
  const resolverOutputPath = path.join(tmpDir, "lens-metric-source-resolution.cjs");
  const goalOutputPath = path.join(tmpDir, "goal-state.cjs");
  const resolverOutput = transpileTs(resolverPath);
  const goalOutput = transpileTs(goalStatePath)
    .replace(/require\(["']server-only["']\);?\n?/g, "")
    .replace(/require\(["']@\/lib\/cmo\/lens-metric-source-resolution["']\)/g, 'require("./lens-metric-source-resolution.cjs")');

  await writeFile(resolverOutputPath, resolverOutput, "utf8");
  await writeFile(goalOutputPath, goalOutput, "utf8");

  return {
    tmpDir,
    goalState: createRequire(import.meta.url)(goalOutputPath),
  };
}

function ga4(status = "ready") {
  return {
    source_type: "ga4_utm",
    source_id: "ga4_native",
    status,
    available_metrics: [
      "social_referral_sessions",
      "landing_page_sessions",
      "engaged_sessions",
      "utm_campaign_sessions",
    ],
  };
}

function xPost(status = "ready") {
  return {
    source_type: "x_post_insights",
    source_id: "x_posts",
    status,
    available_metrics: ["impressions", "likes", "reposts", "replies"],
  };
}

function baseInput(overrides = {}) {
  return {
    rawUserMessage: "Increase website traffic this week.",
    workspaceId: "workspace_1",
    appId: "app_1",
    userId: "user_1",
    sessionId: "session_1",
    targetWindow: {
      label: "this week",
      timezone: "Asia/Saigon",
    },
    now: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

function sourceTypes(items) {
  return items.map((item) => item.source_type);
}

function assertNoFakeMetricValues(value, label) {
  const serialized = JSON.stringify(value);

  assert.doesNotMatch(serialized, /\b(?:baseline_value|current_value|baselineMetric|currentMetric|baselineStatusValue)\b/i, `${label}: goal state must not emit fake baseline/current metric values`);
}

function assertNoUnsafeActionFields(value, label) {
  const serialized = JSON.stringify(value);

  assert.doesNotMatch(
    serialized,
    /\b(?:publisher_job|publish_job|schedule_job|execution_run|execution_action_id|side_effect_action_ids|agent_execution|social_publish|daily_runner|review_queue|vault_write|gbrain_write)\b/i,
    `${label}: goal state must not carry publisher, scheduler, execution, review queue, Vault, or GBrain side-effect fields`,
  );
}

function assertApprovalDefaults(goal, label) {
  assert.equal(goal.approvals.execution.approved, false, `${label}: execution must default to not approved`);
  assert.equal(goal.approvals.publish.approved, false, `${label}: publish must default to not approved`);
  assert.equal(goal.approvals.schedule.approved, false, `${label}: schedule must default to not approved`);
  assert.equal(goal.approvals.paid_generation.approved, false, `${label}: paid generation must default to not approved`);
}

function assertGoalShape(goal, label) {
  assert.equal(goal.contract, "cmo.goal.v1", `${label}: expected cmo.goal.v1 contract`);
  assert.equal(typeof goal.goal_id, "string", `${label}: expected goal_id`);
  assert.equal(typeof goal.raw_user_message, "string", `${label}: expected raw_user_message`);
  assert.equal(typeof goal.normalized_goal_kind, "string", `${label}: expected normalized_goal_kind`);
  assert.equal(typeof goal.resolved_metric, "string", `${label}: expected resolved_metric`);
  assert.equal(typeof goal.workspace_id, "string", `${label}: expected workspace_id`);
  assert.equal(typeof goal.app_id, "string", `${label}: expected app_id`);
  assert.equal(typeof goal.user_id, "string", `${label}: expected user_id`);
  assert.equal(typeof goal.session_id, "string", `${label}: expected session_id`);
  assert.ok("target_window" in goal, `${label}: expected target_window`);
  assert.equal(goal.metric_source_resolution.contract, "lens.metric_source_resolution.v1", `${label}: expected Lens source resolution`);
  assert.equal(typeof goal.status, "string", `${label}: expected status`);
  assert.ok(goal.approvals, `${label}: expected approvals`);
  assert.equal(typeof goal.created_at, "string", `${label}: expected created_at`);
  assert.equal(typeof goal.updated_at, "string", `${label}: expected updated_at`);
}

function assertProductionHardcodeAudit() {
  const goalSource = source("src/lib/cmo/goal-state.ts");
  const resolverSource = source("src/lib/cmo/lens-metric-source-resolution.ts");

  assert.doesNotMatch(
    goalSource,
    /(?:rawUserMessage|raw_user_message)[\s\S]{0,250}(?:\.includes|\.match|\.test|RegExp)/,
    "Goal service must not classify raw user text with includes, match, test, or RegExp",
  );
  assert.doesNotMatch(
    goalSource,
    /\.includes\(\s*["'](?:traffic|facebook|meta|twitter|x|engagement|utm|referral|session)["']\s*\)/,
    "Goal service must not use keyword includes for source or goal routing",
  );
  assert.doesNotMatch(
    resolverSource,
    /raw_user_goal_message[\s\S]{0,500}(?:\.includes|\.match|\.test|RegExp|twitter|x_engagement)/,
    "Lens resolver must not classify raw user text for source routing",
  );
  assert.equal(resolverSource.includes("input.raw_user_goal_message"), false, "Lens resolver must not read raw_user_goal_message for source selection");
}

async function assertGoalStateBehavior() {
  const { tmpDir, goalState } = await loadGoalStateHarness();
  const results = [];

  try {
    assert.equal(goalState.CMO_GOAL_CONTRACT, "cmo.goal.v1");

    let goal = goalState.createCmoGoalDraft(baseInput({
      goalId: "goal_traffic_ga4_ready",
      normalizedGoalKind: "traffic",
      capabilities: {
        app: [ga4("ready")],
      },
    }));
    results.push(goal);
    assertGoalShape(goal, "traffic GA4 ready");
    assert.equal(goal.normalized_goal_kind, "traffic", "traffic GA4 ready: expected traffic kind");
    assert.equal(goal.resolved_metric, "website_traffic", "traffic GA4 ready: expected website traffic metric");
    assert.equal(goal.metric_source_resolution.primary_source?.source_type, "ga4_utm", "traffic GA4 ready: expected GA4 primary");
    assert.ok(["source_resolution_ready", "baseline_pending"].includes(goal.status), "traffic GA4 ready: expected source-ready or baseline-pending status");
    assertApprovalDefaults(goal, "traffic GA4 ready");
    assertNoFakeMetricValues(goal, "traffic GA4 ready");
    assertNoUnsafeActionFields(goal, "traffic GA4 ready");

    goal = goalState.createCmoGoalDraft(baseInput({
      goalId: "goal_traffic_x_enrichment_only",
      rawUserMessage: "Grow traffic from X this week.",
      normalizedGoalKind: "traffic",
      capabilities: {
        app: [ga4("missing")],
        channel: [xPost("ready")],
      },
    }));
    results.push(goal);
    assert.equal(goal.status, "needs_capability", "traffic GA4 missing + X ready: expected capability-needed status");
    assert.equal(goal.metric_source_resolution.primary_source, null, "traffic GA4 missing + X ready: X must not become website traffic primary");
    assert.ok(sourceTypes(goal.metric_source_resolution.enrichment_sources).includes("x_post_insights"), "traffic GA4 missing + X ready: expected X enrichment only");
    assertNoFakeMetricValues(goal, "traffic GA4 missing + X ready");
    assertNoUnsafeActionFields(goal, "traffic GA4 missing + X ready");

    goal = goalState.createCmoGoalDraft(baseInput({
      goalId: "goal_unknown_kind",
      normalizedGoalKind: undefined,
      capabilities: {
        app: [ga4("ready")],
      },
    }));
    results.push(goal);
    assert.equal(goal.status, "needs_metric_resolution", "unknown kind: expected metric-resolution-needed status");
    assert.equal(goal.normalized_goal_kind, "unknown", "unknown kind: expected unknown normalized kind");
    assert.equal(goal.resolved_metric, "unknown_metric", "unknown kind: expected unknown metric");
    assert.equal(goal.metric_source_resolution.primary_source, null, "unknown kind: expected no primary source");
    assert.equal(
      goal.metric_source_resolution.missing_requirements.find((requirement) => requirement.key === "goal_metric_resolution_missing")?.action,
      "ask_cmo_to_resolve_goal_metric",
      "unknown kind: expected CMO metric resolution action",
    );
    assertNoFakeMetricValues(goal, "unknown kind");
    assertNoUnsafeActionFields(goal, "unknown kind");

    goal = goalState.createCmoGoalDraft(baseInput({
      goalId: "goal_plan_approved",
      normalizedGoalKind: "traffic",
      capabilities: {
        app: [ga4("ready")],
      },
      planApproval: {
        approved: true,
        approved_by: "reviewer_1",
      },
    }));
    results.push(goal);
    assert.equal(goal.approvals.plan.approved, true, "approval defaults: plan approval should be recordable");
    assert.equal(goal.approvals.plan.approved_at, "2026-07-08T00:00:00.000Z", "approval defaults: plan approval should receive a timestamp");
    assertApprovalDefaults(goal, "approval defaults with plan approval");
    assertNoUnsafeActionFields(goal, "approval defaults with plan approval");

    const storeDir = path.join(tmpDir, "store");
    const savedGoal = await goalState.createAndStoreCmoGoalDraft(baseInput({
      goalId: "goal_save_load",
      normalizedGoalKind: "traffic",
      capabilities: {
        app: [ga4("ready")],
      },
    }), {
      storeDir,
    });
    const loadedGoal = await goalState.readCmoGoal(savedGoal.goal_id, {
      storeDir,
    });
    results.push(savedGoal);
    assert.deepEqual(loadedGoal, savedGoal, "goal save/load: expected persisted goal by goal_id");

    assert.doesNotMatch(JSON.stringify(results), /\b(?:access_token|refresh_token|authorization|headers|cookie|rawGa4Response|raw_google_response)\b/i, "goal state output must not expose connector secrets or raw API payloads");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

assert.ok(fs.existsSync(goalStatePath), "src/lib/cmo/goal-state.ts is missing");
assert.ok(fs.existsSync(resolverPath), "src/lib/cmo/lens-metric-source-resolution.ts is missing");
assertIncludes("src/lib/cmo/goal-state.ts", 'CMO_GOAL_CONTRACT = "cmo.goal.v1"', "CMO goal contract must exist");
assertIncludes("src/lib/cmo/goal-state.ts", "export interface CmoGoalV1", "CmoGoalV1 must exist");
assertIncludes("src/lib/cmo/goal-state.ts", "goal_id", "Goal state must store goal_id");
assertIncludes("src/lib/cmo/goal-state.ts", "raw_user_message", "Goal state must store raw_user_message");
assertIncludes("src/lib/cmo/goal-state.ts", "normalized_goal_kind", "Goal state must store normalized_goal_kind");
assertIncludes("src/lib/cmo/goal-state.ts", "resolved_metric", "Goal state must store resolved_metric");
assertIncludes("src/lib/cmo/goal-state.ts", "workspace_id", "Goal state must store workspace_id");
assertIncludes("src/lib/cmo/goal-state.ts", "app_id", "Goal state must store app_id");
assertIncludes("src/lib/cmo/goal-state.ts", "user_id", "Goal state must store user_id");
assertIncludes("src/lib/cmo/goal-state.ts", "session_id", "Goal state must store session_id");
assertIncludes("src/lib/cmo/goal-state.ts", "target_window", "Goal state must store target_window");
assertIncludes("src/lib/cmo/goal-state.ts", "metric_source_resolution", "Goal state must store metric_source_resolution");
assertIncludes("src/lib/cmo/goal-state.ts", "resolveLensMetricSourceResolution", "Goal service must use Lens metric source resolution");
assertIncludes("src/lib/cmo/goal-state.ts", "normalized_goal_kind: input.normalizedGoalKind", "Goal service must pass CMO-provided normalized goal kind into Lens");
assertExcludes("src/lib/cmo/goal-state.ts", /\b(?:fetch|runReport|runRealtimeReport|analyticsdata\.googleapis|graph\.facebook\.com|api\.x\.com)\b/i, "Goal state must not implement real connector calls");
assertExcludes("src/lib/cmo/goal-state.ts", /\b(?:baseline_value|current_value|baselineMetric|currentMetric)\b/i, "Goal state must not fake baseline/current metric values");
assertProductionHardcodeAudit();

await assertGoalStateBehavior();

console.log(JSON.stringify({
  ok: true,
  contract: "cmo.goal.v1",
  store: "file-backed",
  cases: 8,
}, null, 2));
