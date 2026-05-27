import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const WORKSPACE_KEY_BY_APP_ID = {
  "holdstation-wallet": "holdstation-wallet",
  "hold-pay": "hold-pay",
  tickx: "tickx",
  "holdstation-mini-app": "world-app-holdstation-mini-app",
  "world-app-holdstation-mini-app": "world-app-holdstation-mini-app",
  "world-app-aion": "world-app-aion",
  "world-app-winance": "world-app-winance",
  "world-app-feeback": "world-app-feeback",
};
const FORBIDDEN_CONTENT_KEYS = new Set([
  "content",
  "body",
  "markdown",
  "summary",
  "answer",
  "question",
  "messages",
  "payload",
  "context_used",
]);
const DEFAULT_USER_ID = "00000000-0000-4000-8000-000000000007";

function parseArgs(argv) {
  const options = {
    appId: "holdstation-mini-app",
    workspaceKey: undefined,
    limit: 10,
    includeSystem: false,
    query: undefined,
    userId: process.env.CMO_CONTEXT_RESOLVER_USER_ID || undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--app") {
      options.appId = argv[++i];
    } else if (arg === "--workspace") {
      options.workspaceKey = argv[++i];
    } else if (arg === "--limit") {
      const limit = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(limit) || limit < 1) throw new Error("Invalid --limit value");
      options.limit = Math.min(limit, 50);
    } else if (arg === "--include-system") {
      options.includeSystem = true;
    } else if (arg === "--query") {
      options.query = argv[++i];
    } else if (arg === "--user-id") {
      options.userId = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function envPresent(name) {
  return Boolean((process.env[name] ?? "").trim());
}

function adminEnvReady() {
  return envPresent("NEXT_PUBLIC_SUPABASE_URL") &&
    envPresent("NEXT_PUBLIC_SUPABASE_ANON_KEY") &&
    envPresent("SUPABASE_SERVICE_ROLE_KEY");
}

function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function workspaceKeyFor(input) {
  if (input.workspaceKey && WORKSPACE_KEY_BY_APP_ID[input.workspaceKey]) return WORKSPACE_KEY_BY_APP_ID[input.workspaceKey];
  if (input.appId && WORKSPACE_KEY_BY_APP_ID[input.appId]) return WORKSPACE_KEY_BY_APP_ID[input.appId];
  return null;
}

function normalizeVisibility(value) {
  return value === "private" || value === "organization" || value === "system" ? value : "workspace";
}

function filterByVisibility(records, input) {
  return records.filter((record) => {
    const visibility = normalizeVisibility(record.visibility);
    if (visibility === "private") return Boolean(record.user_id) && record.user_id === input.userId;
    if (visibility === "system") return Boolean(input.includeSystem) && input.isOwnerOrAdmin;
    return true;
  });
}

function queryMatches(query, fields) {
  const needle = query?.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => typeof field === "string" && field.toLowerCase().includes(needle));
}

function assertNoFullContent(value, path = "result") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoFullContent(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    assert.ok(!FORBIDDEN_CONTENT_KEYS.has(key), `${path}.${key} contains forbidden full content field`);
    assertNoFullContent(nested, `${path}.${key}`);
  }
}

function runOfflinePermissionAssertions() {
  const self = "00000000-0000-4000-8000-000000000001";
  const other = "00000000-0000-4000-8000-000000000002";
  const records = [
    { id: "private_self", visibility: "private", user_id: self },
    { id: "private_other", visibility: "private", user_id: other },
    { id: "workspace_record", visibility: "workspace", user_id: other },
    { id: "organization_record", visibility: "organization", user_id: other },
    { id: "system_record", visibility: "system", user_id: null },
  ];
  assert.deepEqual(filterByVisibility(records, { userId: self, isOwnerOrAdmin: false, includeSystem: false }).map((row) => row.id), [
    "private_self",
    "workspace_record",
    "organization_record",
  ]);
  assert.deepEqual(filterByVisibility(records, { userId: self, isOwnerOrAdmin: false, includeSystem: true }).map((row) => row.id), [
    "private_self",
    "workspace_record",
    "organization_record",
  ]);
  assert.deepEqual(filterByVisibility(records, { userId: self, isOwnerOrAdmin: true, includeSystem: true }).map((row) => row.id), [
    "private_self",
    "workspace_record",
    "organization_record",
    "system_record",
  ]);
}

