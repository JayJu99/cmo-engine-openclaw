import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeSourcePath = path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-runtime.ts");

const compileRuntimeModule = async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "hermes-cmo-runtime-"));
  const tscPath = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");

  try {
    execFileSync(
      process.execPath,
      [
        tscPath,
        "--target",
        "ES2022",
        "--module",
        "CommonJS",
        "--moduleResolution",
        "Node",
        "--strict",
        "--skipLibCheck",
        "--esModuleInterop",
        "--noEmitOnError",
        "true",
        "--outDir",
        tmpDir,
        runtimeSourcePath,
      ],
      {
        cwd: rootDir,
        stdio: "pipe",
      },
    );
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`Failed to compile H4 runtime module:\n${stdout}\n${stderr}`);
  }

  return {
    tmpDir,
    runtimePath: path.join(tmpDir, "hermes-cmo-runtime.js"),
  };
};

const sampleRequest = {
  schema_version: "hermes.cmo.request.v1",
  request_id: "req_h4_runtime_skeleton_001",
  session_id: "session_h4_runtime_skeleton",
  turn_id: "turn_h4_runtime_skeleton_001",
  created_at: "2026-05-28T10:30:00+07:00",
  workspace: {
    workspace_id: "world-app-holdstation-mini-app",
    app_id: "holdstation-mini-app",
    app_name: "Holdstation Mini App",
  },
  user: {
    user_id: "server_derived_user_id",
    display_name: "Jay",
  },
  intent: {
    mode: "cmo.default",
    user_message: "Review activation plan from the provided context for demo readiness.",
    explicit_command: null,
  },
  context_pack: {
    current_priority: [
      {
        type: "priority",
        title: "Demo readiness",
        content: "Keep H4 as a runtime boundary only.",
      },
    ],
    selected_context: [],
    recent_session_summary: null,
    indexed_context_supplement: [],
    artifacts_in: [],
  },
  constraints: {
    no_direct_vault_write: true,
    no_direct_memory_mutation: true,
    vault_agent_delegation_allowed: true,
    vault_agent_requires_save_intent: true,
    kanban_enabled: false,
    demo_mode: true,
    allowed_agents: ["echo", "surf", "vault_agent"],
    allowed_surf_modes: ["surf.default", "surf.x", "surf.trend", "surf.pulse"],
  },
  ui: {
    activity_stream_required: true,
    heartbeat_required: true,
  },
};

const expectedZeroCounters = {
  surfCalls: 0,
  echoCalls: 0,
  vaultAgentCalls: 0,
  vaultWrites: 0,
  supabaseWrites: 0,
  sessionWrites: 0,
  rawCaptureWrites: 0,
  openClawCalls: 0,
};

const assertResponseShape = (response) => {
  assert.equal(response.schema_version, "hermes.cmo.response.v1");
  assert.equal(response.request_id, sampleRequest.request_id);
  assert.equal(response.session_id, sampleRequest.session_id);
  assert.equal(response.turn_id, sampleRequest.turn_id);
  assert.equal(response.status, "completed");
  assert.equal(response.answer_basis?.mode, "fully_grounded");
  assert.equal(response.clarifying_question?.required, false);
  assert.equal(response.answer?.format, "markdown");
  assert.equal(response.structured_output?.runtime_mode, "skeleton");
  assert.equal(Array.isArray(response.delegations), true);
  assert.equal(Array.isArray(response.artifacts), true);
  assert.equal(Array.isArray(response.memory_suggestions), true);
  assert.deepEqual(response.structured_output?.safety_counters, expectedZeroCounters);
};

const assertActivityEvents = (events, response) => {
  assert.equal(Array.isArray(events), true);
  assert.ok(events.length > 0);
  assert.equal(response.activity_summary?.events_count, events.length);

  events.forEach((event, index) => {
    assert.equal(event.schema_version, "hermes.activity.event.v1");
    assert.equal(event.request_id, sampleRequest.request_id);
    assert.equal(event.session_id, sampleRequest.session_id);
    assert.equal(event.turn_id, sampleRequest.turn_id);
    assert.equal(event.seq, index + 1);
    assert.equal(event.source?.agent, "cmo");
    assert.equal(event.source?.mode, "cmo.default");
    assert.equal(typeof event.message, "string");
    assert.ok(event.message.length > 0);
    assert.equal(typeof event.data, "object");
    assert.notEqual(event.data, null);
  });
};

try {
  const { tmpDir, runtimePath } = await compileRuntimeModule();
  const requireFromCheck = createRequire(import.meta.url);
  const { runHermesCmoRuntime } = requireFromCheck(runtimePath);
  const result = runHermesCmoRuntime(sampleRequest);

  try {
    assert.equal(result.ok, true);
    assert.equal(result.runtimeMode, "skeleton");
    assertResponseShape(result.response);
    assertActivityEvents(result.activity_events, result.response);
    assert.deepEqual(result.safety_counters, expectedZeroCounters);
    assert.deepEqual(result.safety.counters, expectedZeroCounters);
    assert.equal(result.safety_flags.noExternalAgentCalls, true);
    assert.equal(result.safety_flags.noWrites, true);
    assert.equal(result.safety_flags.notWiredIntoLiveCmoChat, true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtimeMode: result.runtimeMode,
        responseSchemaVersion: result.response.schema_version,
        activityEvents: result.activity_events.length,
        safetyCounters: result.safety_counters,
        safetyFlags: result.safety_flags,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
