import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const calculatorPath = path.join(root, "src", "lib", "cmo", "goal-baseline-target.ts");

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

async function loadCalculatorHarness() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-goal-baseline-target-"));
  const outputPath = path.join(tmpDir, "goal-baseline-target.cjs");

  await writeFile(outputPath, transpileTs(calculatorPath), "utf8");

  return {
    tmpDir,
    calculator: createRequire(import.meta.url)(outputPath),
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
    goal_id: "goal_m73_1",
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

function calculate(calculator, input) {
  return calculator.calculateCmoGoalBaselineTarget(input);
}

function assertNoFakeBaseline(value, label) {
  if (value.baseline.status !== "ready" && value.baseline.status !== "estimated") {
    assert.equal(value.baseline.value, null, `${label}: missing baseline states must not carry a numeric baseline`);
  }

  if (value.target.status !== "ready") {
    assert.equal(value.target.target_value, null, `${label}: non-ready targets must not carry a target value`);
    assert.equal(value.target.delta_value, null, `${label}: non-ready targets must not carry a delta value`);
  }
}

function assertNoUnsafeActionFields(value, label) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /\b(?:publisher_job|publish_job|schedule_job|execution_run|execution_action_id|side_effect_action_ids|agent_execution|social_publish|daily_runner|review_queue|vault_write|gbrain_write|approval_auto_grant|auto_grant|approved_by_system)\b/i,
    `${label}: calculator output must not include execution, publish, schedule, or approval auto-grant fields`,
  );
}

function assertNoSecrets(value, label) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /\b(?:access_token|refresh_token|authorization|bearer|cookie|rawGa4Response|raw_google_response|SECRET_VALUE)\b/i,
    `${label}: calculator output must not expose secrets or raw connector payloads`,
  );
}

function assertGuardrails(value, label) {
  assert.equal(value.guardrails.no_execution, true, `${label}: no_execution guardrail must be true`);
  assert.equal(value.guardrails.approval_required_before_execution, true, `${label}: execution approval guardrail must be true`);
}

function assertContractShape(value, label) {
  assert.equal(value.contract, "cmo.goal_baseline_target.v1", `${label}: expected baseline/target contract`);
  assert.ok("goal_id" in value, `${label}: expected goal_id`);
  assert.ok("workspace_id" in value, `${label}: expected workspace_id`);
  assert.ok("app_id" in value, `${label}: expected app_id`);
  assert.ok("session_id" in value, `${label}: expected session_id`);
  assert.ok(value.metric, `${label}: expected metric`);
  assert.ok(value.baseline, `${label}: expected baseline`);
  assert.ok(value.target, `${label}: expected target`);
  assert.ok(value.missing, `${label}: expected missing`);
  assertGuardrails(value, label);
  assertNoFakeBaseline(value, label);
  assertNoUnsafeActionFields(value, label);
  assertNoSecrets(value, label);
}

function sum(values) {
  return Math.round(values.reduce((total, value) => total + value, 0) * 1_000_000) / 1_000_000;
}

