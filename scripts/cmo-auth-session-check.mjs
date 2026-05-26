import { createClient } from "@supabase/supabase-js";

const requiredPublicEnv = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const requiredAdminEnv = [...requiredPublicEnv, "SUPABASE_SERVICE_ROLE_KEY"];
const expectedWorkspaces = [
  "holdstation-wallet",
  "hold-pay",
  "tickx",
  "world-app-holdstation-mini-app",
  "world-app-aion",
  "world-app-winance",
  "world-app-feeback",
];

function envValue(name) {
  return (process.env[name] || "").trim();
}

function envPresence(names) {
  return Object.fromEntries(names.map((name) => [name, Boolean(envValue(name))]));
}

function fail(message, detail) {
  console.error(`FAIL: ${message}`);
  if (detail !== undefined) {
    console.error(JSON.stringify(detail, null, 2));
  }
  process.exit(1);
}

function unique(values) {
  return [...new Set(values)];
}

const missingPublic = requiredPublicEnv.filter((name) => !envValue(name));
const missingAdmin = requiredAdminEnv.filter((name) => !envValue(name));
const ownerEmailPresent = Boolean(envValue("CMO_OWNER_EMAIL"));
const result = {
  ok: true,
  env: {
    public: envPresence(requiredPublicEnv),
    admin: envPresence(requiredAdminEnv),
    ownerEmailPresent,
    authFlags: {
      CMO_AUTH_ENABLED: envValue("CMO_AUTH_ENABLED") || "false",
      CMO_AUTH_REQUIRED: envValue("CMO_AUTH_REQUIRED") || "false",
    },
  },
  clientInitialized: false,
  dbCheck: "skipped_missing_admin_env",
  ownerProfileExists: false,
  organizationExists: false,
  workspaceCount: 0,
  ownerMembershipCount: 0,
  missingWorkspaces: expectedWorkspaces,
};

if (!missingPublic.length) {
  createClient(envValue("NEXT_PUBLIC_SUPABASE_URL"), envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
  result.clientInitialized = true;
}

if (missingAdmin.length) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

if (!ownerEmailPresent) {
  result.dbCheck = "skipped_missing_owner_email";
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const admin = createClient(envValue("NEXT_PUBLIC_SUPABASE_URL"), envValue("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const { data: profile, error: profileError } = await admin
  .from("profiles")
  .select("id,email,status")
  .eq("email", envValue("CMO_OWNER_EMAIL").toLowerCase())
  .maybeSingle();

if (profileError) {
  fail("Could not read owner profile.", { code: profileError.code });
}

result.ownerProfileExists = Boolean(profile?.id);

const { data: organization, error: organizationError } = await admin
  .from("organizations")
  .select("id,slug")
  .eq("slug", "cmo-engine")
  .maybeSingle();

if (organizationError) {
  fail("Could not read CMO Engine organization.", { code: organizationError.code });
}

result.organizationExists = Boolean(organization?.id);

if (!profile?.id || !organization?.id) {
  result.dbCheck = "missing_owner_seed";
  fail("Owner seed is incomplete.", result);
}

const { data: workspaces, error: workspacesError } = await admin
  .from("workspaces")
  .select("id,workspace_key")
  .eq("organization_id", organization.id)
  .in("workspace_key", expectedWorkspaces);

if (workspacesError) {
  fail("Could not read seeded workspaces.", { code: workspacesError.code });
}

const workspaceKeys = unique((workspaces ?? []).map((workspace) => workspace.workspace_key));
const workspaceIds = unique((workspaces ?? []).map((workspace) => workspace.id));

result.workspaceCount = workspaceKeys.length;
result.missingWorkspaces = expectedWorkspaces.filter((workspaceKey) => !workspaceKeys.includes(workspaceKey));

const { data: memberships, error: membershipsError } = await admin
  .from("workspace_memberships")
  .select("workspace_id,role,status")
  .eq("user_id", profile.id)
  .eq("role", "owner")
  .eq("status", "active")
  .in("workspace_id", workspaceIds);

if (membershipsError) {
  fail("Could not read owner memberships.", { code: membershipsError.code });
}

result.ownerMembershipCount = memberships?.length ?? 0;
result.dbCheck = "ok";

if (result.missingWorkspaces.length || result.ownerMembershipCount !== expectedWorkspaces.length) {
  fail("Owner workspace seed is incomplete.", result);
}

console.log(JSON.stringify(result, null, 2));
