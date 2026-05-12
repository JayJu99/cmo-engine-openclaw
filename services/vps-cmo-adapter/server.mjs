import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const DEFAULT_DATA_DIR = "/home/ju/.openclaw/workspace/data/cmo-dashboard";
const DEFAULT_SCHEMA_VERSION = "cmo.dashboard.v1";
const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const DEFAULT_OPENCLAW_TIMEOUT_MS = 120_000;
const DEFAULT_TRIGGER_MODE = "mock";
const DEFAULT_OPENCLAW_BIN = "openclaw";
const DEFAULT_CMO_AGENT_ID = "cmo";
const DEFAULT_CMO_RUN_TIMEOUT_SECONDS = 900;
const DEFAULT_CMO_CRON_RUN_TIMEOUT_MS = 180_000;
const MAX_BODY_BYTES = 1_000_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

function getConfig() {
  const triggerMode = process.env.CMO_TRIGGER_MODE ?? DEFAULT_TRIGGER_MODE;

  return {
    apiKey: process.env.CMO_ADAPTER_API_KEY ?? "",
    dataDir: process.env.CMO_DASHBOARD_DATA_DIR ?? DEFAULT_DATA_DIR,
    schemaVersion: process.env.CMO_SCHEMA_VERSION ?? DEFAULT_SCHEMA_VERSION,
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL ?? DEFAULT_GATEWAY_URL,
    openclawTimeoutMs: Number.parseInt(process.env.OPENCLAW_TIMEOUT_MS ?? String(DEFAULT_OPENCLAW_TIMEOUT_MS), 10),
    triggerMode,
    openclawBin: process.env.OPENCLAW_BIN ?? DEFAULT_OPENCLAW_BIN,
    cmoAgentId: process.env.CMO_AGENT_ID ?? DEFAULT_CMO_AGENT_ID,
    cmoRunTimeoutSeconds: Number.parseInt(process.env.CMO_RUN_TIMEOUT_SECONDS ?? String(DEFAULT_CMO_RUN_TIMEOUT_SECONDS), 10),
    cmoCronRunTimeoutMs: Number.parseInt(process.env.CMO_CRON_RUN_TIMEOUT_MS ?? String(DEFAULT_CMO_CRON_RUN_TIMEOUT_MS), 10),
    openclawTriggerEnabled: triggerMode === "openclaw-cron",
    port: Number.parseInt(process.env.CMO_ADAPTER_PORT ?? process.env.PORT ?? "8787", 10),
    host: process.env.CMO_ADAPTER_HOST ?? "0.0.0.0",
  };
}

function isSafeRunId(runId) {
  return /^[A-Za-z0-9_.-]+$/.test(runId);
}

function dataPath(...segments) {
  return path.join(getConfig().dataDir, ...segments);
}

