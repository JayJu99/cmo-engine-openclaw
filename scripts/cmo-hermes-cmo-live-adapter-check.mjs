import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeSourcePath = path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-runtime.ts");
const hermesCmoAgentPath = "/agents/cmo/execute";

const expectedCounters = {
  surfCalls: 0,
  echoCalls: 0,
  vaultAgentCalls: 0,
  vaultWrites: 0,
  directSupabaseMutations: 0,
  openclawCalls: 0,
};
const forbiddenZeroCounters = {
  vaultAgentCalls: 0,
  vaultWrites: 0,
  directSupabaseMutations: 0,
  openclawCalls: 0,
};

const sampleRequest = {
  schema_version: "hermes.cmo.request.v1",
  request_id: "req_h5_live_adapter_001",
  session_id: "session_h5_live_adapter",
  turn_id: "turn_h5_live_adapter_001",
  created_at: "2026-05-28T11:00:00+07:00",
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
        title: "H5 live adapter",
        content: "Call Hermes CMO live only. Do not execute Surf, Echo, Vault Agent, OpenClaw, or writes.",
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

const compileRuntimeModule = async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "hermes-cmo-live-adapter-"));
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
    throw new Error(`Failed to compile H5 runtime module:\n${stdout}\n${stderr}`);
  }

  return {
    tmpDir,
    runtimePath: path.join(tmpDir, "hermes-cmo-runtime.js"),
  };
};

const importPathsFromSource = (source) => {
  const imports = [];
  const importRegex =
    /(?:import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\))/g;
  let match = importRegex.exec(source);

  while (match) {
    imports.push(match[1] ?? match[2] ?? match[3]);
    match = importRegex.exec(source);
  }

  return imports;
};

const assertRuntimeImportsOnlyM1ExecutorsAndNoWriters = async () => {
  const source = await readFile(runtimeSourcePath, "utf8");
  const imports = importPathsFromSource(source);
  const forbiddenImports = [
    { label: "direct bridge/orchestrator", pattern: /surf-bridge|echo-bridge|cmo-surf-orchestrator/i },
    { label: "Vault writer", pattern: /vault-capture-writer|vault-files|vault-auto-capture/i },
    { label: "Supabase", pattern: /supabase/i },
    { label: "session or raw capture writer", pattern: /app-chat-store|raw-capture|store/i },
    { label: "OpenClaw runtime", pattern: /openclaw/i },
    { label: "CMO production runtime", pattern: /(^|[/\\])runtime($|[./\\])/i },
    { label: "Kanban", pattern: /kanban|pipeline/i },
  ];

  for (const importPath of imports) {
    for (const forbidden of forbiddenImports) {
      assert.equal(forbidden.pattern.test(importPath), false, `Runtime imports ${forbidden.label}: ${importPath}`);
    }
  }
};

const readRequestBody = (request) =>
  new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });

const writeJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
};

const addSeconds = (timestamp, seconds) => new Date(Date.parse(timestamp) + seconds * 1000).toISOString();

const safeId = (value) => value.replace(/[^a-zA-Z0-9_]/g, "_");

