import {
  CMO_SCHEMA_VERSION,
  type CmoChatRun,
  type CmoChatRunIndexItem,
  type CmoChatRunListResponse,
  type CmoChatRunStatus,
  type CmoRun,
  type CmoRunIndexItem,
  type CmoRunListResponse,
  type CmoStatus,
} from "@/lib/cmo/types";
import { getRemoteAdapterApiKey, getRemoteAdapterUrl } from "@/lib/cmo/config";
import { CmoAdapterError } from "@/lib/cmo/errors";
import { normalizeRun, validateNormalizedRun } from "@/lib/cmo/validation";

const DEFAULT_TIMEOUT_MS = 15_000;

type RemoteJsonResponse<T> = {
  data: T;
  status: number;
};

export type CmoRunBriefResponse =
  | CmoRun
  | {
      schema_version: typeof CMO_SCHEMA_VERSION;
      run_id: string;
      status: string;
      created_at?: string;
      message?: string;
    };

export type CmoRemoteStatus = {
  ok: boolean;
  adapter?: string;
  openclaw_runtime?: string;
  gateway?: string;
  data_dir?: string;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRemoteConfig() {
  const baseUrl = getRemoteAdapterUrl();
  const apiKey = getRemoteAdapterApiKey();

  if (!baseUrl) {
    throw new CmoAdapterError("CMO_REMOTE_ADAPTER_URL is required when CMO_ADAPTER_MODE=remote", 500, "cmo_remote_url_missing");
  }

  if (!apiKey) {
    throw new CmoAdapterError(
      "CMO_REMOTE_ADAPTER_API_KEY is required when CMO_ADAPTER_MODE=remote",
      500,
      "cmo_remote_api_key_missing",
    );
  }

  return { baseUrl, apiKey };
}

function remoteUrl(path: string): string {
  const { baseUrl } = requireRemoteConfig();
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function parseJsonResponse(response: Response, path: string): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CmoAdapterError(`Remote CMO Adapter returned invalid JSON for ${path}`, 502, "cmo_remote_invalid_json");
  }
}

