import "server-only";

import type { LensOAuthSafeAccount } from "@/lib/cmo/lens-oauth-accounts";

export const GOOGLE_ANALYTICS_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const GOOGLE_OAUTH_SCOPES = [
  GOOGLE_ANALYTICS_READONLY_SCOPE,
  "openid",
  "email",
  "profile",
] as const;

export interface LensGoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export type LensGoogleAccessTokenErrorCode =
  | "oauth_account_not_found"
  | "oauth_account_wrong_tenant"
  | "token_expired"
  | "token_revoked"
  | "google_token_exchange_failed";

interface GoogleRefreshTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  scope?: string;
  token_type?: string;
}

interface GoogleRefreshTokenSuccessResponse extends GoogleRefreshTokenResponse {
  access_token: string;
}

export class LensGoogleAccessTokenError extends Error {
  code: LensGoogleAccessTokenErrorCode;

  constructor(code: LensGoogleAccessTokenErrorCode, message: string) {
    super(message);
    this.name = "LensGoogleAccessTokenError";
    this.code = code;
  }
}

function envValue(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function getLensOAuthConfigStatus(): {
  configured: boolean;
  missing: string[];
} {
  const required = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "LENS_OAUTH_STATE_SECRET",
    "LENS_OAUTH_TOKEN_ENCRYPTION_KEY",
  ];
  const missing = required.filter((name) => !envValue(name));

  return {
    configured: missing.length === 0,
    missing,
  };
}

export function getLensGoogleOAuthConfig(): LensGoogleOAuthConfig {
  const missing = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
  ].filter((name) => !envValue(name));

  if (missing.length) {
    throw new Error(`Missing Google OAuth server env: ${missing.join(", ")}`);
  }

  return {
    clientId: envValue("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: envValue("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: envValue("GOOGLE_OAUTH_REDIRECT_URI"),
  };
}

export function buildGoogleOAuthAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): URL {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);

  return url;
}

function mapGoogleTokenError(data: GoogleRefreshTokenResponse, status: number): LensGoogleAccessTokenErrorCode {
  if (data.error === "invalid_grant") {
    return "token_revoked";
  }

  if (status === 401) {
    return "token_expired";
  }

  return "google_token_exchange_failed";
}

async function exchangeRefreshTokenForAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleRefreshTokenSuccessResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as GoogleRefreshTokenResponse;

  if (!response.ok || !data.access_token) {
    const code = mapGoogleTokenError(data, response.status);
    throw new LensGoogleAccessTokenError(code, code);
  }

  return data as GoogleRefreshTokenSuccessResponse;
}

export async function getLensGoogleAccessToken(input: {
  oauthAccountId: string;
  tenantId: string;
}): Promise<{
  accessToken: string;
  expiresAt: string | null;
  account: LensOAuthSafeAccount;
}> {
  const [
    { decryptLensOAuthToken },
    {
      getGoogleLensOAuthAccountForToken,
      toSafeLensOAuthAccount,
      updateGoogleLensOAuthAccountRefreshMetadata,
    },
  ] = await Promise.all([
    import("@/lib/cmo/lens-oauth-crypto"),
    import("@/lib/cmo/lens-oauth-accounts"),
  ]);
  const account = await getGoogleLensOAuthAccountForToken({ oauthAccountId: input.oauthAccountId });

  if (!account) {
    throw new LensGoogleAccessTokenError("oauth_account_not_found", "oauth_account_not_found");
  }

  if (account.tenant_id !== input.tenantId) {
    throw new LensGoogleAccessTokenError("oauth_account_wrong_tenant", "oauth_account_wrong_tenant");
  }

  if (account.status === "revoked") {
    throw new LensGoogleAccessTokenError("token_revoked", "token_revoked");
  }

  const config = getLensGoogleOAuthConfig();

  try {
    const tokenResponse = await exchangeRefreshTokenForAccessToken({
      refreshToken: decryptLensOAuthToken(account.encrypted_refresh_token),
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    const expiresAt = typeof tokenResponse.expires_in === "number"
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : null;

    await updateGoogleLensOAuthAccountRefreshMetadata({
      oauthAccountId: account.id,
      status: "connected",
      accessTokenExpiresAt: expiresAt,
      lastRefreshAt: new Date().toISOString(),
      lastError: null,
    });

    return {
      accessToken: tokenResponse.access_token,
      expiresAt,
      account: toSafeLensOAuthAccount(account),
    };
  } catch (error) {
    const code = error instanceof LensGoogleAccessTokenError ? error.code : "google_token_exchange_failed";
    await updateGoogleLensOAuthAccountRefreshMetadata({
      oauthAccountId: account.id,
      status: code === "token_revoked" ? "revoked" : "error",
      lastError: code,
    });

    throw error instanceof LensGoogleAccessTokenError
      ? error
      : new LensGoogleAccessTokenError("google_token_exchange_failed", "google_token_exchange_failed");
  }
}
