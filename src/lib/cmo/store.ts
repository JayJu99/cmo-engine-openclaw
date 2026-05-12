import { randomUUID } from "crypto";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import path from "path";

import {
  CMO_SCHEMA_VERSION,
  type CmoRawOutput,
  type CmoRun,
  type CmoRunIndexItem,
} from "@/lib/cmo/types";
import { createFallbackRun, normalizeRun, validateNormalizedRun } from "@/lib/cmo/validation";

const DATA_DIR = path.join(process.cwd(), "data");
const RUNS_DIR = path.join(DATA_DIR, "runs");
const RAW_DIR = path.join(DATA_DIR, "raw");
const LATEST_PATH = path.join(DATA_DIR, "latest.json");
const LATEST_SUCCESSFUL_PATH = path.join(DATA_DIR, "latest_successful.json");

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runPath(runId: string) {
  return path.join(RUNS_DIR, `${runId}.json`);
}

function rawPath(runId: string) {
  return path.join(RAW_DIR, `${runId}.json`);
}

function isSafeRunId(runId: string) {
  return /^[A-Za-z0-9_.-]+$/.test(runId);
}

function summarizeRun(run: CmoRun): CmoRunIndexItem {
  return {
    schema_version: CMO_SCHEMA_VERSION,
    run_id: run.run_id,
    created_at: run.created_at,
    workspace: run.workspace,
    status: run.status,
    action_count: run.actions.length,
    signal_count: run.signals.length,
  };
}

export async function readLatestRun(): Promise<CmoRun> {
  const latest = await readJsonFile(LATEST_PATH);
  return latest ? normalizeRun(latest) : createFallbackRun();
}

export async function readLatestSuccessfulRun(): Promise<CmoRun> {
  const latestSuccessful = await readJsonFile(LATEST_SUCCESSFUL_PATH);
  return latestSuccessful ? normalizeRun(latestSuccessful) : readLatestRun();
}

export async function readRun(runId: string): Promise<CmoRun | null> {
  if (!isSafeRunId(runId)) {
    return null;
  }

  const run = await readJsonFile(runPath(runId));
  return run ? normalizeRun(run) : null;
}

export async function readRawOutput(runId: string): Promise<CmoRawOutput | null> {
  if (!isSafeRunId(runId)) {
    return null;
  }

  const rawOutput = await readJsonFile(rawPath(runId));
  return rawOutput as CmoRawOutput | null;
}

export async function writeRawOutput(rawOutput: CmoRawOutput): Promise<void> {
  await writeJsonFile(rawPath(rawOutput.run_id), rawOutput);
}

async function writeNormalizedRun(run: CmoRun): Promise<void> {
  // Normalized output is the stable dashboard contract consumed by API routes
  // and pages. It is safe to render only after validation passes.
  const validation = validateNormalizedRun(run);

  await writeJsonFile(runPath(run.run_id), run);
  await writeJsonFile(LATEST_PATH, run);

  if (run.status === "completed" && validation.valid) {
    await writeJsonFile(LATEST_SUCCESSFUL_PATH, run);
  }
}

export async function readRuns(): Promise<CmoRunIndexItem[]> {
  try {
    const files = await readdir(RUNS_DIR);
    const runs = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => normalizeRun(await readJsonFile(path.join(RUNS_DIR, file)))),
    );

    return runs
      .map(summarizeRun)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  } catch {
    return [summarizeRun(await readLatestRun())];
  }
}

export async function createMockRun(): Promise<CmoRun> {
  const previous = await readLatestRun();
  const now = new Date();
  const runId = `run_${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const rawOutput: CmoRawOutput = {
    schema_version: CMO_SCHEMA_VERSION,
    run_id: runId,
    captured_at: now.toISOString(),
    source: "mock",
    runtime: "cmo-adapter/mock-run-brief",
    // Raw output is intentionally shaped like an unstable runtime payload. Future
    // OpenClaw output should be captured here before mapping to dashboard JSON.
    payload: {
      adapter_note: "Mock raw output captured before OpenClaw Gateway integration.",
      dashboard_contract_candidate: {
        ...previous,
        schema_version: CMO_SCHEMA_VERSION,
        run_id: runId,
        created_at: now.toISOString(),
        status: "completed",
        summary: {
          ...previous.summary,
          schema_version: CMO_SCHEMA_VERSION,
          title: "Mock CMO Brief",
          next_action: "Review generated mock run before OpenClaw gateway integration",
        },
      },
    },
  };

  await writeRawOutput(rawOutput);

  const payload =
    typeof rawOutput.payload === "object" && rawOutput.payload !== null
      ? (rawOutput.payload as Record<string, unknown>)
      : {};
  const run = normalizeRun(payload.dashboard_contract_candidate);
  const normalizedRun: CmoRun = {
    ...run,
    schema_version: CMO_SCHEMA_VERSION,
    run_id: runId,
    created_at: now.toISOString(),
    status: "completed",
    summary: {
      ...run.summary,
      schema_version: CMO_SCHEMA_VERSION,
    },
  };

  await writeNormalizedRun(normalizedRun);

  return normalizedRun;
}