function errorMessageFromPayload(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    const message = payload.error ?? payload.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

async function requestRemoteJson<T>(
  path: string,
  init: {
    method?: "GET" | "POST";
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<RemoteJsonResponse<T>> {
  const { apiKey } = requireRemoteConfig();
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, init.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(remoteUrl(path), {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = await parseJsonResponse(response, path);

    if (!response.ok) {
      throw new CmoAdapterError(
        errorMessageFromPayload(payload, `Remote CMO Adapter request failed for ${path}`),
        response.status,
        "cmo_remote_request_failed",
      );
    }

    return {
      data: payload as T,
      status: response.status,
    };
  } catch (error) {
    if (error instanceof CmoAdapterError) {
      throw error;
    }

    if (didTimeout) {
      throw new CmoAdapterError("Remote CMO Adapter timed out", 504, "cmo_remote_timeout");
    }

    throw new CmoAdapterError("Remote CMO Adapter is unavailable", 503, "cmo_remote_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRemoteRun(payload: unknown, source: string): CmoRun {
  if (!isRecord(payload) || typeof payload.run_id !== "string" || !payload.run_id.trim()) {
    throw new CmoAdapterError(`Remote CMO Adapter ${source} response did not include a valid run_id`, 502, "cmo_remote_invalid_run");
  }

  const run = normalizeRun(payload);
  const validation = validateNormalizedRun(run);

  if (!validation.valid) {
    throw new CmoAdapterError(
      `Remote CMO Adapter ${source} response failed validation: ${validation.errors.join("; ")}`,
      502,
      "cmo_remote_validation_failed",
    );
  }

  return run;
}

function normalizeRunBriefResponse(payload: unknown): CmoRunBriefResponse {
  if (!isRecord(payload) || typeof payload.run_id !== "string" || !payload.run_id.trim()) {
    throw new CmoAdapterError("Remote CMO Adapter run-brief response did not include a valid run_id", 502, "cmo_remote_invalid_run_brief");
  }

  if ("summary" in payload || "actions" in payload || "signals" in payload) {
    return normalizeRemoteRun(payload, "run-brief");
  }

  return {
    schema_version: CMO_SCHEMA_VERSION,
    run_id: payload.run_id,
    status: typeof payload.status === "string" && payload.status.trim() ? payload.status : "running",
    ...(typeof payload.created_at === "string" ? { created_at: payload.created_at } : {}),
    ...(typeof payload.message === "string" ? { message: payload.message } : {}),
  };
}

function normalizeChatStatus(value: unknown): CmoChatRunStatus {
  return value === "completed" || value === "failed" || value === "timeout" || value === "running" ? value : "failed";
}

function normalizeRemoteChatRun(payload: unknown): CmoChatRun {
  if (!isRecord(payload) || typeof payload.chat_run_id !== "string" || !payload.chat_run_id.trim()) {
    throw new CmoAdapterError("Remote CMO Adapter chat response did not include a valid chat_run_id", 502, "cmo_remote_invalid_chat");
  }

  const error = isRecord(payload.error) ? payload.error : null;

  return {
    schema_version: CMO_SCHEMA_VERSION,
    chat_run_id: payload.chat_run_id,
    created_at: typeof payload.created_at === "string" ? payload.created_at : new Date().toISOString(),
    updated_at: typeof payload.updated_at === "string" ? payload.updated_at : new Date().toISOString(),
    status: normalizeChatStatus(payload.status),
    question: typeof payload.question === "string" ? payload.question : "",
    answer: typeof payload.answer === "string" ? payload.answer : "",
    context_run_id: typeof payload.context_run_id === "string" ? payload.context_run_id : null,
    raw_markdown_path: typeof payload.raw_markdown_path === "string" ? payload.raw_markdown_path : "",
    ...(error
      ? {
          error: {
            code: typeof error.code === "string" ? error.code : "cmo_remote_chat_error",
            message: typeof error.message === "string" ? error.message : "Remote CMO chat failed",
          },
        }
      : {}),
  };
}

function normalizeRemoteChatIndexItem(payload: unknown): CmoChatRunIndexItem | null {
  if (!isRecord(payload) || typeof payload.chat_run_id !== "string" || !payload.chat_run_id.trim()) {
    return null;
  }

  return {
    schema_version: CMO_SCHEMA_VERSION,
    chat_run_id: payload.chat_run_id,
    created_at: typeof payload.created_at === "string" ? payload.created_at : new Date().toISOString(),
    updated_at: typeof payload.updated_at === "string" ? payload.updated_at : new Date().toISOString(),
    status: normalizeChatStatus(payload.status),
    question: typeof payload.question === "string" ? payload.question : "",
    context_run_id: typeof payload.context_run_id === "string" ? payload.context_run_id : null,
  };
}

function normalizeRemoteChatList(payload: unknown): CmoChatRunListResponse {
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? payload : null;

  if (!data) {
    throw new CmoAdapterError("Remote CMO Adapter chat list response was not an array", 502, "cmo_remote_invalid_chat_list");
  }

  return {
    schema_version: CMO_SCHEMA_VERSION,
    data: data
      .map(normalizeRemoteChatIndexItem)
      .filter((item): item is CmoChatRunIndexItem => Boolean(item))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
  };
}

function countValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function safeListLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 20;
}

function normalizeRemoteRunIndexItem(payload: unknown): CmoRunIndexItem | null {
  if (!isRecord(payload) || typeof payload.run_id !== "string" || !payload.run_id.trim()) {
    return null;
  }

  return {
    schema_version: CMO_SCHEMA_VERSION,
    run_id: payload.run_id,
    created_at: typeof payload.created_at === "string" ? payload.created_at : new Date(0).toISOString(),
    workspace: typeof payload.workspace === "string" && payload.workspace.trim() ? payload.workspace : "Holdstation",
    status: (typeof payload.status === "string" && payload.status.trim() ? payload.status : "mock") as CmoStatus,
    title: typeof payload.title === "string" && payload.title.trim() ? payload.title : "CMO Brief",
    actions_count: countValue(payload.actions_count),
    signals_count: countValue(payload.signals_count),
    agents_count: countValue(payload.agents_count),
    campaigns_count: countValue(payload.campaigns_count),
    reports_count: countValue(payload.reports_count),
    vault_count: countValue(payload.vault_count),
    has_error: payload.has_error === true,
  };
}

function normalizeRemoteRunList(payload: unknown, fallbackLimit: number): CmoRunListResponse {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new CmoAdapterError("Remote CMO Adapter run list response was not a valid object", 502, "cmo_remote_invalid_run_list");
  }

  const data = payload.data
    .map(normalizeRemoteRunIndexItem)
    .filter((item): item is CmoRunIndexItem => Boolean(item))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return {
    schema_version: CMO_SCHEMA_VERSION,
    data,
    total: typeof payload.total === "number" && Number.isFinite(payload.total) ? Math.max(0, Math.floor(payload.total)) : data.length,
    limit: typeof payload.limit === "number" && Number.isFinite(payload.limit) ? Math.max(1, Math.min(100, Math.floor(payload.limit))) : fallbackLimit,
  };
}

export async function postRemoteRunBrief(body: unknown): Promise<RemoteJsonResponse<CmoRunBriefResponse>> {
  const response = await requestRemoteJson<unknown>("/cmo/run-brief", {
    method: "POST",
    body,
  });

  return {
    data: normalizeRunBriefResponse(response.data),
    status: response.status,
  };
}

export async function postRemoteChat(body: unknown): Promise<RemoteJsonResponse<CmoChatRun>> {
  const response = await requestRemoteJson<unknown>("/cmo/chat", {
    method: "POST",
    body,
  });

  return {
    data: normalizeRemoteChatRun(response.data),
    status: response.status,
  };
}

export async function getRemoteChat(chatRunId: string): Promise<CmoChatRun> {
  const response = await requestRemoteJson<unknown>(`/cmo/chat/${encodeURIComponent(chatRunId)}`);
  return normalizeRemoteChatRun(response.data);
}

export async function getRemoteChats(limit = 20): Promise<CmoChatRunListResponse> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const response = await requestRemoteJson<unknown>(`/cmo/chat?limit=${safeLimit}`);
  return normalizeRemoteChatList(response.data);
}

export async function getRemoteLatestRun(): Promise<CmoRun> {
  const response = await requestRemoteJson<unknown>("/cmo/latest");
  return normalizeRemoteRun(response.data, "latest");
}

export async function getRemoteRun(runId: string): Promise<CmoRun> {
  const response = await requestRemoteJson<unknown>(`/cmo/runs/${encodeURIComponent(runId)}`);
  return normalizeRemoteRun(response.data, `runs/${runId}`);
}

export async function getRemoteRuns(limit = 20): Promise<CmoRunListResponse> {
  const safeLimit = safeListLimit(limit);
  const response = await requestRemoteJson<unknown>(`/cmo/runs?limit=${safeLimit}`);
  return normalizeRemoteRunList(response.data, safeLimit);
}

export async function getRemoteStatus(): Promise<CmoRemoteStatus> {
  const response = await requestRemoteJson<unknown>("/cmo/status", {
    timeoutMs: 5_000,
  });

  if (!isRecord(response.data)) {
    throw new CmoAdapterError("Remote CMO Adapter status response was not an object", 502, "cmo_remote_invalid_status");
  }

  return {
    ok: response.data.ok === true,
    ...response.data,
  };
}
