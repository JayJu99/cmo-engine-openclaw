import { createClient } from "@supabase/supabase-js";

const ownerEmail = (process.env.CMO_OWNER_EMAIL || process.argv.find((arg) => arg.startsWith("--email="))?.slice("--email=".length) || "").trim().toLowerCase();
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const organization = {
  name: "CMO Engine",
  slug: "cmo-engine",
};

const workspaces = [
  { workspace_key: "holdstation-wallet", name: "Holdstation Wallet", workspace_group: "Holdstation", project: "holdstation-wallet" },
  { workspace_key: "hold-pay", name: "Hold Pay", workspace_group: "Holdstation", project: "hold-pay" },
  { workspace_key: "tickx", name: "TickX", workspace_group: "Holdstation", project: "tickx" },
  { workspace_key: "world-app-holdstation-mini-app", name: "Holdstation Mini App", workspace_group: "World App", project: "holdstation-mini-app" },
  { workspace_key: "world-app-aion", name: "AION", workspace_group: "World App", project: "aion" },
  { workspace_key: "world-app-winance", name: "Winance", workspace_group: "World App", project: "winance" },
  { workspace_key: "world-app-feeback", name: "Feeback", workspace_group: "World App", project: "feeback" },
];

function assertEnv() {
  const missing = [];

  if (!ownerEmail) {
    missing.push("CMO_OWNER_EMAIL or --email=<owner-email>");
  }

  if (!supabaseUrl) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!serviceRoleKey) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  if (missing.length) {
    console.error(`Missing required seed inputs: ${missing.join(", ")}`);
    process.exit(1);
  }
}

async function findAuthUserByEmail(supabase, email) {
  let page = 1;
  const perPage = 1000;

  while (page < 100) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw error;
    }

    const user = data.users.find((item) => item.email?.toLowerCase() === email);

    if (user) {
      return user;
    }

    if (data.users.length < perPage) {
      return null;
    }

    page += 1;
  }

  return null;
}

async function upsertSingle(supabase, table, payload, onConflict, select = "*") {
  const { data, error } = await supabase
    .from(table)
    .upsert(payload, { onConflict })
    .select(select)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function main() {
  assertEnv();

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const authUser = await findAuthUserByEmail(supabase, ownerEmail);

  if (!authUser) {
    console.log("Create the owner user in Supabase Auth first, then rerun seed.");
    console.log(JSON.stringify({ ok: false, reason: "owner_auth_user_missing", ownerEmail }, null, 2));
    return;
  }

  const profile = await upsertSingle(
    supabase,
    "profiles",
    {
      id: authUser.id,
      email: authUser.email ?? ownerEmail,
      display_name: authUser.user_metadata?.name ?? authUser.email ?? ownerEmail,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    "id",
  );
  const org = await upsertSingle(
    supabase,
    "organizations",
    {
      ...organization,
      owner_user_id: profile.id,
    },
    "slug",
  );
  const seededWorkspaces = [];

  for (const workspace of workspaces) {
    const seededWorkspace = await upsertSingle(
      supabase,
      "workspaces",
      {
        organization_id: org.id,
        workspace_key: workspace.workspace_key,
        name: workspace.name,
        workspace_group: workspace.workspace_group,
        project: workspace.project,
        default_visibility: "workspace",
      },
      "organization_id,workspace_key",
    );

    await upsertSingle(
      supabase,
      "workspace_memberships",
      {
        workspace_id: seededWorkspace.id,
        user_id: profile.id,
        role: "owner",
        status: "active",
      },
      "workspace_id,user_id",
    );

    seededWorkspaces.push(seededWorkspace.workspace_key);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        ownerEmail,
        organization: org.slug,
        workspaces: seededWorkspaces,
        role: "owner",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Owner seed failed.");
  process.exit(1);
});
