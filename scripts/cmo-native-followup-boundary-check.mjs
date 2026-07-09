import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const files = {
  config: path.join(root, "src", "lib", "cmo", "config.ts"),
  activityEvents: path.join(root, "src", "lib", "cmo", "activity-events.ts"),
  currentTurnResponse: path.join(root, "src", "lib", "cmo", "current-turn-response-contract.ts"),
  lensMeasurement: path.join(root, "src", "lib", "cmo", "lens-measurement-result.ts"),
  sanitizer: path.join(root, "src", "lib", "cmo", "hermes-outbound-payload-sanitizer.ts"),
  goalStateTransport: path.join(root, "src", "lib", "cmo", "goal-state-transport.ts"),
  userMetadata: path.join(root, "src", "lib", "cmo", "user-metadata.ts"),
  hermesFirst: path.join(root, "src", "lib", "cmo", "hermes-first-cmo-chat.ts"),
};

const unsafePattern = /file:|\/home\/|[A-Za-z]:[\\/]|\.png(?:_redact)?\b|sk-proj-|Bearer\s+[A-Za-z0-9._-]{20,}|raw_artifact_payload/i;

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
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-native-followup-boundary-"));
  const replacements = [
    ["@/lib/cmo/config", "./config.cjs"],
    ["@/lib/cmo/activity-events", "./activity-events.cjs"],
    ["@/lib/cmo/current-turn-response-contract", "./current-turn-response-contract.cjs"],
    ["@/lib/cmo/lens-measurement-result", "./lens-measurement-result.cjs"],
    ["@/lib/cmo/hermes-outbound-payload-sanitizer", "./sanitizer.cjs"],
    ["@/lib/cmo/goal-state-transport", "./goal-state-transport.cjs"],
    ["@/lib/cmo/user-metadata", "./user-metadata.cjs"],
  ];
  const outputs = [
    ["config.cjs", files.config],
    ["activity-events.cjs", files.activityEvents],
    ["current-turn-response-contract.cjs", files.currentTurnResponse],
    ["lens-measurement-result.cjs", files.lensMeasurement],
    ["sanitizer.cjs", files.sanitizer],
    ["goal-state-transport.cjs", files.goalStateTransport],
    ["user-metadata.cjs", files.userMetadata],
    ["hermes-first.cjs", files.hermesFirst],
  ];

  for (const [name, filePath] of outputs) {
    await writeFile(path.join(tmpDir, name), replaceRequires(transpileTs(filePath), replacements), "utf8");
  }

  return {
    tmpDir,
    hermesFirst: createRequire(import.meta.url)(path.join(tmpDir, "hermes-first.cjs")),
  };
}

function contextPack() {
  return {
    items: [
      {
        exists: true,
        kind: "note",
        title: "Social traffic context",
        content: "Use recent campaign context as background. Native CMO owns the strategy and final answer.",
        source: {
          sourceId: "source_social_traffic",
          type: "vault_note",
          label: "Social traffic context",
        },
        contextQuality: "context_hint",
        inclusionReason: "test_context",
        truncated: false,
      },
    ],
  };
}

function inputFor(message, options = {}) {
  const pack = contextPack();

  return {
    contextPack: pack,
    contextPackage: {
      contextPack: pack,
      lensMeasurementResult: null,
      lensReadoutContext: null,
      activeGoalState: null,
    },
    message,
    history: options.history ?? [],
    request: {
      tenantId: "tenant_test",
      workspaceId: "workspace_test",
      appId: "app_test",
      appName: "OpenClaw",
      message,
      rangeKey: "this_week",
    },
    contextUsed: [],
    missingContext: [],
    sessionId: "session_followup",
    userMessageId: `msg_${options.id ?? "turn"}`,
    createdAt: "2026-07-09T00:00:00.000Z",
    userIdentity: {
      authMode: "legacy",
      userId: "user_test",
      userSlug: "user-test",
    },
    sessionSummary: options.sessionSummary,
    sessionArtifacts: options.sessionArtifacts,
  };
}

function hermesResponseFor(request, options) {
  return {
    schema_version: "hermes.cmo.chat.response.v1_1",
    request_id: request.request_id,
    session_id: request.session_id,
    turn_id: request.turn_id,
    mode: "cmo.chat",
    status: "completed",
    answer: {
      body: options.answerBody,
      format: "markdown",
    },
    activity_events: [
      {
        event_id: `${request.request_id}_completed`,
        type: "run.completed",
        status: "completed",
        message: "Native CMO answered.",
        user_visible: false,
        source_agent: "cmo",
        sourceMode: "cmo.default",
      },
    ],
    delegation_summary: [],
    agents_used: ["cmo"],
    artifacts_out: options.artifactsOut ?? [],
    approval_requests: [],
    suggested_vault_updates: [],
    side_effects: {
      publish: false,
      schedule: false,
      execute: false,
      paid_generation: false,
    },
    metadata: options.metadata ?? {
      agents_used: ["cmo"],
      delegations_mode: "proposals_only",
    },
    suggested_session_summary_update: options.suggestedSessionSummaryUpdate,
  };
}

