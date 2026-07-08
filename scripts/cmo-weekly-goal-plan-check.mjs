import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const planPath = path.join(root, "src", "lib", "cmo", "weekly-goal-plan.ts");

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

async function loadPlanHarness() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-weekly-goal-plan-"));
  const outputPath = path.join(tmpDir, "weekly-goal-plan.cjs");

  await writeFile(outputPath, transpileTs(planPath), "utf8");

  return {
    tmpDir,
    plan: createRequire(import.meta.url)(outputPath),
  };
}

function sourceOption(sourceType, status = "ready", role = "primary") {
  return {
    source_type: sourceType,
    source_id: `${sourceType}_source`,
    label: sourceType,
    provider: sourceType === "ga4_utm" ? "google_analytics" : sourceType === "meta_page_insights" ? "meta" : "x",
    status,
    role,
    supported_metrics: [],
    available_metrics: status === "ready" ? ["metric"] : [],
    missing_metrics: status === "ready" ? [] : ["metric"],
  };
}

function missingRequirement(sourceType, severity = "blocking") {
  return {
    key: `${sourceType}.missing`,
    source_type: sourceType,
    severity,
    action: `connect_${sourceType}`,
    safe_user_message: `Connect ${sourceType} before claiming a real baseline.`,
  };
}

function resolution(overrides = {}) {
  return {
    contract: "lens.metric_source_resolution.v1",
    resolved_metric: "website_traffic",
    goal_kind: "traffic",
    primary_source: sourceOption("ga4_utm"),
    enrichment_sources: [],
    fallback_sources: [
      sourceOption("manual_input", "ready", "fallback"),
      sourceOption("estimated", "ready", "fallback"),
    ],
    confidence: "high",
    baseline_status: "available",
    missing_requirements: [],
    ...overrides,
  };
}

function goal(overrides = {}) {
  const metricSourceResolution = overrides.metric_source_resolution ?? resolution();

  return {
    goal_id: "goal_m74_1",
    contract: "cmo.goal.v1",
    raw_user_message: "Increase website traffic this week.",
    normalized_goal_kind: metricSourceResolution.goal_kind,
    resolved_metric: metricSourceResolution.resolved_metric,
    workspace_id: "workspace_1",
    app_id: "app_1",
    user_id: "user_1",
    session_id: "session_1",
    target_window: {
      label: "this week",
      start_date: "2026-07-06",
      end_date: "2026-07-12",
      timezone: "Asia/Saigon",
    },
    metric_source_resolution: metricSourceResolution,
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
    ...overrides,
  };
}

function baselineTarget(overrides = {}) {
  return {
    contract: "cmo.goal_baseline_target.v1",
    goal_id: "goal_m74_1",
    workspace_id: "workspace_1",
    app_id: "app_1",
    session_id: "session_1",
    metric: {
      kind: "traffic",
      key: "website_traffic",
      label: "Website traffic",
    },
    baseline: {
      status: "ready",
      value: 100,
      unit: "sessions",
      source_kind: "ga4_utm",
      confidence: "high",
      evidence: [],
      is_real_measurement: true,
      is_estimated: false,
      planning_only: false,
    },
    target: {
      status: "ready",
      target_value: 130,
      delta_value: 30,
      delta_percent: 30,
      window: {
        label: "this week",
        start_date: "2026-07-06",
        end_date: "2026-07-12",
        timezone: "Asia/Saigon",
      },
      daily_targets: Array.from({ length: 7 }, (_, index) => ({
        day_index: index + 1,
        date: `2026-07-${String(index + 6).padStart(2, "0")}`,
        target_value: index === 6 ? 130 : 100 + Math.round(((index + 1) * 30) / 7),
        delta_value: index === 6 ? 30 : Math.round(((index + 1) * 30) / 7),
        cumulative_delta_value: index === 6 ? 30 : Math.round(((index + 1) * 30) / 7),
      })),
    },
    missing: {
      missing_capability_request: null,
      reason: null,
      code: null,
    },
    guardrails: {
      no_execution: true,
      approval_required_before_execution: true,
    },
    ...overrides,
  };
}

function assemble(plan, input) {
  return plan.assembleCmoWeeklyGoalPlan(input);
}

function walkKeys(value, keys = []) {
  if (!value || typeof value !== "object") {
    return keys;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      walkKeys(item, keys);
    }

    return keys;
  }

  for (const [key, nested] of Object.entries(value)) {
    keys.push(key);
    walkKeys(nested, keys);
  }

  return keys;
}

