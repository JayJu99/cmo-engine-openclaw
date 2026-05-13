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
const SAFE_OPENCLAW_METADATA_KEYS = [
  "mode",
  "agent_id",
  "job_id",
  "job_name",
  "schedule_at",
  "openclaw_run_id",
  "trigger_status",
  "raw_markdown_path",
  "normalized_json_path",
  "spec_path",
];
const VALID_RUN_STATUSES = new Set(["completed", "running", "failed", "partial", "timeout", "mock"]);
const FORBIDDEN_PUBLIC_KEYS = new Set(["runId", "createdAt", "succeeded", "vault_notes", "prompt", "add_stdout", "add_stderr", "run_stdout", "run_stderr"]);
const PRIORITIES = new Set(["High", "Medium", "Low", "Opportunity"]);
const TONES = ["violet", "green", "blue", "orange", "pink", "slate", "red"];
const DEFAULT_AGENT_NAMES = ["CMO", "Adapter", "Researcher", "Content", "Vault"];

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
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeString(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function safeNumber(value, fallback, min = 0, max = 100) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, value));
}

function safePriority(value, fallback = "Medium") {
  return typeof value === "string" && PRIORITIES.has(value) ? value : fallback;
}

function safeTone(value, index = 0) {
  return typeof value === "string" && TONES.includes(value) ? value : TONES[index % TONES.length];
}

function safeStringList(value, fallback) {
  if (Array.isArray(value)) {
    const values = value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
    return values.length ? values : fallback;
  }

  if (typeof value === "string" && value.trim()) {
    const values = value
      .split(/\s{2,}|,\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
    return values.length ? values : fallback;
  }

  return fallback;
}

function slugifyIdPart(value, fallback) {
  const source = safeString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return source || fallback;
}

function stableItemId(prefix, index, record, fallbackLabel) {
  const label = record.title ?? record.name ?? record.type ?? fallbackLabel;
  return `${prefix}_${String(index + 1).padStart(3, "0")}_${slugifyIdPart(label, fallbackLabel)}`;
}

function withExpectedVersion(record, payload) {
  return {
    ...payload,
    schema_version: getConfig().schemaVersion,
    id: safeString(record.id, payload.id),
  };
}

function pickFields(value, fields) {
  const source = isRecord(value) ? value : {};
  const output = {};

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      output[field] = cloneJson(source[field]);
    }
  }

  return output;
}

function sanitizeOpenClawMetadata(value) {
  if (!isRecord(value)) {
    return null;
  }

  const output = {};

  for (const key of SAFE_OPENCLAW_METADATA_KEYS) {
    const candidate = value[key];

    if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") {
      output[key] = candidate;
    }
  }

  return Object.keys(output).length ? output : null;
}

function sanitizeErrorMetadata(value) {
  if (!isRecord(value)) {
    return null;
  }

  const output = {};
  const allowedFields = ["code", "message", "phase", "command", "args", "cwd", "timeout_ms", "validation_errors", "original_status", "checked_at"];

  for (const key of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      output[key] = cloneJson(value[key]);
    }
  }

  return Object.keys(output).length ? output : null;
}

function sanitizePublicRun(run) {
  if (!isRecord(run)) {
    return run;
  }

  const sanitized = pickFields(run, ["schema_version", "run_id", "created_at", "workspace", "status"]);
  sanitized.summary = pickFields(run.summary, [
    "schema_version",
    "title",
    "market_sentiment",
    "content_momentum",
    "top_opportunity",
    "risk",
    "next_action",
  ]);
  sanitized.actions = Array.isArray(run.actions)
    ? run.actions.map((item) => pickFields(item, ["schema_version", "id", "title", "summary", "priority", "source", "agent", "time", "type"]))
    : [];
  sanitized.signals = Array.isArray(run.signals)
    ? run.signals.map((item) => pickFields(item, ["schema_version", "id", "title", "summary", "category", "source", "severity", "time"]))
    : [];
  sanitized.agents = Array.isArray(run.agents)
    ? run.agents.map((item) =>
        pickFields(item, ["schema_version", "id", "name", "codename", "status", "tone", "progress", "description", "activity", "metricA", "metricB"]),
      )
    : [];
  sanitized.campaigns = Array.isArray(run.campaigns)
    ? run.campaigns.map((item) =>
        pickFields(item, [
          "schema_version",
          "id",
          "name",
          "title",
          "channels",
          "stage",
          "owner_agent",
          "status",
          "progress",
          "last_updated",
          "summary",
          "next_action",
          "tone",
        ]),
      )
    : [];
  sanitized.reports = Array.isArray(run.reports)
    ? run.reports.map((item) => pickFields(item, ["schema_version", "id", "title", "type", "meta", "stats", "tone"]))
    : [];
  sanitized.vault = Array.isArray(run.vault)
    ? run.vault.map((item) => pickFields(item, ["schema_version", "id", "name", "type", "status", "count", "tone"]))
    : [];

  const openclaw = sanitizeOpenClawMetadata(run.openclaw);
  const error = sanitizeErrorMetadata(run.error);

  if (openclaw) {
    sanitized.openclaw = openclaw;
  }

  if (error) {
    sanitized.error = error;
  }

  return sanitized;
}

