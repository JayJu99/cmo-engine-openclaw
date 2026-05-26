import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const migrationPath = path.join(root, "supabase", "migrations", "202605260001_cmo_auth_foundation.sql");
const seedPath = path.join(root, "scripts", "cmo-auth-seed-owner.mjs");
const requiredPublicEnv = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const requiredAdminEnv = [...requiredPublicEnv, "SUPABASE_SERVICE_ROLE_KEY"];

function envValue(name) {
  return (process.env[name] || "").trim();
}

function statusFor(names) {
  return Object.fromEntries(names.map((name) => [name, Boolean(envValue(name))]));
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assert(condition, message, detail) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    if (detail !== undefined) {
      console.error(detail);
    }
    process.exit(1);
  }
}

const envStatus = {
  public: statusFor(requiredPublicEnv),
  admin: statusFor(requiredAdminEnv),
  authFlags: {
    CMO_AUTH_ENABLED: envValue("CMO_AUTH_ENABLED") || "false",
    CMO_AUTH_REQUIRED: envValue("CMO_AUTH_REQUIRED") || "false",
  },
};
const missingPublic = requiredPublicEnv.filter((name) => !envValue(name));
const missingAdmin = requiredAdminEnv.filter((name) => !envValue(name));
const migrationExists = await exists(migrationPath);
const seedExists = await exists(seedPath);

assert(migrationExists, "Expected auth foundation migration SQL to exist.", migrationPath);
assert(seedExists, "Expected owner seed script to exist.", seedPath);

const migration = await readFile(migrationPath, "utf8");
const expectedTables = [
  "profiles",
  "organizations",
  "workspaces",
  "workspace_memberships",
  "chat_sessions_index",
  "chat_messages_index",
  "vault_captures_index",
  "gbrain_candidates_index",
  "audit_events",
];
const missingTables = expectedTables.filter((table) => !migration.includes(`public.${table}`));

assert(missingTables.length === 0, "Expected migration SQL to define required tables.", missingTables);
assert(migration.includes("enable row level security"), "Expected migration SQL to enable RLS.");
assert(migration.includes("is_workspace_member"), "Expected workspace membership RLS helper.");

let clientInitialized = false;
let dbConnection = "skipped_missing_admin_env";

if (!missingPublic.length) {
  createClient(envValue("NEXT_PUBLIC_SUPABASE_URL"), envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
  clientInitialized = true;
}

if (!missingAdmin.length) {
  const admin = createClient(envValue("NEXT_PUBLIC_SUPABASE_URL"), envValue("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { error } = await admin.from("profiles").select("id").limit(1);

  dbConnection = error ? `failed:${error.code ?? "unknown"}` : "ok";
}

console.log(
  JSON.stringify(
    {
      ok: true,
      env: envStatus,
      missingPublic,
      missingAdmin,
      clientInitialized,
      dbConnection,
      migrationPath,
      seedPath,
    },
    null,
    2,
  ),
);
