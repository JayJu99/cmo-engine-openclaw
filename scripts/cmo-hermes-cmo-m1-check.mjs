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
const executorSourcePath = path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-delegation-executor.ts");
const kernelSourcePath = path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-skill-kernel.ts");

const forbiddenCounters = {
  vaultWrites: 0,
  openclawCalls: 0,
  directSupabaseMutations: 0,
};

const sampleRequest = {
  schema_version: "hermes.cmo.request.v1",
  request_id: "req_m1_cmo_001",
  session_id: "session_m1_cmo",
  turn_id: "turn_m1_cmo_001",
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
    user_message: "Find recent activation signals, decide the angle, then draft final copy.",
    explicit_command: null,
  },
  context_pack: {
    current_priority: [],
    selected_context: [],
    recent_session_summary: null,
    indexed_context_supplement: [],
    artifacts_in: [],
  },
  constraints: {
    no_direct_vault_write: true,
    no_direct_memory_mutation: true,
    vault_agent_delegation_allowed: false,
    vault_agent_requires_save_intent: true,
    kanban_enabled: false,
    demo_mode: true,
    allowed_agents: ["echo", "surf"],
    allowed_surf_modes: ["surf.default", "surf.x", "surf.trend", "surf.pulse"],
  },
  ui: {
    activity_stream_required: true,
    heartbeat_required: true,
  },
};

const compileRuntimeModule = async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "hermes-cmo-m1-"));
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
    throw new Error(`Failed to compile M1 runtime module:\n${stdout}\n${stderr}`);
  }

  return {
    tmpDir,
    runtimePath: path.join(tmpDir, "hermes-cmo-runtime.js"),
  };
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

const activity = (requestBody, seq, type, message) => ({
  schema_version: "hermes.activity.event.v1",
  event_id: `evt_m1_${requestBody.request_id}_${seq}`,
  request_id: requestBody.request_id,
  session_id: requestBody.session_id,
  turn_id: requestBody.turn_id,
  seq,
  created_at: new Date(Date.parse(requestBody.created_at) + seq * 1000).toISOString(),
  source: {
    agent: "cmo",
    mode: "cmo.default",
  },
  type,
  status: type === "run.completed" ? "completed" : "running",
  user_visible: true,
  message,
  data: {},
});

const cmoResponse = (requestBody, overrides = {}) => {
  const events = overrides.activity_events ?? [activity(requestBody, 1, "run.completed", "Hermes CMO completed.")];

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
        title: "M1 Hermes CMO synthesis",
        summary: "CMO diagnosed, delegated bounded evidence/copy work, then synthesized the decision.",
        decision: "TEST",
        body: "TEST the activation angle with proof-led copy. Main bottleneck: activation proof gap.",
      },
      structured_output: {
        strategyMode: "REVIEW",
        mainBottleneck: "activation proof gap",
        decisionLabel: "TEST",
      },
      delegations: [],
      artifacts: [],
      memory_suggestions: [],
      activity_summary: {
        events_count: events.length,
        final_state: "completed",
      },
      ...overrides.response,
    },
    activity_events: events,
  };
};

