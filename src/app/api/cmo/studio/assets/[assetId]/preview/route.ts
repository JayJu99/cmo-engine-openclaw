import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { getStudioAssetPlaybackUrl } from "@/lib/cmo/studio-asset-ingest";
import { studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    const user = await requireRequestUserIfAuthRequired();
    const { assetId } = await context.params;
    const { signedUrl } = await getStudioAssetPlaybackUrl({
      context: user,
      assetId,
    });

    return Response.redirect(signedUrl, 302);
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
