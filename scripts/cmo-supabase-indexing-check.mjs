import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const writeTest = process.argv.includes("--write-test");
const workspaceKeys = [
  "holdstation-wallet",
  "hold-pay",
  "tickx",
  "world-app-holdstation-mini-app",
  "world-app-aion",
  "world-app-winance",
  "world-app-feeback",
];

function envPresent(name) {
  return Boolean((process.env[name] ?? "").trim());
}

function adminEnvReady() {
  return envPresent("NEXT_PUBLIC_SUPABASE_URL") &&
    envPresent("NEXT_PUBLIC_SUPABASE_ANON_KEY") &&
    envPresent("SUPABASE_SERVICE_ROLE_KEY");
}

const helper = readFileSync("src/lib/cmo/supabase-indexing.ts", "utf8");
const adminHelper = readFileSync("src/lib/supabase/admin.ts", "utf8");
const envExample = readFileSync(".env.example", "utf8");
const migration = readFileSync("supabase/migrations/202605260001_cmo_auth_foundation.sql", "utf8");

assert.match(envExample, /CMO_SUPABASE_INDEXING_ENABLED=false/);
assert.match(helper, /createSupabaseAdminClient/);
assert.match(helper, /CMO_SUPABASE_INDEXING_ENABLED/);
assert.match(helper, /CMO_SUPABASE_INDEXING_ENABLED is false/);
assert.match(adminHelper, /import "server-only"/);
assert.doesNotMatch(migration.match(/create table if not exists public\.chat_messages_index \([\s\S]*?\);/)?.[0] ?? "", /\bcontent\b/i);
assert.doesNotMatch(migration.match(/create table if not exists public\.chat_sessions_index \([\s\S]*?\);/)?.[0] ?? "", /\banswer\b|\bquestion\b|\bcontent\b/i);
assert.doesNotMatch(migration.match(/create table if not exists public\.vault_captures_index \([\s\S]*?\);/)?.[0] ?? "", /\bmarkdown\b|\bcontent\b|\bbody\b/i);

const report = {
  ok: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: envPresent("NEXT_PUBLIC_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: envPresent("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: envPresent("SUPABASE_SERVICE_ROLE_KEY"),
    CMO_SUPABASE_INDEXING_ENABLED: process.env.CMO_SUPABASE_INDEXING_ENABLED ?? "false",
  },
  staticChecks: {
    flagDocumented: true,
    helperLazyLoadsAdminClient: true,
    serviceRoleServerOnly: true,
    noFullContentColumns: true,
  },
  workspaceResolution: "skipped_missing_admin_env",
  dryRun: !writeTest,
  writeTest: "not_requested",
};

if (adminEnvReady()) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: workspaces, error } = await supabase
    .from("workspaces")
    .select("id, organization_id, workspace_key")
    .in("workspace_key", workspaceKeys);

  if (error) {
    throw error;
  }

  const found = new Set((workspaces ?? []).map((workspace) => workspace.workspace_key));
  const missing = workspaceKeys.filter((key) => !found.has(key));
  report.workspaceResolution = {
    found: found.size,
    missing,
  };

  if (writeTest) {
    const miniApp = (workspaces ?? []).find((workspace) => workspace.workspace_key === "world-app-holdstation-mini-app");
    assert.ok(miniApp, "world-app-holdstation-mini-app workspace is required for write-test");

    const suffix = randomUUID();
    const sessionId = `u6a_check_session_${suffix}`;
    const userMessageId = `u6a_check_user_${suffix}`;
    const assistantMessageId = `u6a_check_assistant_${suffix}`;
    const vaultPath = `u6a-check/${suffix}.md`;
    const candidateHash = `u6a${suffix.replace(/-/g, "").slice(0, 13)}`;
    const now = new Date().toISOString();
    const cleanup = async () => {
      await supabase.from("audit_events").delete().like("resource_id", `u6a_check_%`);
      await supabase.from("gbrain_candidates_index").delete().eq("candidate_hash", candidateHash);
      await supabase.from("vault_captures_index").delete().eq("vault_path", vaultPath);
      await supabase.from("chat_sessions_index").delete().eq("id", sessionId);
    };

    await cleanup();
    try {
      let result = await supabase.from("chat_sessions_index").upsert({
        id: sessionId,
        organization_id: miniApp.organization_id,
        workspace_id: miniApp.id,
        app_id: "holdstation-mini-app",
        source_id: "holdstation__holdstation-mini-app",
        user_id: null,
        status: "completed",
        runtime_mode: "fallback",
        json_path: `data/cmo-dashboard/app-chat/${sessionId}.json`,
        created_at: now,
        updated_at: now,
      }, { onConflict: "id" });
      if (result.error) throw result.error;

      result = await supabase.from("chat_messages_index").upsert([
        { id: userMessageId, session_id: sessionId, user_id: null, role: "user", created_at: now },
        { id: assistantMessageId, session_id: sessionId, user_id: null, role: "assistant", created_at: now },
      ], { onConflict: "id" });
      if (result.error) throw result.error;

      const captureInsert = await supabase.from("vault_captures_index").insert({
        organization_id: miniApp.organization_id,
        workspace_id: miniApp.id,
        app_id: "holdstation-mini-app",
        user_id: null,
        visibility: "workspace",
        vault_path: vaultPath,
        source_agent: "CMO",
        mode: "session",
        skill: "cmo",
        source_class: "cmo_interpretation",
        capture_origin: "auto",
        review_status: "raw",
        gbrain_status: "pending",
        created_at: now,
      }).select("id").single();
      if (captureInsert.error) throw captureInsert.error;

      result = await supabase.from("gbrain_candidates_index").insert({
        capture_id: captureInsert.data.id,
        organization_id: miniApp.organization_id,
        workspace_id: miniApp.id,
        app_id: "holdstation-mini-app",
        user_id: null,
        visibility: "private",
        candidate_type: "lesson",
        review_status: "review_candidate",
        source_path: vaultPath,
        candidate_hash: candidateHash,
        created_at: now,
      });
      if (result.error) throw result.error;

      result = await supabase.from("audit_events").insert({
        actor_user_id: null,
        organization_id: miniApp.organization_id,
        workspace_id: miniApp.id,
        event_type: "u6a_indexing_check",
        resource_type: "check",
        resource_id: `u6a_check_${suffix}`,
        metadata: { dry_run: false },
        created_at: now,
      });
      if (result.error) throw result.error;

      report.writeTest = "passed_then_cleaned_up";
    } finally {
      await cleanup();
    }
  }
}

console.log(JSON.stringify(report, null, 2));
