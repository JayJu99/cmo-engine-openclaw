import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveSupabaseWorkspaceScope, type SupabaseWorkspaceScope } from "@/lib/cmo/supabase-indexing";

type IndexedVisibility = "private" | "workspace" | "organization" | "system";

export interface IndexedContextResolverInput {
  userId: string;
  userEmail?: string;
  isOwnerOrAdmin: boolean;
  appId: string;
  workspaceKey?: string;
  query?: string;
  limit?: number;
  includeSystem?: boolean;
}

export interface IndexedChatSessionRecord {
  id: string;
  appId: string | null;
  sourceId: string | null;
  userId: string | null;
  status: string | null;
  runtimeMode: string | null;
  jsonPath: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface IndexedVaultCaptureRecord {
  id: string;
  appId: string | null;
  userId: string | null;
  visibility: IndexedVisibility;
  vaultPath: string | null;
  sourceAgent: string | null;
  mode: string | null;
  skill: string | null;
  sourceClass: string | null;
  captureOrigin: string | null;
  reviewStatus: string | null;
  gbrainStatus: string | null;
  createdAt: string | null;
}

export interface IndexedGBrainCandidateRecord {
  id: string;
  captureId: string | null;
  appId: string | null;
  userId: string | null;
  visibility: IndexedVisibility;
  candidateType: string | null;
  reviewStatus: string | null;
  sourcePath: string | null;
  candidateHash: string | null;
  createdAt: string | null;
}

export interface IndexedAuditEventRecord {
  id: string;
  actorUserId: string | null;
  eventType: string | null;
  resourceType: string | null;
  resourceId: string | null;
  createdAt: string | null;
}

export interface IndexedContextResolverOutput {
  ok: boolean;
  workspaceId?: string;
  organizationId?: string;
  records: {
    sessions: IndexedChatSessionRecord[];
    captures: IndexedVaultCaptureRecord[];
    candidates: IndexedGBrainCandidateRecord[];
    auditEvents?: IndexedAuditEventRecord[];
  };
  warnings: string[];
  dryRun: true;
}

type SupabaseAdmin = SupabaseClient;
type VisibleRecord = { user_id?: string | null; visibility?: string | null };

async function adminClient(): Promise<SupabaseAdmin> {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  return createSupabaseAdminClient();
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || limit < 1) {
    return 10;
  }

  return Math.min(Math.floor(limit), 50);
}

function normalizeVisibility(value: string | null | undefined): IndexedVisibility {
  return value === "private" || value === "organization" || value === "system" ? value : "workspace";
}

export async function resolveWorkspaceScope(input: {
  appId: string;
  workspaceKey?: string;
}): Promise<SupabaseWorkspaceScope | null> {
  return resolveSupabaseWorkspaceScope({
    appId: input.appId,
    workspaceKey: input.workspaceKey,
  });
}

export function filterIndexedRecordsByVisibility<T extends VisibleRecord>(
  records: T[],
  input: {
    userId: string;
    isOwnerOrAdmin: boolean;
    includeSystem?: boolean;
  },
): T[] {
  return records.filter((record) => {
    const visibility = normalizeVisibility(record.visibility);
    if (visibility === "private") {
      return Boolean(record.user_id) && record.user_id === input.userId;
    }

    if (visibility === "system") {
      return Boolean(input.includeSystem) && input.isOwnerOrAdmin;
    }

    return true;
  });
}

function queryMatches(input: { query?: string; fields: Array<string | null | undefined> }): boolean {
  const query = input.query?.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return input.fields.some((field) => field?.toLowerCase().includes(query));
}

function withoutPermissionShim<T extends { user_id?: string | null }>(record: T): Omit<T, "user_id"> {
  const copy = { ...record };
  delete copy.user_id;
  return copy;
}