async function runWithMockHermes(hermesFirst, input, responseOptions) {
  const calls = [];
  const previousFetch = globalThis.fetch;
  const previousBaseUrl = process.env.CMO_HERMES_BASE_URL;
  const previousApiKey = process.env.CMO_HERMES_API_KEY;
  const previousTimeout = process.env.CMO_HERMES_TIMEOUT_MS;

  process.env.CMO_HERMES_BASE_URL = "https://hermes.invalid";
  process.env.CMO_HERMES_API_KEY = "test_api_key";
  process.env.CMO_HERMES_TIMEOUT_MS = "30000";

  globalThis.fetch = async (url, init) => {
    const bodyText = String(init?.body ?? "");
    const body = JSON.parse(bodyText);
    calls.push({ url: String(url), bodyText, body });

    return new Response(JSON.stringify(hermesResponseFor(body, responseOptions)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const run = await hermesFirst.runHermesFirstCmoChat(input);
    assert.equal(run.ok, true, `${input.message}: expected native Hermes CMO request to succeed`);
    assert.equal(calls.length, 1, `${input.message}: expected exactly one Hermes fetch`);

    const mapped = hermesFirst.mapHermesFirstCmoChatToAppChat({
      request: run.request,
      response: run.response,
      liveAttemptStartedAt: run.liveAttemptStartedAt,
      liveAttemptDurationMs: run.liveAttemptDurationMs,
    });

    return { calls, run, mapped };
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBaseUrl === undefined) delete process.env.CMO_HERMES_BASE_URL;
    else process.env.CMO_HERMES_BASE_URL = previousBaseUrl;
    if (previousApiKey === undefined) delete process.env.CMO_HERMES_API_KEY;
    else process.env.CMO_HERMES_API_KEY = previousApiKey;
    if (previousTimeout === undefined) delete process.env.CMO_HERMES_TIMEOUT_MS;
    else process.env.CMO_HERMES_TIMEOUT_MS = previousTimeout;
  }
}

function userMessage(id, content) {
  return {
    id,
    role: "user",
    content,
    createdAt: "2026-07-09T00:00:00.000Z",
  };
}

function assistantMessage(id, content, mapped) {
  return {
    id,
    role: "assistant",
    content,
    createdAt: "2026-07-09T00:00:00.000Z",
    productRenderSource: mapped.productRenderSource,
    runtimeProvider: mapped.runtimeProvider,
    runtimeAgent: mapped.runtimeAgent,
    hermesRequestSent: mapped.hermesRequestSent,
    calledHermesCmo: mapped.calledHermesCmo,
    hermesCmoStatus: mapped.hermesCmoStatus,
    hermesCmoMetadata: mapped.hermesCmoMetadata,
    sessionArtifacts: mapped.sessionArtifacts,
  };
}

function assertNativeMappedResponse(mapped, label) {
  assert.equal(mapped.status, "completed", `${label}: expected completed native CMO response`);
  assert.equal(mapped.runtimeProvider, "hermes", `${label}: response must be Hermes-owned`);
  assert.equal(mapped.runtimeAgent, "cmo", `${label}: response must be CMO-owned`);
  assert.equal(mapped.productRenderSource, "hermes_cmo", `${label}: response must render as native Hermes CMO`);
  assert.equal(mapped.calledHermesCmo, true, `${label}: must call native CMO`);
  assert.equal(mapped.hermesRequestSent, true, `${label}: must send Hermes request`);
}

function assertNoUnsafeLeak(value, label) {
  assert.doesNotMatch(JSON.stringify(value), unsafePattern, `${label}: must not leak local path, secret, or raw artifact text`);
}

function assertNoGoalOrPreflight(value, label) {
  const serialized = JSON.stringify(value);

  assert.doesNotMatch(serialized, /cmo\.goal\./, `${label}: must not emit goal artifacts without /goal`);
  assert.doesNotMatch(serialized, /cmo\.publisher_execution_preflight\.v1/, `${label}: must not emit publisher preflight without /goal publish`);
}

const { tmpDir, hermesFirst } = await loadHarness();

try {
  const turn1 = await runWithMockHermes(
    hermesFirst,
    inputFor("Hi b\u1ea1n", { id: "hello" }),
    {
      answerBody: "Ch\u00e0o b\u1ea1n, m\u00ecnh l\u00e0 native CMO.",
    },
  );
  assertNativeMappedResponse(turn1.mapped, "turn 1");

  const historyAfterTurn1 = [
    userMessage("user_1", "Hi b\u1ea1n"),
    assistantMessage("assistant_1", turn1.mapped.answer, turn1.mapped),
  ];
  const unsafeAnswer = [
    "Tu\u1ea7n n\u00e0y ch\u1ecdn h\u01b0\u1edbng d\u1ec5 l\u00e0m nh\u1ea5t: gom 1 offer social, vi\u1ebft 3 bi\u1ebfn th\u1ec3 ng\u1eafn, \u0111\u0103ng v\u00e0o khung gi\u1edd c\u00f3 engagement t\u1ed1t nh\u1ea5t.",
    "Internal trace: file:/home/admin/openclaw/output/traffic-plan.png sk-proj-redactedexample1234567890",
  ].join("\n");
  const turn2 = await runWithMockHermes(
    hermesFirst,
    inputFor("Tu\u1ea7n n\u00e0y n\u00ean l\u00e0m g\u00ec \u0111\u1ec3 t\u0103ng traffic social?", {
      id: "traffic",
      history: historyAfterTurn1,
    }),
    {
      answerBody: unsafeAnswer,
      artifactsOut: [
        {
          contract: "cmo.native_debug.v1",
          title: "Internal native artifact",
          local_path: "C:\\Users\\ADMIN\\OpenClaw\\traffic-plan.png",
          raw_artifact_payload: "file:/home/admin/openclaw/output/traffic-plan.png",
          diagnostics: {
            authorization: "Bearer abcdefghijklmnopqrstuvwxyz123456",
          },
        },
      ],
      metadata: {
        agents_used: ["cmo"],
        diagnostic_path: "/home/admin/openclaw/output/traffic-plan.png",
        token_preview: "sk-proj-redactedexample1234567890",
      },
      suggestedSessionSummaryUpdate: "Traffic plan was discussed. Internal file: /home/admin/openclaw/output/traffic-plan.png",
    },
  );
  assertNativeMappedResponse(turn2.mapped, "turn 2");
  assert.match(turn2.mapped.answer, /gom 1 offer social/i, "turn 2: safe native CMO answer should be preserved");
  assert.doesNotMatch(turn2.mapped.answer, /Internal trace/i, "turn 2: diagnostic-only unsafe response line should be dropped");
  assertNoUnsafeLeak(turn2.mapped, "turn 2 mapped response");
  assertNoGoalOrPreflight(turn2.mapped, "turn 2 mapped response");

  const historyAfterTurn2 = [
    ...historyAfterTurn1,
    userMessage("user_2", "Tu\u1ea7n n\u00e0y n\u00ean l\u00e0m g\u00ec \u0111\u1ec3 t\u0103ng traffic social?"),
    assistantMessage("assistant_2", turn2.mapped.answer, turn2.mapped),
  ];
  const turn3 = await runWithMockHermes(
    hermesFirst,
    inputFor("Ok ch\u1ecdn h\u01b0\u1edbng d\u1ec5 l\u00e0m nh\u1ea5t cho tu\u1ea7n n\u00e0y", {
      id: "followup",
      history: historyAfterTurn2,
      sessionArtifacts: turn2.mapped.sessionArtifacts,
      sessionSummary: String(turn2.mapped.suggestedSessionSummaryUpdate ?? ""),
    }),
    {
      answerBody: "Ch\u1ecdn h\u01b0\u1edbng d\u1ec5 l\u00e0m nh\u1ea5t: \u01b0u ti\u00ean 1 offer social c\u00f3 th\u1ec3 l\u00e0m ngay trong tu\u1ea7n n\u00e0y.",
    },
  );
  assertNativeMappedResponse(turn3.mapped, "turn 3 follow-up");
  assert.match(turn3.mapped.answer, /1 offer social/i, "turn 3: expected normal native CMO follow-up answer");
  assert.equal(turn3.calls[0].body.intent.user_message, "Ok ch\u1ecdn h\u01b0\u1edbng d\u1ec5 l\u00e0m nh\u1ea5t cho tu\u1ea7n n\u00e0y", "turn 3: user message must reach Hermes intent");
  assert.equal(turn3.calls[0].body.outbound_hermes_payload_guard.outbound_hermes_payload_path_like_blocked, false, "turn 3: scrubbed context must not block request");
  assertNoUnsafeLeak(turn3.calls[0].body, "turn 3 outbound Hermes body");
  assertNoUnsafeLeak(turn3.mapped, "turn 3 mapped response");
  assertNoGoalOrPreflight(turn3.calls[0].body, "turn 3 outbound Hermes body");
  assertNoGoalOrPreflight(turn3.mapped, "turn 3 mapped response");

  console.log(JSON.stringify({
    ok: true,
    nativeMessagesSent: [
      turn1.calls[0].body.intent.user_message,
      turn2.calls[0].body.intent.user_message,
      turn3.calls[0].body.intent.user_message,
    ],
    turn2SafeAnswerPreserved: /gom 1 offer social/i.test(turn2.mapped.answer),
    turn3Status: turn3.mapped.status,
    turn3HermesRequestSent: turn3.mapped.hermesRequestSent,
  }, null, 2));
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}
