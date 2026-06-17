import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";
import {
  productLensGa4ErrorCode,
  syncProductLensGa4Catalog,
} from "@/lib/cmo/lens-ga4-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "GA4 catalog sync request failed";

  if (message.includes("Unknown workspace app scope")) {
    return Response.json(
      {
        error: "Unknown appId",
        code: "unknown_app_id",
      },
      { status: 404 },
    );
  }

  return Response.json(
    {
      error: "GA4 catalog sync request failed",
      code: productLensGa4ErrorCode(error),
    },
    { status: 500 },
  );
}

export async function POST(request: Request, context: RouteContext<"/api/internal/lens/apps/[appId]/ga4/catalog/sync">) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  try {
    const { appId } = await context.params;
    const payload = await syncProductLensGa4Catalog({ appId });

    return Response.json(payload);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
