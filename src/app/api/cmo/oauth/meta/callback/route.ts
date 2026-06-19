import { NextRequest, NextResponse } from "next/server";

import { getOptionalRequestUser } from "@/lib/cmo/auth";
import {
  exchangeMetaCodeForToken,
  fetchMetaAccountProfile,
  upsertMetaOAuthAccount,
} from "@/lib/cmo/facebook-channel-metrics";
import { buildLensOAuthFinalRedirect, normalizeLensOAuthReturnTo } from "@/lib/cmo/lens-oauth-redirect";
import { verifyLensOAuthState, type LensOAuthStatePayload } from "@/lib/cmo/lens-oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const META_OAUTH_NONCE_COOKIE_NAME = "cmo_meta_oauth_nonce";

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
  redirectUrl.searchParams.set("metaOAuth", status);
  if (code) redirectUrl.searchParams.set("metaOAuthCode", code);

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set({
    name: META_OAUTH_NONCE_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
    path: "/api/cmo/oauth/meta",
  });

  return response;
}

function validateNonce(state: LensOAuthStatePayload, request: NextRequest): void {
  const cookieNonce = request.cookies.get(META_OAUTH_NONCE_COOKIE_NAME)?.value;

  if (!state.nonce || !cookieNonce || state.nonce !== cookieNonce) {
    throw new Error("Invalid Meta OAuth nonce");
  }
}

function safeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("Expired Lens OAuth state")) return "expired_state";
  if (message.includes("Invalid Lens OAuth state")) return "invalid_state";
  if (message.includes("Invalid Meta OAuth nonce")) return "invalid_nonce";
  if (message.includes("Missing Meta OAuth server env")) return "server_config_error";
  if (message.includes("meta_token_exchange_failed")) return "token_exchange_error";
  if (message.includes("facebook_oauth_account_write_failed")) return "supabase_write_error";

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

    const token = await exchangeMetaCodeForToken(code);
    const profile = await fetchMetaAccountProfile(token.accessToken);
    const userContext = await getOptionalRequestUser();

    await upsertMetaOAuthAccount({
      tenantId: state.tenant_id,
      providerUserId: profile.id,
      accountName: profile.name,
      accessToken: token.accessToken,
      tokenExpiresAt: token.expiresAt,
      scopes: token.scopes,
      metadata: {
        workspace_id: state.workspace_id,
        app_id: state.app_id,
        created_by_user_id: userContext.mode === "supabase" ? userContext.userId : null,
      },
    });

    return redirectWithStatus(baseUrl, normalizeLensOAuthReturnTo(state.return_to, state.app_id), "connected", undefined, state.app_id);
  } catch (error) {
    return redirectWithStatus(baseUrl, state?.return_to, "error", safeFailureCode(error), state?.app_id);
  }
}

