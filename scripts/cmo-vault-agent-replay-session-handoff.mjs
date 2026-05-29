import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path, { join } from "node:path";

const APP_CHAT_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "app-chat");
const HERMES_VAULT_AGENT_DRY_RUN_PATH = "/agents/vault-agent/dry-run";
const temp = mkdtempSync(join(tmpdir(), "cmo-vault-agent-replay-"));
const dist = join(temp, "dist");
const requireFromScript = createRequire(import.meta.url);
const tscBin = join("node_modules", "typescript", "bin", "tsc");

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) {
    return undefined;
  }

  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  return { key: match[1], value };
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (parsed && process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env"]) {
    loadEnvFile(path.join(process.cwd(), fileName));
  }
}

function latestSessionId() {
  const files = readdirSync(APP_CHAT_DIR)
    .filter((file) => /^session_.*\.json$/.test(file))
    .map((file) => ({
      file,
      mtimeMs: statSync(path.join(APP_CHAT_DIR, file)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return files[0]?.file.replace(/\.json$/, "");
}

function sessionPath(sessionId) {
  const safeSessionId = sessionId.replace(/[^A-Za-z0-9_-]/g, "");
  if (!safeSessionId || safeSessionId !== sessionId) {
    throw new Error("SESSION_ID must contain only letters, numbers, underscore, or hyphen.");
  }

  return path.join(APP_CHAT_DIR, `${safeSessionId}.json`);
}

function workspaceIdForApp(appId) {
  const registrySource = readFileSync(path.join(process.cwd(), "src", "lib", "cmo", "workspace-registry.ts"), "utf8");
  const matches = [...registrySource.matchAll(/workspaceId:\s*"([^"]+)"[\s\S]*?appId:\s*"([^"]+)"/g)];
  const entry = matches
    .map((match) => ({ workspaceId: match[1], appId: match[2] }))
    .find((candidate) => candidate.appId === appId);

  return entry?.workspaceId;
}

function findReplayTurn(session) {
  const messages = Array.isArray(session.messages) ? session.messages.filter(isRecord) : [];
  const assistantIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === "assistant" && stringValue(message.content))?.index;

  if (assistantIndex === undefined) {
    throw new Error("Session has no assistant message to replay.");
  }

  const assistant = messages[assistantIndex];
  const sourceUserMessageId = stringValue(assistant.sourceUserMessageId);
  const user = sourceUserMessageId
    ? messages.find((message) => message.id === sourceUserMessageId && message.role === "user")
    : [...messages.slice(0, assistantIndex)].reverse().find((message) => message.role === "user" && stringValue(message.content));

  if (!user || !stringValue(user.id) || !stringValue(user.content)) {
    throw new Error("Session has no matching user message for the replayed assistant turn.");
  }

  return {
    user,
    assistant,
    userMessageId: stringValue(user.id),
    assistantMessageId: stringValue(assistant.id),
  };
}

function sanitizeList(value) {
  return Array.isArray(value) ? value : undefined;
}

function buildReplayInput(session) {
  const turn = findReplayTurn(session);
  const appId = stringValue(session.appId);
  const appName = stringValue(session.appName) ?? "Selected app";
  const workspaceId = stringValue(session.workspaceId) ?? workspaceIdForApp(appId);

  if (!appId) {
    throw new Error("Session is missing appId.");
  }

  if (!workspaceId) {
    throw new Error(`Unable to infer workspaceId for appId ${appId}.`);
  }

  return {
    request: {
      workspaceId,
      appId,
      appName,
      sessionId: stringValue(session.id),
      message: stringValue(turn.user.content),
      topic: stringValue(session.topic),
      context: {
        mode: "app_context",
        selectedNotes: sanitizeList(session.contextUsed) ?? [],
      },
    },
    session,
    userIdentity: {
      authMode: stringValue(session.authMode) ?? stringValue(turn.user.authMode) ?? "server",
      ...(stringValue(session.userId) ?? stringValue(turn.user.userId) ? { userId: stringValue(session.userId) ?? stringValue(turn.user.userId) } : {}),
      ...(stringValue(session.userEmail) ?? stringValue(turn.user.userEmail) ? { userEmail: stringValue(session.userEmail) ?? stringValue(turn.user.userEmail) } : {}),
      ...(stringValue(session.createdByUserId) ? { createdByUserId: stringValue(session.createdByUserId) } : {}),
      ...(stringValue(session.createdByEmail) ? { createdByEmail: stringValue(session.createdByEmail) } : {}),
      ...(stringValue(session.organizationId) ? { organizationId: stringValue(session.organizationId) } : {}),
    },
    userMessageId: turn.userMessageId,
    assistantMessageId: turn.assistantMessageId,
    answer: stringValue(turn.assistant.content),
    createdAt: stringValue(turn.assistant.createdAt) ?? stringValue(session.updatedAt) ?? new Date(0).toISOString(),
    activityEvents: sanitizeList(turn.assistant.activityEvents) ?? sanitizeList(session.activityEvents) ?? [],
    delegationSummary: sanitizeList(turn.assistant.delegationSummary) ?? sanitizeList(session.delegationSummary) ?? [],
    agentsUsed: sanitizeList(turn.assistant.agentsUsed) ?? sanitizeList(session.agentsUsed) ?? ["cmo"],
    surfCalls: typeof turn.assistant.surfCalls === "number" ? turn.assistant.surfCalls : session.surfCalls,
    echoCalls: typeof turn.assistant.echoCalls === "number" ? turn.assistant.echoCalls : session.echoCalls,
  };
}

function compileHandoffBuilder() {
  execFileSync(process.execPath, [
    tscBin,
    "--target",
    "ES2022",
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--esModuleInterop",
    "--skipLibCheck",
    "--strict",
    "--outDir",
    dist,
    path.join("src", "lib", "cmo", "app-workspace-types.ts"),
    path.join("src", "lib", "cmo", "config.ts"),
    path.join("src", "lib", "cmo", "user-metadata.ts"),
    path.join("src", "lib", "cmo", "vault-agent-contracts.ts"),
    path.join("src", "lib", "cmo", "vault-scope-policy.ts"),
    path.join("src", "lib", "cmo", "vault-agent-dry-run.ts"),
    path.join("src", "lib", "cmo", "vault-agent-remote-client.ts"),
    path.join("src", "lib", "cmo", "vault-agent-handoff-builder.ts"),
  ], { stdio: "inherit" });

  return requireFromScript(join(dist, "vault-agent-handoff-builder.js"));
}

function keyPresence(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, Object.prototype.hasOwnProperty.call(object, key)]));
}

