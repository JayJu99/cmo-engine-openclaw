import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const approvalPath = path.join(root, "src", "lib", "cmo", "scoped-approval.ts");

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

async function loadApprovalHarness() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-scoped-approval-"));
  const outputPath = path.join(tmpDir, "scoped-approval.cjs");

  await writeFile(outputPath, transpileTs(approvalPath), "utf8");

  return {
    tmpDir,
    approval: createRequire(import.meta.url)(outputPath),
  };
}

function weeklyPlan(overrides = {}) {
  return {
    contract: "cmo.weekly_goal_plan.v1",
    goal_id: "goal_m75_1",
    workspace_id: "workspace_1",
    app_id: "app_1",
    session_id: "session_1",
    source_contracts: {
      goal_contract: "cmo.goal.v1",
      baseline_target_contract: "cmo.goal_baseline_target.v1",
      metric_source_resolution_contract: "lens.metric_source_resolution.v1",
    },
    status: "ready_for_approval",
    plan_summary: {
      user_visible_title: "Website traffic weekly plan: ready for plan approval",
      user_visible_body: [
        "Goal request: Increase website traffic this week.",
        "Baseline: 100 sessions from GA4/UTM (real measurement, high confidence).",
        "Target: 130 sessions, 30 sessions change (30%) for this week.",
        "Approval note: approving this plan only approves the plan and draft direction; execution approval remains separate.",
      ].join("\n"),
      goal_summary: "Goal request: Increase website traffic this week.",
      baseline_summary: "Baseline: 100 sessions from GA4/UTM.",
      target_summary: "Target: 130 sessions.",
      measurement_summary: "Measurement: primary source is GA4/UTM with ready status.",
    },
    days: [],
    draft_assembly: {
      briefs_by_channel: [],
      suggested_post_count: 7,
      utm_intent: null,
      handoff_hints: [],
    },
    approval: {
      approval_required: true,
      approval_type: "plan",
      approval_prompt: "Review the 7-day Website traffic plan. Plan approval does not approve execution, scheduling, publishing, paid generation, or connector activity.",
      execution_approval_required_separately: true,
    },
    guardrails: {
      no_execution: true,
      no_publish: true,
      no_schedule: true,
      approval_required_before_execution: true,
      estimated_metrics_must_be_labeled: true,
    },
    ...overrides,
  };
}

function createRequest(approval, scopeType, targetId = "target_1", overrides = {}) {
  return approval.createCmoScopedApprovalRequest({
    approvalId: `approval_${scopeType}_${targetId}`,
    now: "2026-07-08T00:00:00.000Z",
    goalId: "goal_m75_1",
    workspaceId: "workspace_1",
    appId: "app_1",
    sessionId: "session_1",
    requestedBy: "reviewer_1",
    scope: {
      type: scopeType,
      targetId,
      targetContract: "cmo.test_target.v1",
      targetSummary: `${scopeType} target ${targetId}`,
    },
    ...overrides,
  });
}

function approve(approval, request, approvalIdSuffix = "") {
  return approval.applyCmoScopedApprovalDecision({
    approval: approvalIdSuffix ? { ...request, approval_id: `${request.approval_id}${approvalIdSuffix}` } : request,
    approved: true,
    decidedAt: "2026-07-08T01:00:00.000Z",
    decidedBy: "reviewer_1",
    reason: "Approved for scoped test.",
  });
}

function reject(approval, request) {
  return approval.applyCmoScopedApprovalDecision({
    approval: request,
    approved: false,
    decidedAt: "2026-07-08T01:00:00.000Z",
    decidedBy: "reviewer_1",
    reason: "Rejected for scoped test.",
  });
}

function can(approval, approvals, scopeType, targetId = "target_1") {
  return approval.canCmoProceedWithScope({
    approvals,
    scopeType,
    targetId,
    targetContract: "cmo.test_target.v1",
    now: "2026-07-08T02:00:00.000Z",
  });
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
    "published_at",
    "provider_post_id",
    "final_post_id",
  ]);
  const keys = walkKeys(value);

  assert.deepEqual(keys.filter((key) => forbidden.has(key)), [], `${label}: output must not include side-effect action fields`);
}

function assertNoSecrets(value, label) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /\b(?:access_token|refresh_token|authorization|bearer|cookie|rawGa4Response|raw_google_response|SECRET_VALUE)\b/i,
    `${label}: output must not expose secrets or raw connector payloads`,
  );
}

