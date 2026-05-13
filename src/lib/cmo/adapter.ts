import { CMO_SCHEMA_VERSION, type CmoChatRun, type CmoChatRunListResponse, type CmoRun, type CmoRunListResponse } from "@/lib/cmo/types";
import { getCmoAdapterMode, isRemoteCmoAdapter } from "@/lib/cmo/config";
import {
  createLocalChatRun,
  createMockRun,
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

export async function readDashboardStatus(): Promise<CmoRemoteStatus> {
  if (isRemoteCmoAdapter()) {
    return getRemoteStatus();
  }

  return {
    schema_version: CMO_SCHEMA_VERSION,
    ok: true,
    mode: getCmoAdapterMode(),
    adapter: "local",
    data_dir: "data",
  };
}
