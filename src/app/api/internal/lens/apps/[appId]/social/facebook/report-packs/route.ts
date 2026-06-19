import { buildFacebookChannelReportPacks } from "@/lib/cmo/facebook-channel-metrics";
import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<"/api/internal/lens/apps/[appId]/social/facebook/report-packs">) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  const { appId } = await context.params;
  const url = new URL(request.url);

  return Response.json(await buildFacebookChannelReportPacks(appId, url.searchParams.get("rangeKey")));
}