function assertNoForbiddenActionFields(value, label) {
  const forbidden = new Set([
    "publisher_job",
    "publish_job",
    "schedule_job",
    "execution_run",
    "execution_action_id",
    "side_effect_action_ids",
    "agent_execution",
    "social_publish",
    "daily_runner",
    "review_queue",
    "vault_write",
    "gbrain_write",
    "approval_auto_grant",
    "auto_grant",
    "approved_by_system",
    "scheduled_at",
    "publish_ready",
    "published_at",
    "publisher_job_id",
    "schedule_job_id",
    "execution_run_id",
  ]);
  const keys = walkKeys(value);

  assert.deepEqual(keys.filter((key) => forbidden.has(key)), [], `${label}: output must not include publish, schedule, execute, or approval auto-grant fields`);
}

function assertNoSecrets(value, label) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /\b(?:access_token|refresh_token|authorization|bearer|cookie|rawGa4Response|raw_google_response|SECRET_VALUE)\b/i,
    `${label}: output must not expose secrets or raw connector payloads`,
  );
}

function assertApprovalSeparated(value, label) {
  assert.equal(value.approval.approval_required, true, `${label}: plan approval must be required`);
  assert.equal(value.approval.approval_type, "plan", `${label}: approval type must be plan`);
  assert.equal(value.approval.execution_approval_required_separately, true, `${label}: execution approval must remain separate`);
  assert.match(value.approval.approval_prompt, /does not approve execution/i, `${label}: prompt must separate plan from execution`);
}

function assertGuardrails(value, label) {
  assert.equal(value.guardrails.no_execution, true, `${label}: no_execution guardrail must be true`);
  assert.equal(value.guardrails.no_publish, true, `${label}: no_publish guardrail must be true`);
  assert.equal(value.guardrails.no_schedule, true, `${label}: no_schedule guardrail must be true`);
  assert.equal(value.guardrails.approval_required_before_execution, true, `${label}: execution guardrail must be true`);
  assert.equal(value.guardrails.estimated_metrics_must_be_labeled, true, `${label}: estimated label guardrail must be true`);
}

function assertDraftBriefs(value, label) {
  assert.equal(value.days.length, 7, `${label}: expected 7-day plan`);
  assert.ok(value.days.every((day) => day.draft_briefs.length > 0), `${label}: each day needs draft briefs`);
  assert.ok(
    value.days.flatMap((day) => day.draft_briefs).every((brief) => brief.approval_status === "draft_requires_review"),
    `${label}: draft briefs must require review`,
  );
  assertNoForbiddenActionFields(value.days, `${label}: days`);
  assert.doesNotMatch(JSON.stringify(value.days), /\bscheduled_at\b|\bpublish_ready\b/i, `${label}: draft briefs must not be scheduled posts`);
}

function assertRenderable(value, label) {
  assert.equal(value.contract, "cmo.weekly_goal_plan.v1", `${label}: expected weekly plan contract`);
  assert.ok(value.plan_summary.user_visible_title, `${label}: user-visible title required`);
  assert.ok(value.plan_summary.user_visible_body, `${label}: user-visible body required`);
  assert.match(value.plan_summary.user_visible_body, /Goal request|Goal metric/i, `${label}: body should reference goal context`);
  assert.match(value.plan_summary.user_visible_body, /Baseline:/i, `${label}: body should reference baseline context`);
  assert.match(value.plan_summary.user_visible_body, /Target:/i, `${label}: body should reference target context`);
  assertApprovalSeparated(value, label);
  assertGuardrails(value, label);
  assertDraftBriefs(value, label);
  assertNoForbiddenActionFields(value, label);
  assertNoSecrets(value, label);
}

