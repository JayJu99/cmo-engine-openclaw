import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { dispatchStudioJob } from "@/lib/cmo/studio-dispatcher";
import { createStudioVideoJob, listStudioJobs } from "@/lib/cmo/studio-job-service";
import { isRecord, readJsonObject, stringValue, studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";
import type { StudioAspectRatio, StudioBitrate, StudioResolution } from "@/lib/cmo/studio-model-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function limitFromRequest(request: Request): number {
  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

  return Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 20;
}

function settingsFromBody(body: Record<string, unknown>) {
  const settings = isRecord(body.settings) ? body.settings : body;
  const durationSeconds = settings.durationSeconds ?? settings.duration_seconds;
  const variants = settings.variants;

  return {
    aspectRatio: stringValue(settings.aspectRatio ?? settings.aspect_ratio) as StudioAspectRatio | undefined,
    durationSeconds: typeof durationSeconds === "number"
      ? durationSeconds
      : undefined,
    resolution: stringValue(settings.resolution) as StudioResolution | undefined,
    bitrate: stringValue(settings.bitrate) as StudioBitrate | undefined,
    variants: typeof variants === "number" ? variants : undefined,
  };
}

function inputAssetIdsFromBody(body: Record<string, unknown>): string[] {
  const inputAssetIds = body.inputAssetIds ?? body.input_asset_ids;

  return Array.isArray(inputAssetIds)
    ? inputAssetIds.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function modelIdFromBody(body: Record<string, unknown>): string | undefined {
  if (isRecord(body.model)) {
    return stringValue(body.model.uiId ?? body.model.ui_id ?? body.model.product_model_id ?? body.model.provider_model_id ?? body.model.id);
  }

  return stringValue(body.modelId ?? body.model_id);
}

export async function GET(request: Request) {
  try {
    const user = await requireRequestUserIfAuthRequired();

    return Response.json({ jobs: await listStudioJobs(user, limitFromRequest(request)) });
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireRequestUserIfAuthRequired();
    const body = await readJsonObject(request);
    const result = await createStudioVideoJob(user, {
      prompt: stringValue(body.prompt) ?? "",
      negativePrompt: stringValue(body.negativePrompt ?? body.negative_prompt),
      modelId: modelIdFromBody(body),
      settings: settingsFromBody(body),
      context: isRecord(body.context) ? body.context : {},
      inputAssetIds: inputAssetIdsFromBody(body),
      requestId: stringValue(body.requestId ?? body.request_id) ?? request.headers.get("idempotency-key") ?? undefined,
    });

    if (!result.idempotent) {
      void dispatchStudioJob(result.job).catch((error) => {
        console.warn("[studio] Video job dispatch failed.", {
          jobId: result.job.id,
          reason: error instanceof Error ? error.message : "unknown",
        });
      });
    }

    return Response.json({
      job_id: result.job.id,
      job: result.job,
      idempotent: result.idempotent,
    }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
