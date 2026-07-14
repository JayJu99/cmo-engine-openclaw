import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const files = {
  lens: path.join(root, "src", "lib", "cmo", "lens-metric-source-resolution.ts"),
  goalState: path.join(root, "src", "lib", "cmo", "goal-state.ts"),
  baseline: path.join(root, "src", "lib", "cmo", "goal-baseline-target.ts"),
  weeklyPlan: path.join(root, "src", "lib", "cmo", "weekly-goal-plan.ts"),
  approval: path.join(root, "src", "lib", "cmo", "scoped-approval.ts"),
  preflight: path.join(root, "src", "lib", "cmo", "publisher-execution-preflight.ts"),
  smoke: path.join(root, "src", "lib", "cmo", "goal-workflow-smoke.ts"),
};

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

function replaceRequires(output, replacements) {
  let next = output.replace(/require\(["']server-only["']\);?\s*/g, "");

  for (const [from, to] of replacements) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`require\\(["']${escaped}["']\\)`, "g"), `require("${to}")`);
  }

  return next;
}

async function loadHarness() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-goal-workflow-smoke-"));
  const replacements = [
    ["@/lib/cmo/lens-metric-source-resolution", "./lens.cjs"],
    ["@/lib/cmo/goal-state", "./goal-state.cjs"],
    ["@/lib/cmo/goal-baseline-target", "./goal-baseline-target.cjs"],
    ["@/lib/cmo/weekly-goal-plan", "./weekly-goal-plan.cjs"],
    ["@/lib/cmo/scoped-approval", "./scoped-approval.cjs"],
    ["@/lib/cmo/publisher-execution-preflight", "./publisher-execution-preflight.cjs"],
  ];
  const outputs = [
    ["lens.cjs", files.lens],
    ["goal-state.cjs", files.goalState],
    ["goal-baseline-target.cjs", files.baseline],
    ["weekly-goal-plan.cjs", files.weeklyPlan],
    ["scoped-approval.cjs", files.approval],
    ["publisher-execution-preflight.cjs", files.preflight],
    ["goal-workflow-smoke.cjs", files.smoke],
  ];

  for (const [name, filePath] of outputs) {
    await writeFile(path.join(tmpDir, name), replaceRequires(transpileTs(filePath), replacements), "utf8");
  }

  return {
    tmpDir,
    smoke: createRequire(import.meta.url)(path.join(tmpDir, "goal-workflow-smoke.cjs")),
  };
}

function contracts(response) {
  return new Set((response.sessionArtifacts ?? []).map((artifact) => artifact.contract));
}

