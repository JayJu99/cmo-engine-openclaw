import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const preflightPath = path.join(root, "src", "lib", "cmo", "publisher-execution-preflight.ts");
const scopedApprovalPath = path.join(root, "src", "lib", "cmo", "scoped-approval.ts");

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

async function loadHarness() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-publisher-preflight-"));
  const scopedOut = path.join(tmpDir, "scoped-approval.cjs");
  const preflightOut = path.join(tmpDir, "publisher-execution-preflight.cjs");
  const preflightOutput = transpileTs(preflightPath)
    .replace(/require\(["']@\/lib\/cmo\/scoped-approval["']\)/g, 'require("./scoped-approval.cjs")');

  await writeFile(scopedOut, transpileTs(scopedApprovalPath), "utf8");
  await writeFile(preflightOut, preflightOutput, "utf8");

  return {
    tmpDir,
    approval: createRequire(import.meta.url)(scopedOut),
    preflight: createRequire(import.meta.url)(preflightOut),
  };
}

function approvalRequest(approval, scopeType, targetId = "target_1", targetContract = "cmo.test_target.v1", overrides = {}) {
  return approval.createCmoScopedApprovalRequest({
    approvalId: `approval_${scopeType}_${targetId}`,
    now: "2026-07-08T00:00:00.000Z",
    goalId: "goal_m76a_1",
    workspaceId: "workspace_1",
    appId: "app_1",
    sessionId: "session_1",
    requestedBy: "reviewer_1",
    scope: {
      type: scopeType,
      targetId,
      targetContract,
      targetSummary: `${scopeType} target ${targetId}`,
    },
    ...overrides,
  });
}

function approve(approval, request) {
  return approval.applyCmoScopedApprovalDecision({
    approval: request,
    approved: true,
    decidedAt: "2026-07-08T01:00:00.000Z",
    decidedBy: "reviewer_1",
    reason: "Approved for scoped preflight test.",
  });
}

function reject(approval, request) {
  return approval.applyCmoScopedApprovalDecision({
    approval: request,
    approved: false,
    decidedAt: "2026-07-08T01:00:00.000Z",
    decidedBy: "reviewer_1",
    reason: "Rejected for scoped preflight test.",
  });
}

function runPreflight(preflight, approvals, actionType, overrides = {}) {
  return preflight.createCmoPublisherExecutionPreflight({
    preflightId: overrides.preflightId ?? `preflight_${actionType}_target_1`,
    goalId: overrides.goalId ?? "goal_m76a_1",
    workspaceId: "workspace_1",
    appId: "app_1",
    sessionId: "session_1",
    approvals,
    now: overrides.now ?? "2026-07-08T02:00:00.000Z",
    requestedAction: {
      type: actionType,
      targetId: overrides.targetId ?? "target_1",
      targetContract: overrides.targetContract ?? "cmo.test_target.v1",
      channel: overrides.channel ?? "x",
      provider: overrides.provider ?? "publisher_stub",
      scheduledFor: overrides.scheduledFor ?? null,
      executionRequired: overrides.executionRequired,
    },
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
    "queue_name",
    "webhook_url",
    "adapter_call",
    "provider_post_id",
    "final_post_id",
  ]);
  const keys = walkKeys(value);

  assert.deepEqual(keys.filter((key) => forbidden.has(key)), [], `${label}: preflight must not emit side-effect job, queue, webhook, or adapter fields`);
}

function assertNoSecrets(value, label) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /\b(?:access_token|refresh_token|authorization|bearer|cookie|rawGa4Response|raw_google_response|SECRET_VALUE)\b/i,
    `${label}: output must not expose secrets or raw connector payloads`,
  );
}

function assertDryRun(value, label) {
  assert.equal(value.audit.dry_run_only, true, `${label}: dry_run_only must be true`);
  assert.equal(value.audit.no_side_effects, true, `${label}: no_side_effects must be true`);
  assert.equal(value.audit.would_call_publisher, false, `${label}: must not call publisher`);
  assert.equal(value.audit.would_schedule, false, `${label}: must not schedule`);
  assert.equal(value.audit.would_publish, false, `${label}: must not publish`);
  assert.equal(value.guardrails.no_execution_in_preflight, true, `${label}: no execution guardrail expected`);
}

function assertBlocked(value, missingScopes, label) {
  assert.equal(value.approval_check.allowed, false, `${label}: expected blocked`);
  assert.deepEqual(value.approval_check.missing_scopes, missingScopes, `${label}: expected missing scopes`);
  assert.match(value.approval_check.safe_user_message, /blocked|missing|approval/i, `${label}: expected safe block message`);
  assertDryRun(value, label);
  assertNoForbiddenActionFields(value, label);
  assertNoSecrets(value, label);
}

