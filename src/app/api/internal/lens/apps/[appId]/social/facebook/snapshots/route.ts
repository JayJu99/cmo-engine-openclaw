import { buildFacebookChannelSnapshotsResponse } from "@/lib/cmo/facebook-channel-metrics";
import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<"/api/internal/lens/apps/[appId]/social/facebook/snapshots">) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  const { appId } = await context.params;

  return Response.json(await buildFacebookChannelSnapshotsResponse(appId));
}