function sessionRecord(row: Record<string, unknown>): IndexedChatSessionRecord {
  return {
    id: String(row.id ?? ""),
    appId: typeof row.app_id === "string" ? row.app_id : null,
    sourceId: typeof row.source_id === "string" ? row.source_id : null,
    userId: typeof row.user_id === "string" ? row.user_id : null,
    status: typeof row.status === "string" ? row.status : null,
    runtimeMode: typeof row.runtime_mode === "string" ? row.runtime_mode : null,
    jsonPath: typeof row.json_path === "string" ? row.json_path : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

function captureRecord(row: Record<string, unknown>): IndexedVaultCaptureRecord {
  return {
    id: String(row.id ?? ""),
    appId: typeof row.app_id === "string" ? row.app_id : null,
    userId: typeof row.user_id === "string" ? row.user_id : null,
    visibility: normalizeVisibility(typeof row.visibility === "string" ? row.visibility : null),
    vaultPath: typeof row.vault_path === "string" ? row.vault_path : null,
    sourceAgent: typeof row.source_agent === "string" ? row.source_agent : null,
    mode: typeof row.mode === "string" ? row.mode : null,
    skill: typeof row.skill === "string" ? row.skill : null,
    sourceClass: typeof row.source_class === "string" ? row.source_class : null,
    captureOrigin: typeof row.capture_origin === "string" ? row.capture_origin : null,
    reviewStatus: typeof row.review_status === "string" ? row.review_status : null,
    gbrainStatus: typeof row.gbrain_status === "string" ? row.gbrain_status : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
  };
}

function candidateRecord(row: Record<string, unknown>): IndexedGBrainCandidateRecord {
  return {
    id: String(row.id ?? ""),
    captureId: typeof row.capture_id === "string" ? row.capture_id : null,
    appId: typeof row.app_id === "string" ? row.app_id : null,
    userId: typeof row.user_id === "string" ? row.user_id : null,
    visibility: normalizeVisibility(typeof row.visibility === "string" ? row.visibility : null),
    candidateType: typeof row.candidate_type === "string" ? row.candidate_type : null,
    reviewStatus: typeof row.review_status === "string" ? row.review_status : null,
    sourcePath: typeof row.source_path === "string" ? row.source_path : null,
    candidateHash: typeof row.candidate_hash === "string" ? row.candidate_hash : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
  };
}

function auditRecord(row: Record<string, unknown>): IndexedAuditEventRecord {
  return {
    id: String(row.id ?? ""),
    actorUserId: typeof row.actor_user_id === "string" ? row.actor_user_id : null,
    eventType: typeof row.event_type === "string" ? row.event_type : null,
    resourceType: typeof row.resource_type === "string" ? row.resource_type : null,
    resourceId: typeof row.resource_id === "string" ? row.resource_id : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
  };
}

export async function resolveIndexedContextDryRun(
  input: IndexedContextResolverInput,
): Promise<IndexedContextResolverOutput> {
  const warnings: string[] = [];
  const limit = normalizeLimit(input.limit);
  const scope = await resolveWorkspaceScope({
    appId: input.appId,
    workspaceKey: input.workspaceKey,
  });

  if (!scope) {
    return {
      ok: false,
      records: {
        sessions: [],
        captures: [],
        candidates: [],
      },
      warnings: [`Workspace scope could not be resolved for appId=${input.appId}.`],
      dryRun: true,
    };
  }

  const client = await adminClient();

  const sessionsResult = await client
    .from("chat_sessions_index")
    .select("id,app_id,source_id,user_id,status,runtime_mode,json_path,created_at,updated_at")
    .eq("workspace_id", scope.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (sessionsResult.error) {
    warnings.push(`chat_sessions_index query failed: ${sessionsResult.error.message}`);
  }

  const capturesResult = await client
    .from("vault_captures_index")
    .select("id,app_id,user_id,visibility,vault_path,source_agent,mode,skill,source_class,capture_origin,review_status,gbrain_status,created_at")
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit * 2);
  if (capturesResult.error) {
    warnings.push(`vault_captures_index query failed: ${capturesResult.error.message}`);
  }

  const candidatesResult = await client
    .from("gbrain_candidates_index")
    .select("id,capture_id,app_id,user_id,visibility,candidate_type,review_status,source_path,candidate_hash,created_at")
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit * 2);
  if (candidatesResult.error) {
    warnings.push(`gbrain_candidates_index query failed: ${candidatesResult.error.message}`);
  }

  const sessions = ((sessionsResult.data ?? []) as Array<Record<string, unknown>>)
    .map(sessionRecord)
    .filter((record) =>
      queryMatches({
        query: input.query,
        fields: [record.id, record.appId, record.sourceId, record.status, record.runtimeMode, record.jsonPath],
      }),
    )
    .slice(0, limit);

  const captures = filterIndexedRecordsByVisibility(
    ((capturesResult.data ?? []) as Array<Record<string, unknown>>).map(captureRecord).map((record) => ({
      ...record,
      user_id: record.userId,
    })),
    input,
  )
    .filter((record) =>
      queryMatches({
        query: input.query,
        fields: [record.vaultPath, record.appId, record.sourceAgent, record.mode, record.skill, record.sourceClass, record.reviewStatus],
      }),
    )
    .slice(0, limit)
    .map(withoutPermissionShim);

  const candidates = filterIndexedRecordsByVisibility(
    ((candidatesResult.data ?? []) as Array<Record<string, unknown>>).map(candidateRecord).map((record) => ({
      ...record,
      user_id: record.userId,
    })),
    input,
  )
    .filter((record) =>
      queryMatches({
        query: input.query,
        fields: [record.sourcePath, record.appId, record.candidateType, record.reviewStatus, record.candidateHash],
      }),
    )
    .slice(0, limit)
    .map(withoutPermissionShim);

  let auditEvents: IndexedAuditEventRecord[] | undefined;
  if (input.includeSystem && input.isOwnerOrAdmin) {
    const auditResult = await client
      .from("audit_events")
      .select("id,actor_user_id,event_type,resource_type,resource_id,created_at")
      .eq("workspace_id", scope.workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (auditResult.error) {
      warnings.push(`audit_events query failed: ${auditResult.error.message}`);
    } else {
      auditEvents = ((auditResult.data ?? []) as Array<Record<string, unknown>>)
        .map(auditRecord)
        .filter((record) =>
          queryMatches({
            query: input.query,
            fields: [record.eventType, record.resourceType, record.resourceId],
          }),
        );
    }
  } else if (input.includeSystem) {
    warnings.push("System/audit records require owner/admin access and were not included.");
  }

  return {
    ok: warnings.length === 0,
    workspaceId: scope.workspaceId,
    organizationId: scope.organizationId,
    records: {
      sessions,
      captures,
      candidates,
      ...(auditEvents ? { auditEvents } : {}),
    },
    warnings,
    dryRun: true,
  };
}

export const __indexedContextResolverTest = {
  normalizeVisibility,
  filterIndexedRecordsByVisibility,
  queryMatches,
  normalizeLimit,
};
