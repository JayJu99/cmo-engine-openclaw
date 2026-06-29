import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { getStudioAssetPlaybackUrl } from "@/lib/cmo/studio-asset-ingest";
import { studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    const user = await requireRequestUserIfAuthRequired();
    const { assetId } = await context.params;
    const url = new URL(request.url);
    const { signedUrl } = await getStudioAssetPlaybackUrl({
      context: user,
      assetId,
      kind: url.searchParams.get("kind") === "thumbnail" ? "thumbnail" : "asset",
    });

    return Response.redirect(signedUrl, 302);
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
