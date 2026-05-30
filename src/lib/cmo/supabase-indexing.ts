import type { SupabaseClient } from "@supabase/supabase-js";

import type { CMOChatMessage, CMOChatSession } from "@/lib/cmo/app-workspace-types";
import { getAppWorkspace } from "@/lib/cmo/app-workspaces";
import type { GBrainCandidateWriteResult } from "@/lib/cmo/gbrain-candidate-writer";
import type { CMOVaultCaptureEvent } from "@/lib/cmo/vault-capture-types";

type IndexStatus = "indexed" | "skipped" | "failed";

export interface CmoIndexResult {
  status: IndexStatus;
  table?: string;
  reason?: string;
  id?: string;
}

export interface SupabaseWorkspaceScope {
  organizationId: string;
  workspaceId: string;
  workspaceKey: string;
}

type SupabaseAdmin = SupabaseClient;

const WORKSPACE_KEY_BY_APP_ID: Record<string, string> = {
  "holdstation-wallet": "holdstation-wallet",
  "hold-pay": "hold-pay",
  tickx: "tickx",
  "holdstation-mini-app": "world-app-holdstation-mini-app",
  "world-app-holdstation-mini-app": "world-app-holdstation-mini-app",
  aion: "world-app-aion",
  "world-app-aion": "world-app-aion",
  winance: "world-app-winance",
  "world-app-winance": "world-app-winance",
  feeback: "world-app-feeback",
  feedback: "world-app-feeback",
  "world-app-feeback": "world-app-feeback",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workspaceScopeCache = new Map<string, SupabaseWorkspaceScope | null>();

function envValue(name: string): string {
  return (process.env[name] ?? "").trim();
}

function isIndexingEnabled(): boolean {
  return envValue("CMO_SUPABASE_INDEXING_ENABLED") === "true";
}

function missingAdminEnv(): string[] {
  return ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter(
    (name) => !envValue(name),
  );
}

function skipped(table: string, reason: string): CmoIndexResult {
  return { status: "skipped", table, reason };
}

function failed(table: string, error: unknown): CmoIndexResult {
  return {
    status: "failed",
    table,
    reason: error instanceof Error ? error.message : "Supabase index write failed",
  };
}

function warnNonFatal(message: string, detail: unknown) {
  console.warn("[cmo-supabase-indexing]", message, detail instanceof Error ? detail.message : detail);
}

function indexingReady(table: string): CmoIndexResult | null {
  if (!isIndexingEnabled()) {
    return skipped(table, "CMO_SUPABASE_INDEXING_ENABLED is false");
  }

  return adminEnvReady(table);
}

function adminEnvReady(table: string): CmoIndexResult | null {
  const missing = missingAdminEnv();
  if (missing.length) {
    return skipped(table, `Missing Supabase admin env: ${missing.join(", ")}`);
  }

  return null;
}

async function adminClient(): Promise<SupabaseAdmin> {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  return createSupabaseAdminClient();
}

function uuidOrNull(value: string | undefined | null): string | null {
  return value && UUID_PATTERN.test(value) ? value : null;
}

function workspaceKeyFor(input: { appId?: string; workspaceId?: string; workspaceKey?: string; project?: string }): string | null {
  if (input.workspaceKey && WORKSPACE_KEY_BY_APP_ID[input.workspaceKey]) {
    return WORKSPACE_KEY_BY_APP_ID[input.workspaceKey];
  }

  if (input.appId && WORKSPACE_KEY_BY_APP_ID[input.appId]) {
    return WORKSPACE_KEY_BY_APP_ID[input.appId];
  }

  if (input.workspaceId && WORKSPACE_KEY_BY_APP_ID[input.workspaceId]) {
    return WORKSPACE_KEY_BY_APP_ID[input.workspaceId];
  }

  if (/holdstation mini app/i.test(input.project ?? "")) {
    return "world-app-holdstation-mini-app";
  }

  return null;
}

export function inferAppIdForIndex(input: { appId?: string; workspaceId?: string; project?: string }): string | undefined {
  if (input.appId === "world-app-holdstation-mini-app") {
    return "holdstation-mini-app";
  }

  if (input.appId) {
    return input.appId;
  }

  if (input.workspaceId === "world-app-holdstation-mini-app" || /holdstation mini app/i.test(input.project ?? "")) {
    return "holdstation-mini-app";
  }

  return input.workspaceId && WORKSPACE_KEY_BY_APP_ID[input.workspaceId] ? input.workspaceId : undefined;
}

export async function resolveSupabaseWorkspaceScope(input: {
  appId?: string;
  workspaceId?: string;
  workspaceKey?: string;
  project?: string;
}): Promise<SupabaseWorkspaceScope | null> {
  const key = workspaceKeyFor(input);
  if (!key) {
    return null;
  }

  if (workspaceScopeCache.has(key)) {
    return workspaceScopeCache.get(key) ?? null;
  }

  const readiness = adminEnvReady("workspaces");
  if (readiness) {
    return null;
  }

  try {
    const client = await adminClient();
    const { data, error } = await client
      .from("workspaces")
      .select("id, organization_id, workspace_key")
      .eq("workspace_key", key)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data || typeof data.id !== "string" || typeof data.organization_id !== "string" || typeof data.workspace_key !== "string") {
      workspaceScopeCache.set(key, null);
      return null;
    }

    const scope = {
      organizationId: data.organization_id,
      workspaceId: data.id,
      workspaceKey: data.workspace_key,
    };
    workspaceScopeCache.set(key, scope);
    return scope;
  } catch (error) {
    warnNonFatal("Workspace scope resolution failed", error);
    return null;
  }
}