function assertAllowed(value, satisfiedScopes, label) {
  assert.equal(value.approval_check.allowed, true, `${label}: expected allowed`);
  assert.deepEqual(value.approval_check.satisfied_scopes, satisfiedScopes, `${label}: expected satisfied scopes`);
  assert.deepEqual(value.approval_check.missing_scopes, [], `${label}: expected no missing scopes`);
  assert.match(value.approval_check.safe_user_message, /dry-run only|does not execute/i, `${label}: expected dry-run message`);
  assertDryRun(value, label);
  assertNoForbiddenActionFields(value, label);
  assertNoSecrets(value, label);
}

function assertSourceAudits() {
  assertIncludes(
    "src/lib/cmo/publisher-execution-preflight.ts",
    'CMO_PUBLISHER_EXECUTION_PREFLIGHT_CONTRACT =',
    "Publisher preflight contract constant must exist",
  );
  assertIncludes(
    "src/lib/cmo/publisher-execution-preflight.ts",
    '"cmo.publisher_execution_preflight.v1"',
    "Publisher preflight contract value must exist",
  );
  for (const actionType of ["execute", "publish", "schedule", "paid_generation"]) {
    assertIncludes("src/lib/cmo/publisher-execution-preflight.ts", `"${actionType}"`, `Action type ${actionType} must exist`);
  }
  for (const fn of [
    "createCmoPublisherExecutionPreflight",
    "requiredCmoApprovalScopesForPublisherAction",
    "createCmoPublisherIdempotencyKey",
    "summarizeCmoPublisherPreflightBlock",
  ]) {
    assertIncludes("src/lib/cmo/publisher-execution-preflight.ts", `export function ${fn}`, `${fn} must be exported`);
  }
  assertExcludes(
    "src/lib/cmo/publisher-execution-preflight.ts",
    /\b(?:fetch\s*\(|runReport|runRealtimeReport|analyticsdata\.googleapis|graph\.facebook\.com|api\.x\.com|getWorkspaceGa4MetricSourceMapping|getLatestWorkspaceGa4MetricSnapshot|getLatestProductMetricDefinitionSnapshots|webhook|queueMicrotask|new\s+Worker|Publisher|Echo|Creative)\b/i,
    "Preflight module must not call connector APIs, Publisher, Echo, Creative, workers, queues, or webhooks",
  );
  assertExcludes(
    "src/lib/cmo/publisher-execution-preflight.ts",
    /\b(?:Date\.now|randomUUID|writeFile|readFile|mkdir|rm\s*\()\b/,
    "Preflight module must not use nondeterministic IDs/timestamps or filesystem access",
  );
  assertExcludes(
    "src/lib/cmo/publisher-execution-preflight.ts",
    /raw_user_message[\s\S]{0,220}(?:\.includes|\.match|\.test|RegExp)/,
    "Preflight module must not infer goal semantics from raw user text",
  );
}

async function assertPreflightBehavior() {
  const { tmpDir, approval, preflight } = await loadHarness();
  const results = [];

  try {
    assert.equal(preflight.CMO_PUBLISHER_EXECUTION_PREFLIGHT_CONTRACT, "cmo.publisher_execution_preflight.v1");
    assert.deepEqual(preflight.CMO_PUBLISHER_EXECUTION_PREFLIGHT_ACTION_TYPES, [
      "execute",
      "publish",
      "schedule",
      "paid_generation",
    ]);
    assert.deepEqual(
      preflight.requiredCmoApprovalScopesForPublisherAction({ actionType: "publish" }),
      ["execution", "publish"],
      "publish should require execution and publish by default",
    );

    const planApproval = approve(approval, approvalRequest(approval, "plan"));
    let result = runPreflight(preflight, [planApproval], "execute");
    results.push(result);
    assertBlocked(result, ["execution"], "plan approval only -> execute blocked");

    const executionApproval = approve(approval, approvalRequest(approval, "execution"));
    result = runPreflight(preflight, [executionApproval], "execute");
    results.push(result);
    assertAllowed(result, ["execution"], "execution approval -> execute allowed");

    result = runPreflight(preflight, [executionApproval], "publish");
    results.push(result);
    assertBlocked(result, ["publish"], "execution approval only -> publish blocked");
    assert.deepEqual(result.approval_check.satisfied_scopes, ["execution"], "publish with execution only: execution should be satisfied");

    const publishApproval = approve(approval, approvalRequest(approval, "publish"));
    result = runPreflight(preflight, [executionApproval, publishApproval], "publish");
    results.push(result);
    assertAllowed(result, ["execution", "publish"], "execution + publish approval -> publish allowed");

    result = runPreflight(preflight, [publishApproval], "publish");
    results.push(result);
    assertBlocked(result, ["execution"], "publish approval only -> publish blocked due missing execution");

    result = runPreflight(preflight, [executionApproval], "schedule");
    results.push(result);
    assertBlocked(result, ["schedule"], "execution approval only -> schedule blocked");

    const scheduleApproval = approve(approval, approvalRequest(approval, "schedule"));
    result = runPreflight(preflight, [executionApproval, scheduleApproval], "schedule", {
      scheduledFor: "2026-07-09T09:00:00.000Z",
    });
    results.push(result);
    assertAllowed(result, ["execution", "schedule"], "execution + schedule approval -> schedule allowed");

    const paidGenerationApproval = approve(approval, approvalRequest(approval, "paid_generation"));
    const creativeApproval = approve(approval, approvalRequest(approval, "creative"));
    result = runPreflight(preflight, [creativeApproval], "paid_generation");
    results.push(result);
    assertBlocked(result, ["paid_generation"], "creative approval only -> paid generation blocked");
    result = runPreflight(preflight, [paidGenerationApproval], "paid_generation");
    results.push(result);
    assertAllowed(result, ["paid_generation"], "paid generation approval -> paid generation allowed");

    const rejectedExecution = reject(approval, approvalRequest(approval, "execution", "rejected_target"));
    result = runPreflight(preflight, [rejectedExecution], "execute", { targetId: "rejected_target" });
    results.push(result);
    assert.equal(result.approval_check.allowed, false, "rejected approval -> blocked");
    assert.deepEqual(result.approval_check.rejected_scopes, ["execution"], "rejected approval -> rejected scope visible");
    assert.match(result.approval_check.safe_user_message, /rejected execution approval/i, "rejected approval -> message visible");

    const expiredExecution = approve(approval, approvalRequest(approval, "execution", "expired_target", "cmo.test_target.v1", {
      expiresAt: "2026-07-07T00:00:00.000Z",
    }));
    const supersededSchedule = approval.applyCmoScopedApprovalDecision({
      approval: approvalRequest(approval, "schedule", "superseded_target"),
      approved: true,
      decidedAt: "2026-07-08T01:00:00.000Z",
      decidedBy: "reviewer_1",
      status: "superseded",
    });
    result = runPreflight(preflight, [expiredExecution], "execute", { targetId: "expired_target" });
    results.push(result);
    assert.equal(result.approval_check.allowed, false, "expired approval -> blocked");
    assert.deepEqual(result.approval_check.expired_or_superseded_scopes, ["execution"], "expired approval -> expired scope visible");
    result = runPreflight(preflight, [executionApproval, supersededSchedule], "schedule", { targetId: "superseded_target" });
    results.push(result);
    assert.equal(result.approval_check.allowed, false, "superseded approval -> blocked");
    assert.deepEqual(result.approval_check.expired_or_superseded_scopes, ["schedule"], "superseded approval -> superseded scope visible");

    result = runPreflight(preflight, [executionApproval], "execute", { targetId: "different_target" });
    results.push(result);
    assertBlocked(result, ["execution"], "target_id mismatch -> blocked");

    const keyA = preflight.createCmoPublisherIdempotencyKey({
      actionType: "publish",
      goalId: "goal_m76a_1",
      targetContract: "cmo.test_target.v1",
      targetId: "target_1",
      channel: "x",
      provider: "publisher_stub",
    });
    const keyB = preflight.createCmoPublisherIdempotencyKey({
      actionType: "publish",
      goalId: "goal_m76a_1",
      targetContract: "cmo.test_target.v1",
      targetId: "target_1",
      channel: "x",
      provider: "publisher_stub",
    });
    assert.equal(keyA, keyB, "idempotency key should be deterministic for same input");

    const scheduleKeyA = runPreflight(preflight, [executionApproval, scheduleApproval], "schedule", {
      scheduledFor: "2026-07-09T09:00:00.000Z",
    }).idempotency.key;
    const scheduleKeyB = runPreflight(preflight, [executionApproval, scheduleApproval], "schedule", {
      scheduledFor: "2026-07-10T09:00:00.000Z",
    }).idempotency.key;
    assert.notEqual(scheduleKeyA, scheduleKeyB, "schedule idempotency should change with scheduled_for");

    const unsafeResult = runPreflight(preflight, [executionApproval], "execute", {
      targetId: "authorization bearer SECRET_VALUE",
      targetContract: "rawGa4Response SECRET_VALUE",
      channel: "access_token SECRET_VALUE",
      provider: "cookie SECRET_VALUE",
      preflightId: "secret_preflight",
    });
    results.push(unsafeResult);
    assertNoSecrets(unsafeResult, "unsafe input redaction");
    assert.equal(unsafeResult.requested_action.target_id, "execute_target", "unsafe target id should fall back");
    assert.equal(unsafeResult.requested_action.target_contract, "unknown.contract", "unsafe target contract should fall back");

    for (const [index, item] of results.entries()) {
      assertDryRun(item, `result ${index}`);
      assertNoForbiddenActionFields(item, `result ${index}`);
      assertNoSecrets(item, `result ${index}`);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

assert.ok(fs.existsSync(preflightPath), "src/lib/cmo/publisher-execution-preflight.ts is missing");
assert.ok(fs.existsSync(scopedApprovalPath), "src/lib/cmo/scoped-approval.ts is missing");
assertSourceAudits();
await assertPreflightBehavior();

console.log(JSON.stringify({
  ok: true,
  contract: "cmo.publisher_execution_preflight.v1",
  cases: 15,
}, null, 2));