function jsonResponse(res, status, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function methodNotAllowed(res) {
  jsonResponse(res, 405, {
    error: "Method not allowed",
    code: "method_not_allowed",
  });
}

function notFound(res, message = "Not found") {
  jsonResponse(res, 404, {
    error: message,
    code: "not_found",
  });
}

function unauthorized(res) {
  jsonResponse(res, 401, {
    error: "Missing or invalid CMO Adapter API key",
    code: "unauthorized",
  });
}

function configError(res, message) {
  jsonResponse(res, 500, {
    error: message,
    code: "adapter_config_error",
  });
}

function hasValidApiKey(req) {
  const { apiKey } = getConfig();

  if (!apiKey) {
    return false;
  }

  const header = req.headers.authorization ?? "";
  const prefix = "Bearer ";

  if (!header.startsWith(prefix)) {
    return false;
  }

  const received = header.slice(prefix.length);
  const expectedBuffer = Buffer.from(apiKey);
  const receivedBuffer = Buffer.from(received);

  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeJsonFile(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function ensureDashboardDirs() {
  await mkdir(dataPath("raw"), { recursive: true });
  await mkdir(dataPath("runs"), { recursive: true });
  await mkdir(dataPath("status"), { recursive: true });
}

async function readRequestJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();

  if (!body) {
    return {};
  }

  return JSON.parse(body);
}

function versioned(payload = {}) {
  return {
    schema_version: getConfig().schemaVersion,
    ...payload,
  };
}

function createMockRun({ runId, createdAt, workspace, status }) {
  return versioned({
    run_id: runId,
    created_at: createdAt,
    workspace,
    status,
    summary: versioned({
      title: "Mock VPS CMO Brief",
      market_sentiment: "Bullish",
      content_momentum: "Improving",
      top_opportunity: "Stock trading campaign",
      risk: "OpenClaw trigger is not connected yet",
      next_action: "Wire Phase 5 real OpenClaw trigger inside the VPS adapter",
    }),
    actions: [
      versioned({
        id: "act_vps_001",
        title: "Review VPS adapter skeleton output",
        summary: "Confirm dashboard remote mode can read normalized JSON from the adapter service.",
        priority: "High",
        source: "VPS CMO Adapter",
        agent: "Skeleton",
        time: "Just now",
        type: "Integration Check",
      }),
      versioned({
        id: "act_vps_002",
        title: "Prepare Phase 5 trigger mapping",
        summary: "Replace mock raw payload creation with the local OpenClaw CMO trigger path on the VPS.",
        priority: "Medium",
        source: "VPS CMO Adapter",
        agent: "Skeleton",
        time: "Just now",
        type: "Implementation Prep",
      }),
    ],
    signals: [
      versioned({
        id: "sig_vps_001",
        title: "Remote adapter service is reachable",
        summary: "The dashboard can call the VPS adapter contract without direct Gateway access.",
        category: "Infrastructure",
        source: "VPS CMO Adapter",
        severity: "Opportunity",
        time: "Just now",
      }),
    ],
    agents: [
      versioned({
        id: "agent_vps_adapter",
        name: "VPS Adapter",
        codename: "Bridge",
        status: "Idle",
        tone: "blue",
        progress: 35,
        description: "Serving normalized dashboard JSON",
        activity: "Waiting for Phase 5 OpenClaw trigger wiring",
        metricA: "4 routes",
        metricB: "mock",
      }),
    ],
    campaigns: [
      versioned({
        id: "campaign_vps_stock_push",
        name: "Stock Trading Push",
        title: "Stock Trading Push",
        channels: ["Facebook", "X", "Reddit"],
        stage: "Content",
        owner_agent: "Content Agent (Echo)",
        status: "Running",
        progress: 3,
        last_updated: "Just now",
        summary: "Remote adapter skeleton campaign used to verify Pipeline data binding.",
        next_action: "Review generated campaign hooks before Phase 5 trigger wiring",
        tone: "violet",
      }),
      versioned({
        id: "campaign_vps_hspay_referral",
        name: "HSPay Referral",
        title: "HSPay Referral",
        channels: ["LinkedIn", "Email"],
        stage: "Strategy",
        owner_agent: "Lens Agent (Vista)",
        status: "Need Approval",
        progress: 4,
        last_updated: "18 min ago",
        summary: "Referral campaign waiting for strategy approval and audience refinement.",
        next_action: "Approve referral positioning and channel priority",
        tone: "blue",
      }),
      versioned({
        id: "campaign_vps_us_traders",
        name: "US Traders Push",
        title: "US Traders Push",
        channels: ["X", "Reddit", "YouTube"],
        stage: "Published",
        owner_agent: "Researcher (Radar)",
        status: "Done",
        progress: 6,
        last_updated: "2 hr ago",
        summary: "Published campaign tracking US trader engagement and conversion signals.",
        next_action: "Prepare performance report from collected signals",
        tone: "green",
      }),
    ],
    reports: [
      versioned({
        id: "rep_vps_adapter",
        title: "VPS Adapter Skeleton",
        type: "Integration",
        meta: "Phase 4C mock run",
        stats: ["4 routes", "1 data dir", "0 Gateway calls"],
        tone: "slate",
      }),
    ],
    vault: [
      versioned({
        id: "vault_vps_adapter_contract",
        name: "Adapter Contract",
        type: "Normalized JSON",
        status: "Indexed",
        count: "4 endpoints",
        tone: "green",
      }),
    ],
  });
}

function createAdapterRun({ runId, createdAt, workspace, status, summary, agents, openclaw, error }) {
  return versioned({
    run_id: runId,
    created_at: createdAt,
    workspace,
    status,
    summary: versioned({
      title: summary.title,
      market_sentiment: summary.market_sentiment,
      content_momentum: summary.content_momentum,
      top_opportunity: summary.top_opportunity,
      risk: summary.risk,
      next_action: summary.next_action,
    }),
    actions: [],
    signals: [],
    agents,
    campaigns: [],
    reports: [
      versioned({
        id: "rep_openclaw_trigger",
        title: "OpenClaw CMO Trigger",
        type: "Integration",
        meta: `Phase 5A ${status}`,
        stats: ["cron one-shot", getConfig().cmoAgentId, status],
        tone: status === "failed" ? "red" : "blue",
      }),
    ],
    vault: [],
    ...(openclaw ? { openclaw } : {}),
    ...(error ? { error } : {}),
  });
}

function createRunningOpenClawRun({ runId, createdAt, workspace, openclaw }) {
  return createAdapterRun({
    runId,
    createdAt,
    workspace,
    status: "running",
    summary: {
      title: "CMO Brief Running",
      market_sentiment: "Pending",
      content_momentum: "Pending",
      top_opportunity: "Pending CMO output",
      risk: "CMO run is still in progress",
      next_action: "Wait for the normalized dashboard JSON to be written",
    },
    agents: [
      versioned({
        id: "agent_cmo",
        name: "CMO",
        codename: "OpenClaw",
        status: "Running",
        tone: "blue",
        progress: 10,
        description: "OpenClaw CMO agent",
        activity: "Generating dashboard brief",
        metricA: getConfig().cmoAgentId,
        metricB: "openclaw-cron",
      }),
    ],
    openclaw,
  });
}

function createFailedOpenClawRun({ runId, createdAt, workspace, error, openclaw }) {
  return createAdapterRun({
    runId,
    createdAt,
    workspace,
    status: "failed",
    summary: {
      title: "CMO Brief Trigger Failed",
      market_sentiment: "Unavailable",
      content_momentum: "Unavailable",
      top_opportunity: "Retry after checking the VPS OpenClaw runtime",
      risk: "OpenClaw cron trigger failed before CMO completed",
      next_action: "Check adapter status and OpenClaw CLI availability on the VPS",
    },
    agents: [
      versioned({
        id: "agent_cmo",
        name: "CMO",
        codename: "OpenClaw",
        status: "Need Review",
        tone: "red",
        progress: 0,
        description: "OpenClaw CMO agent",
        activity: "Trigger failed",
        metricA: getConfig().cmoAgentId,
        metricB: "failed",
      }),
    ],
    error,
    openclaw,
  });
}

function buildCmoDashboardPrompt({ runId, rawPath, normalizedPath, workspace }) {
  return [
    "You are the Holdstation CMO agent producing one dashboard brief for the CMO Engine.",
    "",
    `Run ID: ${runId}`,
    `Workspace: ${workspace}`,
    `Raw markdown path: ${rawPath}`,
    `Normalized JSON path: ${normalizedPath}`,
    "",
    "Execution rules:",
    "1. Write the raw markdown brief first to the raw markdown path.",
    "2. Write the normalized dashboard JSON second to the normalized JSON path.",
    "3. Do not send Discord, Telegram, chat, email, or other external messages.",
    "4. Keep your final response short after files are written.",
    "",
    "The normalized JSON must match this dashboard contract exactly:",
    JSON.stringify(
      {
        schema_version: "cmo.dashboard.v1",
        run_id: runId,
        created_at: "ISO-8601 timestamp",
        workspace,
        status: "completed | running | failed | partial | timeout",
        summary: {
          schema_version: "cmo.dashboard.v1",
          title: "string",
          market_sentiment: "string",
          content_momentum: "string",
          top_opportunity: "string",
          risk: "string",
          next_action: "string",
        },
        actions: [],
        signals: [],
        agents: [],
        reports: [],
        vault: [],
        campaigns: [],
      },
      null,
      2,
    ),
    "",
    "Use snake_case keys only. Do not use runId, createdAt, status value succeeded, or vault_notes.",
  ].join("\n");
}

function sanitizeCommandArgs(args) {
  if (!Array.isArray(args)) {
    return null;
  }

  return args.map((arg, index) => (args[index - 1] === "--message" ? "[omitted cmo prompt]" : arg));
}

function summarizeExecError(error) {
  return {
    message: error.message,
    code: error.code ?? null,
    signal: error.signal ?? null,
    phase: error.openclaw?.phase ?? null,
    command: error.openclaw?.command ?? null,
    args: sanitizeCommandArgs(error.openclaw?.args),
    cwd: error.openclaw?.cwd ?? null,
    timeout_ms: error.openclaw?.timeoutMs ?? null,
    stdout: typeof error.stdout === "string" ? error.stdout.slice(0, 4000) : "",
    stderr: typeof error.stderr === "string" ? error.stderr.slice(0, 4000) : "",
  };
}

function parseJsonFromText(text) {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }

    return null;
  }
}