function packageDiagnostics(pkg) {
  return {
    top_level_keys: Object.keys(pkg).sort(),
    schema_version_presence: keyPresence(pkg, ["schema_version", "schemaVersion"]),
    schema_version_value: pkg.schema_version ?? pkg.schemaVersion ?? null,
    tenant_id_presence: keyPresence(pkg, ["tenant_id", "tenantId"]),
    workspace_id_presence: keyPresence(pkg, ["workspace_id", "workspaceId"]),
    user_presence: keyPresence(pkg, ["user_id", "userId", "user_ref", "userRef"]),
    session_id_presence: keyPresence(pkg, ["session_id", "sessionId"]),
    turn_or_message_presence: keyPresence(pkg, ["turn_id", "turnId", "message_id", "messageId"]),
    no_auto_promote_presence: keyPresence(pkg, ["no_auto_promote", "noAutoPromote"]),
    no_auto_promote_value: pkg.no_auto_promote ?? pkg.noAutoPromote ?? null,
    truth_status: pkg.truth_status ?? pkg.truthStatus ?? null,
    review_status: pkg.review_status ?? pkg.reviewStatus ?? null,
    canonical_language: pkg.canonical_language ?? pkg.canonicalLanguage ?? null,
    scope: pkg.scope ?? null,
    safety_keys: isRecord(pkg.safety) ? Object.keys(pkg.safety).sort() : [],
  };
}