const makeActivityEvents = (requestBody) => [
  {
    schema_version: "hermes.activity.event.v1",
    event_id: `evt_${safeId(requestBody.request_id)}_001`,
    request_id: requestBody.request_id,
    session_id: requestBody.session_id,
    turn_id: requestBody.turn_id,
    seq: 1,
    created_at: addSeconds(requestBody.created_at, 1),
    source: {
      agent: "cmo",
      mode: "cmo.default",
    },
    type: "run.started",
    status: "running",
    user_visible: true,
    message: "Hermes CMO Agent accepted the live H5 request.",
    data: {
      mode: "live",
      h5_live_adapter: true,
    },
  },
  {
    schema_version: "hermes.activity.event.v1",
    event_id: `evt_${safeId(requestBody.request_id)}_002`,
    request_id: requestBody.request_id,
    session_id: requestBody.session_id,
    turn_id: requestBody.turn_id,
    seq: 2,
    created_at: addSeconds(requestBody.created_at, 2),
    source: {
      agent: "cmo",
      mode: "cmo.default",
    },
    type: "stage.completed",
    status: "completed",
    user_visible: true,
    message: "Hermes CMO completed strategy-only handling with sub-agent execution disabled.",
    data: {
      sub_agent_execution_allowed: false,
      safety_counters: expectedCounters,
    },
  },
  {
    schema_version: "hermes.activity.event.v1",
    event_id: `evt_${safeId(requestBody.request_id)}_003`,
    request_id: requestBody.request_id,
    session_id: requestBody.session_id,
    turn_id: requestBody.turn_id,
    seq: 3,
    created_at: addSeconds(requestBody.created_at, 3),
    source: {
      agent: "cmo",
      mode: "cmo.default",
    },
    type: "run.completed",
    status: "completed",
    user_visible: true,
    message: "Hermes CMO returned a live response without Surf, Echo, Vault Agent, OpenClaw, or write execution.",
    data: {
      final_state: "completed",
      safety_counters: expectedCounters,
    },
  },
];

const makeHermesCmoEnvelope = (requestBody) => {
  const activityEvents = makeActivityEvents(requestBody);

  return {
    response: {
      schema_version: "hermes.cmo.response.v1",
      request_id: requestBody.request_id,
      session_id: requestBody.session_id,
      turn_id: requestBody.turn_id,
      status: "completed",
      answer_basis: {
        mode: "fully_grounded",
        missing_inputs: [],
        assumptions_used: [],
        user_can_override: true,
        suggested_user_inputs: [],
      },
      clarifying_question: {
        required: false,
        question: null,
        reason: null,
        missing_inputs: [],
      },
      answer: {
        format: "markdown",
        title: "H5 Hermes CMO live adapter check",
        summary: "The live adapter called only the Hermes CMO Agent endpoint.",
        decision: "Proceed with the H5 live adapter boundary.",
        body: "Hermes CMO returned a contract-valid live response while sub-agent execution and writes remained disabled.",
      },
      structured_output: {
        runtime_mode: "live",
        called_hermes_cmo: true,
        sub_agent_execution_allowed: false,
        diagnosis: ["Live Hermes CMO endpoint was called through the H5 adapter."],
        recommendations: ["Keep H5 unwired from production chat until a later explicit runtime wiring phase."],
        risks: ["Live Hermes CMO endpoint availability is now required; there is no dry-run or fallback mode."],
        next_steps: ["Wire this boundary only after explicit approval for a later phase."],
        safety_counters: expectedCounters,
      },
      delegations: [],
      artifacts: [],
      memory_suggestions: [],
      activity_summary: {
        events_count: activityEvents.length,
        final_state: "completed",
      },
    },
    activity_events: activityEvents,
  };
};

