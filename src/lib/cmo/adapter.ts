import { CMO_SCHEMA_VERSION, type CmoChatRun, type CmoChatRunListResponse, type CmoRun, type CmoRunListResponse } from "@/lib/cmo/types";
import { getCmoAdapterMode, getRemoteAdapterUrl, isRemoteCmoAdapter } from "@/lib/cmo/config";
import {
  createLocalChatRun,
  createMockRun,
  readLocalDataDirStatus,
  readLocalChatRun,
  readLocalChatRuns,
  readLatestRun,
  readRun,
  readRuns,
} from "@/lib/cmo/store";
import {
  getRemoteChat,
  getRemoteChats,
  getRemoteLatestRun,
  getRemoteRun,
  getRemoteRuns,
  getRemoteStatus,
  postRemoteChat,
  postRemoteRunBrief,
  type CmoRemoteStatus,
  type CmoRunBriefResponse,
} from "@/lib/cmo/remote-client";
import { CmoAdapterError } from "@/lib/cmo/errors";

type RuntimeStatus = "connected" | "configured_but_unreachable" | "development_fallback" | "runtime_error" | "not_configured";

export async function readDashboardLatestRun(): Promise<CmoRun> {
  return isRemoteCmoAdapter() ? getRemoteLatestRun() : readLatestRun();
}

export async function readDashboardRun(runId: string): Promise<CmoRun | null> {
  return isRemoteCmoAdapter() ? getRemoteRun(runId) : readRun(runId);
}

export async function readDashboardRuns(limit = 20): Promise<CmoRunListResponse> {
  return isRemoteCmoAdapter() ? getRemoteRuns(limit) : readRuns(limit);
}

export async function runDashboardBrief(body: unknown): Promise<{ data: CmoRun | CmoRunBriefResponse; status: number }> {
  if (isRemoteCmoAdapter()) {
    return postRemoteRunBrief(body);
  }

  return {
    data: await createMockRun(),
    status: 201,
  };
}

export async function startDashboardChat(body: unknown): Promise<{ data: CmoChatRun; status: number }> {
  if (isRemoteCmoAdapter()) {
    return postRemoteChat(body);
  }

  try {
    return {
      data: await createLocalChatRun(body),
      status: 202,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Question is required") {
      throw new CmoAdapterError("Question is required", 400, "cmo_chat_question_required");
    }

    throw error;
  }
}

export async function readDashboardChat(chatRunId: string): Promise<CmoChatRun | null> {
  if (isRemoteCmoAdapter()) {
    return getRemoteChat(chatRunId);
  }

  return readLocalChatRun(chatRunId);
}

export async function readDashboardChats(limit = 20): Promise<CmoChatRunListResponse> {
  if (isRemoteCmoAdapter()) {
    return getRemoteChats(limit);
  }

  return {
    schema_version: CMO_SCHEMA_VERSION,
    data: await readLocalChatRuns(limit),
  };
}

function normalizeRuntimeStatus(value: unknown): RuntimeStatus | null {
  return value === "connected" ||
    value === "configured_but_unreachable" ||
    value === "development_fallback" ||
    value === "runtime_error" ||
    value === "not_configured"
    ? value
    : null;
}

function runtimeStatusFromRemotePayload(status: CmoRemoteStatus): RuntimeStatus {
  const explicit = normalizeRuntimeStatus(status.runtime_status ?? status.openclaw_runtime);

  if (explicit) {
    return explicit;
  }

  if (status.openclaw_trigger_enabled !== true || status.trigger_mode !== "openclaw-cron") {
    return "development_fallback";
  }

  return "runtime_error";
}

function remoteStatusFromError(error: unknown): CmoRemoteStatus {
  const isConfigMissing =
    error instanceof CmoAdapterError && (error.code === "cmo_remote_url_missing" || error.code === "cmo_remote_api_key_missing");
  const isUnreachable =
    error instanceof CmoAdapterError && (error.status === 503 || error.status === 504 || error.code.includes("unavailable") || error.code.includes("timeout"));
  const runtimeStatus: RuntimeStatus = isConfigMissing ? "not_configured" : isUnreachable ? "configured_but_unreachable" : "runtime_error";

  return {
    schema_version: CMO_SCHEMA_VERSION,
    ok: false,
    mode: getCmoAdapterMode(),
    adapter: "remote",
    adapter_reachable: false,
    remote_adapter_url_configured: Boolean(getRemoteAdapterUrl()),
    runtime_status: runtimeStatus,
    openclaw_runtime: runtimeStatus,
    runtime_reason: error instanceof Error ? error.message : "Remote CMO Adapter status check failed",
  };
}

export async function readDashboardStatus(): Promise<CmoRemoteStatus> {
  if (isRemoteCmoAdapter()) {
    try {
      const status = await getRemoteStatus();
      const runtimeStatus = runtimeStatusFromRemotePayload(status);

      return {
        ...status,
        mode: getCmoAdapterMode(),
        adapter: status.adapter ?? "remote",
        adapter_reachable: true,
        runtime_status: runtimeStatus,
        openclaw_runtime: runtimeStatus,
      };
    } catch (error) {
      return remoteStatusFromError(error);
    }
  }

  const dataDir = await readLocalDataDirStatus();

  return {
    schema_version: CMO_SCHEMA_VERSION,
    ok: true,
    mode: getCmoAdapterMode(),
    adapter: "local",
    data_dir: dataDir.dataDir,
    data_dir_exists: dataDir.exists,
    gateway_mode: "not_configured",
    trigger_mode: "local",
    openclaw_trigger_enabled: false,
    runtime_status: "development_fallback",
    openclaw_runtime: "development_fallback",
    runtime_reason: "CMO_ADAPTER_MODE is local, so the app uses local development behavior instead of the VPS OpenClaw runtime.",
  };
}
