import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";
import {
  runProductLensAutoSync,
  type ProductLensAutoSyncMode,
} from "@/lib/cmo/lens-auto-sync";
import {
  isWorkspaceGa4MetricRangeKey,
  type WorkspaceGa4MetricRangeKey,
} from "@/lib/cmo/workspace-metric-snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RANGE_KEYS: WorkspaceGa4MetricRangeKey[] = ["this_week", "last_7_days", "last_30_days", "this_month"];

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

function rangeKeysFromBody(body: Record<string, unknown>): WorkspaceGa4MetricRangeKey[] {
  const requested = Array.isArray(body.rangeKeys) ? body.rangeKeys : [];
  const rangeKeys = requested
    .filter((value): value is WorkspaceGa4MetricRangeKey => typeof value === "string" && isWorkspaceGa4MetricRangeKey(value));

  return Array.from(new Set(rangeKeys.length ? rangeKeys : DEFAULT_RANGE_KEYS));
}

function modeFromBody(body: Record<string, unknown>): ProductLensAutoSyncMode {
  if (body.dryRun === true) {
    return "dryRun";
  }

  const value = typeof body.mode === "string" ? body.mode.trim() : "";

  if (value === "refresh_all" || value === "dryRun") {
    return value;
  }

  return "refresh_if_stale";
}

function triggerFromBody(body: Record<string, unknown>): string {
  return typeof body.trigger === "string" && body.trigger.trim() ? body.trigger.trim() : "hourly";
}

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Lens auto-sync request failed";

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
      error: "Lens auto-sync request failed",
      code: "lens_auto_sync_request_failed",
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
    const payload = await runProductLensAutoSync({
      appIds: appIdsFromBody(body),
      rangeKeys: rangeKeysFromBody(body),
      mode: modeFromBody(body),
      trigger: triggerFromBody(body),
    });

    return Response.json(payload);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