function normalizeSummaryForValidation(value) {
  const record = isRecord(value) ? value : {};

  return {
    schema_version: getConfig().schemaVersion,
    title: safeString(record.title, "CMO Brief"),
    market_sentiment: safeString(record.market_sentiment, "Unavailable"),
    content_momentum: safeString(record.content_momentum, "Needs review"),
    top_opportunity: safeString(record.top_opportunity, "Review the completed CMO brief"),
    risk: safeString(record.risk, "Some CMO fields were repaired by the adapter"),
    next_action: safeString(record.next_action, "Review normalized output before acting"),
  };
}

function normalizeActionsForValidation(value) {
  const source = Array.isArray(value) ? value : [];

  return source.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const title = safeString(record.title, `CMO action ${index + 1}`);

    return withExpectedVersion(record, {
      id: stableItemId("action", index, record, "cmo_action"),
      title,
      summary: safeString(record.summary, `Review and execute: ${title}`),
      priority: safePriority(record.priority, "Medium"),
      source: safeString(record.source, "CMO"),
      agent: safeString(record.agent, "CMO"),
      time: safeString(record.time, "Just now"),
      type: safeString(record.type, "CMO Recommendation"),
    });
  });
}

function normalizeSignalsForValidation(value) {
  const source = Array.isArray(value) ? value : [];

  return source.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const title = safeString(record.title, `CMO signal ${index + 1}`);

    return withExpectedVersion(record, {
      id: stableItemId("signal", index, record, "cmo_signal"),
      title,
      summary: safeString(record.summary, `Monitor signal: ${title}`),
      category: safeString(record.category, "Market"),
      source: safeString(record.source, "CMO"),
      severity: safePriority(record.severity, "Medium"),
      time: safeString(record.time, "Just now"),
    });
  });
}

function normalizeAgentsForValidation(value) {
  const source = Array.isArray(value) ? value : [];

  return source.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const name = safeString(record.name, DEFAULT_AGENT_NAMES[index] ?? `Agent ${index + 1}`);
    const codename = safeString(record.codename, slugifyIdPart(name, "agent").replace(/_/g, " "));

    return withExpectedVersion(record, {
      id: stableItemId("agent", index, record, "agent"),
      name,
      codename,
      status: safeString(record.status, "Idle"),
      tone: safeTone(record.tone, index),
      progress: safeNumber(record.progress, record.status === "Done" ? 100 : 50),
      description: safeString(record.description, `${name} supports the CMO dashboard workflow.`),
      activity: safeString(record.activity, "Reviewing CMO brief output"),
      metricA: safeString(record.metricA ?? record.metric_a, "Active"),
      metricB: safeString(record.metricB ?? record.metric_b, "Normalized"),
    });
  });
}

