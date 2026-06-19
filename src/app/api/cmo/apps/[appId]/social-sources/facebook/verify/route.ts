import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { verifyFacebookPageSource } from "@/lib/cmo/facebook-channel-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: RouteContext<"/api/cmo/apps/[appId]/social-sources/facebook/verify">) {
  try {
    await requireRequestUserIfAuthRequired();

    const { appId } = await context.params;
    const payload = await verifyFacebookPageSource(appId);

    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Facebook Page verification failed";

    return Response.json(
      {
        error: message,
        code: "facebook_page_verify_failed",
      },
      { status: message.includes("Authentication required") ? 401 : 500 },
    );
  }
}

