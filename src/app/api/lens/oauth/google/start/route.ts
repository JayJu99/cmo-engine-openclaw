import { NextResponse } from "next/server";

import { buildGoogleOAuthAuthorizationUrl, getLensGoogleOAuthConfig, getLensOAuthConfigStatus } from "@/lib/cmo/lens-google-oauth";
import {
  createLensOAuthNonce,
  createLensOAuthState,
  LENS_OAUTH_NONCE_COOKIE_NAME,
  LENS_OAUTH_STATE_TTL_SECONDS,
} from "@/lib/cmo/lens-oauth-state";
import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeReturnTo(value: string | null, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  return value;
}

export async function GET(request: Request) {
  try {
    await requireRequestUserIfAuthRequired();

    const url = new URL(request.url);
    const appId = url.searchParams.get("appId")?.trim() || "holdstation-mini-app";
    const entry = requireWorkspaceRegistryEntry(appId);
    const returnTo = safeReturnTo(url.searchParams.get("returnTo"), `${entry.route}?tab=dashboard`);
    const configStatus = getLensOAuthConfigStatus();

    if (!configStatus.configured) {
      throw new Error(`Missing Lens OAuth server env: ${configStatus.missing.join(", ")}`);
    }

    const config = getLensGoogleOAuthConfig();
    const nonce = createLensOAuthNonce();
    const state = createLensOAuthState({
      tenant_id: entry.tenantId,
      workspace_id: entry.workspaceId,
      app_id: entry.appId,
      return_to: returnTo,
      nonce,
    });
    const oauthUrl = buildGoogleOAuthAuthorizationUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
    });
    const response = NextResponse.redirect(oauthUrl);

    response.cookies.set({
      name: LENS_OAUTH_NONCE_COOKIE_NAME,
      value: nonce,
      httpOnly: true,
      secure: config.redirectUri.startsWith("https://"),
      sameSite: "lax",
      maxAge: LENS_OAUTH_STATE_TTL_SECONDS,
      path: "/api/lens/oauth/google",
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google OAuth start failed";

    return Response.json(
      {
        error: message,
        code: "lens_google_oauth_start_failed",
      },
      { status: message.includes("Authentication required") ? 401 : 500 },
    );
  }
}