export async function writeAuditEvent(input: {
  eventType: string;
  resourceType?: string;
  resourceId?: string;
  actorUserId?: string | null;
  scope?: SupabaseWorkspaceScope | null;
  metadata?: Record<string, unknown>;
}): Promise<CmoIndexResult> {
  const table = "audit_events";
  const readiness = indexingReady(table);
  if (readiness) {
    return readiness;
  }

  try {
    const client = await adminClient();
    const { error } = await client.from(table).insert({
      actor_user_id: uuidOrNull(input.actorUserId),
      organization_id: input.scope?.organizationId ?? null,
      workspace_id: input.scope?.workspaceId ?? null,
      event_type: input.eventType,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      metadata: input.metadata ?? {},
    });

    if (error) {
      throw error;
    }

    return { status: "indexed", table };
  } catch (error) {
    warnNonFatal("Audit event index write failed", error);
    return failed(table, error);
  }
}

export async function indexChatSession(input: {
  session: CMOChatSession;
  jsonPath: string;
  auditCreated?: boolean;
}): Promise<CmoIndexResult> {
  const table = "chat_sessions_index";
  const readiness = indexingReady(table);
  if (readiness) {
    return readiness;
  }

  const app = getAppWorkspace(input.session.appId);
  const scope = await resolveSupabaseWorkspaceScope({
    appId: input.session.appId,
    workspaceId: app?.workspaceId,
    project: input.session.appName,
  });

  if (!scope) {
    return skipped(table, `Workspace not resolved for appId ${input.session.appId}`);
  }

  const userId = uuidOrNull(input.session.userId);

  try {
    const client = await adminClient();
    const { error } = await client.from(table).upsert({
      id: input.session.id,
      organization_id: scope.organizationId,
      workspace_id: scope.workspaceId,
      app_id: input.session.appId,
      source_id: app?.sourceId,
      user_id: userId,
      status: input.session.status,
      runtime_mode: input.session.runtimeMode,
      json_path: input.jsonPath,
      created_at: input.session.createdAt,
      updated_at: input.session.updatedAt,
    }, { onConflict: "id" });

    if (error) {
      throw error;
    }

    if (input.auditCreated) {
      await writeAuditEvent({
        eventType: "chat_session_created",
        resourceType: "chat_session",
        resourceId: input.session.id,
        actorUserId: userId,
        scope,
        metadata: {
          app_id: input.session.appId,
          runtime_mode: input.session.runtimeMode ?? null,
          status: input.session.status,
        },
      });
    }

    return { status: "indexed", table, id: input.session.id };
  } catch (error) {
    warnNonFatal("Chat session index write failed", error);
    return failed(table, error);
  }
}

export async function indexChatMessage(input: {
  session: CMOChatSession;
  message: CMOChatMessage;
}): Promise<CmoIndexResult> {
  const table = "chat_messages_index";
  const readiness = indexingReady(table);
  if (readiness) {
    return readiness;
  }

  const app = getAppWorkspace(input.session.appId);
  const scope = await resolveSupabaseWorkspaceScope({
    appId: input.session.appId,
    workspaceId: app?.workspaceId,
    project: input.session.appName,
  });

  if (!scope) {
    return skipped(table, `Workspace not resolved for appId ${input.session.appId}`);
  }

  const userId = uuidOrNull(input.message.userId ?? input.message.sourceUserId ?? input.session.userId);

  try {
    const client = await adminClient();
    const { error } = await client.from(table).upsert({
      id: input.message.id,
      session_id: input.session.id,
      user_id: userId,
      role: input.message.role,
      created_at: input.message.createdAt,
    }, { onConflict: "id" });

    if (error) {
      throw error;
    }

    await writeAuditEvent({
      eventType: "chat_message_created",
      resourceType: "chat_message",
      resourceId: input.message.id,
      actorUserId: userId,
      scope,
      metadata: {
        session_id: input.session.id,
        role: input.message.role,
      },
    });

    return { status: "indexed", table, id: input.message.id };
  } catch (error) {
    warnNonFatal("Chat message index write failed", error);
    return failed(table, error);
  }
}

export async function indexChatMessages(input: {
  session: CMOChatSession;
  messages: CMOChatMessage[];
}): Promise<CmoIndexResult[]> {
  const results: CmoIndexResult[] = [];
  for (const message of input.messages) {
    results.push(await indexChatMessage({ session: input.session, message }));
  }
  return results;
}

function normalizedVisibility(value: string | undefined): "private" | "workspace" | "organization" | "system" {
  if (value === "private" || value === "organization" || value === "system") {
    return value;
  }

  return "workspace";
}

