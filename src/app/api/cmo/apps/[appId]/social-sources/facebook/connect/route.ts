import { NextResponse } from "next/server";

import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { buildMetaOAuthAuthorizationUrl, getMetaOAuthConfigStatus } from "@/lib/cmo/facebook-channel-metrics";
import {
  createLensOAuthNonce,
  createLensOAuthState,
  LENS_OAUTH_STATE_TTL_SECONDS,
} from "@/lib/cmo/lens-oauth-state";
import { normalizeLensOAuthReturnTo } from "@/lib/cmo/lens-oauth-redirect";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const META_OAUTH_NONCE_COOKIE_NAME = "cmo_meta_oauth_nonce";

export async function GET(request: Request, context: RouteContext<"/api/cmo/apps/[appId]/social-sources/facebook/connect">) {
  try {
    await requireRequestUserIfAuthRequired();

    const { appId } = await context.params;
    const entry = requireWorkspaceRegistryEntry(appId);
    const url = new URL(request.url);
    const returnTo = normalizeLensOAuthReturnTo(url.searchParams.get("returnTo"), entry.appId);
    const configStatus = getMetaOAuthConfigStatus();

    if (!configStatus.configured) {
      return Response.json(
        {
          error: `Missing Meta OAuth server env: ${configStatus.missing.join(", ")}`,
          code: "meta_oauth_not_configured",
          missingConfig: configStatus.missing,
        },
        { status: 500 },
      );
    }

    const nonce = createLensOAuthNonce();
    const state = createLensOAuthState({
      tenant_id: entry.tenantId,
      workspace_id: entry.workspaceId,
      app_id: entry.appId,
      return_to: returnTo,
      nonce,
    });
    const response = NextResponse.redirect(buildMetaOAuthAuthorizationUrl({ state }));

    response.cookies.set({
      name: META_OAUTH_NONCE_COOKIE_NAME,
      value: nonce,
      httpOnly: true,
      secure: request.url.startsWith("https://"),
      sameSite: "lax",
      maxAge: LENS_OAUTH_STATE_TTL_SECONDS,
      path: "/api/cmo/oauth/meta",
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta OAuth start failed";

    return Response.json(
      {
        error: message,
        code: "meta_oauth_start_failed",
      },
      { status: message.includes("Authentication required") ? 401 : 500 },
    );
  }
}

