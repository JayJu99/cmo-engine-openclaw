import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";
import {
  normalizeProductLensDeepSyncMode,
  normalizeProductLensDeepSyncPackKeys,
  normalizeProductLensDeepSyncRangeKeys,
  runProductLensDailyDeepSync,
} from "@/lib/cmo/lens-ga4-deep-sync";

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

function appIdsFromBody(body: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(body.appIds)) {
    return undefined;
  }

  const appIds = body.appIds
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim());

  return appIds.length ? Array.from(new Set(appIds)) : undefined;
}

function triggerFromBody(body: Record<string, unknown>): string {
  return typeof body.trigger === "string" && body.trigger.trim() ? body.trigger.trim() : "daily";
}

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Lens daily deep sync request failed";

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
      error: "Lens daily deep sync request failed",
      code: "lens_daily_deep_sync_request_failed",
    },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  try {
    const body = await requestBody(request);
    const payload = await runProductLensDailyDeepSync({
      appIds: appIdsFromBody(body),
      rangeKeys: normalizeProductLensDeepSyncRangeKeys(body.rangeKeys),
      packKeys: normalizeProductLensDeepSyncPackKeys(body.packKeys),
      mode: normalizeProductLensDeepSyncMode(body),
      trigger: triggerFromBody(body),
    });

    return Response.json(payload);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
