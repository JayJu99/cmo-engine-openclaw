import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { completeStudioAssetUpload } from "@/lib/cmo/studio-asset-ingest";
import { isRecord, readJsonObject, stringValue, studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireRequestUserIfAuthRequired();
    const body = await readJsonObject(request);
    const asset = await completeStudioAssetUpload({
      context: user,
      sessionId: stringValue(body.sessionId ?? body.session_id) ?? "",
      width: body.width,
      height: body.height,
      durationSeconds: body.durationSeconds ?? body.duration_seconds,
      metadata: isRecord(body.metadata) ? body.metadata : {},
    });

    return Response.json({
      asset_id: asset.id,
      storage_key: asset.storage_key,
      asset,
    }, { status: 201 });
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
