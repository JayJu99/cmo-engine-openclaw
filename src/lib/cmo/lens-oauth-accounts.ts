import "server-only";

export type LensOAuthAccountStatus = "connected" | "revoked" | "error";

export interface LensOAuthSafeAccount {
  id: string;
  tenantId: string;
  provider: "google";
  googleEmail: string | null;
  scopes: string[];
  status: LensOAuthAccountStatus;
  createdAt: string;
  updatedAt: string;
  lastRefreshAt?: string | null;
  lastError?: string | null;
}

interface LensOAuthAccountRow {
  id: string;
  tenant_id: string;
  provider: "google";
  google_email: string | null;
  scopes: string[] | null;
  status: LensOAuthAccountStatus;
  created_at: string;
  updated_at: string;
  last_refresh_at: string | null;
  last_error: string | null;
}

export interface UpsertGoogleLensOAuthAccountInput {
  tenantId: string;
  workspaceId?: string | null;
  appId?: string | null;
  googleEmail: string | null;
  googleSubject?: string | null;
  scopes: string[];
  encryptedRefreshToken: string;
  accessTokenExpiresAt?: string | null;
  createdByUserId?: string | null;
}

async function getLensOAuthAccountsClient() {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");

  return createSupabaseAdminClient();
}

export function toSafeLensOAuthAccount(row: LensOAuthAccountRow): LensOAuthSafeAccount {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: "google",
    googleEmail: row.google_email,
    scopes: row.scopes ?? [],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRefreshAt: row.last_refresh_at,
    lastError: row.last_error,
  };
}

export async function listGoogleLensOAuthAccounts(input: {
  tenantId: string;
}): Promise<LensOAuthSafeAccount[]> {
  const supabase = await getLensOAuthAccountsClient();
  const { data, error } = await supabase
    .from("lens_oauth_accounts")
    .select("id,tenant_id,provider,google_email,scopes,status,created_at,updated_at,last_refresh_at,last_error")
    .eq("tenant_id", input.tenantId)
    .eq("provider", "google")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Lens OAuth account lookup failed: ${error.message}`);
  }

  return ((data ?? []) as LensOAuthAccountRow[]).map(toSafeLensOAuthAccount);
}

export async function upsertGoogleLensOAuthAccount(input: UpsertGoogleLensOAuthAccountInput): Promise<LensOAuthSafeAccount> {
  const supabase = await getLensOAuthAccountsClient();
  let existingId: string | null = null;

  if (input.googleEmail) {
    const { data, error } = await supabase
      .from("lens_oauth_accounts")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("provider", "google")
      .eq("google_email", input.googleEmail)
      .maybeSingle();

    if (error) {
      throw new Error(`Lens OAuth account lookup failed: ${error.message}`);
    }

    existingId = typeof data?.id === "string" ? data.id : null;
  }

  const row = {
    tenant_id: input.tenantId,
    workspace_id: input.workspaceId ?? null,
    app_id: input.appId ?? null,
    provider: "google",
    google_email: input.googleEmail,
    google_subject: input.googleSubject ?? null,
    scopes: input.scopes,
    encrypted_refresh_token: input.encryptedRefreshToken,
    status: "connected",
    created_by_user_id: input.createdByUserId ?? null,
    access_token_expires_at: input.accessTokenExpiresAt ?? null,
    last_error: null,
  };

  const query = existingId
    ? supabase
        .from("lens_oauth_accounts")
        .update(row)
        .eq("id", existingId)
        .select("id,tenant_id,provider,google_email,scopes,status,created_at,updated_at,last_refresh_at,last_error")
        .single()
    : supabase
        .from("lens_oauth_accounts")
        .insert(row)
        .select("id,tenant_id,provider,google_email,scopes,status,created_at,updated_at,last_refresh_at,last_error")
        .single();

  const { data, error } = await query;

  if (error) {
    throw new Error(`Lens OAuth account write failed: ${error.message}`);
  }

  return toSafeLensOAuthAccount(data as LensOAuthAccountRow);
}
