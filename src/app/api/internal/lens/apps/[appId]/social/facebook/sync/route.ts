import { runNativeFacebookChannelSync } from "@/lib/cmo/facebook-channel-metrics";
import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request, context: RouteContext<"/api/internal/lens/apps/[appId]/social/facebook/sync">) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  const { appId } = await context.params;
  const body = await request.json().catch(() => ({})) as unknown;
  const record = isRecord(body) ? body : {};
  const payload = await runNativeFacebookChannelSync({
    appId,
    rangeKey: typeof record.rangeKey === "string" ? record.rangeKey : "this_week",
    mode: record.mode === "refresh_all" || record.mode === "refresh_if_stale" || record.mode === "cache_only" ? record.mode : "refresh_if_stale",
    trigger: typeof record.trigger === "string" ? record.trigger : "manual",
    dryRun: record.dryRun === true,
  });

  return Response.json(payload);
}

