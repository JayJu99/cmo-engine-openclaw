import type { CMOAppChatResponse, CMOChatMessage, CMOContextPackage } from "@/lib/cmo/app-workspace-types";
import type { CmoChatRun } from "@/lib/cmo/types";
import {
  getCmoAppTurnRequestTimeoutMs,
  getOpenClawApiKey,
  getOpenClawCmoEndpoint,
  getOpenClawCmoTimeoutMs,
  getRemoteAdapterApiKey,
  getRemoteAdapterUrl,
  isRemoteCmoAdapter,
} from "@/lib/cmo/config";
import { CmoAdapterError } from "@/lib/cmo/errors";
import { getRemoteChat, getRemoteStatus, postRemoteAppTurn, postRemoteChat } from "@/lib/cmo/remote-client";

type RuntimeKind = "openclaw-cmo-endpoint" | "vps-cmo-adapter";

export interface OpenClawCmoRuntimeConfig {
  kind: RuntimeKind;
  label: string;
  endpoint: string;
  apiKey: string;
  statusEndpoint?: string;
}

export interface OpenClawCmoRuntimeAvailability {
  status: "connected" | "configured_but_unreachable" | "development_fallback" | "runtime_error" | "not_configured";
  label: string;
  reason?: string;
  config?: OpenClawCmoRuntimeConfig;
}

export interface OpenClawCmoResult {
  answer: string;
  assumptions: string[];
  suggestedActions: CMOAppChatResponse["suggestedActions"];
  contextUsed: string[];
  rawRuntimeResponse?: unknown;
  isDevelopmentFallback: false;
  runtimeLabel: string;
  runtimeRunId?: string;
}