function normalizeCampaignsForValidation(value) {
  const source = Array.isArray(value) ? value : [];

  return source.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const name = safeString(record.name ?? record.title, `Campaign ${index + 1}`);
    const ownerAgent = safeString(record.owner_agent, "CMO");

    return withExpectedVersion(record, {
      id: stableItemId("campaign", index, record, "campaign"),
      name,
      title: safeString(record.title, name),
      channels: safeStringList(record.channels, ["X", "Telegram"]),
      stage: safeString(record.stage, "Strategy"),
      owner_agent: ownerAgent,
      status: safeString(record.status, "In Progress"),
      progress: safeNumber(record.progress, 3, 0, 6),
      last_updated: safeString(record.last_updated ?? record.updated_at ?? record.updated, "Just now"),
      summary: safeString(record.summary, `${name} is active and needs CMO review.`),
      next_action: safeString(record.next_action, "Confirm owner, channel mix, and next delivery step"),
      tone: safeTone(record.tone, index + 2),
    });
  });
}

function normalizeReportsForValidation(value) {
  const source = Array.isArray(value) ? value : [];

  return source.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const title = safeString(record.title, `CMO report ${index + 1}`);
    const stats = Array.isArray(record.stats)
      ? record.stats.map((stat) => safeString(stat, "-")).filter((stat) => stat !== "-")
      : [];

    return withExpectedVersion(record, {
      id: stableItemId("report", index, record, "report"),
      title,
      type: safeString(record.type, "Brief"),
      meta: safeString(record.meta, "Generated by CMO"),
      stats: stats.length ? stats.slice(0, 3) : ["Review", "CMO", "Now"],
      tone: safeTone(record.tone, index + 4),
    });
  });
}

function normalizeVaultForValidation(value) {
  const source = Array.isArray(value) ? value : [];

  return source.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const type = safeString(record.type, "Memory");
    const name = safeString(record.name ?? record.title, `${type} ${index + 1}`);

    return withExpectedVersion(record, {
      id: stableItemId("vault", index, record, "vault"),
      name,
      type,
      status: safeString(record.status, "Indexed"),
      count: safeString(record.count, "1 item"),
      tone: safeTone(record.tone, index + 5),
    });
  });
}

function normalizeCompletedRunForValidation(run) {
  const record = isRecord(run) ? run : {};

  return {
    schema_version: getConfig().schemaVersion,
    run_id: safeString(record.run_id, "run_fallback"),
    created_at: safeString(record.created_at, new Date().toISOString()),
    workspace: safeString(record.workspace, "Holdstation"),
    status: "completed",
    summary: normalizeSummaryForValidation(record.summary),
    actions: normalizeActionsForValidation(record.actions),
    signals: normalizeSignalsForValidation(record.signals),
    agents: normalizeAgentsForValidation(record.agents),
    campaigns: normalizeCampaignsForValidation(record.campaigns),
    reports: normalizeReportsForValidation(record.reports),
    vault: normalizeVaultForValidation(record.vault),
    ...(sanitizeOpenClawMetadata(record.openclaw) ? { openclaw: sanitizeOpenClawMetadata(record.openclaw) } : {}),
  };
}

function collectForbiddenPublicKeys(value, pathName = "$", errors = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenPublicKeys(item, `${pathName}[${index}]`, errors));
    return errors;
  }

  if (!isRecord(value)) {
    return errors;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_KEYS.has(key)) {
      errors.push(`${pathName}.${key} is not allowed in public run JSON`);
    }

    collectForbiddenPublicKeys(nestedValue, `${pathName}.${key}`, errors);
  }

  return errors;
}

function validateStringField(record, key, errors, pathName) {
  if (typeof record[key] !== "string" || !record[key].trim()) {
    errors.push(`${pathName}.${key} is required`);
  }
}

function validateVersionedItemArray(run, key, minItems, maxItems, requiredFields, errors) {
  const value = run[key];

  if (!Array.isArray(value)) {
    errors.push(`${key} must be an array`);
    return;
  }

  if (run.status === "completed" && value.length < minItems) {
    errors.push(`${key} must include at least ${minItems} item${minItems === 1 ? "" : "s"} for completed runs`);
  }

  if (run.status === "completed" && Number.isFinite(maxItems) && value.length > maxItems) {
    errors.push(`${key} must include no more than ${maxItems} items for completed runs`);
  }

  value.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`${key}[${index}] must be an object`);
      return;
    }

    if (item.schema_version !== getConfig().schemaVersion) {
      errors.push(`${key}[${index}].schema_version must be ${getConfig().schemaVersion}`);
    }

    validateStringField(item, "id", errors, `${key}[${index}]`);

    for (const field of requiredFields) {
      if (field === "channels" || field === "stats") {
        if (!Array.isArray(item[field]) || item[field].length === 0) {
          errors.push(`${key}[${index}].${field} must be a non-empty array`);
        }
        continue;
      }

      if (field === "progress") {
        if (typeof item[field] !== "number" || !Number.isFinite(item[field])) {
          errors.push(`${key}[${index}].${field} must be a number`);
        }
        continue;
      }

      validateStringField(item, field, errors, `${key}[${index}]`);
    }
  });
}

