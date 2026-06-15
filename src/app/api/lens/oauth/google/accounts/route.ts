import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { getLensOAuthConfigStatus } from "@/lib/cmo/lens-google-oauth";
import { listGoogleLensOAuthAccounts } from "@/lib/cmo/lens-oauth-accounts";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireRequestUserIfAuthRequired();

    const url = new URL(request.url);
    const appId = url.searchParams.get("appId")?.trim();

    if (!appId) {
      return Response.json(
        {
          error: "appId is required so the server can resolve the tenant from the workspace registry",
          code: "lens_google_oauth_app_id_required",
        },
        { status: 400 },
      );
    }

    const entry = requireWorkspaceRegistryEntry(appId);
    const configStatus = getLensOAuthConfigStatus();
    const accounts = await listGoogleLensOAuthAccounts({ tenantId: entry.tenantId });

    return Response.json({
      data: accounts,
      oauthConfigured: configStatus.configured,
      missingConfig: configStatus.missing,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lens OAuth account lookup failed";

    return Response.json(
      {
        error: message,
        code: "lens_google_oauth_accounts_failed",
      },
      { status: message.includes("Authentication required") ? 401 : 500 },
    );
  }
}
