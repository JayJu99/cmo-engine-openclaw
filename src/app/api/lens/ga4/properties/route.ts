import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { LensGa4PropertiesError, listLensGa4Properties } from "@/lib/cmo/lens-ga4-properties";
import { getLensGoogleAccessToken, LensGoogleAccessTokenError } from "@/lib/cmo/lens-google-oauth";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseStatusForCode(code: string): number {
  if (code === "oauth_account_not_found") {
    return 404;
  }

  if (code === "oauth_account_wrong_tenant" || code === "property_access_denied") {
    return 403;
  }

  if (code === "token_revoked" || code === "token_expired") {
    return 401;
  }

  return 502;
}

export async function GET(request: Request) {
  try {
    await requireRequestUserIfAuthRequired();

    const url = new URL(request.url);
    const appId = url.searchParams.get("appId")?.trim();
    const oauthAccountId = url.searchParams.get("oauthAccountId")?.trim();

    if (!appId) {
      return Response.json(
        {
          error: "appId is required",
          code: "ga4_properties_app_id_required",
        },
        { status: 400 },
      );
    }

    if (!oauthAccountId) {
      return Response.json(
        {
          error: "oauthAccountId is required",
          code: "oauth_account_id_required",
        },
        { status: 400 },
      );
    }

    const entry = requireWorkspaceRegistryEntry(appId);
    const token = await getLensGoogleAccessToken({
      oauthAccountId,
      tenantId: entry.tenantId,
    });
    const properties = await listLensGa4Properties({ accessToken: token.accessToken });

    return Response.json({ data: properties });
  } catch (error) {
    if (error instanceof LensGoogleAccessTokenError || error instanceof LensGa4PropertiesError) {
      return Response.json(
        {
          error: error.code,
          code: error.code,
        },
        { status: responseStatusForCode(error.code) },
      );
    }

    const message = error instanceof Error ? error.message : "GA4 property discovery failed";

    if (message.includes("Unknown workspace app scope")) {
      return Response.json(
        {
          error: "Unknown appId",
          code: "unknown_app_id",
        },
        { status: 404 },
      );
    }

    return Response.json(
      {
        error: message.includes("Authentication required") ? "Authentication required." : "GA4 property discovery failed",
        code: message.includes("Authentication required") ? "authentication_required" : "ga4_property_discovery_failed",
      },
      { status: message.includes("Authentication required") ? 401 : 500 },
    );
  }
}