function validateDashboardRunContract(run) {
  const errors = collectForbiddenPublicKeys(run);
  const config = getConfig();

  if (!isRecord(run)) {
    return {
      valid: false,
      errors: ["run must be a JSON object"],
    };
  }

  for (const key of ["schema_version", "run_id", "created_at", "workspace", "status", "summary", "actions", "signals", "agents", "reports", "vault", "campaigns"]) {
    if (!Object.prototype.hasOwnProperty.call(run, key)) {
      errors.push(`${key} is required`);
    }
  }

  if (run.schema_version !== config.schemaVersion) {
    errors.push(`schema_version must be ${config.schemaVersion}`);
  }

  validateStringField(run, "run_id", errors, "$");
  validateStringField(run, "created_at", errors, "$");
  validateStringField(run, "workspace", errors, "$");

  if (typeof run.created_at === "string" && Number.isNaN(Date.parse(run.created_at))) {
    errors.push("created_at must be a valid ISO-8601 timestamp");
  }

  if (run.status === "succeeded") {
    errors.push("status must not use succeeded; use completed");
  } else if (typeof run.status !== "string" || !VALID_RUN_STATUSES.has(run.status)) {
    errors.push("status must be one of completed, running, failed, partial, timeout, or mock");
  }

  if (!isRecord(run.summary)) {
    errors.push("summary must be an object");
  } else {
    if (run.summary.schema_version !== config.schemaVersion) {
      errors.push(`summary.schema_version must be ${config.schemaVersion}`);
    }

    for (const key of ["title", "market_sentiment", "content_momentum", "top_opportunity", "risk", "next_action"]) {
      validateStringField(run.summary, key, errors, "$.summary");
    }
  }

  validateVersionedItemArray(run, "actions", 3, 5, ["title", "summary", "priority", "source", "agent", "time", "type"], errors);
  validateVersionedItemArray(run, "signals", 3, 5, ["title", "summary", "category", "source", "severity", "time"], errors);
  validateVersionedItemArray(
    run,
    "agents",
    5,
    Infinity,
    ["name", "codename", "status", "tone", "progress", "description", "activity", "metricA", "metricB"],
    errors,
  );
  validateVersionedItemArray(
    run,
    "campaigns",
    2,
    3,
    ["name", "title", "channels", "stage", "owner_agent", "status", "progress", "last_updated", "summary", "next_action", "tone"],
    errors,
  );
  validateVersionedItemArray(run, "reports", 1, 3, ["title", "type", "meta", "stats", "tone"], errors);
  validateVersionedItemArray(run, "vault", 1, 3, ["name", "type", "status", "count", "tone"], errors);

  return {
    valid: errors.length === 0,
    errors,
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

function createTimeoutOpenClawRun({ runId, createdAt, workspace, openclaw }) {
  return createAdapterRun({
    runId,
    createdAt,
    workspace,
    status: "timeout",
    summary: {
      title: "CMO Brief Timed Out",
      market_sentiment: "Unavailable",
      content_momentum: "Unavailable",
      top_opportunity: "Retry the CMO brief after checking OpenClaw runtime health",
      risk: "CMO did not write completed dashboard JSON before the timeout",
      next_action: "Inspect private adapter status files and run a fresh brief",
    },
    agents: [
      versioned({
        id: "agent_cmo",
        name: "CMO",
        codename: "OpenClaw",
        status: "Need Review",
        tone: "orange",
        progress: 0,
        description: "OpenClaw CMO agent",
        activity: "Run timed out",
        metricA: getConfig().cmoAgentId,
        metricB: "timeout",
      }),
    ],
    openclaw,
  });
}

function createInvalidOpenClawRun({ runId, createdAt, workspace, validationErrors, openclaw, originalStatus }) {
  return createAdapterRun({
    runId,
    createdAt,
    workspace,
    status: "partial",
    summary: {
      title: "CMO Brief Needs Validation",
      market_sentiment: "Unavailable",
      content_momentum: "Needs review",
      top_opportunity: "Fix the normalized dashboard JSON and rerun validation",
      risk: "CMO wrote completed output that did not match the dashboard contract",
      next_action: "Review validation errors in the adapter response metadata",
    },
    agents: [
      versioned({
        id: "agent_cmo",
        name: "CMO",
        codename: "OpenClaw",
        status: "Need Review",
        tone: "red",
        progress: 25,
        description: "OpenClaw CMO agent",
        activity: "Output validation failed",
        metricA: getConfig().cmoAgentId,
        metricB: "partial",
      }),
    ],
    error: {
      code: "cmo_run_validation_failed",
      message: "Completed CMO output failed dashboard contract validation",
      validation_errors: validationErrors,
      original_status: originalStatus ?? "unknown",
      checked_at: new Date().toISOString(),
    },
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
        actions: [
          {
            schema_version: "cmo.dashboard.v1",
            id: "action_001_approve_trading_campaign",
            title: "Approve trading campaign",
            summary: "Approve the next campaign step and confirm launch channel priority.",
            priority: "High",
            source: "CMO",
            agent: "Content",
            time: "Just now",
            type: "Approval",
          },
        ],
        signals: [
          {
            schema_version: "cmo.dashboard.v1",
            id: "signal_001_retail_trader_momentum",
            title: "Retail trader momentum rising",
            summary: "Audience activity increased around stock trading education topics.",
            category: "Market",
            source: "CMO",
            severity: "Opportunity",
            time: "Just now",
          },
        ],
        agents: [
          {
            schema_version: "cmo.dashboard.v1",
            id: "agent_001_cmo",
            name: "CMO",
            codename: "OpenClaw",
            status: "Running",
            tone: "blue",
            progress: 72,
            description: "Leads the dashboard brief and decides next marketing actions.",
            activity: "Prioritizing campaign decisions",
            metric_a: "5 actions",
            metric_b: "3 risks",
          },
        ],
        campaigns: [
          {
            schema_version: "cmo.dashboard.v1",
            id: "campaign_001_stock_trading_push",
            name: "Stock Trading Push",
            title: "Stock Trading Push",
            channels: ["X", "Telegram"],
            stage: "Content",
            owner_agent: "Content",
            status: "In Progress",
            progress: 3,
            last_updated: "Just now",
            summary: "Campaign is ready for CMO review before launch.",
            next_action: "Approve message angle and channel order",
            tone: "violet",
          },
        ],
        reports: [
          {
            schema_version: "cmo.dashboard.v1",
            id: "report_001_daily_cmo_brief",
            title: "Daily CMO Brief",
            type: "Brief",
            meta: "Generated by CMO",
            stats: ["3 signals", "5 actions", "2 campaigns"],
            tone: "slate",
          },
        ],
        vault: [
          {
            schema_version: "cmo.dashboard.v1",
            id: "vault_001_brand_memory",
            name: "Brand Memory",
            type: "Memory",
            status: "Indexed",
            count: "12 notes",
            tone: "green",
          },
        ],
      },
      null,
      2,
    ),
    "",
    "The completed dashboard JSON must include useful non-empty sections:",
    "- actions: 3-5 action items.",
    "- signals: 3-5 market, content, audience, or product signals.",
    "- agents: include at least CMO, Adapter, Researcher/Radar, Content/Echo, and Vault/Mind.",
    "- campaigns: 2-3 workstream or campaign items.",
    "- reports: 1-3 report cards.",
    "- vault: 1-3 memory or knowledge items.",
    "- Every object inside actions, signals, agents, campaigns, reports, and vault must include a non-empty id.",
    "- Every nested object should include schema_version: cmo.dashboard.v1.",
    "",
    "Use only the top-level schema keys shown above: schema_version, run_id, created_at, workspace, status, summary, actions, signals, agents, reports, vault, campaigns.",
    "Use snake_case keys only in the CMO-authored JSON. For agent metrics use metric_a and metric_b.",
    "Do not use runId, createdAt, status value succeeded, or vault_notes.",
    "Do not include this prompt, cron payload, OpenClaw stdout, OpenClaw stderr, or Gateway details in the normalized JSON.",
  ].join("\n");
}

function sanitizeCommandArgs(args) {
  if (!Array.isArray(args)) {
    return null;
  }

  return args.map((arg, index) => (args[index - 1] === "--message" ? "[omitted cmo prompt]" : arg));
}

function summarizeExecError(error, { includeOutput = false } = {}) {
  return {
    message: error.message,
    code: error.code ?? null,
    signal: error.signal ?? null,
    phase: error.openclaw?.phase ?? null,
    command: error.openclaw?.command ?? null,
    args: sanitizeCommandArgs(error.openclaw?.args),
    cwd: error.openclaw?.cwd ?? null,
    timeout_ms: error.openclaw?.timeoutMs ?? null,
    ...(includeOutput
      ? {
          stdout: typeof error.stdout === "string" ? error.stdout.slice(0, 4000) : "",
          stderr: typeof error.stderr === "string" ? error.stderr.slice(0, 4000) : "",
        }
      : {}),
  };
}

function pickOpenClawRunId(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload.openclaw_run_id ?? payload.run_id ?? payload.runId ?? payload.task_id ?? payload.taskId ?? payload.id ?? null;
  }

  return null;
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
  const debugPath = dataPath("status", `${runId}.debug.json`);
  const openclawRunId = pickOpenClawRunId(runResult.json);
  const triggerStatus = runResult.json?.enqueued === true ? "enqueued" : "triggered";

  await writeJsonFile(debugPath, versioned({
    run_id: runId,
    captured_at: new Date().toISOString(),
    note: "Private OpenClaw CLI debug output. Do not serve this file through dashboard APIs.",
    add: {
      args: sanitizeCommandArgs(addResult.args),
      stdout: addResult.stdout,
      stderr: addResult.stderr,
      json: addResult.json,
    },
    run: {
      args: sanitizeCommandArgs(runResult.args),
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      json: runResult.json,
    },
  }));

  return {
    mode: "openclaw-cron",
    agent_id: config.cmoAgentId,
    job_id: jobId,
    job_name: jobName,
    schedule_at: cronSpec.at,
    openclaw_run_id: openclawRunId ? String(openclawRunId) : "",
    trigger_status: triggerStatus,
    raw_markdown_path: rawPath,
    normalized_json_path: normalizedPath,
    spec_path: specPath,
  };
}

