import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";
import {
  configuredDuneBusinessQueryKeys,
  runNativeDuneBusinessSync,
  type DuneBusinessSyncMode,
} from "@/lib/cmo/dune-business-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json() as unknown;

    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function modeFromBody(body: Record<string, unknown>): DuneBusinessSyncMode {
  const mode = typeof body.mode === "string" ? body.mode.trim() : "";

  return mode === "refresh_if_stale" ? "refresh_if_stale" : "refresh_all";
}

function queryKeysFromBody(body: Record<string, unknown>) {
  const requested = Array.isArray(body.queryKeys) ? body.queryKeys.filter((value): value is string => typeof value === "string") : undefined;

  return configuredDuneBusinessQueryKeys(requested);
}

function triggerFromBody(body: Record<string, unknown>): string {
  return typeof body.trigger === "string" && body.trigger.trim() ? body.trigger.trim() : "manual";
}

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Native Dune business sync failed";

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
      error: "Native Dune business sync failed",
      code: "native_dune_business_sync_failed",
    },
    { status: 500 },
  );
}

export async function POST(request: Request, context: RouteContext<"/api/internal/lens/apps/[appId]/business/dune/sync">) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  try {
    const { appId } = await context.params;
    const body = await requestBody(request);
    const payload = await runNativeDuneBusinessSync({
      appId,
      queryKeys: queryKeysFromBody(body),
      mode: modeFromBody(body),
      trigger: triggerFromBody(body),
      dryRun: body.dryRun === true,
    });

    return Response.json(payload);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