function artifact(response, contract) {
  return (response.sessionArtifacts ?? []).find((item) => item.contract === contract);
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

function assertNoExecutableJobFields(value, label) {
  const keys = walkKeys(value).map((key) => key.toLowerCase());

  assert.ok(!keys.some((key) => key.includes("job")), `${label}: no executable job fields should be emitted`);
  assert.ok(!keys.includes("publisher_request"), `${label}: no publisher request should be emitted`);
  assert.ok(!keys.includes("execute_request"), `${label}: no execute request should be emitted`);
  assert.ok(!keys.includes("schedule_request"), `${label}: no schedule request should be emitted`);
}

function assertNoRealBaselineFabricated(response) {
  const baseline = artifact(response, "cmo.goal_baseline_target.v1");

  assert.ok(baseline, "Expected cmo.goal_baseline_target.v1 artifact");
  assert.notEqual(baseline.baseline?.is_real_measurement, true, "Smoke baseline must not be real measurement");
  assert.notEqual(baseline.baseline?.status, "ready", "Smoke baseline must not be ready without source truth");
  assert.ok(
    baseline.baseline?.status === "missing_primary_source" ||
      baseline.baseline?.status === "manual_required" ||
      baseline.baseline?.status === "estimated",
    "Smoke baseline must be visibly missing, manual-required, or estimated",
  );
}

assertIncludes(
  "src/lib/cmo/goal-workflow-smoke.ts",
  "export function maybeCreateCmoGoalWorkflowSmokeResponse",
  "Smoke helper must export maybeCreateCmoGoalWorkflowSmokeResponse",
);
assertIncludes(
  "src/lib/cmo/goal-workflow-smoke.ts",
  "export function cmoGoalWorkflowSmokeCommandText",
  "Smoke helper must export /goal command text parser",
);
assertIncludes(
  "src/lib/cmo/goal-workflow-smoke.ts",
  "export function isCmoGoalWorkflowSmokeRequest",
  "Smoke helper must export weekly goal detector",
);
assertIncludes(
  "src/lib/cmo/goal-workflow-smoke.ts",
  "export function isCmoPublisherPreflightSmokeRequest",
  "Smoke helper must export publisher preflight detector",
);
assertExcludes("src/lib/cmo/goal-workflow-smoke.ts", /\bfetch\s*\(/, "Smoke helper must not fetch");
assertExcludes("src/lib/cmo/goal-workflow-smoke.ts", /\bwriteFile\b|\bwriteJsonFile\b|\bsaveCmoGoal\b|\bcreateAndStoreCmoGoalDraft\b/, "Smoke helper must not write runtime files");
assertExcludes("src/lib/cmo/goal-workflow-smoke.ts", /\brunHermes|\bexecuteCmoSurf|\bexecuteMixedCmoEcho|\bmaybeHandleEchoBridge|\bmaybeHandleSurfBridge/, "Smoke helper must not call Hermes, Surf, or Echo");
assertExcludes("src/lib/cmo/goal-workflow-smoke.ts", /\bPublisher\b.*\(/, "Smoke helper must not call Publisher");

const appChatSource = source("src/lib/cmo/app-chat-store.ts");
const smokeCallIndex = appChatSource.indexOf("maybeCreateCmoGoalWorkflowSmokeResponse({");
const smokeWriteIndex = appChatSource.indexOf("await writeJsonFile(sessionPath(sessionId), smokeSession);");
const weeklyWorkflowGateIndex = appChatSource.indexOf("const weeklyCampaignWorkflowRequested = isCmoWeeklyCampaignWorkflowRequest(request.message);");
const hermesFirstRouteIndex = appChatSource.indexOf("const hermesFirstNormalChatRequested = !weeklyCampaignWorkflowRequested && isHermesFirstNormalChatTurn({");
assert.notEqual(smokeCallIndex, -1, "createAppChatSession must call smoke helper");
assert.notEqual(smokeWriteIndex, -1, "Smoke branch must persist through app-chat session store");
assert.notEqual(weeklyWorkflowGateIndex, -1, "App chat must explicitly detect qualifying weekly /goal workflow requests");
assert.ok(smokeCallIndex < smokeWriteIndex, "Smoke branch should create response before writing smoke session");
assert.ok(weeklyWorkflowGateIndex < hermesFirstRouteIndex, "Weekly /goal workflow gate must run before native Hermes normal-chat routing");
assert.match(appChatSource, /weeklyCampaignWorkflowRequested\s*\?\s*null\s*:\s*maybeCreateCmoGoalWorkflowSmokeResponse/, "Qualifying weekly /goal must bypass the deterministic smoke response");
assert.match(appChatSource, /weeklyCampaignWorkflow:\s*\{ commandText: weeklyCampaignCommandText \}/, "Qualifying weekly /goal must transport only its command text into the Hermes workflow request");
for (const marker of [
  "const turnAttachments = bindCmoAttachmentsToTurn",
  "await buildContextPack({",
  "await getRuntimeRegistry().selectRuntime()",
  "await runHermesFirstCmoChat({",
  "await runHermesCmoChatV11({",
  "await runHermesCmoRuntime(",
  "await writeJsonFile(sessionPath(sessionId), session)",
  "await indexChatSession({",
]) {
  const index = appChatSource.indexOf(marker);
  assert.ok(index === -1 || smokeCallIndex < index, `Smoke helper must run before ${marker}`);
}
assert.ok(
  smokeWriteIndex < appChatSource.indexOf("const turnAttachments = bindCmoAttachmentsToTurn"),
  "Smoke session write must happen before attachment/context/runtime work",
);
assert.ok(
  appChatSource.indexOf("const smokeAssistantMessage: CMOChatMessage") !== -1 &&
    appChatSource.indexOf("content: goalWorkflowSmokeResponse.answer") !== -1 &&
    appChatSource.indexOf("...(continuedSession?.messages ?? [])") !== -1 &&
    appChatSource.indexOf("smokeUserMessage") < appChatSource.indexOf("smokeAssistantMessage") &&
    appChatSource.indexOf("sessionArtifacts: smokeSessionArtifacts") !== -1,
  "Smoke branch must persist continued history, user message, assistant body, and artifacts in message shape",
);

const { tmpDir, smoke } = await loadHarness();

try {
  const input = {
    message: "/goal increase social traffic this week",
    workspaceId: "workspace_1",
    appId: "app_1",
    sessionId: "session_1",
    userId: "user_1",
    now: "2026-07-08T00:00:00.000Z",
  };
  const weekly = smoke.maybeCreateCmoGoalWorkflowSmokeResponse(input);
  const weeklyAgain = smoke.maybeCreateCmoGoalWorkflowSmokeResponse(input);
  const vietnameseWeekly = smoke.maybeCreateCmoGoalWorkflowSmokeResponse({
    ...input,
    message: "/goal Tu\u1ea7n n\u00e0y t\u0103ng traffic social 30%",
  });
  const unprefixedWeekly = smoke.maybeCreateCmoGoalWorkflowSmokeResponse({
    ...input,
    message: "Tu\u1ea7n n\u00e0y t\u0103ng traffic social 30%",
  });
  const referralStrategy = smoke.maybeCreateCmoGoalWorkflowSmokeResponse({
    ...input,
    message: "How should we improve referral conversion this week?",
  });
  const generalStrategy = smoke.maybeCreateCmoGoalWorkflowSmokeResponse({
    ...input,
    message: "Create a CMO strategy for our next acquisition push.",
  });

  assert.ok(weekly, "Weekly smoke request should return a response");
  assert.ok(vietnameseWeekly, "Vietnamese weekly goal smoke phrase should return a response");
  assert.equal(vietnameseWeekly.smokeKind, "weekly_goal_plan", "Vietnamese weekly goal phrase should use weekly smoke kind");
  assert.equal(unprefixedWeekly, null, "Unprefixed weekly goal-like text must not trigger smoke helper");
  assert.equal(referralStrategy, null, "Normal referral strategy chat must remain on the native Hermes path");
  assert.equal(generalStrategy, null, "Normal CMO strategy chat must remain on the native Hermes path");
  assert.deepEqual(weeklyAgain, weekly, "Smoke output should be deterministic when inputs are supplied");
  assert.equal(weekly.status, "completed", "Weekly smoke should complete synchronously");
  assert.equal(weekly.smokeKind, "weekly_goal_plan", "Weekly smoke kind should be explicit");
  assert.equal(weekly.runtimeProvider, "product", "Smoke response should use product runtime provider");
  assert.equal(weekly.runtimeAgent, "goal-workflow-smoke", "Smoke response should use goal-workflow-smoke agent");
  assert.equal(typeof weekly.answer, "string", "Smoke response should expose assistant markdown answer");
  assert.match(weekly.answer, /weekly plan/i, "Weekly body should include a plan summary");
  assert.match(weekly.answer, /`?\/goal`? weekly campaign workflow/i, "Weekly body should identify /goal workflow");
  assert.match(weekly.answer, /Native CMO chat remains available/i, "Weekly body should state native chat remains available without /goal");
  assert.match(weekly.answer, /plan approval is separate from execution, publish, schedule, and paid generation/i, "Weekly body should state scoped approval separation");
  assert.match(weekly.answer, /Baseline label: (missing|manual|estimated|real)/i, "Weekly body should include visible baseline label");
  assert.match(weekly.answer, /No real baseline is claimed/i, "Weekly body should state no real baseline is claimed");

  const weeklyContracts = contracts(weekly);
  assert.ok(weeklyContracts.has("cmo.goal.v1"), "Expected cmo.goal.v1 artifact");
  assert.ok(weeklyContracts.has("cmo.goal_baseline_target.v1"), "Expected cmo.goal_baseline_target.v1 artifact");
  assert.ok(weeklyContracts.has("cmo.weekly_goal_plan.v1"), "Expected cmo.weekly_goal_plan.v1 artifact");
  assert.ok(weeklyContracts.has("cmo.scoped_approval.v1"), "Expected cmo.scoped_approval.v1 artifact");
  assert.ok(weeklyContracts.has("cmo.goal_workflow_smoke_metadata.v1"), "Expected smoke metadata artifact");
  assert.ok(
    weekly.sessionArtifacts.some((item) => item.goal_workflow_smoke === true && item.goal_workflow_trigger === "/goal"),
    "Expected persisted metadata for goal_workflow_smoke and /goal trigger",
  );
  assert.ok(weekly.approvalRequests?.some((request) => request.contract === "cmo.scoped_approval.v1" && request.kind === "plan"), "Expected UI-compatible plan approval request");
  assert.match(String(weekly.approvalRequests?.[0]?.side_effect_if_approved ?? ""), /does not permit execution, publish, schedule, paid generation/i, "Approval request should state limited scope");
  assertNoRealBaselineFabricated(weekly);
  assertNoExecutableJobFields(weekly, "weekly");

  const publish = smoke.maybeCreateCmoGoalWorkflowSmokeResponse({
    message: "/goal publish luon",
    workspaceId: "workspace_1",
    appId: "app_1",
    sessionId: "session_1",
    userId: "user_1",
    now: "2026-07-08T00:00:00.000Z",
    activeGoalState: artifact(weekly, "cmo.goal.v1"),
  });
  const preflight = artifact(publish, "cmo.publisher_execution_preflight.v1");

  assert.ok(publish, "Publish smoke request should return a response");
  assert.equal(publish.smokeKind, "publisher_preflight", "Publish smoke kind should be explicit");
  assert.ok(preflight, "Expected publisher execution preflight artifact");
  assert.equal(preflight.approval_check?.allowed, false, "Preflight without approvals should block");
  assert.deepEqual(preflight.approval_check?.missing_scopes, ["execution", "publish"], "Publish preflight should list missing execution and publish scopes");
  assert.match(publish.answer, /blocked/i, "Preflight response should be visibly blocked");
  assert.match(publish.answer, /Missing scopes: execution, publish/i, "Preflight response should list missing scopes");
  assert.equal(preflight.audit?.dry_run_only, true, "Preflight must be dry-run only");
  assert.equal(preflight.audit?.would_call_publisher, false, "Preflight must not call publisher");
  assert.equal(preflight.audit?.would_publish, false, "Preflight must not publish");
  assert.equal(preflight.audit?.would_schedule, false, "Preflight must not schedule");
  assertNoExecutableJobFields(publish, "publish");

  const vietnamesePublish = smoke.maybeCreateCmoGoalWorkflowSmokeResponse({
    ...input,
    message: "/goal \u0111\u0103ng lu\u00f4n",
  });
  const vietnamesePublishPreflight = artifact(vietnamesePublish, "cmo.publisher_execution_preflight.v1");
  assert.deepEqual(vietnamesePublishPreflight.approval_check?.missing_scopes, ["execution", "publish"], "Vietnamese publish smoke should require execution and publish scopes");
  assert.equal(smoke.maybeCreateCmoGoalWorkflowSmokeResponse({
    ...input,
    message: "publish luon",
  }), null, "Unprefixed publish must not trigger smoke preflight");
  assert.equal(smoke.maybeCreateCmoGoalWorkflowSmokeResponse({
    ...input,
    message: "\u0111\u0103ng lu\u00f4n",
  }), null, "Unprefixed Vietnamese publish must not trigger smoke preflight");

  const schedule = smoke.maybeCreateCmoGoalWorkflowSmokeResponse({
    ...input,
    message: "/goal schedule",
  });
  const schedulePreflight = artifact(schedule, "cmo.publisher_execution_preflight.v1");
  assert.deepEqual(schedulePreflight.approval_check?.missing_scopes, ["execution", "schedule"], "Schedule smoke should require execution and schedule scopes");

  const normal = smoke.maybeCreateCmoGoalWorkflowSmokeResponse({
    ...input,
    message: "hello, what should this app focus on?",
  });
  assert.equal(normal, null, "Normal unrelated chat should not trigger smoke helper");
  assert.equal(smoke.maybeCreateCmoGoalWorkflowSmokeResponse({
    ...input,
    message: "Hi",
  }), null, "Hi should not trigger smoke helper");
  assert.equal(smoke.maybeCreateCmoGoalWorkflowSmokeResponse({
    ...input,
    message: "Vi\u1ebft gi\u00fap m\u00ecnh 3 caption ng\u1eafn cho campaign n\u00e0y",
  }), null, "Native creative caption request should not trigger smoke helper");

  console.log(JSON.stringify({
    ok: true,
    weeklyContracts: [...weeklyContracts],
    publishMissingScopes: preflight.approval_check.missing_scopes,
    scheduleMissingScopes: schedulePreflight.approval_check.missing_scopes,
    answerPreview: weekly.answer.slice(0, 220),
  }, null, 2));
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}
