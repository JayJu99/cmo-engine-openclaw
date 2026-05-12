import { CMO_SCHEMA_VERSION, type CmoRun } from "@/lib/cmo/types";
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

export async function getRemoteLatestRun(): Promise<CmoRun> {
  const response = await requestRemoteJson<unknown>("/cmo/latest");
  return normalizeRemoteRun(response.data, "latest");
}

export async function getRemoteRun(runId: string): Promise<CmoRun> {
  const response = await requestRemoteJson<unknown>(`/cmo/runs/${encodeURIComponent(runId)}`);
  return normalizeRemoteRun(response.data, `runs/${runId}`);
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
