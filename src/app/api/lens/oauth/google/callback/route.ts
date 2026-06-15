import { NextRequest, NextResponse } from "next/server";

import { getOptionalRequestUser } from "@/lib/cmo/auth";
import { getLensGoogleOAuthConfig } from "@/lib/cmo/lens-google-oauth";
import { encryptLensOAuthToken } from "@/lib/cmo/lens-oauth-crypto";
import {
  LENS_OAUTH_NONCE_COOKIE_NAME,
  verifyLensOAuthState,
  type LensOAuthStatePayload,
} from "@/lib/cmo/lens-oauth-state";
import { upsertGoogleLensOAuthAccount } from "@/lib/cmo/lens-oauth-accounts";
import { buildLensOAuthFinalRedirect, normalizeLensOAuthReturnTo } from "@/lib/cmo/lens-oauth-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface GoogleIdTokenClaims {
  aud?: string;
  email?: string;
  sub?: string;
}

function getFinalRedirectBaseUrl(requestOrigin: string): string {
  return (process.env.CMO_PUBLIC_APP_URL ?? "").trim() || requestOrigin;
}

function redirectWithStatus(
  baseUrl: string,
  returnTo: string | null | undefined,
  status: "connected" | "error",
  code?: string,
  appId?: string | null,
): NextResponse {
  const redirectUrl = buildLensOAuthFinalRedirect(baseUrl, returnTo, status, code, appId);
  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set({
    name: LENS_OAUTH_NONCE_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
    path: "/api/lens/oauth/google",
  });

  return response;
}

function decodeGoogleIdToken(idToken: string, clientId: string): GoogleIdTokenClaims {
  const [, payload] = idToken.split(".");

  if (!payload) {
    return {};
  }

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GoogleIdTokenClaims;

    if (claims.aud && claims.aud !== clientId) {
      return {};
    }

    return claims;
  } catch {
    return {};
  }
}

async function exchangeCodeForTokens(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error("Google OAuth token exchange failed");
  }

  return (await response.json()) as GoogleTokenResponse;
}

async function fetchGoogleEmail(accessToken: string): Promise<Pick<GoogleIdTokenClaims, "email" | "sub">> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return {};
  }

  const data = (await response.json()) as GoogleIdTokenClaims;

  return {
    email: typeof data.email === "string" ? data.email : undefined,
    sub: typeof data.sub === "string" ? data.sub : undefined,
  };
}

function scopesFromTokenResponse(tokenResponse: GoogleTokenResponse): string[] {
  return (tokenResponse.scope ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function validateNonce(state: LensOAuthStatePayload, request: NextRequest): void {
  const cookieNonce = request.cookies.get(LENS_OAUTH_NONCE_COOKIE_NAME)?.value;

  if (!state.nonce || !cookieNonce || state.nonce !== cookieNonce) {
    throw new Error("Invalid Lens OAuth nonce");
  }
}

function safeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("Expired Lens OAuth state")) {
    return "expired_state";
  }

  if (message.includes("Invalid Lens OAuth state")) {
    return "invalid_state";
  }

  if (message.includes("Invalid Lens OAuth nonce")) {
    return "invalid_nonce";
  }

  if (message.includes("Missing Google OAuth server env") || message.includes("Missing Lens OAuth token encryption env") || message.includes("Invalid Lens OAuth token encryption key")) {
    return "server_config_error";
  }

  if (message.includes("Google OAuth token exchange failed")) {
    return "token_exchange_error";
  }

  if (message.includes("Lens OAuth account write failed")) {
    return "supabase_write_error";
  }

  return "callback_failed";
}

export async function GET(request: NextRequest) {
  let state: LensOAuthStatePayload | null = null;
  const baseUrl = getFinalRedirectBaseUrl(request.nextUrl.origin);

  try {
    const url = new URL(request.url);
    const stateText = url.searchParams.get("state");

    if (!stateText) {
      return redirectWithStatus(baseUrl, null, "error", "missing_state", "holdstation-mini-app");
    }

    state = verifyLensOAuthState(stateText);
    validateNonce(state, request);

    const code = url.searchParams.get("code");

    if (!code) {
      return redirectWithStatus(baseUrl, state.return_to, "error", "missing_code", state.app_id);
    }

    if (!state.tenant_id) {
      return redirectWithStatus(baseUrl, state.return_to, "error", "missing_tenant", state.app_id);
    }

    const config = getLensGoogleOAuthConfig();
    const tokenResponse = await exchangeCodeForTokens({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    });

    if (!tokenResponse.refresh_token) {
      return redirectWithStatus(baseUrl, state.return_to, "error", "missing_refresh_token", state.app_id);
    }

    const idTokenClaims = tokenResponse.id_token ? decodeGoogleIdToken(tokenResponse.id_token, config.clientId) : {};
    const userinfoClaims = !idTokenClaims.email && tokenResponse.access_token
      ? await fetchGoogleEmail(tokenResponse.access_token)
      : {};
    const accountEmail = idTokenClaims.email ?? userinfoClaims.email ?? null;
    const googleSubject = idTokenClaims.sub ?? userinfoClaims.sub ?? null;
    const userContext = await getOptionalRequestUser();
    const accessTokenExpiresAt = typeof tokenResponse.expires_in === "number"
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : null;

    await upsertGoogleLensOAuthAccount({
      tenantId: state.tenant_id,
      workspaceId: state.workspace_id ?? null,
      appId: state.app_id ?? null,
      googleEmail: accountEmail,
      googleSubject,
      scopes: scopesFromTokenResponse(tokenResponse),
      encryptedRefreshToken: encryptLensOAuthToken(tokenResponse.refresh_token),
      accessTokenExpiresAt,
      createdByUserId: userContext.mode === "supabase" ? userContext.userId : null,
    });

    return redirectWithStatus(baseUrl, normalizeLensOAuthReturnTo(state.return_to, state.app_id), "connected", undefined, state.app_id);
  } catch (error) {
    return redirectWithStatus(baseUrl, state?.return_to, "error", safeFailureCode(error), state?.app_id);
  }
}