function pickOpenClawJobId(payload, fallbackName) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload.id ?? payload.job_id ?? payload.jobId ?? payload.cron_id ?? payload.cronId ?? payload.name ?? fallbackName;
  }

  return fallbackName;
}

function pickOpenClawJobIdFromOutput(output, fallbackName) {
  const payload = parseJsonFromText(output);
  const jsonJobId = pickOpenClawJobId(payload, null);

  if (jsonJobId) {
    return String(jsonJobId);
  }

  const idMatch = output.match(/\b(?:job_id|jobId|cron_id|cronId|id)\b[^A-Za-z0-9_.-]+([A-Za-z0-9_.-]+)/i);

  return idMatch?.[1] ?? fallbackName;
}

function createNearFutureCronAt() {
  return new Date(Date.now() + 2 * 60 * 1000).toISOString();
}

async function execOpenClaw(args, timeoutMs, phase) {
  const config = getConfig();
  const cwd = process.cwd();
  const command = config.openclawBin;
  let result;

  try {
    result = await execFileAsync(command, args, {
      cwd,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    error.openclaw = {
      phase,
      command,
      args,
      cwd,
      timeoutMs,
    };
    throw error;
  }

  return {
    args,
    stdout: result.stdout,
    stderr: result.stderr,
    json: parseJsonFromText(result.stdout),
  };
}

async function runOpenClawCronBrief({ runId, rawPath, normalizedPath, workspace }) {
  const config = getConfig();
  const jobName = `cmo-dashboard-${runId}`;
  const prompt = buildCmoDashboardPrompt({ runId, rawPath, normalizedPath, workspace });
  const scheduleAt = createNearFutureCronAt();
  const cronSpec = {
    name: jobName,
    oneShot: true,
    enabled: true,
    at: scheduleAt,
    agentId: config.cmoAgentId,
    sessionTarget: "isolated",
    payload: {
      kind: "agentTurn",
      prompt,
      dashboard: {
        schema_version: config.schemaVersion,
        run_id: runId,
        raw_markdown_path: rawPath,
        normalized_json_path: normalizedPath,
        workspace,
      },
    },
    delivery: {
      mode: "none",
    },
    timeoutSeconds: config.cmoRunTimeoutSeconds,
  };
  const specPath = dataPath("status", `${runId}.openclaw-cron-spec.json`);

  await writeJsonFile(specPath, cronSpec);

  const addResult = await execOpenClaw(
    [
      "cron",
      "add",
      "--name",
      jobName,
      "--at",
      cronSpec.at,
      "--session",
      "isolated",
      "--message",
      prompt,
      "--agent",
      config.cmoAgentId,
      "--no-deliver",
      "--delete-after-run",
    ],
    config.cmoCronRunTimeoutMs,
    "cron_add",
  );
  const jobId = pickOpenClawJobIdFromOutput(addResult.stdout, jobName);
  const runResult = await execOpenClaw(["cron", "run", jobId], config.cmoCronRunTimeoutMs, "cron_run");

  return {
    mode: "openclaw-cron",
    agent_id: config.cmoAgentId,
    job_id: jobId,
    job_name: jobName,
    schedule_at: cronSpec.at,
    spec_path: specPath,
    add_stdout: addResult.stdout.slice(0, 4000),
    add_stderr: addResult.stderr.slice(0, 4000),
    run_stdout: runResult.stdout.slice(0, 4000),
    run_stderr: runResult.stderr.slice(0, 4000),
    run_json: runResult.json,
  };
}

async function triggerOpenClawCronInBackground({ runId, createdAt, workspace, rawPath, normalizedPath }) {
  const statusPath = dataPath("status", `${runId}.trigger.json`);

  try {
    const metadata = await runOpenClawCronBrief({ runId, rawPath, normalizedPath, workspace });
    const currentRun = (await readJsonFile(normalizedPath)) ?? createRunningOpenClawRun({ runId, createdAt, workspace });
    const runningRun = {
      ...currentRun,
      openclaw: metadata,
    };

    await writeJsonFile(normalizedPath, runningRun);
    await writeJsonFile(dataPath("latest.json"), runningRun);
    await writeJsonFile(statusPath, versioned({
      run_id: runId,
      status: "triggered",
      updated_at: new Date().toISOString(),
      openclaw: metadata,
    }));
    // Phase 5B completes file polling, final normalized JSON validation, timeout
    // promotion, and latest_successful.json updates after CMO writes output.
  } catch (error) {
    const failure = summarizeExecError(error);
    const failedRun = createFailedOpenClawRun({
      runId,
      createdAt,
      workspace,
      error: failure,
      openclaw: {
        mode: "openclaw-cron",
        agent_id: getConfig().cmoAgentId,
        raw_markdown_path: rawPath,
        normalized_json_path: normalizedPath,
      },
    });

    await writeJsonFile(normalizedPath, failedRun);
    await writeJsonFile(dataPath("latest.json"), failedRun);
    await writeJsonFile(statusPath, versioned({
      run_id: runId,
      status: "failed",
      updated_at: new Date().toISOString(),
      error: failure,
    }));
    console.error("OpenClaw CMO trigger failed", failure);
  }
}

async function handleStatus(res) {
  const config = getConfig();
  const dataDirExists = await pathExists(config.dataDir);

  jsonResponse(res, 200, versioned({
    ok: true,
    adapter: "ok",
    schema_version: config.schemaVersion,
    data_dir: config.dataDir,
    data_dir_exists: dataDirExists,
    gateway_mode: "loopback",
    trigger_mode: config.triggerMode,
    cmo_agent_id: config.cmoAgentId,
    openclaw_trigger_enabled: config.openclawTriggerEnabled,
    openclaw_runtime: "not_checked",
    openclaw_timeout_ms: config.openclawTimeoutMs,
    cmo_run_timeout_seconds: config.cmoRunTimeoutSeconds,
    cmo_cron_run_timeout_ms: config.cmoCronRunTimeoutMs,
  }));
}

async function handleLatest(res) {
  const latest = await readJsonFile(dataPath("latest.json"));

  if (!latest) {
    notFound(res, "No latest CMO run found");
    return;
  }

  jsonResponse(res, 200, latest);
}

async function handleRun(res, runId) {
  if (!isSafeRunId(runId)) {
    jsonResponse(res, 400, {
      error: "Invalid run_id",
      code: "invalid_run_id",
    });
    return;
  }

  const run = await readJsonFile(dataPath("runs", `${runId}.json`));

  if (!run) {
    notFound(res, `CMO run not found: ${runId}`);
    return;
  }

  jsonResponse(res, 200, run);
}

async function handleRunBrief(req, res) {
  const config = getConfig();
  const body = await readRequestJson(req);
  const requestedRunId = typeof body.run_id === "string" && body.run_id.trim() ? body.run_id.trim() : null;
  const runId = requestedRunId ?? `run_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;

  if (!isSafeRunId(runId)) {
    jsonResponse(res, 400, {
      error: "Invalid run_id",
      code: "invalid_run_id",
    });
    return;
  }

  const createdAt = new Date().toISOString();
  const workspace = typeof body.workspace === "string" && body.workspace.trim() ? body.workspace.trim() : "Holdstation";
  const status = typeof body.status === "string" && body.status.trim() ? body.status.trim() : "completed";

  if (config.triggerMode !== "mock" && config.triggerMode !== "openclaw-cron") {
    jsonResponse(res, 400, {
      error: `Unsupported CMO_TRIGGER_MODE: ${config.triggerMode}`,
      code: "unsupported_trigger_mode",
    });
    return;
  }

  if (config.triggerMode === "openclaw-cron") {
    await ensureDashboardDirs();

    const rawPath = dataPath("raw", `${runId}.md`);
    const normalizedPath = dataPath("runs", `${runId}.json`);
    const run = createRunningOpenClawRun({
      runId,
      createdAt,
      workspace,
      openclaw: {
        mode: "openclaw-cron",
        agent_id: config.cmoAgentId,
        raw_markdown_path: rawPath,
        normalized_json_path: normalizedPath,
        trigger_status: "pending",
      },
    });

    await writeJsonFile(normalizedPath, run);
    await writeJsonFile(dataPath("latest.json"), run);
    await writeJsonFile(dataPath("status", `${runId}.trigger.json`), versioned({
      run_id: runId,
      status: "running",
      created_at: createdAt,
      trigger_mode: config.triggerMode,
      cmo_agent_id: config.cmoAgentId,
      raw_markdown_path: rawPath,
      normalized_json_path: normalizedPath,
    }));

    void triggerOpenClawCronInBackground({ runId, createdAt, workspace, rawPath, normalizedPath }).catch((error) => {
      console.error("OpenClaw CMO trigger background task failed", error);
    });

    jsonResponse(res, 202, run);
    return;
  }

  await mkdir(dataPath("raw"), { recursive: true });
  await mkdir(dataPath("runs"), { recursive: true });

  const rawOutput = versioned({
    run_id: runId,
    captured_at: createdAt,
    source: "mock",
    runtime: "vps-cmo-adapter/phase-4c-skeleton",
    payload: {
      adapter_note: "Phase 4C skeleton only. No OpenClaw Gateway call was made.",
      request: body,
      gateway_mode: "loopback",
      // Phase 5: trigger local OpenClaw CMO here on the VPS, capture raw output,
      // then map that raw payload into the normalized dashboard schema below.
      phase_5_placeholder: "openclaw_cmo_trigger_goes_here",
    },
  });
  const run = createMockRun({ runId, createdAt, workspace, status });

  await writeJsonFile(dataPath("raw", `${runId}.json`), rawOutput);
  await writeJsonFile(dataPath("runs", `${runId}.json`), run);
  await writeJsonFile(dataPath("latest.json"), run);

  if (status === "completed") {
    await writeJsonFile(dataPath("latest_successful.json"), run);
  }

  jsonResponse(res, 201, run);
}

async function routeRequest(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const runMatch = url.pathname.match(/^\/cmo\/runs\/([^/]+)$/);

  if (!url.pathname.startsWith("/cmo/")) {
    notFound(res);
    return;
  }

  if (!getConfig().apiKey) {
    configError(res, "CMO_ADAPTER_API_KEY is required");
    return;
  }

  if (!hasValidApiKey(req)) {
    unauthorized(res);
    return;
  }

  try {
    if (url.pathname === "/cmo/status") {
      if (req.method !== "GET") {
        methodNotAllowed(res);
        return;
      }

      await handleStatus(res);
      return;
    }

    if (url.pathname === "/cmo/latest") {
      if (req.method !== "GET") {
        methodNotAllowed(res);
        return;
      }

      await handleLatest(res);
      return;
    }

    if (runMatch) {
      if (req.method !== "GET") {
        methodNotAllowed(res);
        return;
      }

      await handleRun(res, decodeURIComponent(runMatch[1]));
      return;
    }

    if (url.pathname === "/cmo/run-brief") {
      if (req.method !== "POST") {
        methodNotAllowed(res);
        return;
      }

      await handleRunBrief(req, res);
      return;
    }

    notFound(res);
  } catch (error) {
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, {
        error: "Invalid JSON request body",
        code: "invalid_json_body",
      });
      return;
    }

    if (error && Number.isInteger(error.status)) {
      jsonResponse(res, error.status, {
        error: error.message,
        code: "request_error",
      });
      return;
    }

    console.error("CMO Adapter request failed", error);
    jsonResponse(res, 500, {
      error: "CMO Adapter request failed",
      code: "adapter_request_failed",
    });
  }
}

const server = createServer((req, res) => {
  void routeRequest(req, res);
});

const config = getConfig();

server.listen(config.port, config.host, () => {
  console.log(`VPS CMO Adapter listening on http://${config.host}:${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
  console.log(`Service root: ${__dirname}`);
});