async function triggerOpenClawCronInBackground({ runId, createdAt, workspace, rawPath, normalizedPath }) {
  const statusPath = dataPath("status", `${runId}.trigger.json`);

  try {
    const metadata = sanitizeOpenClawMetadata(await runOpenClawCronBrief({ runId, rawPath, normalizedPath, workspace }));
    const currentRun = (await readJsonFile(normalizedPath)) ?? createRunningOpenClawRun({ runId, createdAt, workspace });
    const runningRun = sanitizePublicRun({
      ...currentRun,
      openclaw: metadata,
    });

    await writeJsonFile(normalizedPath, runningRun);
    await writeJsonFile(dataPath("latest.json"), runningRun);
    await writeJsonFile(statusPath, versioned({
      run_id: runId,
      status: "triggered",
      updated_at: new Date().toISOString(),
      openclaw: metadata,
    }));
    // Phase 5B finalization happens when run/latest endpoints are read, after
    // CMO has had time to write the completed normalized dashboard JSON.
  } catch (error) {
    const failure = summarizeExecError(error);
    const privateFailure = summarizeExecError(error, { includeOutput: true });
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
    await writeJsonFile(dataPath("status", `${runId}.debug.json`), versioned({
      run_id: runId,
      captured_at: new Date().toISOString(),
      note: "Private OpenClaw CLI failure debug output. Do not serve this file through dashboard APIs.",
      error: privateFailure,
    }));
    console.error("OpenClaw CMO trigger failed", failure);
  }
}

