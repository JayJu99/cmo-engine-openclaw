import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { saveFacebookPageMapping } from "@/lib/cmo/facebook-channel-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export async function POST(request: Request, context: RouteContext<"/api/cmo/apps/[appId]/social-sources/facebook">) {
  try {
    await requireRequestUserIfAuthRequired();

    const { appId } = await context.params;
    const body = await request.json().catch(() => ({})) as unknown;
    const record = isRecord(body) ? body : {};
    const authRef = stringValue(record.authRef ?? record.auth_ref);
    const pageId = stringValue(record.pageId ?? record.page_id);
    const pageName = stringValue(record.pageName ?? record.page_name);

    if (!authRef || !pageId) {
      return Response.json(
        {
          error: "authRef and pageId are required.",
          code: "facebook_page_mapping_invalid_request",
        },
        { status: 400 },
      );
    }

    const source = await saveFacebookPageMapping({
      appId,
      authRef,
      pageId,
      pageName: pageName || null,
    });

    return Response.json({ data: source });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Facebook Page mapping failed";

    return Response.json(
      {
        error: message,
        code: "facebook_page_mapping_failed",
      },
      { status: message.includes("Authentication required") ? 401 : 500 },
    );
  }
}