async function resolveUserContext(supabase, options) {
  if (!supabase) {
    return {
      userId: options.userId || DEFAULT_USER_ID,
      userEmail: null,
      isOwnerOrAdmin: false,
      source: options.userId ? "cli_or_env" : "fallback_test_user",
    };
  }
  if (options.userId) {
    const { data, error } = await supabase
      .from("workspace_memberships")
      .select("role")
      .eq("user_id", options.userId)
      .eq("status", "active");
    if (error) throw error;
    return {
      userId: options.userId,
      userEmail: null,
      isOwnerOrAdmin: (data ?? []).some((row) => row.role === "owner" || row.role === "admin"),
      source: "cli_or_env",
    };
  }
  if (process.env.CMO_OWNER_EMAIL) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id,email")
      .eq("email", process.env.CMO_OWNER_EMAIL)
      .maybeSingle();
    if (error) throw error;
    if (profile?.id) {
      return {
        userId: profile.id,
        userEmail: profile.email ?? null,
        isOwnerOrAdmin: true,
        source: "CMO_OWNER_EMAIL",
      };
    }
  }
  return {
    userId: DEFAULT_USER_ID,
    userEmail: null,
    isOwnerOrAdmin: false,
    source: "fallback_test_user",
  };
}

async function resolveWorkspaceScope(supabase, options) {
  const workspaceKey = workspaceKeyFor({ appId: options.appId, workspaceKey: options.workspaceKey });
  if (!workspaceKey) {
    return { workspaceKey: null, scope: null, warning: `Unsupported app/workspace: ${options.appId}` };
  }
  if (!supabase) {
    return { workspaceKey, scope: null, warning: "Supabase admin env missing; workspace DB scope not resolved." };
  }
  const { data, error } = await supabase
    .from("workspaces")
    .select("id,organization_id,workspace_key")
    .eq("workspace_key", workspaceKey)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    return { workspaceKey, scope: null, warning: `Workspace not found in Supabase: ${workspaceKey}` };
  }
  return {
    workspaceKey,
    scope: {
      workspaceId: data.id,
      organizationId: data.organization_id,
      workspaceKey: data.workspace_key,
    },
    warning: null,
  };
}

function toSessionRecord(row) {
  return {
    id: row.id,
    appId: row.app_id ?? null,
    sourceId: row.source_id ?? null,
    userId: row.user_id ?? null,
    status: row.status ?? null,
    runtimeMode: row.runtime_mode ?? null,
    jsonPath: row.json_path ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function toCaptureRecord(row) {
  return {
    id: row.id,
    appId: row.app_id ?? null,
    userId: row.user_id ?? null,
    visibility: normalizeVisibility(row.visibility),
    vaultPath: row.vault_path ?? null,
    sourceAgent: row.source_agent ?? null,
    mode: row.mode ?? null,
    skill: row.skill ?? null,
    sourceClass: row.source_class ?? null,
    captureOrigin: row.capture_origin ?? null,
    reviewStatus: row.review_status ?? null,
    gbrainStatus: row.gbrain_status ?? null,
    createdAt: row.created_at ?? null,
  };
}

function toCandidateRecord(row) {
  return {
    id: row.id,
    captureId: row.capture_id ?? null,
    appId: row.app_id ?? null,
    userId: row.user_id ?? null,
    visibility: normalizeVisibility(row.visibility),
    candidateType: row.candidate_type ?? null,
    reviewStatus: row.review_status ?? null,
    sourcePath: row.source_path ?? null,
    candidateHash: row.candidate_hash ?? null,
    createdAt: row.created_at ?? null,
  };
}

function toAuditRecord(row) {
  return {
    id: row.id,
    actorUserId: row.actor_user_id ?? null,
    eventType: row.event_type ?? null,
    resourceType: row.resource_type ?? null,
    resourceId: row.resource_id ?? null,
    createdAt: row.created_at ?? null,
  };
}

async function resolveIndexedContext(supabase, options, userContext, scope) {
  const warnings = [];
  if (!supabase || !scope) {
    return {
      records: { sessions: [], captures: [], candidates: [] },
      warnings,
    };
  }

  const sessionsQuery = await supabase
    .from("chat_sessions_index")
    .select("id,app_id,source_id,user_id,status,runtime_mode,json_path,created_at,updated_at")
    .eq("workspace_id", scope.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(options.limit);
  if (sessionsQuery.error) throw sessionsQuery.error;

  const capturesQuery = await supabase
    .from("vault_captures_index")
    .select("id,app_id,user_id,visibility,vault_path,source_agent,mode,skill,source_class,capture_origin,review_status,gbrain_status,created_at")
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false })
    .limit(options.limit * 2);
  if (capturesQuery.error) throw capturesQuery.error;

  const candidatesQuery = await supabase
    .from("gbrain_candidates_index")
    .select("id,capture_id,app_id,user_id,visibility,candidate_type,review_status,source_path,candidate_hash,created_at")
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false })
    .limit(options.limit * 2);
  if (candidatesQuery.error) throw candidatesQuery.error;

  const sessions = (sessionsQuery.data ?? [])
    .map(toSessionRecord)
    .filter((record) => queryMatches(options.query, [record.id, record.appId, record.sourceId, record.status, record.runtimeMode, record.jsonPath]))
    .slice(0, options.limit);
  const captures = filterByVisibility((capturesQuery.data ?? []), {
    userId: userContext.userId,
    isOwnerOrAdmin: userContext.isOwnerOrAdmin,
    includeSystem: options.includeSystem,
  })
    .map(toCaptureRecord)
    .filter((record) => queryMatches(options.query, [record.vaultPath, record.appId, record.sourceAgent, record.mode, record.skill, record.sourceClass, record.reviewStatus]))
    .slice(0, options.limit);
  const candidates = filterByVisibility((candidatesQuery.data ?? []), {
    userId: userContext.userId,
    isOwnerOrAdmin: userContext.isOwnerOrAdmin,
    includeSystem: options.includeSystem,
  })
    .map(toCandidateRecord)
    .filter((record) => queryMatches(options.query, [record.sourcePath, record.appId, record.candidateType, record.reviewStatus, record.candidateHash]))
    .slice(0, options.limit);

  let auditEvents;
  if (options.includeSystem && userContext.isOwnerOrAdmin) {
    const auditQuery = await supabase
      .from("audit_events")
      .select("id,actor_user_id,event_type,resource_type,resource_id,created_at")
      .eq("workspace_id", scope.workspaceId)
      .order("created_at", { ascending: false })
      .limit(options.limit);
    if (auditQuery.error) throw auditQuery.error;
    auditEvents = (auditQuery.data ?? [])
      .map(toAuditRecord)
      .filter((record) => queryMatches(options.query, [record.eventType, record.resourceType, record.resourceId]));
  } else if (options.includeSystem) {
    warnings.push("System/audit records require owner/admin access and were not included.");
  }

  return {
    records: {
      sessions,
      captures,
      candidates,
      ...(auditEvents ? { auditEvents } : {}),
    },
    warnings,
  };
}

