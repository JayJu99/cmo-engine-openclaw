import { cmoCreativeAssetResponse } from "@/lib/cmo/creative-asset-response";
import { cmoErrorResponse } from "@/lib/cmo/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ appId: string; assetId: string }> }) {
  try {
    const { appId, assetId } = await context.params;

    return await cmoCreativeAssetResponse({
      request: _request,
      appId,
      assetId,
      mode: "preview",
    });
  } catch (error) {
    return cmoErrorResponse(error);
  }
}
