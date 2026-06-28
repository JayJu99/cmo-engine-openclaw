import { CmoAdapterError } from "@/lib/cmo/errors";
import {
  getHermesVideoAgentSetupState,
  getVideoAgentStatus,
} from "@/lib/cmo/studio/hermes-video-client";
import { studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getVideoAgentStatus());
  } catch (error) {
    if (error instanceof CmoAdapterError) {
      if (error.code === "video_agent_not_configured") {
        return Response.json(getHermesVideoAgentSetupState());
      }

      return Response.json({
        configured: true,
        connected: false,
        setupRequired: false,
        cli_available: null,
        authenticated: error.code === "video_agent_auth_failed" ? false : null,
        backend: "higgsfield",
        message: error.message,
        code: error.code,
      });
    }

    return studioRouteErrorResponse(error);
  }
}
