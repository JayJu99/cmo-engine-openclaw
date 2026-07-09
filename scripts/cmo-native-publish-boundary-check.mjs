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
    detail: "/home/, file:",
    outboundBlockedLiterals: ["/home/", "file:"],
    outboundBlockedSources: ["fetch_body"],
    outboundBlockedSnippets: ["...lensOutputPath\":\"[local_path_redacted]..."],
    outboundBlockedPaths: ["context_pack.artifacts_in.0.context.channel_metrics_sync_status.lensOutputPath"],
    outboundBlockedFieldsPreview: ["context_pack.artifacts_in.0.context.channel_metrics_sync_status.lensOutputPath"],
  };
}

const { tmpDir, hermesFirst } = await loadHarness();

try {
  const nativePublish = hermesFirst.hermesFirstBoundaryFailureResponse({
    failure: blockedFailure("publish luon"),
  });

  assert.equal(nativePublish.status, "completed", "Native publish boundary should return a normal assistant answer");
  assert.equal(nativePublish.runtimeProvider, "product", "Native publish boundary should be Product-owned");
  assert.equal(nativePublish.runtimeAgent, "cmo", "Native publish boundary should stay in CMO UX");
  assert.equal(nativePublish.productRenderSource, "local_runtime_fallback", "Native publish boundary should not render as Hermes boundary failure");
  assert.equal(nativePublish.calledHermesCmo, false, "Native publish boundary must not claim Hermes was called");
  assert.equal(nativePublish.hermesRequestSent, false, "Native publish boundary must not claim a Hermes request was sent");
  assert.match(nativePublish.answer, /cannot publish/i, "Native publish answer should block publish side effects");
  assert.match(nativePublish.answer, /asset|draft/i, "Native publish answer should ask for asset or draft");
  assert.match(nativePublish.answer, /channel|account/i, "Native publish answer should ask for channel/account");
  assert.match(nativePublish.answer, /approval/i, "Native publish answer should require explicit approval");
  assert.match(nativePublish.answer, /No publish, schedule, execution/i, "Native publish answer should state no side effects occurred");
  assert.doesNotMatch(nativePublish.answer, /Boundary failure|No Product fallback answer/i, "Native publish answer must not expose boundary failure copy");
  assert.doesNotMatch(JSON.stringify(nativePublish), /cmo\.publisher_execution_preflight\.v1/, "Native publish boundary must not emit /goal preflight artifact");
  assert.equal(nativePublish.approvalRequests.length, 0, "Native publish boundary should defer approval request until scope is known");
  assert.deepEqual(nativePublish.hermesCmoMetadata.outbound_blocked_literal_labels, ["/home/", "file:"], "Unsafe labels should be preserved in metadata");
  assert.deepEqual(nativePublish.hermesCmoMetadata.outbound_blocked_paths, ["context_pack.artifacts_in.0.context.channel_metrics_sync_status.lensOutputPath"], "Unsafe paths should be preserved in metadata");

  const vietnamesePublish = hermesFirst.hermesFirstBoundaryFailureResponse({
    failure: blockedFailure("\u0111\u0103ng lu\u00f4n"),
  });

  assert.equal(vietnamesePublish.status, "completed", "Vietnamese native publish boundary should return safe clarification");
  assert.equal(vietnamesePublish.hermesRequestSent, false, "Vietnamese native publish boundary must not send Hermes");

  const goalPublish = hermesFirst.hermesFirstBoundaryFailureResponse({
    failure: blockedFailure("/goal publish luon"),
  });

  assert.equal(goalPublish.status, "failed", "/goal publish boundary should not use native publish clarification");
  assert.match(goalPublish.answer, /No Product fallback answer was generated/i, "/goal publish boundary should keep generic boundary mapping here");

  const normalChat = hermesFirst.hermesFirstBoundaryFailureResponse({
    failure: blockedFailure("Hi"),
  });

  assert.equal(normalChat.status, "failed", "Normal blocked non-publish chat should keep generic boundary failure");
  assert.match(normalChat.answer, /Boundary failure/i, "Normal blocked non-publish chat should expose generic boundary copy");

  console.log(JSON.stringify({
    ok: true,
    nativePublishStatus: nativePublish.status,
    nativePublishProvider: nativePublish.runtimeProvider,
    unsafeLabels: nativePublish.hermesCmoMetadata.outbound_blocked_literal_labels,
    unsafePaths: nativePublish.hermesCmoMetadata.outbound_blocked_paths,
  }, null, 2));
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}
