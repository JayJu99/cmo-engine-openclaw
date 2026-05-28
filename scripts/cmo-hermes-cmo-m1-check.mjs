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
  vaultAgentCalls: 0,
  vaultWrites: 0,
  openclawCalls: 0,
  directSupabaseMutations: 0,
};

const signalTopics = [
  "World App Mini App",
  "World Mini Apps",
  "trading mini app",
  "mini app trading",
  "World Chain trading",
  "Holdstation",
];

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
    user_message:
      "Research the activation evidence gaps for Holdstation Mini App, then create 3 short X posts based on the safest angle.",
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
  ...(seq % 2 === 0 ? { schema_version: "hermes.activity.event.v1" } : {}),
  eventId: `evt_m1_${requestBody.request_id}_${seq}`,
  requestId: requestBody.request_id,
  sessionId: requestBody.session_id,
  turnId: requestBody.turn_id,
  seq,
  createdAt: new Date(Date.parse(requestBody.created_at) + seq * 1000).toISOString(),
  sourceAgent: "cmo",
  sourceMode: "cmo.default",
  type,
  status: type === "cmo.run.completed" ? "completed" : "running",
  userVisible: true,
  message,
  data: {},
});

const cmoPolishActivityEvents = (requestBody) => [
  activity(requestBody, 1, "run.started", "CMO run started."),
  activity(requestBody, 2, "context.loaded", "CMO loaded context."),
  activity(requestBody, 3, "cmo.mode.selected", "Mode selected: REVIEW."),
  activity(requestBody, 4, "cmo.bottleneck.identified", "Main bottleneck identified: activation proof gap."),
  activity(requestBody, 5, "cmo.decision.selected", "Decision selected: TEST."),
  activity(requestBody, 6, "cmo.next_step.selected", "Next step selected: run a proof-led activation copy test."),
  activity(requestBody, 7, "plan.created", "CMO created the plan."),
  activity(requestBody, 8, "cmo.run.completed", "CMO run completed."),
];