interface RuntimeJsonResponse<T> {
  data: T;
  status: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 1_500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function withEndpointPath(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function withEndpointOrigin(endpoint: string, path: string): string {
  try {
    const url = new URL(endpoint);

    return `${url.origin}${path.startsWith("/") ? path : `/${path}`}`;
  } catch {
    return withEndpointPath(endpoint, path);
  }
}

export function getOpenClawCmoRuntimeConfig(): OpenClawCmoRuntimeConfig | null {
  const remoteAdapterUrl = getRemoteAdapterUrl();
  const remoteAdapterApiKey = getRemoteAdapterApiKey();

  if (isRemoteCmoAdapter()) {
    if (!remoteAdapterUrl || !remoteAdapterApiKey) {
      return null;
    }

    return {
      kind: "vps-cmo-adapter",
      label: "VPS CMO Adapter",
      endpoint: withEndpointPath(remoteAdapterUrl, "/cmo/chat"),
      statusEndpoint: withEndpointPath(remoteAdapterUrl, "/cmo/status"),
      apiKey: remoteAdapterApiKey,
    };
  }

  const explicitEndpoint = getOpenClawCmoEndpoint();

  if (explicitEndpoint) {
    return {
      kind: "openclaw-cmo-endpoint",
      label: "OpenClaw CMO endpoint",
      endpoint: explicitEndpoint,
      apiKey: getOpenClawApiKey(),
    };
  }

  return null;
}

async function parseRuntimeJson(response: Response, endpoint: string): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CmoAdapterError(`OpenClaw CMO runtime returned invalid JSON from ${endpoint}`, 502, "openclaw_cmo_invalid_json");
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

async function requestRuntimeJson<T>(
  config: OpenClawCmoRuntimeConfig,
  endpoint: string,
  init: {
    method?: "GET" | "POST";
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<RuntimeJsonResponse<T>> {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, init.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await parseRuntimeJson(response, endpoint);

    if (!response.ok) {
      throw new CmoAdapterError(
        errorMessageFromPayload(payload, `OpenClaw CMO runtime request failed at ${endpoint}`),
        response.status,
        "openclaw_cmo_request_failed",
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
      throw new CmoAdapterError("OpenClaw CMO runtime timed out", 504, "openclaw_cmo_timeout");
    }

    throw new CmoAdapterError("OpenClaw CMO runtime is unavailable", 503, "openclaw_cmo_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => trimString(item)).filter(Boolean).slice(0, 12);
}

function normalizedRuntimeStatus(value: unknown): OpenClawCmoRuntimeAvailability["status"] | null {
  return value === "connected" ||
    value === "configured_but_unreachable" ||
    value === "development_fallback" ||
    value === "runtime_error" ||
    value === "not_configured"
    ? value
    : null;
}

function classifyAvailabilityError(error: unknown): OpenClawCmoRuntimeAvailability["status"] {
  if (error instanceof CmoAdapterError && (error.code.includes("unavailable") || error.code.includes("timeout"))) {
    return "configured_but_unreachable";
  }

  return "runtime_error";
}

async function checkVpsAdapterAvailability(config: OpenClawCmoRuntimeConfig): Promise<OpenClawCmoRuntimeAvailability> {
  let payload: unknown;

  try {
    payload = await getRemoteStatus();
  } catch (error) {
    return {
      status: classifyAvailabilityError(error),
      label: config.label,
      reason: error instanceof Error ? error.message : "VPS CMO Adapter status check failed.",
      config,
    };
  }

  if (!isRecord(payload)) {
    return {
      status: "runtime_error",
      label: config.label,
      reason: "VPS CMO Adapter status response was not an object.",
      config,
    };
  }

  const payloadStatus = normalizedRuntimeStatus(payload.runtime_status ?? payload.openclaw_runtime);

  if (payloadStatus) {
    return {
      status: payloadStatus,
      label: config.label,
      reason: typeof payload.runtime_reason === "string" ? payload.runtime_reason : undefined,
      config,
    };
  }

  if (payload.openclaw_trigger_enabled !== true || trimString(payload.trigger_mode) !== "openclaw-cron") {
    return {
      status: "development_fallback",
      label: "Development fallback",
      reason: "VPS CMO Adapter is reachable, but OpenClaw trigger mode is not enabled.",
      config,
    };
  }

  return {
    status: "runtime_error",
    label: config.label,
    reason: "VPS CMO Adapter did not return a checked OpenClaw runtime status.",
    config,
  };
}

async function checkDirectEndpointReachability(config: OpenClawCmoRuntimeConfig): Promise<OpenClawCmoRuntimeAvailability> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 5_000);

  try {
    const response = await fetch(config.endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status < 500 && response.status !== 404) {
      return {
        status: "connected",
        label: config.label,
        config,
      };
    }

    return {
      status: response.status === 404 ? "configured_but_unreachable" : "runtime_error",
      label: config.label,
      reason: `Direct endpoint returned HTTP ${response.status} during reachability check.`,
      config,
    };
  } catch (error) {
    return {
      status: "configured_but_unreachable",
      label: config.label,
      reason: error instanceof Error ? error.message : "Direct endpoint is unreachable.",
      config,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSuggestedActions(value: unknown): CMOAppChatResponse["suggestedActions"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      if (typeof item === "string" && item.trim()) {
        return {
          type: "runtime_suggestion",
          label: item.trim(),
        };
      }

      if (!isRecord(item)) {
        return null;
      }

      const label = trimString(item.label ?? item.title ?? item.action);

      if (!label) {
        return null;
      }

      return {
        type: trimString(item.type) || `runtime_suggestion_${index + 1}`,
        label,
      };
    })
    .filter((item): item is CMOAppChatResponse["suggestedActions"][number] => Boolean(item))
    .slice(0, 8);
}

function pickAnswer(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  const directAnswer = trimString(payload.answer ?? payload.response ?? payload.output ?? payload.text);

  if (directAnswer) {
    return directAnswer;
  }

  const data = isRecord(payload.data) ? payload.data : null;
  const nestedAnswer = trimString(data?.answer ?? data?.response ?? data?.output ?? data?.text);

  if (nestedAnswer) {
    return nestedAnswer;
  }

  const message = isRecord(payload.message) ? payload.message : null;
  return trimString(message?.content);
}

function pickStatus(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  return trimString(payload.status ?? (isRecord(payload.data) ? payload.data.status : ""));
}

function pickRuntimeRunId(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  const data = isRecord(payload.data) ? payload.data : {};
  return trimString(payload.chat_run_id ?? payload.chatRunId ?? payload.run_id ?? payload.runId ?? data.chat_run_id ?? data.run_id);
}

function isDashboardRunBriefPayload(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  if (payload.schema_version === "cmo.dashboard.v1") {
    return true;
  }

  return "summary" in payload || "actions" in payload || "signals" in payload || "agents" in payload || "reports" in payload || "vault" in payload || "campaigns" in payload;
}

function normalizeRuntimeResult(payload: unknown, config: OpenClawCmoRuntimeConfig): OpenClawCmoResult {
  const status = pickStatus(payload);

  if (status === "failed" || status === "timeout") {
    throw new CmoAdapterError(
      errorMessageFromPayload(payload, `OpenClaw CMO runtime returned ${status}`),
      status === "timeout" ? 504 : 502,
      status === "timeout" ? "openclaw_cmo_timeout" : "openclaw_cmo_failed",
    );
  }

  const answer = pickAnswer(payload);

  if (!answer) {
    throw new CmoAdapterError("OpenClaw CMO runtime completed without an answer", 502, "openclaw_cmo_empty_answer");
  }

  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;

  return {
    answer,
    assumptions: stringList(isRecord(payload) ? payload.assumptions ?? data?.assumptions : undefined),
    suggestedActions: normalizeSuggestedActions(isRecord(payload) ? payload.suggestedActions ?? payload.suggested_actions ?? data?.suggestedActions ?? data?.suggested_actions : undefined),
    contextUsed: stringList(isRecord(payload) ? payload.contextUsed ?? payload.context_used ?? data?.contextUsed ?? data?.context_used : undefined),
    rawRuntimeResponse: payload,
    isDevelopmentFallback: false,
    runtimeLabel: config.label,
    runtimeRunId: pickRuntimeRunId(payload) || undefined,
  };
}

function isDiagnosticOnlyAnswer(answer: string): boolean {
  const normalized = answer.toLowerCase();

  return (
    normalized.includes("live app-chat is unavailable") ||
    normalized.includes("fallback generated this response") ||
    normalized.includes("fallback generated this answer") ||
    normalized.startsWith("fallback response:")
  );
}

function normalizeAppTurnRuntimeResult(payload: unknown, config: OpenClawCmoRuntimeConfig): OpenClawCmoResult {
  if (isDashboardRunBriefPayload(payload)) {
    throw new CmoAdapterError(
      "OpenClaw CMO returned dashboard run-brief JSON instead of app-turn JSON",
      502,
      "openclaw_cmo_dashboard_json",
    );
  }

  if (!isRecord(payload)) {
    throw new CmoAdapterError("OpenClaw CMO app-turn response was not an object", 502, "openclaw_cmo_invalid_response");
  }

  const data = isRecord(payload.data) ? payload.data : null;
  const source = data ?? payload;

  if (isDashboardRunBriefPayload(source)) {
    throw new CmoAdapterError(
      "OpenClaw CMO returned nested dashboard run-brief JSON instead of app-turn JSON",
      502,
      "openclaw_cmo_dashboard_json",
    );
  }

  const answer = trimString(source.answer);

  if (!answer) {
    throw new CmoAdapterError("OpenClaw CMO app-turn response did not include a usable answer", 502, "openclaw_cmo_empty_answer");
  }

  if (isDiagnosticOnlyAnswer(answer)) {
    throw new CmoAdapterError("OpenClaw CMO app-turn response only contained diagnostics", 502, "openclaw_cmo_diagnostic_answer");
  }

  return {
    answer,
    assumptions: stringList(source.assumptions),
    suggestedActions: normalizeSuggestedActions(source.suggestedActions ?? source.suggested_actions),
    contextUsed: stringList(source.contextUsed ?? source.context_used),
    rawRuntimeResponse: payload,
    isDevelopmentFallback: false,
    runtimeLabel: config.label,
    runtimeRunId: pickRuntimeRunId(payload) || undefined,
  };
}

function appTurnBody(contextPackage: CMOContextPackage, history: CMOChatMessage[], sessionId?: string) {
  return {
    schema_version: "cmo.app_turn.request.v1" as const,
    ...(sessionId ? { sessionId } : {}),
    workspaceId: contextPackage.workspaceId,
    appId: contextPackage.app.id,
    sourceId: contextPackage.sourceId,
    contextPack: contextPackage.contextPack,
    userMessage: contextPackage.userMessage,
    message: contextPackage.userMessage,
    history,
    metadata: {
      requestedBy: "app-cmo-workspace",
      appName: contextPackage.app.name,
    },
  };
}

function runtimeBody(contextPackage: CMOContextPackage) {
  return {
    workspace_id: contextPackage.runtimeWorkspaceId ?? contextPackage.workspaceId,
    workspaceId: contextPackage.workspaceId,
    source_id: contextPackage.sourceId,
    sourceId: contextPackage.sourceId,
    app_id: contextPackage.app.id,
    appId: contextPackage.app.id,
    question: contextPackage.userMessage,
    message: contextPackage.userMessage,
    mode: contextPackage.mode,
    context_package: contextPackage,
    app_context_package: contextPackage,
    requested_by: "app-cmo-workspace",
  };
}

function pollEndpoint(config: OpenClawCmoRuntimeConfig, firstPayload: unknown): string {
  if (isRecord(firstPayload)) {
    const explicitPollUrl = trimString(firstPayload.poll_url ?? firstPayload.pollUrl);

    if (explicitPollUrl) {
      return explicitPollUrl.startsWith("http") ? explicitPollUrl : withEndpointOrigin(config.endpoint, explicitPollUrl);
    }
  }

  const chatRunId = pickRuntimeRunId(firstPayload);

  if (!chatRunId) {
    return "";
  }

  return withEndpointPath(config.endpoint, encodeURIComponent(chatRunId));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeRemoteChatRuntimeResult(chatRun: CmoChatRun, config: OpenClawCmoRuntimeConfig): OpenClawCmoResult {
  if (chatRun.status === "failed" || chatRun.status === "timeout") {
    throw new CmoAdapterError(
      chatRun.error?.message || `OpenClaw CMO runtime returned ${chatRun.status}`,
      chatRun.status === "timeout" ? 504 : 502,
      chatRun.status === "timeout" ? "openclaw_cmo_timeout" : chatRun.error?.code || "openclaw_cmo_failed",
    );
  }

  if (chatRun.status === "running") {
    throw new CmoAdapterError("OpenClaw CMO runtime did not complete before returning a chat result", 504, "openclaw_cmo_poll_timeout");
  }

  if (!chatRun.answer.trim()) {
    throw new CmoAdapterError("OpenClaw CMO runtime completed without an answer", 502, "openclaw_cmo_empty_answer");
  }

  return {
    answer: chatRun.answer,
    assumptions: [],
    suggestedActions: [],
    contextUsed: chatRun.context_run_id ? [chatRun.context_run_id] : [],
    rawRuntimeResponse: chatRun,
    isDevelopmentFallback: false,
    runtimeLabel: config.label,
    runtimeRunId: chatRun.chat_run_id,
  };
}

async function callRemoteAdapterChatRuntime(
  contextPackage: CMOContextPackage,
  config: OpenClawCmoRuntimeConfig,
): Promise<OpenClawCmoResult> {
  const deadline = Date.now() + getOpenClawCmoTimeoutMs();
  const started = await postRemoteChat(runtimeBody(contextPackage));
  let chatRun = started.data;

  if (chatRun.status !== "running") {
    return normalizeRemoteChatRuntimeResult(chatRun, config);
  }

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    chatRun = await getRemoteChat(chatRun.chat_run_id);

    if (chatRun.status !== "running") {
      return normalizeRemoteChatRuntimeResult(chatRun, config);
    }
  }

  throw new CmoAdapterError("OpenClaw CMO runtime did not complete before the app chat timeout", 504, "openclaw_cmo_poll_timeout");
}

export async function getOpenClawCmoRuntimeAvailability(): Promise<OpenClawCmoRuntimeAvailability> {
  const config = getOpenClawCmoRuntimeConfig();

  if (!config) {
    return {
      status: isRemoteCmoAdapter() ? "not_configured" : "development_fallback",
      label: isRemoteCmoAdapter() ? "VPS CMO Adapter" : "Development fallback",
      reason: isRemoteCmoAdapter()
        ? "CMO_REMOTE_ADAPTER_URL and CMO_REMOTE_ADAPTER_API_KEY are required when CMO_ADAPTER_MODE=remote."
        : "No OpenClaw CMO endpoint or remote VPS adapter config is set.",
    };
  }

  if (config.kind === "vps-cmo-adapter") {
    return checkVpsAdapterAvailability(config);
  }

  if (!config.statusEndpoint) {
    return checkDirectEndpointReachability(config);
  }

  let payload: unknown;

  try {
    const status = await requestRuntimeJson<unknown>(config, config.statusEndpoint, { timeoutMs: 5_000 });
    payload = status.data;
  } catch (error) {
    return {
      status: classifyAvailabilityError(error),
      label: config.label,
      reason: error instanceof Error ? error.message : "VPS CMO Adapter status check failed.",
      config,
    };
  }

  if (!isRecord(payload)) {
    return {
      status: "runtime_error",
      label: config.label,
      reason: "VPS CMO Adapter status response was not an object.",
      config,
    };
  }

  const payloadStatus = normalizedRuntimeStatus(payload.runtime_status ?? payload.openclaw_runtime);

  if (payloadStatus) {
    return {
      status: payloadStatus,
      label: config.label,
      reason: typeof payload.runtime_reason === "string" ? payload.runtime_reason : undefined,
      config,
    };
  }

  if (payload.openclaw_trigger_enabled !== true || trimString(payload.trigger_mode) !== "openclaw-cron") {
    return {
      status: "development_fallback",
      label: "Development fallback",
      reason: "VPS CMO Adapter is reachable, but OpenClaw trigger mode is not enabled.",
      config,
    };
  }

  return {
    status: "runtime_error",
    label: config.label,
    reason: "VPS CMO Adapter did not return a checked OpenClaw runtime status.",
    config,
  };
}

export async function callOpenClawCmoRuntime(
  contextPackage: CMOContextPackage,
  config: OpenClawCmoRuntimeConfig,
): Promise<OpenClawCmoResult> {
  if (config.kind === "vps-cmo-adapter") {
    return callRemoteAdapterChatRuntime(contextPackage, config);
  }

  const deadline = Date.now() + getOpenClawCmoTimeoutMs();
  const started = await requestRuntimeJson<unknown>(config, config.endpoint, {
    method: "POST",
    body: runtimeBody(contextPackage),
  });
  let payload = started.data;
  let status = pickStatus(payload);

  if (!status || status === "completed") {
    return normalizeRuntimeResult(payload, config);
  }

  if (status !== "running") {
    return normalizeRuntimeResult(payload, config);
  }

  const endpoint = pollEndpoint(config, payload);

  if (!endpoint) {
    throw new CmoAdapterError("OpenClaw CMO runtime returned a running chat without a poll endpoint", 502, "openclaw_cmo_poll_missing");
  }

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const remaining = Math.max(1_000, Math.min(DEFAULT_REQUEST_TIMEOUT_MS, deadline - Date.now()));
    const poll = await requestRuntimeJson<unknown>(config, endpoint, { timeoutMs: remaining });

    payload = poll.data;
    status = pickStatus(payload);

    if (status !== "running") {
      return normalizeRuntimeResult(payload, config);
    }
  }

  throw new CmoAdapterError("OpenClaw CMO runtime did not complete before the app chat timeout", 504, "openclaw_cmo_poll_timeout");
}

export async function callOpenClawAppTurnRuntime(
  contextPackage: CMOContextPackage,
  config: OpenClawCmoRuntimeConfig,
  history: CMOChatMessage[],
  sessionId?: string,
): Promise<OpenClawCmoResult> {
  if (config.kind === "vps-cmo-adapter") {
    const response = await postRemoteAppTurn(appTurnBody(contextPackage, history, sessionId));

    return {
      answer: response.data.answer,
      assumptions: [],
      suggestedActions: response.data.suggestedActions,
      contextUsed: response.data.contextUsed,
      rawRuntimeResponse: response.data.rawRuntimeResponse,
      isDevelopmentFallback: false,
      runtimeLabel: config.label,
    };
  }

  const response = await requestRuntimeJson<unknown>(config, config.endpoint, {
    method: "POST",
    body: appTurnBody(contextPackage, history, sessionId),
    timeoutMs: getCmoAppTurnRequestTimeoutMs(),
  });

  return normalizeAppTurnRuntimeResult(response.data, config);
}