async function readSafeOpenClawMetadata(runId, run) {
  const direct = sanitizeOpenClawMetadata(run?.openclaw);

  if (direct) {
    return direct;
  }

  const status = await readJsonFile(dataPath("status", `${runId}.trigger.json`));
  return sanitizeOpenClawMetadata(status?.openclaw);
}

function isRunTimedOut(run) {
  if (!isRecord(run) || run.status !== "running") {
    return false;
  }

  const createdAtMs = Date.parse(String(run.created_at ?? ""));

  if (Number.isNaN(createdAtMs)) {
    return false;
  }

  return Date.now() - createdAtMs > getConfig().cmoRunTimeoutSeconds * 1000;
}

async function writePublicRunState(run, { successful = false } = {}) {
  const sanitized = sanitizePublicRun(run);

  await writeJsonFile(dataPath("runs", `${sanitized.run_id}.json`), sanitized);
  await writeJsonFile(dataPath("latest.json"), sanitized);

  if (successful) {
    await writeJsonFile(dataPath("latest_successful.json"), sanitized);
  }

  return sanitized;
}

async function writePublicRunFileAndCurrentLatest(run) {
  const sanitized = sanitizePublicRun(run);

  await writeJsonFile(dataPath("runs", `${sanitized.run_id}.json`), sanitized);

  try {
    const latest = await readJsonFile(dataPath("latest.json"));

    if (isRecord(latest) && latest.run_id === sanitized.run_id) {
      await writeJsonFile(dataPath("latest.json"), sanitized);
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }

  return sanitized;
}

async function readRunCandidate(runId, fallbackRun = null) {
  try {
    return (await readJsonFile(dataPath("runs", `${runId}.json`))) ?? fallbackRun;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        schema_version: getConfig().schemaVersion,
        run_id: runId,
        created_at: safeString(fallbackRun?.created_at, new Date().toISOString()),
        workspace: safeString(fallbackRun?.workspace, "Holdstation"),
        status: "completed",
        summary: {},
        actions: [],
        signals: [],
        agents: [],
        reports: [],
        vault: [],
        campaigns: [],
        error: {
          code: "invalid_json",
          message: `runs/${runId}.json is not valid JSON`,
        },
      };
    }

    throw error;
  }
}