const cmoResponse = (requestBody, overrides = {}) => {
  const events = overrides.activity_events ?? cmoPolishActivityEvents(requestBody);

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
        currentStep: "Run a proof-led activation copy test.",
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
    surfUnified: 0,
    legacySurfX: 0,
    legacySurfLast30Days: 0,
    echo: 0,
    forbidden: 0,
    unexpected: 0,
    surfRequests: [],
    echoRequests: [],
    cmoRequests: [],
  };
  let serverFailure = null;
  const cmoCallsByRequestId = new Map();

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const rawBody = request.method === "POST" ? await readRequestBody(request) : "{}";
      const body = JSON.parse(rawBody);

      assert.equal(request.headers.authorization, "Bearer test-m1-key");

      if (url.pathname === "/agents/cmo/execute") {
        calls.cmo += 1;
        const cmoCallCount = (cmoCallsByRequestId.get(body.request_id) ?? 0) + 1;
        cmoCallsByRequestId.set(body.request_id, cmoCallCount);
        calls.cmoRequests.push({
          requestId: body.request_id,
          count: cmoCallCount,
          allowedAgents: body.constraints?.allowed_agents,
          delegationsMode: body.constraints?.delegations_mode,
        });

        if (cmoCallCount === 1) {
          assert.equal(body.skill_kernel?.id, "clean-cmo-skill-kernel");
          assert.deepEqual(body.constraints.allowed_agents, ["echo", "surf"]);
          assert.deepEqual(body.constraints.allowed_surf_modes, ["surf.default", "surf.x", "surf.trend", "surf.pulse"]);
          assert.equal(body.constraints.delegations_mode, "echo_surf_bounded");
          assert.equal(body.constraints.allowSubAgentExecution, true);
          assert.equal(body.constraints.execution_boundary?.vault_agent_execution_allowed, false);
          assert.equal(body.constraints.execution_boundary?.direct_supabase_mutations_allowed, false);
          assert.equal(body.constraints.execution_boundary?.openclaw_calls_allowed, false);

          const echoFailFixture = body.request_id === "req_m1_echo_fail";
          const latestPostFixture = body.request_id === "req_m1_native_latest_post";
          const xSignalFixture = body.request_id === "req_m1_native_x_signal";
          const xPostsEchoOnlyFixture = body.request_id === "req_m1_x_posts_echo_only";
          const surfFailFixture = body.request_id === "req_m1_surf_fail";
          const echoRetryFixture =
            body.request_id === "req_m1_echo_retry_good" ||
            body.request_id === "req_m1_echo_retry_fail" ||
            body.request_id === "req_m1_echo_retry_limit";

          let delegations;

          if (latestPostFixture) {
            delegations = [
              {
                id: "del_latest_post",
                targetAgent: "surf",
                mode: "surf.x",
                taskType: "latest_post_lookup",
                surface: "x",
                entity: "Holdstation",
                query: "Holdstation latest post",
                outputContract: {
                  linkRequired: true,
                  strategySynthesisAllowed: false,
                },
                objective: "Find the latest Holdstation post on X and return the link.",
                constraints: ["Read-only lookup.", "Return a source link."],
              },
            ];
          } else if (xSignalFixture) {
            delegations = [
              {
                id: "del_x_signal_scan",
                target_agent: "surf",
                mode: "surf.x",
                task_type: "x_signal_scan",
                surface: "x",
                topics: signalTopics,
                objective: "Scan X for World App and trading mini app signal.",
                output_contract: {
                  strategySynthesisAllowed: false,
                },
                constraints: ["Read-only X scan.", "Treat social signal as weak evidence."],
              },
            ];
          } else if (xPostsEchoOnlyFixture) {
            delegations = [
              {
                id: "del_x_posts_echo_only",
                targetAgent: "echo",
                mode: "echo.default",
                objective: "Create 3 short X posts from the safest angle.",
                input: {
                  brief: "Write channel-native X posts from the CMO angle.",
                  constraints: ["Do not research.", "Do not decide strategy."],
                },
              },
            ];
          } else if (surfFailFixture) {
            delegations = [
              {
                id: "del_surf_fail",
                targetAgent: "surf",
                mode: "surf.x",
                taskType: "latest_post_lookup",
                surface: "x",
                entity: "Holdstation",
                query: "Holdstation latest post",
                outputContract: {
                  linkRequired: true,
                  strategySynthesisAllowed: false,
                },
                objective: "Find the latest Holdstation post on X and return the link.",
                constraints: ["Read-only lookup.", "Return a source link."],
              },
            ];
          } else if (echoRetryFixture) {
            delegations = [
              {
                id: `del_${body.request_id}_initial`,
                targetAgent: "echo",
                mode: "echo.default",
                objective: "Create 3 short X posts from the safest angle.",
                input: {
                  brief: "Write channel-native X posts from the CMO angle.",
                  constraints: ["Do not research.", "Do not decide strategy."],
                },
              },
            ];
          } else if (echoFailFixture) {
            delegations = [
              {
                id: "del_surf_fail_default",
                target: { agent: "surf", mode: "surf.default" },
                objective: "Research activation evidence gaps for Holdstation Mini App.",
                input: {
                  brief: "Find compact activation proof gaps before content execution.",
                  constraints: ["M1 source caps only."],
                },
              },
              {
                id: "del_echo_fail",
                target: { agent: "echo", mode: "echo.default" },
                objective: "Create 3 short X posts from the safest angle.",
                input: {
                  brief: "Use evidence boundaries and produce final copy only through Echo.",
                  constraints: ["Do not decide strategy."],
                },
              },
            ];
          } else {
            delegations = [
              {
                id: "del_surf_gap_wrong",
                target: { agent: "surf", mode: "surf.x" },
                objective: "Research activation evidence gaps for Holdstation Mini App.",
                input: {
                  brief: "Find compact activation proof gaps before content execution.",
                  constraints: ["M1 source caps only."],
                },
              },
              {
                id: "del_surf_x_explicit",
                target: { agent: "surf", mode: "surf.x" },
                objective: "Research X social signal evidence for activation objections.",
                input: {
                  brief: "Scan X signal only for activation objection language.",
                  constraints: ["M1 source caps only."],
                },
              },
              {
                id: "del_echo_copy",
                target: { agent: "echo", mode: "echo.default" },
                objective: "Create 3 short X posts from the safest angle.",
                input: {
                  brief: "Write final copy only after Surf evidence is available.",
                  constraints: ["Do not decide strategy."],
                },
              },
            ];
          }

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
                answer: {
                  format: "markdown",
                  title: "Delegated fixture answer",
                  summary: "Initial CMO response requested specialist execution.",
                  decision: "WAIT",
                  body: "Delegating to specialist. This text must not be surfaced as the final answer when orchestration is enabled.",
                },
                delegations,
              },
            }),
          );
          return;
        }

        const echoRetryRequest =
          body.request_id === "req_m1_echo_retry_good" ||
          body.request_id === "req_m1_echo_retry_fail" ||
          body.request_id === "req_m1_echo_retry_limit";
        const echoRetryAllowedOnSynthesis =
          cmoCallCount === 2 &&
          (echoRetryRequest ||
            body.request_id === "req_m1_cmo_001" ||
            body.request_id === "req_m1_echo_fail" ||
            body.request_id === "req_m1_x_posts_echo_only");
        const expectedAllowedAgents = echoRetryAllowedOnSynthesis ? ["echo"] : [];
        if (JSON.stringify(body.constraints.allowed_agents) !== JSON.stringify(expectedAllowedAgents)) {
          throw new Error(`Unexpected allowed_agents for ${body.request_id} #${cmoCallCount}: ${JSON.stringify(body.constraints.allowed_agents)} expected ${JSON.stringify(expectedAllowedAgents)}`);
        }
        assert.deepEqual(body.constraints.allowed_surf_modes, []);
        assert.equal(body.constraints.delegations_mode, echoRetryAllowedOnSynthesis ? "echo_retry_bounded" : "proposals_only");
        assert.equal(body.constraints.m1_clean_cmo_skill_kernel?.final_synthesis, true);
        assert.equal(body.context_pack.artifacts_in.at(-1)?.type, "cmo_engine_delegation_results");
        const expectedResultCount = echoRetryRequest && cmoCallCount === 3
          ? 2
          : body.request_id === "req_m1_echo_fail"
            ? 2
            : body.request_id === "req_m1_cmo_001"
              ? 3
              : 1;
        assert.equal(body.context_pack.artifacts_in.at(-1)?.results.length, expectedResultCount);

        if (echoRetryRequest && cmoCallCount === 2) {
          assert.equal(body.constraints.delegations_mode, "echo_retry_bounded");
          assert.equal(body.constraints.allowEchoExecution, true);
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                status: "delegated",
                classification: "needs_echo_retry",
                retry_of: "echo",
                retry_reason: "echo_output_unusable_internal_process_language",
                structured_output: {
                  strategyMode: "REVIEW",
                  mainBottleneck: "Echo output used internal process language.",
                  decisionLabel: "WAIT",
                  classification: "needs_echo_retry",
                  retry_of: "echo",
                  retry_reason: "echo_output_unusable_internal_process_language",
                },
                answer: {
                  format: "markdown",
                  title: "Unsafe CMO Replacement Copy",
                  summary: "This fixture tries to replace Echo output.",
                  decision: "TEST",
                  body: "Post 1: CMO-written replacement copy must not be final.",
                },
                delegations: [
                  {
                    id: body.request_id === "req_m1_echo_retry_fail" ? "del_echo_retry_fail_again" : `del_${body.request_id}_again`,
                    target_agent: "echo",
                    mode: "echo.default",
                    objective: "Create 3 short X posts from the safest angle.",
                    input: {
                      brief: "Retry without internal process language.",
                      constraints: ["Do not research.", "Do not decide strategy.", "No internal process language."],
                    },
                  },
                ],
              },
            }),
          );
          return;
        }

        if (body.request_id === "req_m1_echo_retry_good" && cmoCallCount === 3) {
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                answer: {
                  format: "markdown",
                  title: "Echo Retry Accepted",
                  summary: "CMO accepted the retried Echo output.",
                  decision: "KEEP",
                  body: "Echo retry accepted. Final copy is ready from Echo.",
                },
              },
            }),
          );
          return;
        }

        if (body.request_id === "req_m1_echo_retry_limit" && cmoCallCount === 3) {
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                status: "delegated",
                classification: "needs_echo_retry",
                retry_of: "echo",
                retry_reason: "echo_output_unusable_internal_process_language",
                structured_output: {
                  strategyMode: "REVIEW",
                  mainBottleneck: "Echo output still unusable.",
                  decisionLabel: "WAIT",
                  classification: "needs_echo_retry",
                  retry_of: "echo",
                  retry_reason: "echo_output_unusable_internal_process_language",
                },
                answer: {
                  format: "markdown",
                  title: "Unsafe Second Retry Replacement",
                  summary: "This fixture asks for another retry after budget is spent.",
                  decision: "TEST",
                  body: "Post 1: This should not render because a second retry would be required.",
                },
                delegations: [
                  {
                    id: "del_echo_retry_limit_third_attempt",
                    target_agent: "echo",
                    mode: "echo.default",
                    objective: "Create 3 short X posts from the safest angle.",
                    input: {
                      brief: "Try a third Echo attempt, which M1 must not execute.",
                      constraints: ["No internal process language."],
                    },
                  },
                ],
              },
            }),
          );
          return;
        }

        writeJson(
          response,
          200,
          cmoResponse(
            body,
            body.request_id === "req_m1_echo_fail" || body.request_id === "req_m1_surf_fail" || body.request_id === "req_m1_echo_retry_fail"
              ? {
                  response: {
                    answer: {
                      format: "markdown",
                      title: "Unsafe fixture final copy",
                      summary: "This fixture tries to present success even though delegation failed.",
                      decision: "TEST",
                      body: "Post 1: Pretend specialist execution succeeded.\nPost 2: Pretend completed.\nPost 3: Pretend final answer is ready.",
                    },
                  },
                }
              : body.request_id === "req_m1_native_latest_post"
                ? {
                    response: {
                      answer: {
                        format: "markdown",
                        title: "Latest Holdstation X Post",
                        summary: "Surf returned the latest Holdstation X link.",
                        decision: "KEEP",
                        body: "Latest Holdstation post found: https://x.com/HoldstationW/status/123",
                      },
                    },
                  }
                : body.request_id === "req_m1_native_x_signal"
                  ? {
                      response: {
                        answer: {
                          format: "markdown",
                          title: "X Signal Scan",
                          summary: "Surf returned a bounded X signal pack.",
                          decision: "WAIT",
                          body: "Surf found weak World App mini app signal. Treat as source-gathering, not strategy.",
                        },
                      },
                    }
              : {},
          ),
        );
        return;
      }

      if (url.pathname === "/agents/surf/execute") {
        calls.surfUnified += 1;
        calls.surfRequests.push({
          handoffId: body.handoff_id,
          mode: body.mode,
          objective: body.objective,
        });
        assert.equal(body.source_agent, "cmo");
        assert.equal(body.target_agent, "surf");
        assert.ok(["surf.default", "surf.x"].includes(body.mode), `unexpected surf mode ${body.mode}`);

        if (body.handoff_id === "del_latest_post" || body.handoff_id === "del_surf_fail") {
          assert.equal(body.mode, "surf.x");
          assert.equal(body.task_type, "latest_post_lookup");
          assert.equal(body.surface, "x");
          assert.equal(body.entity, "Holdstation");
          assert.equal(body.query, "Holdstation latest post");
          assert.equal(body.topic, "Holdstation latest post");
          assert.equal(body.output_contract?.linkRequired, true);
          assert.equal(body.output_contract?.strategySynthesisAllowed, false);
        }

        if (body.handoff_id === "del_x_signal_scan") {
          assert.equal(body.mode, "surf.x");
          assert.equal(body.task_type, "x_signal_scan");
          assert.equal(body.surface, "x");
          assert.deepEqual(body.topics, signalTopics);
          assert.equal(body.output_contract?.strategySynthesisAllowed, false);
        }

        if (body.handoff_id === "del_surf_fail") {
          writeJson(response, 200, {
            schema_version: "surf.response.v1",
            handoff_id: body.handoff_id,
            agent: "surf",
            mode: "surf.x",
            status: "failed",
            failure_reason: "Surf fixture unavailable",
            safety: {
              published: false,
              vault_write: false,
              supabase_mutation: false,
              session_mutation: false,
              raw_capture: false,
              kanban: false,
              openclaw_call: false,
            },
          });
          return;
        }

        writeJson(response, 200, {
          schema_version: "surf.response.v1",
          handoff_id: body.handoff_id,
          agent: "surf",
          mode: body.mode,
          status: "completed",
          summary: `${body.mode} returned activation evidence.`,
          research_pack: {
            summary: `${body.mode} returned activation evidence.`,
            sources_used: [body.mode === "surf.x" ? "x" : "web"],
            key_findings: [`${body.mode} says users respond to concrete proof before feature depth.`],
          },
          safety: {
            published: false,
            vault_write: false,
            supabase_mutation: false,
            session_mutation: false,
            raw_capture: false,
            kanban: false,
            openclaw_call: false,
          },
        });
        return;
      }

      if (url.pathname === "/agents/surf-x/execute") {
        calls.legacySurfX += 1;
      } else if (url.pathname === "/agents/surf-last30days/execute") {
        calls.legacySurfLast30Days += 1;
      }

      if (url.pathname === "/agents/echo/execute") {
        calls.echo += 1;
        calls.echoRequests.push(body);
        assert.equal(body.source_agent, "cmo");
        assert.equal(body.target_agent, "echo");
        assert.equal(body.task_type, "cmo_orchestrated_final_copy");
        assert.equal(body.objective, "Create 3 short X posts from the safest angle.");
        assert.equal(body.platform, "x");
        const expectedEchoAngle = body.handoff_id === "del_echo_fail"
          ? "Use evidence boundaries and produce final copy only through Echo."
          : body.handoff_id === "del_x_posts_echo_only" || String(body.handoff_id).includes("_initial")
            ? "Write channel-native X posts from the CMO angle."
            : String(body.handoff_id).includes("_again")
              ? "Retry without internal process language."
              : "Write final copy only after Surf evidence is available.";
        assert.equal(
          body.brief?.angle,
          expectedEchoAngle,
        );
        assert.ok(Array.isArray(body.claim_boundaries));
        assert.equal(body.output_contract, "echo.response.v1");
        assert.ok(body.source_context);
        assert.ok(Array.isArray(body.constraints));

        if (body.handoff_id === "del_echo_fail") {
          writeJson(response, 200, {
            schema_version: "echo.response.v1",
            handoff_id: body.handoff_id,
            agent: "echo",
            mode: "echo.default",
            status: "failed",
            failure_reason: "Echo fixture unavailable",
            outputs: [],
            safety: {
              published: false,
              vault_write: false,
              supabase_mutation: false,
              session_mutation: false,
              raw_capture: false,
              kanban: false,
              openclaw_call: false,
            },
          });
          return;
        }

        if (body.handoff_id === "del_echo_retry_fail_again") {
          writeJson(response, 200, {
            schema_version: "echo.response.v1",
            handoff_id: body.handoff_id,
            agent: "echo",
            mode: "echo.default",
            status: "failed",
            failure_reason: "Echo retry fixture unavailable",
            outputs: [],
            safety: {
              published: false,
              vault_write: false,
              supabase_mutation: false,
              session_mutation: false,
              raw_capture: false,
              kanban: false,
              openclaw_call: false,
            },
          });
          return;
        }

        writeJson(response, 200, {
          schema_version: "echo.response.v1",
          handoff_id: body.handoff_id,
          agent: "echo",
          mode: "echo.default",
          status: "completed",
          outputs: [{ label: "final_copy", copy: "Prove the win in one action. Then scale." }],
          notes: ["Stayed inside CMO constraints."],
          safety: {
            published: false,
            vault_write: false,
            supabase_mutation: false,
            session_mutation: false,
            raw_capture: false,
            kanban: false,
            openclaw_call: false,
          },
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
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
        cmoRequests: calls.cmoRequests,
      });
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
  let echoFailResult;
  let latestPostResult;
  let xSignalResult;
  let xPostsEchoOnlyResult;
  let surfFailResult;
  let echoRetryGoodResult;
  let echoRetryFailResult;
  let echoRetryLimitResult;

  try {
    process.env.CMO_HERMES_EXECUTION_ENABLED = "true";
    process.env.CMO_HERMES_BASE_URL = server.baseUrl;
    process.env.CMO_HERMES_API_KEY = "test-m1-key";
    process.env.CMO_HERMES_TIMEOUT_MS = "5000";
    process.env.CMO_HERMES_LAST30DAYS_TIMEOUT_MS = "5000";
    process.env.CMO_HERMES_CMO_ORCHESTRATION_ENABLED = "true";
    process.env.CMO_HERMES_CMO_MAX_DELEGATIONS = "3";

    result = await runHermesCmoRuntime(sampleRequest);

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling a request");
    assert.equal(server.calls.cmo, 2);
    assert.equal(server.calls.surfUnified, 2);
    assert.equal(server.calls.legacySurfX, 0);
    assert.equal(server.calls.legacySurfLast30Days, 0);
    assert.equal(server.calls.echo, 1);
    assert.equal(server.calls.forbidden, 0);
    assert.equal(server.calls.unexpected, 0);
    assert.deepEqual(result.forbidden_counters, forbiddenCounters);
    assert.deepEqual(result.safety_counters, {
      surfCalls: 2,
      echoCalls: 1,
      vaultAgentCalls: 0,
      vaultWrites: 0,
      directSupabaseMutations: 0,
      openclawCalls: 0,
    });
    assert.equal(result.strategyMode, "REVIEW");
    assert.equal(result.mainBottleneck, "activation proof gap");
    assert.equal(result.decisionLabel, "TEST");
    assert.equal(result.currentStep, "Run a proof-led activation copy test.");
    assert.deepEqual(result.agentsUsed, ["cmo", "surf", "echo"]);
    assert.equal(result.delegationSummary.length, 3);
    assert.equal(result.delegationSummary[0].mode, "surf.default");
    assert.equal(result.delegationSummary[1].mode, "surf.x");
    assert.equal(result.delegationSummary[2].mode, "echo.default");
    assert.deepEqual(
      server.calls.surfRequests.map((surfRequest) => [surfRequest.handoffId, surfRequest.mode]),
      [
        ["del_surf_gap_wrong", "surf.default"],
        ["del_surf_x_explicit", "surf.x"],
      ],
    );
    assert.equal(result.response.activity_summary.events_count, result.activity_events.length);

    echoFailResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_echo_fail",
      session_id: "session_m1_echo_fail",
      turn_id: "turn_m1_echo_fail_001",
      intent: {
        ...sampleRequest.intent,
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling Echo failure fixture");
    assert.equal(server.calls.cmo, 4);
    assert.equal(server.calls.surfUnified, 3);
    assert.equal(server.calls.legacySurfX, 0);
    assert.equal(server.calls.legacySurfLast30Days, 0);
    assert.equal(server.calls.echo, 2);
    assert.equal(server.calls.forbidden, 0);
    assert.equal(server.calls.unexpected, 0);
    assert.deepEqual(echoFailResult.forbidden_counters, forbiddenCounters);
    assert.equal(echoFailResult.delegationSummary.length, 2);
    assert.equal(echoFailResult.delegationSummary[0].mode, "surf.default");
    assert.equal(echoFailResult.delegationSummary[0].status, "completed");
    assert.equal(echoFailResult.delegationSummary[1].mode, "echo.default");
    assert.equal(echoFailResult.delegationSummary[1].status, "failed");
    assert.equal(echoFailResult.delegationSummary[1].failureReason, "Echo fixture unavailable");
    assert.equal(echoFailResult.response.answer?.decision, "WAIT");
    assert.match(echoFailResult.response.answer?.body ?? "", /Echo did not complete/);
    assert.match(echoFailResult.response.answer?.body ?? "", /Echo fixture unavailable/);
    assert.doesNotMatch(echoFailResult.response.answer?.body ?? "", /Post 1:/);
    assert.equal(echoFailResult.response.structured_output?.echo_failed, true);

    latestPostResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_native_latest_post",
      session_id: "session_m1_native_latest_post",
      turn_id: "turn_m1_native_latest_post_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Check thử X xem bài mới nhất của Holdstation có gì? Gửi mình link nhé",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling native latest-post fixture");
    assert.equal(latestPostResult.surfCalls, 1);
    assert.equal(latestPostResult.echoCalls, 0);
    assert.deepEqual(latestPostResult.agentsUsed, ["cmo", "surf"]);
    assert.equal(latestPostResult.delegationSummary.length, 1);
    assert.equal(latestPostResult.delegationSummary[0].mode, "surf.x");
    assert.equal(latestPostResult.delegationSummary[0].status, "completed");
    assert.match(latestPostResult.response.answer?.body ?? "", /https:\/\/x\.com\/HoldstationW\/status\/123/);
    assert.doesNotMatch(latestPostResult.response.answer?.body ?? "", /Delegating to specialist/);

    xSignalResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_native_x_signal",
      session_id: "session_m1_native_x_signal",
      turn_id: "turn_m1_native_x_signal_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Scan X for World App Mini App and trading mini app signal.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling native X signal fixture");
    assert.equal(xSignalResult.surfCalls, 1);
    assert.equal(xSignalResult.echoCalls, 0);
    assert.equal(xSignalResult.delegationSummary[0].mode, "surf.x");
    assert.equal(xSignalResult.delegationSummary[0].status, "completed");

    const surfCallsBeforeXPostsOnly = server.calls.surfUnified;
    xPostsEchoOnlyResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_x_posts_echo_only",
      session_id: "session_m1_x_posts_echo_only",
      turn_id: "turn_m1_x_posts_echo_only_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Create 3 short X posts based on the safest angle.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling X-posts Echo-only fixture");
    assert.equal(server.calls.surfUnified, surfCallsBeforeXPostsOnly);
    assert.equal(xPostsEchoOnlyResult.surfCalls, 0);
    assert.equal(xPostsEchoOnlyResult.echoCalls, 1);
    assert.deepEqual(xPostsEchoOnlyResult.agentsUsed, ["cmo", "echo"]);
    assert.equal(xPostsEchoOnlyResult.delegationSummary[0].mode, "echo.default");
    assert.equal(xPostsEchoOnlyResult.delegationSummary[0].status, "completed");

    surfFailResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_surf_fail",
      session_id: "session_m1_surf_fail",
      turn_id: "turn_m1_surf_fail_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Check X for the latest Holdstation post link.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling Surf failure fixture");
    assert.equal(surfFailResult.surfCalls, 1);
    assert.equal(surfFailResult.echoCalls, 0);
    assert.equal(surfFailResult.delegationSummary[0].mode, "surf.x");
    assert.equal(surfFailResult.delegationSummary[0].status, "failed");
    assert.equal(surfFailResult.delegationSummary[0].failureReason, "Surf fixture unavailable");
    assert.equal(surfFailResult.response.answer?.decision, "WAIT");
    assert.match(surfFailResult.response.answer?.body ?? "", /Surf did not complete/);
    assert.match(surfFailResult.response.answer?.body ?? "", /Surf fixture unavailable/);
    assert.doesNotMatch(surfFailResult.response.answer?.body ?? "", /Post 1:/);
    assert.equal(surfFailResult.response.structured_output?.surf_failed, true);
    assert.equal(server.calls.cmo, 12);
    assert.equal(server.calls.surfUnified, 6);
    assert.equal(server.calls.echo, 3);
    assert.equal(server.calls.legacySurfX, 0);
    assert.equal(server.calls.legacySurfLast30Days, 0);
    assert.equal(server.calls.forbidden, 0);
    assert.equal(server.calls.unexpected, 0);

    echoRetryGoodResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_echo_retry_good",
      session_id: "session_m1_echo_retry_good",
      turn_id: "turn_m1_echo_retry_good_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Create 3 short X posts from the safest angle.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling Echo retry success fixture");
    assert.equal(echoRetryGoodResult.surfCalls, 0);
    assert.equal(echoRetryGoodResult.echoCalls, 2);
    assert.equal(echoRetryGoodResult.delegationSummary.length, 2);
    assert.equal(echoRetryGoodResult.delegationSummary[0].status, "completed");
    assert.equal(echoRetryGoodResult.delegationSummary[1].status, "completed");
    assert.match(echoRetryGoodResult.response.answer?.body ?? "", /Echo retry accepted/);
    assert.doesNotMatch(echoRetryGoodResult.response.answer?.body ?? "", /CMO-written replacement copy/);

    echoRetryFailResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_echo_retry_fail",
      session_id: "session_m1_echo_retry_fail",
      turn_id: "turn_m1_echo_retry_fail_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Create 3 short X posts from the safest angle.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling Echo retry failure fixture");
    assert.equal(echoRetryFailResult.surfCalls, 0);
    assert.equal(echoRetryFailResult.echoCalls, 2);
    assert.equal(echoRetryFailResult.delegationSummary.length, 2);
    assert.equal(echoRetryFailResult.delegationSummary[1].status, "failed");
    assert.equal(echoRetryFailResult.delegationSummary[1].failureReason, "Echo retry fixture unavailable");
    assert.equal(echoRetryFailResult.response.answer?.decision, "WAIT");
    assert.match(echoRetryFailResult.response.answer?.body ?? "", /Echo output unusable; retry required\./);
    assert.doesNotMatch(echoRetryFailResult.response.answer?.body ?? "", /Post 1:/);
    assert.equal(echoRetryFailResult.response.structured_output?.echo_retry_failed, true);

    const echoCallsBeforeRetryLimit = server.calls.echo;
    echoRetryLimitResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_echo_retry_limit",
      session_id: "session_m1_echo_retry_limit",
      turn_id: "turn_m1_echo_retry_limit_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Create 3 short X posts from the safest angle.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling Echo retry limit fixture");
    assert.equal(echoRetryLimitResult.surfCalls, 0);
    assert.equal(echoRetryLimitResult.echoCalls, 2);
    assert.equal(server.calls.echo, echoCallsBeforeRetryLimit + 2);
    assert.equal(echoRetryLimitResult.delegationSummary.length, 2);
    assert.equal(echoRetryLimitResult.delegationSummary[1].status, "completed");
    assert.equal(echoRetryLimitResult.response.answer?.decision, "WAIT");
    assert.match(echoRetryLimitResult.response.answer?.body ?? "", /Echo output unusable; retry required\./);
    assert.doesNotMatch(echoRetryLimitResult.response.answer?.body ?? "", /Post 1:/);
    assert.equal(echoRetryLimitResult.response.structured_output?.echo_retry_failed, true);
    assert.equal(server.calls.cmo, 21);
    assert.equal(server.calls.surfUnified, 6);
    assert.equal(server.calls.echo, 9);
    assert.equal(server.calls.legacySurfX, 0);
    assert.equal(server.calls.legacySurfLast30Days, 0);
    assert.equal(server.calls.forbidden, 0);
    assert.equal(server.calls.unexpected, 0);
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
        echoFailureGuarded: echoFailResult?.response.structured_output?.echo_failed === true,
        surfFailureGuarded: surfFailResult?.response.structured_output?.surf_failed === true,
        echoRetryGood: echoRetryGoodResult?.echoCalls === 2,
        echoRetryFailureGuarded: echoRetryFailResult?.response.structured_output?.echo_retry_failed === true,
        echoRetryLimited: echoRetryLimitResult?.echoCalls === 2,
        legacySurfXCalls: server.calls.legacySurfX,
        legacySurfLast30DaysCalls: server.calls.legacySurfLast30Days,
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
