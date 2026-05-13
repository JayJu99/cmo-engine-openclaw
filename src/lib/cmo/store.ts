import { randomUUID } from "crypto";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import path from "path";

import {
  CMO_SCHEMA_VERSION,
  type CmoChatRun,
  type CmoRawOutput,
  type CmoRun,
  type CmoRunIndexItem,
} from "@/lib/cmo/types";
import { createFallbackRun, normalizeRun, validateNormalizedRun } from "@/lib/cmo/validation";

const DATA_DIR = path.join(process.cwd(), "data");
const RUNS_DIR = path.join(DATA_DIR, "runs");
const RAW_DIR = path.join(DATA_DIR, "raw");
const CMO_DASHBOARD_DATA_DIR = path.join(DATA_DIR, "cmo-dashboard");
const CHAT_DIR = path.join(CMO_DASHBOARD_DATA_DIR, "chat");
const CHAT_RAW_DIR = path.join(CHAT_DIR, "raw");
const LATEST_PATH = path.join(DATA_DIR, "latest.json");
const LATEST_SUCCESSFUL_PATH = path.join(DATA_DIR, "latest_successful.json");
const LOCAL_CHAT_MIN_RUNNING_MS = 1_500;
const LOCAL_CHAT_TIMEOUT_MS = 15 * 60 * 1000;

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

async function writeTextFile(filePath: string, value: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

function runPath(runId: string) {
  return path.join(RUNS_DIR, `${runId}.json`);
}

function rawPath(runId: string) {
  return path.join(RAW_DIR, `${runId}.json`);
}

function chatPath(chatRunId: string) {
  return path.join(CHAT_DIR, `${chatRunId}.json`);
}

function chatRawPath(chatRunId: string) {
  return path.join(CHAT_RAW_DIR, `${chatRunId}.md`);
}

function relativeDataPath(filePath: string) {
  return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}

function isSafeRunId(runId: string) {
  return /^[A-Za-z0-9_.-]+$/.test(runId);
}

function isSafeChatRunId(chatRunId: string) {
  return /^[A-Za-z0-9_.-]+$/.test(chatRunId);
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

function questionFromPayload(body: unknown): string {
  if (typeof body === "string") {
    return body.trim();
  }

  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    const value = record.question ?? record.message ?? record.input;

    if (typeof value === "string") {
      return value.trim();
    }
  }

  return "";
}

function conciseLocalAnswer(question: string, context: CmoRun): string {
  const highAction = context.actions.find((action) => action.priority === "High") ?? context.actions[0];
  const signal = context.signals[0];
  const campaign = context.campaigns[0];
  const vault = context.vault[0];

  return [
    `For "${question}", focus on ${context.summary.top_opportunity}.`,
    highAction ? `Next action: ${highAction.title} - ${highAction.summary}` : `Next action: ${context.summary.next_action}.`,
    signal ? `Watch signal: ${signal.title}.` : `Risk to watch: ${context.summary.risk}.`,
    campaign ? `Campaign priority: ${campaign.name} (${campaign.stage}) - ${campaign.next_action}.` : null,
    vault ? `Use vault context from ${vault.name} when making the final call.` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function normalizeChatRun(value: unknown): CmoChatRun | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const chatRunId = typeof record.chat_run_id === "string" ? record.chat_run_id : "";

  if (!chatRunId || !isSafeChatRunId(chatRunId)) {
    return null;
  }

  const status = record.status;
  const normalizedStatus =
    status === "completed" || status === "failed" || status === "timeout" || status === "running"
      ? status
      : "failed";
  const error = typeof record.error === "object" && record.error !== null && !Array.isArray(record.error)
    ? (record.error as Record<string, unknown>)
    : null;

  return {
    schema_version: CMO_SCHEMA_VERSION,
    chat_run_id: chatRunId,
    created_at: typeof record.created_at === "string" ? record.created_at : new Date().toISOString(),
    updated_at: typeof record.updated_at === "string" ? record.updated_at : new Date().toISOString(),
    status: normalizedStatus,
    question: typeof record.question === "string" ? record.question : "",
    answer: typeof record.answer === "string" ? record.answer : "",
    context_run_id: typeof record.context_run_id === "string" ? record.context_run_id : null,
    raw_markdown_path: typeof record.raw_markdown_path === "string" ? record.raw_markdown_path : relativeDataPath(chatRawPath(chatRunId)),
    ...(error
      ? {
          error: {
            code: typeof error.code === "string" ? error.code : "chat_error",
            message: typeof error.message === "string" ? error.message : "CMO chat failed",
          },
        }
      : {}),
  };
}

async function finalizeLocalChatRun(chatRun: CmoChatRun): Promise<CmoChatRun> {
  if (chatRun.status !== "running") {
    return chatRun;
  }

  const createdAtMs = Date.parse(chatRun.created_at);
  const elapsedMs = Number.isNaN(createdAtMs) ? LOCAL_CHAT_TIMEOUT_MS : Date.now() - createdAtMs;

  if (elapsedMs < LOCAL_CHAT_MIN_RUNNING_MS) {
    return chatRun;
  }

  const now = new Date().toISOString();

  if (elapsedMs > LOCAL_CHAT_TIMEOUT_MS) {
    const timeoutRun: CmoChatRun = {
      ...chatRun,
      status: "timeout",
      updated_at: now,
      error: {
        code: "cmo_chat_timeout",
        message: "CMO chat run timed out before completion",
      },
    };

    await writeJsonFile(chatPath(chatRun.chat_run_id), timeoutRun);
    return timeoutRun;
  }

  try {
    const context = await readLatestSuccessfulRun();
    const answer = conciseLocalAnswer(chatRun.question, context);
    const completedRun: CmoChatRun = {
      ...chatRun,
      status: "completed",
      updated_at: now,
      answer,
      context_run_id: context.run_id,
    };

    await writeTextFile(chatRawPath(chatRun.chat_run_id), `${answer}\n`);
    await writeJsonFile(chatPath(chatRun.chat_run_id), completedRun);
    return completedRun;
  } catch (error) {
    const failedRun: CmoChatRun = {
      ...chatRun,
      status: "failed",
      updated_at: now,
      error: {
        code: "cmo_chat_local_failed",
        message: error instanceof Error ? error.message : "Local CMO chat failed",
      },
    };

    await writeJsonFile(chatPath(chatRun.chat_run_id), failedRun);
    return failedRun;
  }
}

export async function createLocalChatRun(body: unknown): Promise<CmoChatRun> {
  const question = questionFromPayload(body);

  if (!question) {
    throw new Error("Question is required");
  }

  const now = new Date().toISOString();
  const chatRunId = `chat_${now.replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const latest = await readLatestRun();
  const chatRun: CmoChatRun = {
    schema_version: CMO_SCHEMA_VERSION,
    chat_run_id: chatRunId,
    created_at: now,
    updated_at: now,
    status: "running",
    question,
    answer: "",
    context_run_id: latest.run_id,
    raw_markdown_path: relativeDataPath(chatRawPath(chatRunId)),
  };

  await writeJsonFile(chatPath(chatRunId), chatRun);

  return chatRun;
}

export async function readLocalChatRun(chatRunId: string): Promise<CmoChatRun | null> {
  if (!isSafeChatRunId(chatRunId)) {
    return null;
  }

  const chatRun = normalizeChatRun(await readJsonFile(chatPath(chatRunId)));

  if (!chatRun) {
    return null;
  }

  return finalizeLocalChatRun(chatRun);
}
