import { exec, execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const workspaceRoot = process.cwd();
const appId = "holdstation-mini-app";
const channel = "facebook";
const normalizedOutputPath = path.join(workspaceRoot, "data", "cmo-dashboard", "channel-metrics", appId, "facebook.json");
const syncStatusPath = path.join(workspaceRoot, "data", "cmo-dashboard", "channel-metrics", appId, "facebook-sync-status.json");
const normalizedOutputDisplayPath = path.relative(workspaceRoot, normalizedOutputPath).replace(/\\/g, "/");
const lensOutputPath = process.env.CMO_LENS_FACEBOOK_OUTPUT_PATH || "/home/ju/.openclaw/workspace/knowledge/holdstation/07 Knowledge/Data/facebook-page/processed/cmo-channel-metrics-facebook.json";
const lensRunCommand = process.env.CMO_LENS_FACEBOOK_RUN_COMMAND?.trim() || "";
const startedAt = new Date().toISOString();
const previousStatus = await readPreviousStatus();

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function syncStatusFromSnapshot(snapshot) {
  if (snapshot?.status === "connected") {
    return "success";
  }

  if (snapshot?.status === "partial") {
    return "partial";
  }

  return "skipped";
}

function metricIds(snapshot, mode) {
  if (Array.isArray(snapshot?.diagnostics?.[mode])) {
    return stringArray(snapshot.diagnostics[mode]);
  }

  if (!Array.isArray(snapshot?.metrics)) {
    return [];
  }

  if (mode === "availableMetrics") {
    return snapshot.metrics.filter((metric) => typeof metric?.value === "number" && Number.isFinite(metric.value)).map((metric) => metric.id).filter(Boolean);
  }

  return snapshot.metrics.filter((metric) => metric?.value === null || metric?.value === undefined).map((metric) => metric.id).filter(Boolean);
}

function safeErrorMessage(error, stage) {
  const code = typeof error?.code === "number" || typeof error?.code === "string" ? ` (${error.code})` : "";
  return `${stage} failed${code}. Check service logs for command output.`;
}

async function runShellCommand(command, stage) {
  try {
    await execAsync(command, {
      cwd: workspaceRoot,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(safeErrorMessage(error, stage));
  }
}

async function runNodeScript(script, stage) {
  try {
    await execFileAsync(process.execPath, [script], {
      cwd: workspaceRoot,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(safeErrorMessage(error, stage));
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readPreviousStatus() {
  try {
    const value = await readJson(syncStatusPath);

    if (value?.schemaVersion === "cmo.channel-metrics-sync-status.v1" && value?.appId === appId && value?.channel === channel) {
      return value;
    }
  } catch {
    return null;
  }

  return null;
}

async function writeStatus(status) {
  await mkdir(path.dirname(syncStatusPath), { recursive: true });
  const tempPath = `${syncStatusPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  await rename(tempPath, syncStatusPath);
}

async function readSnapshotSafely() {
  try {
    return await readJson(normalizedOutputPath);
  } catch {
    return null;
  }
}

function buildStatus({ status, snapshot, finishedAt, lastErrorMessage = null, notes }) {
  const succeeded = status === "success" || status === "partial";

  return {
    schemaVersion: "cmo.channel-metrics-sync-status.v1",
    appId,
    channel,
    status,
    lastStartedAt: startedAt,
    lastFinishedAt: finishedAt,
    lastSuccessAt: succeeded ? finishedAt : previousStatus?.lastSuccessAt ?? null,
    lastErrorAt: status === "failed" ? finishedAt : previousStatus?.lastErrorAt ?? null,
    lastErrorMessage,
    normalizedOutputPath: normalizedOutputDisplayPath,
    lensOutputPath,
    availableMetrics: metricIds(snapshot, "availableMetrics"),
    missingMetrics: metricIds(snapshot, "missingMetrics"),
    notes,
  };
}

try {
  const notes = [];

  if (lensRunCommand) {
    notes.push("CMO_LENS_FACEBOOK_RUN_COMMAND configured; Lens pipeline command executed before normalization.");
    await runShellCommand(lensRunCommand, "lens_pipeline");
  } else {
    notes.push("CMO_LENS_FACEBOOK_RUN_COMMAND is not configured; ran normalize-only/manual refresh mode.");
  }

  await runNodeScript("scripts/cmo-lens-facebook-normalize.mjs", "normalizer");
  const snapshot = await readSnapshotSafely();
  await runNodeScript("scripts/cmo-channel-metrics-contract-check.mjs", "contract_check");

  const finishedAt = new Date().toISOString();
  const status = syncStatusFromSnapshot(snapshot);
  const syncStatus = buildStatus({
    status,
    snapshot,
    finishedAt,
    notes: [
      ...notes,
      status === "skipped" ? "No usable Lens Facebook metrics are available yet." : "Channel metrics normalized and contract check passed.",
      ...(isRecord(snapshot?.diagnostics) ? stringArray(snapshot.diagnostics.notes).slice(0, 4) : []),
    ],
  });

  await writeStatus(syncStatus);
  console.log(JSON.stringify({ ok: true, status: syncStatus.status, lastSuccessAt: syncStatus.lastSuccessAt, availableMetrics: syncStatus.availableMetrics, missingMetrics: syncStatus.missingMetrics }, null, 2));
} catch (error) {
  const finishedAt = new Date().toISOString();
  const snapshot = await readSnapshotSafely();
  const lastErrorMessage = error instanceof Error ? error.message : "Lens Facebook sync failed.";
  const syncStatus = buildStatus({
    status: "failed",
    snapshot,
    finishedAt,
    lastErrorMessage,
    notes: [
      lensRunCommand ? "Lens pipeline command was configured, but sync did not complete." : "Normalize-only/manual refresh mode did not complete.",
      "Existing normalized Facebook channel metrics were left in place.",
    ],
  });

  await writeStatus(syncStatus);
  console.error(JSON.stringify({ ok: false, status: syncStatus.status, lastErrorMessage: syncStatus.lastErrorMessage }, null, 2));
  process.exit(1);
}