const startHermesCmoContractServer = async () => {
  const calls = {
    hermesCmo: 0,
    surf: 0,
    echo: 0,
    vaultAgent: 0,
    openclaw: 0,
    unexpected: 0,
  };
  let serverFailure = null;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (url.pathname.includes("/surf")) {
        calls.surf += 1;
      } else if (url.pathname.includes("/echo")) {
        calls.echo += 1;
      } else if (url.pathname.includes("/vault")) {
        calls.vaultAgent += 1;
      } else if (url.pathname.toLowerCase().includes("openclaw")) {
        calls.openclaw += 1;
      } else if (url.pathname === hermesCmoAgentPath) {
        calls.hermesCmo += 1;
      } else {
        calls.unexpected += 1;
      }

      if (request.method !== "POST" || url.pathname !== hermesCmoAgentPath) {
        writeJson(response, 404, { error: `Unexpected endpoint ${request.method} ${url.pathname}` });
        return;
      }

      assert.equal(request.headers.authorization, "Bearer test-hermes-cmo-live-key");
      assert.match(request.headers["content-type"] ?? "", /application\/json/);

      const rawBody = await readRequestBody(request);
      const requestBody = JSON.parse(rawBody);

      assert.equal(requestBody.schema_version, "hermes.cmo.request.v1");
      assert.equal(requestBody.request_id, sampleRequest.request_id);
      assert.deepEqual(requestBody.constraints.allowed_agents, []);
      assert.deepEqual(requestBody.constraints.allowed_surf_modes, []);
      assert.equal(requestBody.constraints.delegations_mode, "proposals_only");
      assert.equal(requestBody.constraints.allowSubAgentExecution, false);
      assert.equal(requestBody.constraints.vault_agent_delegation_allowed, false);
      assert.equal(requestBody.constraints.kanban_enabled, false);
      assert.equal(requestBody.constraints.h5_live_adapter?.live_only, true);
      assert.equal(requestBody.constraints.h5_live_adapter?.sub_agent_execution_allowed, false);
      assert.equal(requestBody.constraints.h5_live_adapter?.vault_writes_allowed, false);
      assert.equal(requestBody.constraints.h5_live_adapter?.direct_supabase_mutations_allowed, false);
      assert.equal(requestBody.constraints.h5_live_adapter?.platform_persistence_owner, "cmo_engine_app_chat_store");
      assert.equal(requestBody.constraints.h5_live_adapter?.openclaw_calls_allowed, false);

      writeJson(response, 200, makeHermesCmoEnvelope(requestBody));
    } catch (error) {
      serverFailure = error;
      writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object", "Test server did not expose an address");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    get serverFailure() {
      return serverFailure;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
};

const restoreEnvValue = (name, value) => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
};

const restoreHermesEnv = (previousEnv) => {
  restoreEnvValue("CMO_HERMES_EXECUTION_ENABLED", previousEnv.CMO_HERMES_EXECUTION_ENABLED);
  restoreEnvValue("CMO_HERMES_BASE_URL", previousEnv.CMO_HERMES_BASE_URL);
  restoreEnvValue("CMO_HERMES_API_KEY", previousEnv.CMO_HERMES_API_KEY);
  restoreEnvValue("CMO_HERMES_TIMEOUT_MS", previousEnv.CMO_HERMES_TIMEOUT_MS);
  restoreEnvValue("CMO_HERMES_CMO_ORCHESTRATION_ENABLED", previousEnv.CMO_HERMES_CMO_ORCHESTRATION_ENABLED);
  restoreEnvValue("CMO_HERMES_CMO_MAX_DELEGATIONS", previousEnv.CMO_HERMES_CMO_MAX_DELEGATIONS);
};

const assertMissingLiveConfigFailsClearly = async (runHermesCmoRuntime) => {
  const previousEnv = {
    CMO_HERMES_EXECUTION_ENABLED: process.env.CMO_HERMES_EXECUTION_ENABLED,
    CMO_HERMES_BASE_URL: process.env.CMO_HERMES_BASE_URL,
    CMO_HERMES_API_KEY: process.env.CMO_HERMES_API_KEY,
    CMO_HERMES_TIMEOUT_MS: process.env.CMO_HERMES_TIMEOUT_MS,
    CMO_HERMES_CMO_ORCHESTRATION_ENABLED: process.env.CMO_HERMES_CMO_ORCHESTRATION_ENABLED,
    CMO_HERMES_CMO_MAX_DELEGATIONS: process.env.CMO_HERMES_CMO_MAX_DELEGATIONS,
  };

  try {
    delete process.env.CMO_HERMES_EXECUTION_ENABLED;
    delete process.env.CMO_HERMES_BASE_URL;
    delete process.env.CMO_HERMES_API_KEY;
    delete process.env.CMO_HERMES_TIMEOUT_MS;
    delete process.env.CMO_HERMES_CMO_ORCHESTRATION_ENABLED;
    delete process.env.CMO_HERMES_CMO_MAX_DELEGATIONS;

    await assert.rejects(
      () => runHermesCmoRuntime(sampleRequest),
      /CMO_HERMES_EXECUTION_ENABLED must be true/,
      "Missing Hermes CMO live config must fail clearly",
    );
  } finally {
    restoreHermesEnv(previousEnv);
  }
};

