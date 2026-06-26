import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { createStudioAssetUploadSession } from "@/lib/cmo/studio-asset-ingest";
import { readJsonObject, stringValue, studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireRequestUserIfAuthRequired();
    const body = await readJsonObject(request);
    const session = await createStudioAssetUploadSession({
      context: user,
      jobId: stringValue(body.jobId ?? body.job_id) ?? "",
      mediaKind: body.mediaKind ?? body.media_kind,
      purpose: body.purpose,
      expectedMimeType: body.expectedMimeType ?? body.expected_mime_type ?? body.mimeType ?? body.mime_type,
    });

    return Response.json({
      session_id: session.id,
      upload_target: session.upload_target,
      storage_key: session.storage_key,
      allowed_mime_types: session.allowed_mime_types,
      max_bytes: session.max_bytes,
      expires_at: session.expires_at,
      session,
    }, { status: 201 });
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
