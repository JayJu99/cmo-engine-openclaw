import { CmoAdapterError } from "@/lib/cmo/errors";
import {
  getHermesVideoAgentSetupState,
  getVideoAgentStatus,
} from "@/lib/cmo/studio/hermes-video-client";
import { studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withRealVideoState(body: object): Record<string, unknown> {
  return {
    ...body,
    realVideoEnabled: process.env.CMO_STUDIO_REAL_VIDEO_ENABLED === "true",
  };
}

export async function GET() {
  try {
    return Response.json(withRealVideoState(await getVideoAgentStatus()));
  } catch (error) {
    if (error instanceof CmoAdapterError) {
      if (error.code === "video_agent_not_configured") {
        return Response.json(withRealVideoState(getHermesVideoAgentSetupState()));
      }

      return Response.json(withRealVideoState({
        configured: true,
        connected: false,
        setupRequired: false,
        cli_available: null,
        authenticated: error.code === "video_agent_auth_failed" ? false : null,
        backend: "higgsfield",
        message: error.message,
        code: error.code,
      }));
    }

    return studioRouteErrorResponse(error);
  }
}
