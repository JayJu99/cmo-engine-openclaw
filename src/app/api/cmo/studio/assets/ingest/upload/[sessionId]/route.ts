import { uploadStudioAssetSessionBytes } from "@/lib/cmo/studio-asset-ingest";
import { studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    const session = await uploadStudioAssetSessionBytes({
      sessionId,
      contentType: request.headers.get("content-type"),
      bytes: await request.arrayBuffer(),
    });

    return Response.json({
      session_id: session.id,
      status: session.status,
      bytes: session.uploaded_bytes,
      sha256: session.uploaded_sha256,
      mime_type: session.uploaded_mime_type,
      session,
    });
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