function assertSourceAudits() {
  assertIncludes(
    "src/lib/cmo/weekly-goal-plan.ts",
    'CMO_WEEKLY_GOAL_PLAN_CONTRACT = "cmo.weekly_goal_plan.v1"',
    "Weekly plan contract must exist",
  );
  assertIncludes(
    "src/lib/cmo/weekly-goal-plan.ts",
    "export function assembleCmoWeeklyGoalPlan",
    "Plan assembler must be exported",
  );
  assertIncludes(
    "src/lib/cmo/weekly-goal-plan.ts",
    "export function cmoWeeklyGoalPlanStatusFromBaselineTarget",
    "Plan status helper must be exported",
  );
  assertIncludes(
    "src/lib/cmo/weekly-goal-plan.ts",
    "export function createCmoWeeklyGoalPlanDays",
    "Daily plan helper must be exported",
  );
  assertIncludes(
    "src/lib/cmo/weekly-goal-plan.ts",
    "export function createCmoWeeklyGoalDraftBrief",
    "Draft brief helper must be exported",
  );
  assertIncludes(
    "src/lib/cmo/weekly-goal-plan.ts",
    "export function createCmoWeeklyGoalPlanApprovalPrompt",
    "Approval prompt helper must be exported",
  );
  assertIncludes(
    "src/lib/cmo/weekly-goal-plan.ts",
    "export function createCmoWeeklyGoalPlanSummary",
    "User-visible summary helper must be exported",
  );
  assertIncludes(
    "src/lib/cmo/weekly-goal-plan.ts",
    "export function createCmoWeeklyGoalUtmIntent",
    "UTM intent helper must be exported",
  );
  assertExcludes(
    "src/lib/cmo/weekly-goal-plan.ts",
    /\b(?:fetch\s*\(|runReport|runRealtimeReport|analyticsdata\.googleapis|graph\.facebook\.com|api\.x\.com|getWorkspaceGa4MetricSourceMapping|getLatestWorkspaceGa4MetricSnapshot|getLatestProductMetricDefinitionSnapshots)\b/i,
    "Weekly plan assembler must not call connector APIs, databases, or external services",
  );
  assertExcludes(
    "src/lib/cmo/weekly-goal-plan.ts",
    /\b(?:Date\.now|randomUUID)\b/,
    "Weekly plan assembler must not use Date.now or randomUUID internally",
  );
  assertExcludes(
    "src/lib/cmo/weekly-goal-plan.ts",
    /raw_user_message[\s\S]{0,220}(?:\.includes|\.match|\.test|RegExp)/,
    "Weekly plan assembler must not infer goal semantics from raw user text",
  );
  assertExcludes(
    "src/lib/cmo/weekly-goal-plan.ts",
    /\b(?:creative-agent|echo-bridge|runCreative|executeEcho|callEcho|callCreative)\b/i,
    "Weekly plan assembler must not call Echo or Creative execution paths",
  );
}

async function assertPlanBehavior() {
  const { tmpDir, plan } = await loadPlanHarness();
  const results = [];

  try {
    assert.equal(plan.CMO_WEEKLY_GOAL_PLAN_CONTRACT, "cmo.weekly_goal_plan.v1");

    let result = assemble(plan, {
      goal: goal(),
      baselineTarget: baselineTarget(),
      startDate: "2026-07-06",
    });
    results.push(result);
    assertRenderable(result, "ready traffic goal + real GA4 baseline/target");
    assert.equal(result.status, "ready_for_approval", "ready traffic goal: expected ready_for_approval");
    assert.equal(result.days.length, 7, "ready traffic goal: expected 7-day plan");
    assert.ok(result.draft_assembly.utm_intent, "ready traffic goal: expected UTM intent");
    assert.equal(result.draft_assembly.utm_intent.source_ready, true, "ready traffic goal: expected source-ready UTM intent");
    assert.match(result.plan_summary.user_visible_body, /GA4\/UTM/, "ready traffic goal: expected GA4/UTM baseline label");

    const missingGa4Resolution = resolution({
      primary_source: null,
      enrichment_sources: [sourceOption("x_post_insights", "ready", "enrichment")],
      confidence: "low",
      baseline_status: "missing",
      missing_requirements: [missingRequirement("ga4_utm", "blocking")],
    });
    result = assemble(plan, {
      goal: goal({
        goal_id: "goal_missing_ga4",
        metric_source_resolution: missingGa4Resolution,
        status: "needs_capability",
      }),
      baselineTarget: baselineTarget({
        goal_id: "goal_missing_ga4",
        baseline: {
          ...baselineTarget().baseline,
          status: "missing_primary_source",
          value: null,
          source_kind: "unknown",
          confidence: "unknown",
          is_real_measurement: false,
        },
        target: {
          ...baselineTarget().target,
          status: "needs_baseline",
          target_value: null,
          delta_value: null,
          delta_percent: null,
          daily_targets: [],
        },
        missing: {
          missing_capability_request: {
            source_kind: "ga4_utm",
            action: "connect_ga4_utm",
            safe_user_message: "Connect GA4/UTM before claiming a real traffic baseline.",
          },
          reason: "missing primary",
          code: "missing_primary_source",
        },
      }),
    });
    results.push(result);
    assertRenderable(result, "traffic goal + missing GA4 primary");
    assert.ok(["needs_capability", "needs_baseline"].includes(result.status), "missing GA4: expected capability or baseline status");
    assert.match(result.plan_summary.user_visible_body, /no real baseline is claimed|missing primary source/i, "missing GA4: must not claim real baseline");
    assert.match(JSON.stringify(result.days), /Connect GA4\/UTM/, "missing GA4: missing capability must be visible");

    result = assemble(plan, {
      goal: goal({ goal_id: "goal_manual_baseline" }),
      baselineTarget: baselineTarget({
        goal_id: "goal_manual_baseline",
        baseline: {
          ...baselineTarget().baseline,
          value: 80,
          source_kind: "manual_input",
          confidence: "medium",
          is_real_measurement: false,
        },
        target: {
          ...baselineTarget().target,
          target_value: 100,
          delta_value: 20,
          delta_percent: 25,
        },
      }),
    });
    results.push(result);
    assertRenderable(result, "manual baseline");
    assert.equal(result.status, "ready_for_approval", "manual baseline: expected ready_for_approval");
    assert.match(result.plan_summary.user_visible_body, /manual/i, "manual baseline: manual label must be visible");
    assert.doesNotMatch(result.plan_summary.user_visible_body, /real measurement/i, "manual baseline: must not claim connector measurement");

    result = assemble(plan, {
      goal: goal({ goal_id: "goal_estimated_baseline" }),
      baselineTarget: baselineTarget({
        goal_id: "goal_estimated_baseline",
        baseline: {
          ...baselineTarget().baseline,
          status: "estimated",
          value: 200,
          source_kind: "estimated",
          confidence: "low",
          is_real_measurement: false,
          is_estimated: true,
          planning_only: true,
        },
        target: {
          ...baselineTarget().target,
          target_value: 220,
          delta_value: 20,
          delta_percent: 10,
        },
      }),
    });
    results.push(result);
    assertRenderable(result, "estimated baseline");
    assert.equal(result.status, "estimated_plan_only", "estimated baseline: expected estimated_plan_only");
    assert.match(result.plan_summary.user_visible_body, /estimated|low confidence|planning-only/i, "estimated baseline: expected low-confidence estimate label");
    assert.doesNotMatch(result.plan_summary.user_visible_body, /real measurement/i, "estimated baseline: must not claim real measurement");
    assert.equal(result.approval.approval_required, true, "estimated baseline: approval still required");

    const unknownResolution = resolution({
      resolved_metric: "unknown_metric",
      goal_kind: "unknown",
      primary_source: null,
      enrichment_sources: [],
      confidence: "low",
      baseline_status: "missing",
      missing_requirements: [missingRequirement("estimated", "blocking")],
    });
    assert.doesNotThrow(() => {
      result = assemble(plan, {
        goal: goal({
          goal_id: "goal_unknown",
          normalized_goal_kind: "unknown",
          resolved_metric: "unknown_metric",
          metric_source_resolution: unknownResolution,
        }),
        baselineTarget: baselineTarget({
          goal_id: "goal_unknown",
          metric: {
            kind: "unknown",
            key: "unknown_metric",
            label: "Unknown metric",
          },
          baseline: {
            ...baselineTarget().baseline,
            status: "unavailable",
            value: null,
            source_kind: "unknown",
            confidence: "unknown",
            is_real_measurement: false,
          },
          target: {
            ...baselineTarget().target,
            status: "unsupported",
            target_value: null,
            delta_value: null,
            delta_percent: null,
            daily_targets: [],
          },
        }),
      });
      results.push(result);
      assertRenderable(result, "unsupported unknown goal");
      assert.equal(result.status, "unsupported", "unsupported unknown goal: expected unsupported");
    }, "unsupported/unknown goal should not throw");

    assert.doesNotThrow(() => {
      result = assemble(plan, {
        goal: {
          contract: "cmo.goal.v1",
        },
        baselineTarget: {
          contract: "cmo.goal_baseline_target.v1",
          baseline: {},
          target: {},
        },
      });
      results.push(result);
      assert.equal(result.status, "unsupported", "corrupt incomplete input: expected fail-safe unsupported status");
      assert.equal(result.days.length, 7, "corrupt incomplete input: expected safe 7-day shell");
    }, "corrupt incomplete input should fail safe without throwing");

    for (const [index, item] of results.entries()) {
      assertApprovalSeparated(item, `result ${index}`);
      assertGuardrails(item, `result ${index}`);
      assertDraftBriefs(item, `result ${index}`);
      assertNoForbiddenActionFields(item, `result ${index}`);
      assertNoSecrets(item, `result ${index}`);
    }

    assert.ok(
      results.some((item) => item.draft_assembly.utm_intent?.applies_to_goal === true),
      "UTM intent must be present for traffic goals",
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

assert.ok(fs.existsSync(planPath), "src/lib/cmo/weekly-goal-plan.ts is missing");
assertSourceAudits();
await assertPlanBehavior();

console.log(JSON.stringify({
  ok: true,
  contract: "cmo.weekly_goal_plan.v1",
  cases: 10,
}, null, 2));