runOfflinePermissionAssertions();
const resolverSource = readFileSync("src/lib/cmo/indexed-context-resolver.ts", "utf8");
assert.match(resolverSource, /chat_sessions_index/);
assert.match(resolverSource, /vault_captures_index/);
assert.match(resolverSource, /gbrain_candidates_index/);
assert.doesNotMatch(resolverSource, /readFile|writeFile|insert\(|upsert\(|delete\(/);

const options = parseArgs(process.argv.slice(2));
const supabase = adminEnvReady() ? createAdminClient() : null;
const userContext = await resolveUserContext(supabase, options);
const workspaceResolution = await resolveWorkspaceScope(supabase, options);
const resolved = await resolveIndexedContext(supabase, options, userContext, workspaceResolution.scope);
const warnings = [
  ...(workspaceResolution.warning ? [workspaceResolution.warning] : []),
  ...resolved.warnings,
];

const output = {
  ok: warnings.length === 0 || !supabase,
  dryRun: true,
  env: {
    supabaseAdminConfigured: Boolean(supabase),
  },
  input: {
    appId: options.appId,
    workspaceKey: workspaceResolution.workspaceKey,
    limit: options.limit,
    includeSystem: options.includeSystem,
    query: options.query ?? null,
  },
  userContext: {
    userId: userContext.userId,
    userEmail: userContext.userEmail,
    isOwnerOrAdmin: userContext.isOwnerOrAdmin,
    source: userContext.source,
  },
  workspaceId: workspaceResolution.scope?.workspaceId,
  organizationId: workspaceResolution.scope?.organizationId,
  records: {
    sessions: resolved.records.sessions,
    captures: resolved.records.captures,
    candidates: resolved.records.candidates,
    ...(resolved.records.auditEvents ? { auditEvents: resolved.records.auditEvents } : {}),
  },
  counts: {
    sessions: resolved.records.sessions.length,
    captures: resolved.records.captures.length,
    candidates: resolved.records.candidates.length,
    auditEvents: resolved.records.auditEvents?.length ?? 0,
  },
  samples: {
    sessions: resolved.records.sessions.slice(0, 3),
    captures: resolved.records.captures.slice(0, 3),
    candidates: resolved.records.candidates.slice(0, 3),
    auditEvents: resolved.records.auditEvents?.slice(0, 3) ?? [],
  },
  permissionChecks: {
    privateOtherUserFiltered: true,
    workspaceVisibleToAuthenticatedUser: true,
    organizationTreatedAsWorkspaceForMvp: true,
    systemRequiresOwnerAdmin: true,
  },
  safety: {
    indexesOnly: true,
    noFullContentReturned: true,
    noWrites: true,
  },
  warnings,
};

assertNoFullContent(output.records);
assertNoFullContent(output.samples);

console.log(JSON.stringify(output, null, 2));
