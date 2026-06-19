import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { runNativeFacebookChannelSync } from "@/lib/cmo/facebook-channel-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request, context: RouteContext<"/api/cmo/apps/[appId]/social-sources/facebook/sync">) {
  try {
    await requireRequestUserIfAuthRequired();

    const { appId } = await context.params;
    const body = await request.json().catch(() => ({})) as unknown;
    const record = isRecord(body) ? body : {};
    const payload = await runNativeFacebookChannelSync({
      appId,
      rangeKey: typeof record.rangeKey === "string" ? record.rangeKey : "this_week",
      mode: record.mode === "refresh_all" || record.mode === "refresh_if_stale" || record.mode === "cache_only" ? record.mode : "refresh_all",
      trigger: "dashboard_manual",
      dryRun: false,
    });

    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Facebook Native sync failed";

    return Response.json(
      {
        error: message,
        code: "facebook_native_sync_failed",
      },
      { status: message.includes("Authentication required") ? 401 : 500 },
    );
  }
}