try {
  await assertRuntimeImportsOnlyM1ExecutorsAndNoWriters();

  const { tmpDir, runtimePath } = await compileRuntimeModule();
  const requireFromCheck = createRequire(import.meta.url);
  const { runHermesCmoRuntime } = requireFromCheck(runtimePath);
  await assertMissingLiveConfigFailsClearly(runHermesCmoRuntime);

  const server = await startHermesCmoContractServer();
  const previousEnv = {
    CMO_HERMES_EXECUTION_ENABLED: process.env.CMO_HERMES_EXECUTION_ENABLED,
    CMO_HERMES_BASE_URL: process.env.CMO_HERMES_BASE_URL,
    CMO_HERMES_API_KEY: process.env.CMO_HERMES_API_KEY,
    CMO_HERMES_TIMEOUT_MS: process.env.CMO_HERMES_TIMEOUT_MS,
    CMO_HERMES_CMO_ORCHESTRATION_ENABLED: process.env.CMO_HERMES_CMO_ORCHESTRATION_ENABLED,
    CMO_HERMES_CMO_MAX_DELEGATIONS: process.env.CMO_HERMES_CMO_MAX_DELEGATIONS,
  };

  let result;

  try {
    process.env.CMO_HERMES_EXECUTION_ENABLED = "true";
    process.env.CMO_HERMES_BASE_URL = server.baseUrl;
    process.env.CMO_HERMES_API_KEY = "test-hermes-cmo-live-key";
    process.env.CMO_HERMES_TIMEOUT_MS = "5000";
    process.env.CMO_HERMES_CMO_ORCHESTRATION_ENABLED = "false";
    process.env.CMO_HERMES_CMO_MAX_DELEGATIONS = "2";

    result = await runHermesCmoRuntime(sampleRequest);

    assert.equal(server.serverFailure, null, "Hermes CMO contract server failed while handling the request");
    assert.equal(result.ok, true);
    assert.equal(result.mode, "live");
    assert.equal(result.runtimeMode, "live");
    assert.equal(result.calledHermesCmo, true);
    assert.equal(result.hermesCmoAgentPath, hermesCmoAgentPath);
    assert.deepEqual(result.safety_counters, expectedCounters);
    assert.deepEqual(result.safety.counters, expectedCounters);
    assert.deepEqual(result.forbidden_counters, forbiddenZeroCounters);
    assert.equal(result.safety_flags.liveOnly, true);
    assert.equal(result.safety_flags.calledHermesCmo, true);
    assert.equal(result.safety_flags.cmoEngineMechanicalExecutor, true);
    assert.equal(result.safety_flags.subAgentExecutionAllowed, false);
    assert.equal(result.safety_flags.noWrites, true);
    assert.equal(result.response.schema_version, "hermes.cmo.response.v1");
    assert.equal(result.response.structured_output?.runtime_mode, "live");
    assert.equal(result.response.activity_summary.events_count, result.activity_events.length);
    assert.equal(server.calls.hermesCmo, 1);
    assert.equal(server.calls.surf, 0);
    assert.equal(server.calls.echo, 0);
    assert.equal(server.calls.vaultAgent, 0);
    assert.equal(server.calls.openclaw, 0);
    assert.equal(server.calls.unexpected, 0);
  } finally {
    restoreHermesEnv(previousEnv);
    await server.close();
    await rm(tmpDir, { recursive: true, force: true });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: result.mode,
        calledHermesCmo: true,
        surfCalls: 0,
        echoCalls: 0,
        vaultAgentCalls: 0,
        vaultWrites: 0,
        directSupabaseMutations: 0,
        openclawCalls: 0,
        activityEvents: result.activity_events.length,
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
