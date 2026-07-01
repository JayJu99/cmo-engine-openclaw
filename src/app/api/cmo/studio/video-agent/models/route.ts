import { getVideoAgentModelsCatalog } from "@/lib/cmo/studio/hermes-video-client";
import { studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getVideoAgentModelsCatalog());
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