function assertSourceAudits() {
  assertIncludes(
    "src/lib/cmo/scoped-approval.ts",
    'CMO_SCOPED_APPROVAL_CONTRACT = "cmo.scoped_approval.v1"',
    "Scoped approval contract must exist",
  );
  for (const scope of ["plan", "draft", "creative", "execution", "publish", "schedule", "paid_generation", "revision"]) {
    assertIncludes("src/lib/cmo/scoped-approval.ts", `"${scope}"`, `Scope ${scope} must exist`);
  }
  for (const fn of [
    "createCmoScopedApprovalRequest",
    "applyCmoScopedApprovalDecision",
    "canCmoProceedWithScope",
    "createCmoWeeklyPlanApprovalRequest",
    "deriveCmoGoalApprovalPatch",
    "summarizeCmoScopedApprovalSeparation",
  ]) {
    assertIncludes("src/lib/cmo/scoped-approval.ts", `export function ${fn}`, `${fn} must be exported`);
  }
  assertExcludes(
    "src/lib/cmo/scoped-approval.ts",
    /\b(?:fetch\s*\(|runReport|runRealtimeReport|analyticsdata\.googleapis|graph\.facebook\.com|api\.x\.com|getWorkspaceGa4MetricSourceMapping|getLatestWorkspaceGa4MetricSnapshot|getLatestProductMetricDefinitionSnapshots)\b/i,
    "Scoped approval module must not call connector APIs, databases, or external services",
  );
  assertExcludes(
    "src/lib/cmo/scoped-approval.ts",
    /\b(?:Date\.now|randomUUID|writeFile|readFile|mkdir|rm\s*\()\b/,
    "Scoped approval module must not use nondeterministic IDs/timestamps or filesystem writes",
  );
  assertExcludes(
    "src/lib/cmo/scoped-approval.ts",
    /raw_user_message[\s\S]{0,220}(?:\.includes|\.match|\.test|RegExp)/,
    "Scoped approval module must not infer goal semantics from raw user text",
  );
  assertExcludes(
    "src/lib/cmo/scoped-approval.ts",
    /\b(?:publisher_job|publish_job|schedule_job|execution_run|execution_action_id|side_effect_action_ids|agent_execution|social_publish|daily_runner|review_queue|vault_write|gbrain_write|approval_auto_grant|auto_grant|approved_by_system|scheduled_at|published_at|provider_post_id|final_post_id)\b/i,
    "Scoped approval module must not define publish, schedule, execute, or auto-grant side-effect fields",
  );
}

async function assertApprovalBehavior() {
  const { tmpDir, approval } = await loadApprovalHarness();
  const results = [];

  try {
    assert.equal(approval.CMO_SCOPED_APPROVAL_CONTRACT, "cmo.scoped_approval.v1");
    assert.deepEqual(approval.CMO_SCOPED_APPROVAL_SCOPE_TYPES, [
      "plan",
      "draft",
      "creative",
      "execution",
      "publish",
      "schedule",
      "paid_generation",
      "revision",
    ]);

    const planRequest = approval.createCmoWeeklyPlanApprovalRequest({
      weeklyPlan: weeklyPlan(),
      approvalId: "approval_plan_goal_m75_1",
      now: "2026-07-08T00:00:00.000Z",
      requestedBy: "reviewer_1",
    });
    results.push(planRequest);
    assert.equal(planRequest.contract, "cmo.scoped_approval.v1", "plan request: expected contract");
    assert.equal(planRequest.approval_id, "approval_plan_goal_m75_1", "plan request: deterministic supplied id");
    assert.equal(planRequest.requested.requested_at, "2026-07-08T00:00:00.000Z", "plan request: deterministic supplied timestamp");
    assert.equal(planRequest.scope.type, "plan", "plan request: expected plan scope");
    assert.equal(planRequest.scope.target_contract, "cmo.weekly_goal_plan.v1", "plan request: expected weekly plan target");
    assert.equal(planRequest.constraints.requires_separate_execution_approval, true, "plan request: must require separate execution approval");
    assert.equal(planRequest.constraints.requires_separate_publish_approval, true, "plan request: must require separate publish approval");
    assert.equal(planRequest.constraints.requires_separate_schedule_approval, true, "plan request: must require separate schedule approval");
    assert.equal(planRequest.constraints.requires_separate_paid_generation_approval, true, "plan request: must require separate paid generation approval");

    const planApproved = approval.applyCmoScopedApprovalDecision({
      approval: planRequest,
      approved: true,
      decidedAt: "2026-07-08T01:00:00.000Z",
      decidedBy: "reviewer_1",
      reason: "Plan direction approved.",
    });
    results.push(planApproved);
    assert.equal(planApproved.status, "approved", "plan approval: expected approved status");
    assert.equal(
      approval.canCmoProceedWithScope({
        approvals: [planApproved],
        scopeType: "plan",
        targetId: "goal_m75_1",
        targetContract: "cmo.weekly_goal_plan.v1",
        now: "2026-07-08T02:00:00.000Z",
      }).allowed,
      true,
      "plan approval: can proceed with plan scope",
    );

    for (const downstream of ["execution", "publish", "schedule", "paid_generation"]) {
      const proceed = approval.canCmoProceedWithScope({
        approvals: [planApproved],
        scopeType: downstream,
        targetId: "goal_m75_1",
        targetContract: "cmo.weekly_goal_plan.v1",
        now: "2026-07-08T02:00:00.000Z",
      });
      assert.equal(proceed.allowed, false, `plan approval: must not unlock ${downstream}`);
      assert.deepEqual(proceed.missing_scopes, [downstream], `plan approval: expected missing ${downstream}`);
    }

    const executionApproved = approve(approval, createRequest(approval, "execution"));
    results.push(executionApproved);
    assert.equal(can(approval, [executionApproved], "execution").allowed, true, "execution approval: can proceed with execution");
    assert.equal(can(approval, [executionApproved], "publish").allowed, false, "execution approval: must not imply publish");
    assert.equal(can(approval, [executionApproved], "schedule").allowed, false, "execution approval: must not imply schedule");

    const publishApproved = approve(approval, createRequest(approval, "publish"));
    results.push(publishApproved);
    assert.equal(can(approval, [publishApproved], "publish").allowed, true, "publish approval: can proceed with publish");
    assert.equal(can(approval, [publishApproved], "schedule").allowed, false, "publish approval: must not imply schedule");

    const draftApproved = approve(approval, createRequest(approval, "draft"));
    const creativeApproved = approve(approval, createRequest(approval, "creative"));
    results.push(draftApproved, creativeApproved);
    assert.equal(can(approval, [draftApproved], "draft").allowed, true, "draft approval: can proceed with draft");
    assert.equal(can(approval, [draftApproved], "creative").allowed, false, "draft approval: must not imply creative");
    assert.equal(can(approval, [creativeApproved], "creative").allowed, true, "creative approval: can proceed with creative");
    assert.equal(can(approval, [creativeApproved], "paid_generation").allowed, false, "creative approval: must not imply paid generation");
    assert.equal(can(approval, [creativeApproved], "publish").allowed, false, "creative approval: must not imply publish");

    const revisionApproved = approve(approval, createRequest(approval, "revision", "revision_1"));
    results.push(revisionApproved);
    assert.equal(can(approval, [revisionApproved], "revision", "revision_1").allowed, true, "revision approval: can proceed for target");
    assert.equal(can(approval, [revisionApproved], "revision", "revision_2").allowed, false, "revision approval: target-specific");
    assert.equal(can(approval, [revisionApproved], "execution", "revision_1").allowed, false, "revision approval: must not imply execution");

    const rejectedDraft = reject(approval, createRequest(approval, "draft", "draft_rejected"));
    results.push(rejectedDraft);
    const rejectedProceed = can(approval, [rejectedDraft], "draft", "draft_rejected");
    assert.equal(rejectedProceed.allowed, false, "rejection: must block scope");
    assert.match(rejectedProceed.safe_user_message, /rejected/i, "rejection: expected rejection message");

    const expiredApproved = approval.applyCmoScopedApprovalDecision({
      approval: createRequest(approval, "execution", "expired_target", {
        expiresAt: "2026-07-07T00:00:00.000Z",
      }),
      approved: true,
      decidedAt: "2026-07-07T01:00:00.000Z",
      decidedBy: "reviewer_1",
    });
    const supersededApproval = approval.applyCmoScopedApprovalDecision({
      approval: createRequest(approval, "publish", "superseded_target"),
      approved: true,
      decidedAt: "2026-07-08T01:00:00.000Z",
      decidedBy: "reviewer_1",
      status: "superseded",
    });
    results.push(expiredApproved, supersededApproval);
    assert.equal(can(approval, [expiredApproved], "execution", "expired_target").allowed, false, "expired approval: not usable");
    assert.match(can(approval, [expiredApproved], "execution", "expired_target").safe_user_message, /expired/i, "expired approval: expected message");
    assert.equal(can(approval, [supersededApproval], "publish", "superseded_target").allowed, false, "superseded approval: not usable");
    assert.match(can(approval, [supersededApproval], "publish", "superseded_target").safe_user_message, /superseded/i, "superseded approval: expected message");

    const planPatch = approval.deriveCmoGoalApprovalPatch({ approval: planApproved });
    assert.equal(planPatch.contract, "cmo.goal_approval_patch.v1", "goal patch: expected contract");
    assert.deepEqual(Object.keys(planPatch.approvals), ["plan"], "goal patch: only plan touched");
    assert.deepEqual(planPatch.touched_scopes, ["plan"], "goal patch: touched scopes should only include requested scope");
    assert.equal(planPatch.approvals.plan.approved, true, "goal patch: plan approved");

    const executionPatch = approval.deriveCmoGoalApprovalPatch({ approval: executionApproved });
    assert.deepEqual(Object.keys(executionPatch.approvals), ["execution"], "goal patch: only execution touched");
    assert.equal(approval.deriveCmoGoalApprovalPatch({ approval: draftApproved }), null, "goal patch: draft not in cmo.goal.v1 approvals");

    const set = approval.createCmoScopedApprovalSet({
      approvals: [planApproved, executionApproved],
    });
    assert.equal(set.contract, "cmo.scoped_approval_set.v1", "approval set: expected contract");
    assert.equal(
      approval.canCmoProceedWithScope({
        approvals: set,
        scopeType: "execution",
        targetId: "target_1",
        targetContract: "cmo.test_target.v1",
        now: "2026-07-08T02:00:00.000Z",
      }).allowed,
      true,
      "approval set: should support proceed checks",
    );

    const unsafeRequest = approval.createCmoScopedApprovalRequest({
      approvalId: "unsafe_secret_request",
      now: "2026-07-08T00:00:00.000Z",
      scope: {
        type: "plan",
        targetId: "unsafe_target",
        targetContract: "cmo.test_target.v1",
        targetSummary: "authorization bearer SECRET_VALUE",
      },
      prompt: "access_token SECRET_VALUE",
      safeUserMessage: "rawGa4Response SECRET_VALUE",
    });
    results.push(unsafeRequest);
    assertNoSecrets(unsafeRequest, "unsafe request redaction");
    assert.equal(unsafeRequest.scope.target_summary, "plan target", "unsafe request: target summary should fall back");
    assert.match(unsafeRequest.requested.prompt, /Approve the plan scope/i, "unsafe request: prompt should fall back");

    const metadata = approval.createCmoScopedApprovalResponseMetadata({
      approvalRequests: [planRequest],
      proceedChecks: [rejectedProceed],
    });
    results.push(metadata);
    assert.equal(metadata.contract, "cmo.scoped_approval_response_metadata.v1", "response metadata: expected contract");
    assert.equal(metadata.approval_requests.length, 1, "response metadata: expected approval request");
    assert.ok(metadata.separation_summary.rules.length >= 8, "response metadata: expected separation summary");

    const separation = approval.summarizeCmoScopedApprovalSeparation();
    assert.equal(separation.contract, "cmo.scoped_approval_separation_summary.v1", "separation summary: expected contract");
    assert.equal(separation.rules.length, 8, "separation summary: expected all scopes");

    for (const [index, item] of results.entries()) {
      assertNoForbiddenActionFields(item, `result ${index}`);
      assertNoSecrets(item, `result ${index}`);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

assert.ok(fs.existsSync(approvalPath), "src/lib/cmo/scoped-approval.ts is missing");
assertSourceAudits();
await assertApprovalBehavior();

console.log(JSON.stringify({
  ok: true,
  contract: "cmo.scoped_approval.v1",
  cases: 14,
}, null, 2));