function reviewStatusFor(event: CMOVaultCaptureEvent): string {
  if (event.reviewStatus) {
    return event.reviewStatus;
  }

  return event.type === "cmo_decision" || event.type === "memory_candidate" ? "review_candidate" : "raw";
}

export async function indexVaultCapture(input: {
  event: CMOVaultCaptureEvent;
  relativePath: string;
}): Promise<CmoIndexResult> {
  const table = "vault_captures_index";
  const readiness = indexingReady(table);
  if (readiness) {
    return readiness;
  }

  const appId = inferAppIdForIndex({
    appId: input.event.appId,
    workspaceId: input.event.workspaceId,
    project: input.event.project,
  });
  const scope = await resolveSupabaseWorkspaceScope({
    appId,
    workspaceId: input.event.workspaceId,
    project: input.event.project,
  });

  if (!scope) {
    return skipped(table, `Workspace not resolved for capture ${input.relativePath}`);
  }

  const userId = uuidOrNull(input.event.userId);

  try {
    const client = await adminClient();
    const { data, error } = await client.from(table).insert({
      organization_id: scope.organizationId,
      workspace_id: scope.workspaceId,
      app_id: appId,
      user_id: userId,
      visibility: normalizedVisibility(input.event.visibility),
      vault_path: input.relativePath,
      source_agent: input.event.sourceAgent,
      mode: input.event.mode,
      skill: input.event.skill,
      source_class: input.event.sourceClass,
      capture_origin: input.event.captureOrigin ?? (input.event.captureMode === "auto_raw" ? "auto" : "manual"),
      review_status: reviewStatusFor(input.event),
      gbrain_status: input.event.gbrainStatus ?? "pending",
      created_at: input.event.createdAt,
    }).select("id").single();

    if (error) {
      throw error;
    }

    const id = typeof data?.id === "string" ? data.id : undefined;
    await writeAuditEvent({
      eventType: "vault_capture_created",
      resourceType: "vault_capture",
      resourceId: id ?? input.relativePath,
      actorUserId: userId,
      scope,
      metadata: {
        app_id: appId ?? null,
        vault_path: input.relativePath,
        source_agent: input.event.sourceAgent,
        source_class: input.event.sourceClass,
        capture_origin: input.event.captureOrigin ?? null,
      },
    });

    return { status: "indexed", table, id };
  } catch (error) {
    warnNonFatal("Vault capture index write failed", error);
    return failed(table, error);
  }
}

export async function indexGBrainCandidate(input: {
  candidate: GBrainCandidateWriteResult;
}): Promise<CmoIndexResult> {
  const table = "gbrain_candidates_index";
  const readiness = indexingReady(table);
  if (readiness) {
    return readiness;
  }

  const scope = await resolveSupabaseWorkspaceScope({
    appId: input.candidate.appId,
    workspaceId: input.candidate.workspaceId,
    project: input.candidate.project,
  });

  if (!scope) {
    return skipped(table, `Workspace not resolved for candidate ${input.candidate.candidateHash}`);
  }

  const userId = uuidOrNull(input.candidate.userId);
  let captureId: string | null = null;

  if (input.candidate.sourcePath) {
    try {
      const client = await adminClient();
      const { data, error } = await client
        .from("vault_captures_index")
        .select("id")
        .eq("vault_path", input.candidate.sourcePath)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      captureId = typeof data?.id === "string" ? data.id : null;
    } catch (error) {
      warnNonFatal("Candidate capture_id resolution failed", error);
    }
  }

  try {
    const client = await adminClient();
    const { data, error } = await client.from(table).insert({
      capture_id: captureId,
      organization_id: scope.organizationId,
      workspace_id: scope.workspaceId,
      app_id: input.candidate.appId,
      user_id: userId,
      visibility: normalizedVisibility(input.candidate.visibility),
      candidate_type: input.candidate.candidateType,
      review_status: input.candidate.reviewStatus ?? "review_candidate",
      source_path: input.candidate.sourcePath,
      candidate_hash: input.candidate.candidateHash,
      created_at: input.candidate.createdAt,
    }).select("id").single();

    if (error) {
      throw error;
    }

    const id = typeof data?.id === "string" ? data.id : undefined;
    await writeAuditEvent({
      eventType: "gbrain_candidate_created",
      resourceType: "gbrain_candidate",
      resourceId: id ?? input.candidate.candidateHash,
      actorUserId: userId,
      scope,
      metadata: {
        app_id: input.candidate.appId ?? null,
        candidate_type: input.candidate.candidateType,
        candidate_hash: input.candidate.candidateHash,
        source_path: input.candidate.sourcePath ?? null,
      },
    });

    return { status: "indexed", table, id };
  } catch (error) {
    warnNonFatal("GBrain candidate index write failed", error);
    return failed(table, error);
  }
}

export const __cmoSupabaseIndexingTest = {
  workspaceKeyFor,
  uuidOrNull,
  normalizedVisibility,
  indexingEnabled: isIndexingEnabled,
};
