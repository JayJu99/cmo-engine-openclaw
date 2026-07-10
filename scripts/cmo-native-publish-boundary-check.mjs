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
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-native-publish-boundary-"));
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

function contextPack(unsafeContext = false) {
  return {
    items: [
      {
        exists: true,
        kind: "note",
        title: "Campaign context",
        content: unsafeContext
          ? "Creative artifact path file:/home/admin/campaigns/publish-now.png_redact and token sk-proj-testunsafe123456789012345 should not leave Product."
          : "Safe campaign context for native CMO.",
        source: {
          sourceId: "source_campaign",
          type: "vault_note",
          label: "Campaign context",
        },
        contextQuality: "context_hint",
        inclusionReason: "test_context",
        truncated: false,
      },
    ],
  };
}

function inputFor(message, options = {}) {
  const pack = contextPack(options.unsafeContext === true);

  return {
    contextPack: pack,
    contextPackage: {
      contextPack: pack,
      lensMeasurementResult: null,
      lensReadoutContext: null,
      activeGoalState: null,
    },
    message,
    history: [],
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
    sessionId: "session_test",
    userMessageId: `msg_${options.id ?? "native"}`,
    createdAt: "2026-07-09T00:00:00.000Z",
    userIdentity: {
      authMode: "legacy",
      userId: "user_test",
      userSlug: "user-test",
    },
  };
}

