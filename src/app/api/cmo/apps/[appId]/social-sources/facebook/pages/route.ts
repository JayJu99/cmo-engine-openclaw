import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { listAccessibleFacebookPages } from "@/lib/cmo/facebook-channel-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<"/api/cmo/apps/[appId]/social-sources/facebook/pages">) {
  try {
    await requireRequestUserIfAuthRequired();

    const { appId } = await context.params;
    const url = new URL(request.url);
    const payload = await listAccessibleFacebookPages({
      appId,
      authRef: url.searchParams.get("authRef"),
    });

    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Facebook Pages lookup failed";

    return Response.json(
      {
        error: message,
        code: "facebook_pages_lookup_failed",
      },
      { status: message.includes("Authentication required") ? 401 : 500 },
    );
  }
}