const startServer = async () => {
  const calls = {
    cmo: 0,
    surfTrend: 0,
    echo: 0,
    forbidden: 0,
    unexpected: 0,
  };
  let serverFailure = null;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const rawBody = request.method === "POST" ? await readRequestBody(request) : "{}";
      const body = JSON.parse(rawBody);

      assert.equal(request.headers.authorization, "Bearer test-m1-key");

      if (url.pathname === "/agents/cmo/execute") {
        calls.cmo += 1;

        if (calls.cmo === 1) {
          assert.equal(body.skill_kernel?.id, "clean-cmo-skill-kernel");
          assert.deepEqual(body.constraints.allowed_agents, ["echo", "surf"]);
          assert.deepEqual(body.constraints.allowed_surf_modes, ["surf.default", "surf.x", "surf.trend", "surf.pulse"]);
          assert.equal(body.constraints.delegations_mode, "echo_surf_bounded");
          assert.equal(body.constraints.allowSubAgentExecution, true);
          assert.equal(body.constraints.execution_boundary?.vault_agent_execution_allowed, false);
          assert.equal(body.constraints.execution_boundary?.direct_supabase_mutations_allowed, false);
          assert.equal(body.constraints.execution_boundary?.openclaw_calls_allowed, false);

          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                status: "delegated",
                structured_output: {
                  strategyMode: "DIAGNOSE",
                  mainBottleneck: "activation proof gap",
                  decisionLabel: "TEST",
                },
                delegations: [
                  {
                    id: "del_surf_trend",
                    target: { agent: "surf", mode: "surf.trend" },
                    objective: "Gather bounded last-30-days activation signals.",
                    input: {
                      brief: "Find compact activation proof signals for the angle.",
                      constraints: ["M1 source caps only."],
                    },
                  },
                  {
                    id: "del_echo_copy",
                    target: { agent: "echo", mode: "echo.default" },
                    objective: "Draft final proof-led copy inside CMO constraints.",
                    input: {
                      brief: "Write final copy only after Surf evidence is available.",
                      constraints: ["Do not decide strategy."],
                    },
                  },
                ],
              },
              activity_events: [activity(body, 1, "stage.completed", "CMO diagnosed and emitted bounded delegations.")],
            }),
          );
          return;
        }

        assert.deepEqual(body.constraints.allowed_agents, []);
        assert.deepEqual(body.constraints.allowed_surf_modes, []);
        assert.equal(body.constraints.delegations_mode, "proposals_only");
        assert.equal(body.constraints.m1_clean_cmo_skill_kernel?.final_synthesis, true);
        assert.equal(body.context_pack.artifacts_in.at(-1)?.type, "cmo_engine_delegation_results");
        assert.equal(body.context_pack.artifacts_in.at(-1)?.results.length, 2);

        writeJson(response, 200, cmoResponse(body));
        return;
      }

      if (url.pathname === "/agents/surf-last30days/execute") {
        calls.surfTrend += 1;
        assert.equal(body.source_agent, "cmo");
        assert.equal(body.target_agent, "surf");
        assert.equal(body.research_mode, "last30days");
        assert.equal(body.mode, "cmo_orchestrated");
        assert.deepEqual(body.allowed_sources, ["reddit", "hackernews", "polymarket"]);
        writeJson(response, 200, {
          handoff_id: body.handoff_id,
          agent: "surf",
          status: "completed",
          summary: "Recent activation signal: proof-led onboarding copy is the highest-leverage test.",
          sources_used: ["reddit", "hackernews"],
          key_findings: ["Users respond to concrete proof before feature depth."],
        });
        return;
      }

      if (url.pathname === "/agents/echo/execute") {
        calls.echo += 1;
        assert.equal(body.source_agent, "cmo");
        assert.equal(body.target_agent, "echo");
        assert.equal(body.task_type, "cmo_orchestrated_final_copy");
        writeJson(response, 200, {
          handoff_id: body.handoff_id,
          agent: "echo",
          status: "completed",
          outputs: [{ label: "final_copy", copy: "Prove the win in one action. Then scale." }],
          notes: ["Stayed inside CMO constraints."],
        });
        return;
      }

      if (/vault|openclaw|supabase/i.test(url.pathname)) {
        calls.forbidden += 1;
      } else {
        calls.unexpected += 1;
      }

      writeJson(response, 404, { error: `Unexpected endpoint ${url.pathname}` });
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
  assert.ok(address && typeof address === "object", "M1 test server did not expose an address");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    get serverFailure() {
      return serverFailure;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
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

const assertStaticBoundaries = async () => {
  const kernel = await readFile(kernelSourcePath, "utf8");
  const runtime = await readFile(runtimeSourcePath, "utf8");
  const executor = await readFile(executorSourcePath, "utf8");

  for (const needle of [
    "No tactics without diagnosis.",
    "CMO is not a content intern.",
    "DIAGNOSE",
    "FOCUS",
    "PRIORITIZE",
    "REVIEW",
    "RESET",
    "KEEP",
    "CUT",
    "TEST",
    "SCALE",
    "WAIT",
    "CMO must not write Vault directly.",
    "CMO must not mutate Supabase directly.",
    "CMO must not call OpenClaw from Hermes orchestration.",
  ]) {
    assert.match(kernel, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(runtime, /buildCleanCmoSkillKernel/);
  assert.match(executor, /targetAgent: HermesCmoExecutableAgent/);
  assert.doesNotMatch(importPathsFromSource(runtime).join("\n"), /vault-auto-capture|vault-capture-writer|supabase-indexing|openclaw/i);
  assert.doesNotMatch(importPathsFromSource(executor).join("\n"), /vault-auto-capture|vault-capture-writer|supabase-indexing|openclaw/i);
};

try {
  await assertStaticBoundaries();

  const { tmpDir, runtimePath } = await compileRuntimeModule();
  const requireFromCheck = createRequire(import.meta.url);
  const { runHermesCmoRuntime } = requireFromCheck(runtimePath);
  const server = await startServer();
  const previousEnv = {
    CMO_HERMES_EXECUTION_ENABLED: process.env.CMO_HERMES_EXECUTION_ENABLED,
    CMO_HERMES_BASE_URL: process.env.CMO_HERMES_BASE_URL,
    CMO_HERMES_API_KEY: process.env.CMO_HERMES_API_KEY,
    CMO_HERMES_TIMEOUT_MS: process.env.CMO_HERMES_TIMEOUT_MS,
    CMO_HERMES_LAST30DAYS_TIMEOUT_MS: process.env.CMO_HERMES_LAST30DAYS_TIMEOUT_MS,
    CMO_HERMES_CMO_ORCHESTRATION_ENABLED: process.env.CMO_HERMES_CMO_ORCHESTRATION_ENABLED,
    CMO_HERMES_CMO_MAX_DELEGATIONS: process.env.CMO_HERMES_CMO_MAX_DELEGATIONS,
  };

  let result;

  try {
    process.env.CMO_HERMES_EXECUTION_ENABLED = "true";
    process.env.CMO_HERMES_BASE_URL = server.baseUrl;
    process.env.CMO_HERMES_API_KEY = "test-m1-key";
    process.env.CMO_HERMES_TIMEOUT_MS = "5000";
    process.env.CMO_HERMES_LAST30DAYS_TIMEOUT_MS = "5000";
    process.env.CMO_HERMES_CMO_ORCHESTRATION_ENABLED = "true";
    process.env.CMO_HERMES_CMO_MAX_DELEGATIONS = "2";

    result = await runHermesCmoRuntime(sampleRequest);

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling a request");
    assert.equal(server.calls.cmo, 2);
    assert.equal(server.calls.surfTrend, 1);
    assert.equal(server.calls.echo, 1);
    assert.equal(server.calls.forbidden, 0);
    assert.equal(server.calls.unexpected, 0);
    assert.deepEqual(result.forbidden_counters, forbiddenCounters);
    assert.deepEqual(result.safety_counters, {
      surfCalls: 1,
      echoCalls: 1,
      vaultAgentCalls: 0,
      vaultWrites: 0,
      directSupabaseMutations: 0,
      openclawCalls: 0,
    });
    assert.equal(result.strategyMode, "REVIEW");
    assert.equal(result.mainBottleneck, "activation proof gap");
    assert.equal(result.decisionLabel, "TEST");
    assert.deepEqual(result.agentsUsed, ["cmo", "surf", "echo"]);
    assert.equal(result.delegationSummary.length, 2);
    assert.equal(result.delegationSummary[0].mode, "surf.trend");
    assert.equal(result.delegationSummary[1].mode, "echo.default");
    assert.equal(result.response.activity_summary.events_count, result.activity_events.length);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      restoreEnvValue(key, value);
    }
    await server.close();
    await rm(tmpDir, { recursive: true, force: true });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        cmoCalls: server.calls.cmo,
        surfCalls: result.surfCalls,
        echoCalls: result.echoCalls,
        forbiddenCounters: result.forbidden_counters,
        agentsUsed: result.agentsUsed,
        delegationSummary: result.delegationSummary.map((delegation) => ({
          targetAgent: delegation.targetAgent,
          mode: delegation.mode,
          status: delegation.status,
        })),
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