function responseDiagnostics(httpStatus, payload) {
  const frontmatter = isRecord(payload?.frontmatter_preview) ? payload.frontmatter_preview : undefined;

  return {
    http_status: httpStatus,
    schema_version: payload?.schema_version,
    status: payload?.status,
    errors: payload?.errors ?? payload?.validation_errors ?? [],
    warnings: payload?.warnings ?? payload?.validation_warnings ?? [],
    record_id_exists: typeof payload?.record_id === "string" && payload.record_id.length > 0,
    target_path_preview_exists: typeof payload?.target_path_preview === "string" && payload.target_path_preview.length > 0,
    frontmatter_preview: {
      no_auto_promote: frontmatter?.no_auto_promote ?? null,
      truth_status: frontmatter?.truth_status ?? null,
      review_status: frontmatter?.review_status ?? null,
      scope: frontmatter?.scope ?? null,
      canonical_language: frontmatter?.canonical_language ?? null,
    },
  };
}

function compactJson(value) {
  return JSON.stringify(value, null, 2);
}

async function postHermesDryRun(pkg) {
  const baseUrl = (process.env.CMO_HERMES_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.CMO_HERMES_API_KEY ?? "").trim();
  const timeoutMs = Number.parseInt(process.env.CMO_HERMES_TIMEOUT_MS ?? "", 10) > 0
    ? Number.parseInt(process.env.CMO_HERMES_TIMEOUT_MS, 10)
    : 30_000;

  if (!baseUrl) {
    throw new Error("CMO_HERMES_BASE_URL is not configured.");
  }

  if (!apiKey) {
    throw new Error("CMO_HERMES_API_KEY is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${HERMES_VAULT_AGENT_DRY_RUN_PATH}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(pkg),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;

    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { parse_error: "Hermes returned non-JSON response." };
    }

    return { httpStatus: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function inferMismatch(pkg, response) {
  const responseErrors = response.errors;
  if (Array.isArray(responseErrors) && responseErrors.length) {
    return "Hermes returned explicit errors; fix should follow those fields.";
  }

  if (response.status === "rejected") {
    const missing = [];
    if (!pkg.no_auto_promote) missing.push("no_auto_promote");
    if ((pkg.canonical_language ?? pkg.canonicalLanguage) !== "en") missing.push("canonical_language=en");
    if (!pkg.tenant_id && !pkg.tenantId) missing.push("tenant_id");
    if (!pkg.workspace_id && !pkg.workspaceId) missing.push("workspace_id");
    if (!pkg.session_id && !pkg.sessionId) missing.push("session_id");
    if (!pkg.user_id && !pkg.userId && !pkg.user_ref && !pkg.userRef) missing.push("user_id/user_ref");

    return missing.length
      ? `CMO Engine package builder is missing required package fields: ${missing.join(", ")}.`
      : "Hermes rejected without errors while required package fields are present; likely Hermes normalization/rejection reporting.";
  }

  return "No missing/mismatched package field detected by replay diagnostics.";
}

async function main() {
  loadLocalEnv();

  const requestedSessionId = process.env.SESSION_ID?.trim() || latestSessionId();
  if (!requestedSessionId) {
    throw new Error("Set SESSION_ID or add a session JSON under data/cmo-dashboard/app-chat.");
  }

  const filePath = sessionPath(requestedSessionId);
  if (!existsSync(filePath)) {
    throw new Error(`Session JSON not found: data/cmo-dashboard/app-chat/${requestedSessionId}.json`);
  }

  const session = readJson(filePath);
  const { buildTurnCompletedPackage } = compileHandoffBuilder();
  const replayInput = buildReplayInput(session);
  const pkg = buildTurnCompletedPackage(replayInput);

  console.log("Session replay:", {
    session_id: requestedSessionId,
    session_json_found: true,
    hermes_base_url_configured: Boolean((process.env.CMO_HERMES_BASE_URL ?? "").trim()),
    hermes_api_key_configured: Boolean((process.env.CMO_HERMES_API_KEY ?? "").trim()),
  });
  console.log("Safe package diagnostics:");
  console.log(compactJson(packageDiagnostics(pkg)));

  const { httpStatus, payload } = await postHermesDryRun(pkg);
  const safeResponse = responseDiagnostics(httpStatus, payload);

  console.log("Safe Hermes response diagnostics:");
  console.log(compactJson(safeResponse));

  if (safeResponse.status === "rejected" && Array.isArray(safeResponse.errors) && safeResponse.errors.length === 0) {
    console.log("Hermes rejected without errors");
  }

  console.log("Mismatch inference:");
  console.log(inferMismatch(pkg, safeResponse));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => {
  rmSync(temp, { recursive: true, force: true });
});