async function finalizeRun(runId, { fallbackRun = null } = {}) {
  const run = await readRunCandidate(runId, fallbackRun);

  if (!run) {
    return null;
  }

  const openclaw = await readSafeOpenClawMetadata(runId, run);

  if (!openclaw) {
    return sanitizePublicRun(run);
  }

  const rawRunWithMetadata = {
    ...run,
    openclaw,
  };
  const runWithMetadata = sanitizePublicRun(rawRunWithMetadata);
  const createdAt = safeString(runWithMetadata.created_at, new Date().toISOString());
  const workspace = safeString(runWithMetadata.workspace, "Holdstation");

  if (runWithMetadata.status === "completed") {
    const normalizedRun = sanitizePublicRun(normalizeCompletedRunForValidation({
      ...rawRunWithMetadata,
      run_id: safeString(rawRunWithMetadata.run_id, runId),
      created_at: createdAt,
      workspace,
    }));
    const validation = validateDashboardRunContract(normalizedRun);

    if (validation.valid) {
      return writePublicRunState(normalizedRun, { successful: true });
    }

    const invalidRun = createInvalidOpenClawRun({
      runId,
      createdAt,
      workspace,
      validationErrors: validation.errors,
      originalStatus: run.status,
      openclaw,
    });

    return writePublicRunState(invalidRun);
  }

  if (isRunTimedOut(runWithMetadata)) {
    const timeoutRun = createTimeoutOpenClawRun({
      runId,
      createdAt,
      workspace,
      openclaw,
    });

    return writePublicRunState(timeoutRun);
  }

  return writePublicRunFileAndCurrentLatest(runWithMetadata);
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

  if (isRecord(latest) && typeof latest.run_id === "string" && isSafeRunId(latest.run_id)) {
    const finalized = await finalizeRun(latest.run_id, { fallbackRun: latest });
    jsonResponse(res, 200, finalized ?? sanitizePublicRun(latest));
    return;
  }

  jsonResponse(res, 200, sanitizePublicRun(latest));
}

async function handleRun(res, runId) {
  if (!isSafeRunId(runId)) {
    jsonResponse(res, 400, {
      error: "Invalid run_id",
      code: "invalid_run_id",
    });
    return;
  }

  const run = await finalizeRun(runId);

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