function hermesResponseFor(request, answerBody) {
  return {
    schema_version: "hermes.cmo.chat.response.v1_1",
    request_id: request.request_id,
    session_id: request.session_id,
    turn_id: request.turn_id,
    mode: "cmo.chat",
    status: "completed",
    answer: {
      body: answerBody,
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
    artifacts_out: [],
    approval_requests: [],
    suggested_vault_updates: [],
    side_effects: {
      publish: false,
      schedule: false,
      execute: false,
      paid_generation: false,
    },
    metadata: {
      agents_used: ["cmo"],
      delegations_mode: "proposals_only",
    },
  };
}

async function runWithMockHermes(hermesFirst, input, answerBody) {
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

    return new Response(JSON.stringify(hermesResponseFor(body, answerBody)), {
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

function requestFor(message) {
  return {
    request_id: "req_hf_cmo_chat_msg_publish",
    session_id: "session_publish",
    turn_id: "msg_publish",
    intent: {
      user_message: message,
    },
  };
}

function blockedFailure(message) {
  return {
    type: "request_payload_blocked",
    publicReason: "Product blocked Hermes-first request because the final outbound body still contained unsafe local path, secret, or artifact text after scrub",
    runtimeError: "Product blocked Hermes-first request because the final outbound body still contained unsafe local path, secret, or artifact text after scrub",
    runtimeErrorReason: "invalid_response",
    requestId: "req_hf_cmo_chat_msg_publish",
    request: requestFor(message),
    detail: "home_path, file_uri",
    outboundBlockedLiterals: ["home_path", "file_uri"],
    outboundBlockedSources: ["fetch_body"],
    outboundBlockedSnippets: ["...lensOutputPath\":\"[local_path_redacted]..."],
    outboundBlockedPaths: ["context_pack.artifacts_in.0.context.channel_metrics_sync_status.lensOutputPath"],
    outboundBlockedFieldsPreview: ["context_pack.artifacts_in.0.context.channel_metrics_sync_status.lensOutputPath"],
    outboundBlockedClasses: ["home_path", "file_uri"],
  };
}

function assertNoProductPublishPreflight(value, label) {
  assert.doesNotMatch(JSON.stringify(value), /cmo\.publisher_execution_preflight\.v1/, `${label}: must not emit publisher preflight`);
}

function assertNoUnsafeLeak(value, label) {
  assert.doesNotMatch(String(value), /file:|\/home\/|\.png_redact|sk-proj-/i, `${label}: must not leak local path, raw artifact suffix, or secret shape`);
}

function assertNativeMappedResponse(mapped, expectedAnswer, label) {
  assert.equal(mapped.status, "completed", `${label}: expected completed native CMO response`);
  assert.equal(mapped.answer, expectedAnswer, `${label}: Product must render Hermes CMO answer verbatim`);
  assert.equal(mapped.runtimeProvider, "hermes", `${label}: response must be Hermes-owned`);
  assert.equal(mapped.runtimeAgent, "cmo", `${label}: response must be CMO-owned`);
  assert.equal(mapped.productRenderSource, "hermes_cmo", `${label}: response must render as native Hermes CMO`);
  assert.equal(mapped.calledHermesCmo, true, `${label}: must call native CMO`);
  assert.equal(mapped.hermesRequestSent, true, `${label}: must send Hermes request`);
  assertNoProductPublishPreflight(mapped, label);
}

const { tmpDir, hermesFirst } = await loadHarness();

try {
  const nativePublish = await runWithMockHermes(
    hermesFirst,
    inputFor("publish luon", { unsafeContext: true, id: "publish" }),
    "Native CMO handled the publish request without Product-authored publish clarification.",
  );
  assertNativeMappedResponse(nativePublish.mapped, "Native CMO handled the publish request without Product-authored publish clarification.", "normal publish");
  assert.equal(nativePublish.calls[0].body.intent.user_message, "publish luon", "normal publish: user message must reach Hermes intent");
  assert.equal(nativePublish.calls[0].body.outbound_hermes_payload_guard.outbound_hermes_payload_sanitized, true, "normal publish: unsafe context should be scrubbed");
  assert.equal(nativePublish.calls[0].body.outbound_hermes_payload_guard.outbound_hermes_payload_path_like_blocked, false, "normal publish: scrubbed context must not block request");
  assertNoUnsafeLeak(nativePublish.calls[0].bodyText, "normal publish outbound body");
  assertNoUnsafeLeak(nativePublish.mapped.answer, "normal publish user answer");

  const vietnamesePublish = await runWithMockHermes(
    hermesFirst,
    inputFor("\u0111\u0103ng lu\u00f4n", { unsafeContext: true, id: "publish_vn" }),
    "Native CMO handled the Vietnamese publish request.",
  );
  assertNativeMappedResponse(vietnamesePublish.mapped, "Native CMO handled the Vietnamese publish request.", "normal Vietnamese publish");
  assert.equal(vietnamesePublish.calls[0].body.intent.user_message, "\u0111\u0103ng lu\u00f4n", "normal Vietnamese publish: user message must reach Hermes intent");
  assertNoUnsafeLeak(vietnamesePublish.calls[0].bodyText, "normal Vietnamese publish outbound body");

  const traffic = await runWithMockHermes(
    hermesFirst,
    inputFor("Tu\u1ea7n n\u00e0y n\u00ean l\u00e0m g\u00ec \u0111\u1ec3 t\u0103ng traffic?", { id: "traffic" }),
    "Native CMO handled the traffic strategy request.",
  );
  assertNativeMappedResponse(traffic.mapped, "Native CMO handled the traffic strategy request.", "normal traffic");
  assert.doesNotMatch(traffic.mapped.answer, /GA4\/UTM|weekly plan|No real baseline is claimed/i, "normal traffic: Product must not return weekly traffic smoke advice");

  const caption = await runWithMockHermes(
    hermesFirst,
    inputFor("Cho m\u00ecnh 3 caption ng\u1eafn cho campaign n\u00e0y", { id: "caption" }),
    "Native CMO handled the caption request.",
  );
  assertNativeMappedResponse(caption.mapped, "Native CMO handled the caption request.", "normal caption");
  assert.doesNotMatch(caption.mapped.answer, /caption 1|caption 2|caption 3|Echo was not called/i, "normal caption: Product must not return canned copy");

  const boundaryPublish = hermesFirst.hermesFirstBoundaryFailureResponse({
    failure: blockedFailure("publish luon"),
  });
  assert.equal(boundaryPublish.status, "failed", "blocked publish: generic transport failure should stay failed");
  assert.equal(boundaryPublish.runtimeProvider, "hermes", "blocked publish: Product must not own a publish clarification");
  assert.equal(boundaryPublish.productRenderSource, "hermes_cmo_boundary_failure", "blocked publish: must render as Hermes boundary failure");
  assert.match(boundaryPublish.answer, /No Product fallback answer was generated/i, "blocked publish: must not return Product-authored publish strategy");
  assert.doesNotMatch(boundaryPublish.answer, /exact asset or draft|target channel\/account|I cannot publish from this turn yet/i, "blocked publish: must not contain old Product publish clarification");
  assertNoProductPublishPreflight(boundaryPublish, "blocked publish");
  assert.deepEqual(
    boundaryPublish.hermesCmoMetadata?.outbound_blocked_paths,
    ["context_pack.artifacts_in.0.context.channel_metrics_sync_status.lensOutputPath"],
    "blocked publish: boundary metadata must preserve sanitized outbound paths",
  );
  assert.deepEqual(
    boundaryPublish.hermesCmoMetadata?.outbound_blocked_literal_labels,
    ["home_path", "file_uri"],
    "blocked publish: boundary metadata must preserve blocked labels",
  );
  assert.deepEqual(
    boundaryPublish.hermesCmoMetadata?.outbound_blocked_classes,
    ["home_path", "file_uri"],
    "blocked publish: boundary metadata must preserve blocked classes",
  );
  assert.ok(
    [
      boundaryPublish.hermesCmoMetadata?.outbound_blocked_paths,
      boundaryPublish.hermesCmoMetadata?.outbound_blocked_fields_preview,
      boundaryPublish.hermesCmoMetadata?.outbound_blocked_literal_labels,
      boundaryPublish.hermesCmoMetadata?.outbound_blocked_classes,
    ].some((value) => Array.isArray(value) && value.length > 0),
    "blocked publish: persisted outbound diagnostics must not all be empty",
  );

  const rootOnlyBoundary = hermesFirst.hermesFirstBoundaryFailureResponse({
    failure: {
      ...blockedFailure("serialized outbound value"),
      requestId: "req_hf_cmo_chat_msg_root_only",
      detail: "file_uri",
      outboundBlockedLiterals: ["file_uri"],
      outboundBlockedPaths: ["$"],
      outboundBlockedFieldsPreview: ["$"],
      outboundBlockedClasses: ["file_uri"],
    },
  });
  assert.deepEqual(rootOnlyBoundary.hermesCmoMetadata?.outbound_blocked_fields_preview, ["$"]);
  assert.deepEqual(rootOnlyBoundary.hermesCmoMetadata?.outbound_blocked_literal_labels, ["file_uri"]);
  assert.deepEqual(rootOnlyBoundary.hermesCmoMetadata?.outbound_blocked_classes, ["file_uri"]);

  const goalPublish = hermesFirst.hermesFirstBoundaryFailureResponse({
    failure: blockedFailure("/goal publish luon"),
  });
  assert.equal(goalPublish.status, "failed", "/goal publish boundary: generic boundary mapping should remain");
  assert.match(goalPublish.answer, /No Product fallback answer was generated/i, "/goal publish boundary: should keep generic boundary mapping");

  console.log(JSON.stringify({
    ok: true,
    nativeMessagesSent: [
      nativePublish.calls[0].body.intent.user_message,
      vietnamesePublish.calls[0].body.intent.user_message,
      traffic.calls[0].body.intent.user_message,
      caption.calls[0].body.intent.user_message,
    ],
    scrubbedUnsafeContext: nativePublish.calls[0].body.outbound_hermes_payload_guard.outbound_hermes_payload_sanitized,
    boundaryPublishStatus: boundaryPublish.status,
  }, null, 2));
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}