function assertSourceAudits() {
  assertIncludes(
    "src/lib/cmo/goal-baseline-target.ts",
    'CMO_GOAL_BASELINE_TARGET_CONTRACT = "cmo.goal_baseline_target.v1"',
    "Baseline/target contract must exist",
  );
  assertIncludes(
    "src/lib/cmo/goal-baseline-target.ts",
    "export function calculateCmoGoalBaselineTarget",
    "Calculator function must be exported",
  );
  assertIncludes(
    "src/lib/cmo/goal-baseline-target.ts",
    "export function calculatePercentageIncreaseTarget",
    "Percent target helper must be exported",
  );
  assertIncludes(
    "src/lib/cmo/goal-baseline-target.ts",
    "export function calculateAbsoluteTarget",
    "Absolute target helper must be exported",
  );
  assertIncludes(
    "src/lib/cmo/goal-baseline-target.ts",
    "export function createWeeklyDailyTargets",
    "Weekly daily target helper must be exported",
  );
  assertExcludes(
    "src/lib/cmo/goal-baseline-target.ts",
    /\b(?:fetch\s*\(|runReport|runRealtimeReport|analyticsdata\.googleapis|graph\.facebook\.com|api\.x\.com|getWorkspaceGa4MetricSourceMapping|getLatestWorkspaceGa4MetricSnapshot|getLatestProductMetricDefinitionSnapshots)\b/i,
    "Calculator must not call connector APIs, databases, or external services",
  );
  assertExcludes(
    "src/lib/cmo/goal-baseline-target.ts",
    /\b(?:lens-measurement-runner|shouldRunLensMeasurementForMessage|raw_user_message[\s\S]{0,180}(?:includes|match|test|RegExp))\b/i,
    "Calculator must not use Product-side keyword measurement runner logic",
  );
  assertExcludes(
    "src/lib/cmo/goal-baseline-target.ts",
    /\b(?:Date\.now|randomUUID)\b/,
    "Calculator must not use Date.now or randomUUID internally",
  );
}

async function assertCalculatorBehavior() {
  const { tmpDir, calculator } = await loadCalculatorHarness();
  const results = [];

  try {
    assert.equal(calculator.CMO_GOAL_BASELINE_TARGET_CONTRACT, "cmo.goal_baseline_target.v1");

    let result = calculate(calculator, {
      goal: goal(),
      baseline: {
        kind: "real",
        value: 100,
        unit: "sessions",
        source_kind: "ga4_utm",
        confidence: "high",
        evidence: [
          {
            source_kind: "ga4_utm",
            source_id: "ga4_native",
            note: "access_token SECRET_VALUE",
          },
        ],
      },
      target: {
        mode: "percent_increase",
        percent: 30,
      },
    });
    results.push(result);
    assertContractShape(result, "traffic GA4 ready + real baseline");
    assert.equal(result.baseline.status, "ready", "traffic GA4 ready + real baseline: baseline should be ready");
    assert.equal(result.baseline.value, 100, "traffic GA4 ready + real baseline: expected supplied baseline");
    assert.equal(result.baseline.source_kind, "ga4_utm", "traffic GA4 ready + real baseline: expected GA4 source");
    assert.equal(result.baseline.is_real_measurement, true, "traffic GA4 ready + real baseline: expected real measurement");
    assert.equal(result.target.status, "ready", "traffic GA4 ready + real baseline: target should be ready");

    const xEnrichmentOnlyResolution = resolution({
      primary_source: null,
      enrichment_sources: [sourceOption("x_post_insights", "ready", "enrichment")],
      confidence: "low",
      baseline_status: "missing",
      missing_requirements: [missingRequirement("ga4_utm", "blocking")],
    });
    result = calculate(calculator, {
      goal: goal({
        goal_id: "goal_x_enrichment_only",
        metric_source_resolution: xEnrichmentOnlyResolution,
        status: "needs_capability",
      }),
      target: {
        mode: "percent_increase",
        percent: 30,
      },
    });
    results.push(result);
    assertContractShape(result, "traffic GA4 missing + X enrichment only");
    assert.equal(result.baseline.status, "missing_primary_source", "traffic GA4 missing + X enrichment only: expected missing primary source");
    assert.equal(result.baseline.value, null, "traffic GA4 missing + X enrichment only: must not fake baseline");
    assert.equal(result.baseline.source_kind, "unknown", "traffic GA4 missing + X enrichment only: X enrichment must not become primary");
    assert.equal(result.missing.missing_capability_request.source_kind, "ga4_utm", "traffic GA4 missing + X enrichment only: GA4 remains the missing traffic primary");
    assert.equal(result.target.status, "needs_baseline", "traffic GA4 missing + X enrichment only: target needs baseline");

    result = calculate(calculator, {
      goal: goal({
        goal_id: "goal_manual_baseline",
        metric_source_resolution: xEnrichmentOnlyResolution,
        status: "needs_capability",
      }),
      baseline: {
        kind: "manual",
        value: 80,
        unit: "sessions",
      },
      target: {
        mode: "absolute",
        target_value: 100,
      },
    });
    results.push(result);
    assertContractShape(result, "manual baseline supplied");
    assert.equal(result.baseline.status, "ready", "manual baseline supplied: baseline should be ready");
    assert.equal(result.baseline.source_kind, "manual_input", "manual baseline supplied: expected manual source");
    assert.equal(result.baseline.is_real_measurement, false, "manual baseline supplied: manual is not automatically real measured data");
    assert.equal(result.baseline.is_estimated, false, "manual baseline supplied: manual is not estimated");
    assert.equal(result.target.status, "ready", "manual baseline supplied: target should be ready");
    assert.equal(result.target.target_value, 100, "manual baseline supplied: expected absolute target");

    result = calculate(calculator, {
      goal: goal({
        goal_id: "goal_estimated_baseline",
      }),
      baseline: {
        kind: "estimated",
        value: 200,
        unit: "sessions",
      },
      target: {
        mode: "percent_increase",
        percent: 10,
      },
    });
    results.push(result);
    assertContractShape(result, "estimated baseline explicitly supplied");
    assert.equal(result.baseline.status, "estimated", "estimated baseline: expected estimated status");
    assert.equal(result.baseline.confidence, "low", "estimated baseline: expected low confidence");
    assert.equal(result.baseline.planning_only, true, "estimated baseline: expected planning-only flag");
    assert.equal(result.baseline.is_real_measurement, false, "estimated baseline: must not be real measurement");
    assert.equal(result.baseline.is_estimated, true, "estimated baseline: expected is_estimated");
    assert.equal(result.target.status, "ready", "estimated baseline: target can be calculated for planning");

    assert.deepEqual(
      calculator.calculatePercentageIncreaseTarget({
        baselineValue: 100,
        percent: 30,
      }),
      {
        target_value: 130,
        delta_value: 30,
        delta_percent: 30,
      },
      "Percent target helper should calculate +30% from 100",
    );

    result = calculate(calculator, {
      goal: goal({
        goal_id: "goal_weekly_breakdown",
      }),
      baseline: {
        kind: "real",
        value: 100,
        unit: "sessions",
      },
      target: {
        mode: "percent_increase",
        percent: 28,
      },
    });
    results.push(result);
    assertContractShape(result, "weekly target daily breakdown");
    assert.equal(result.target.status, "ready", "weekly target daily breakdown: expected ready target");
    assert.equal(result.target.daily_targets.length, 7, "weekly target daily breakdown: expected seven days");
    assert.equal(result.target.daily_targets[0].date, "2026-07-06", "weekly target daily breakdown: expected deterministic start date");
    assert.equal(result.target.daily_targets.at(-1).date, "2026-07-12", "weekly target daily breakdown: expected deterministic end date");
    assert.equal(result.target.daily_targets.at(-1).target_value, 128, "weekly target daily breakdown: final day must end at target");
    assert.equal(sum(result.target.daily_targets.map((item) => item.delta_value)), 28, "weekly target daily breakdown: daily deltas must sum to total delta");

    const unknownResolution = resolution({
      resolved_metric: "unknown_metric",
      goal_kind: "unknown",
      primary_source: null,
      enrichment_sources: [],
      confidence: "low",
      baseline_status: "missing",
      missing_requirements: [missingRequirement("estimated", "blocking")],
    });
    result = calculate(calculator, {
      goal: goal({
        goal_id: "goal_unknown_kind",
        normalized_goal_kind: "unknown",
        resolved_metric: "unknown_metric",
        metric_source_resolution: unknownResolution,
      }),
      baseline: {
        kind: "real",
        value: 100,
      },
      target: {
        mode: "percent_increase",
        percent: 30,
      },
    });
    results.push(result);
    assertContractShape(result, "unknown unsupported goal kind");
    assert.equal(result.metric.kind, "unknown", "unknown unsupported goal kind: expected unknown metric kind");
    assert.equal(result.baseline.status, "unavailable", "unknown unsupported goal kind: expected unavailable baseline");
    assert.equal(result.target.status, "unsupported", "unknown unsupported goal kind: expected unsupported target");

    assert.doesNotThrow(() => {
      const corruptResult = calculator.calculateCmoGoalBaselineTarget({
        goal: {
          contract: "cmo.goal.v1",
        },
        baseline: {
          value: "100",
        },
        target: {
          mode: "percent_increase",
          percent: "30",
        },
      });

      results.push(corruptResult);
      assertContractShape(corruptResult, "corrupt incomplete inputs");
      assert.equal(corruptResult.baseline.value, null, "corrupt incomplete inputs: must not coerce fake baseline");
      assert.notEqual(corruptResult.target.status, "ready", "corrupt incomplete inputs: target must not be ready");
    }, "corrupt incomplete inputs should fail safe without throwing");

    const paired = calculator.pairCmoGoalBaselineTargetWithActiveGoalState({
      activeGoalState: goal({
        goal_id: "goal_pairing",
      }),
      baselineTarget: calculate(calculator, {
        goal: goal({
          goal_id: "goal_pairing",
        }),
        baseline: {
          kind: "real",
          value: 100,
        },
        target: {
          mode: "percent_increase",
          percent: 30,
        },
      }),
    });
    assert.equal(paired.active_goal_state.goal_id, "goal_pairing", "paired context: expected active goal");
    assert.equal(paired.goal_baseline_target.contract, "cmo.goal_baseline_target.v1", "paired context: expected baseline target");

    for (const [index, item] of results.entries()) {
      assertGuardrails(item, `result ${index}`);
      assertNoFakeBaseline(item, `result ${index}`);
      assertNoUnsafeActionFields(item, `result ${index}`);
      assertNoSecrets(item, `result ${index}`);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

assert.ok(fs.existsSync(calculatorPath), "src/lib/cmo/goal-baseline-target.ts is missing");
assertSourceAudits();
await assertCalculatorBehavior();

console.log(JSON.stringify({
  ok: true,
  contract: "cmo.goal_baseline_target.v1",
  cases: 10,
}, null, 2));
