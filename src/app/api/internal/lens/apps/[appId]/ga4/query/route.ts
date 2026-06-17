import { authorizeLensInternalRequest } from "@/lib/cmo/lens-internal-auth";
import {
  ProductLensGa4ValidationError,
  productLensGa4ErrorCode,
  runProductLensGa4AdHocQuery,
} from "@/lib/cmo/lens-ga4-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json() as unknown;

    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "GA4 ad-hoc query request failed";

  if (message.includes("Unknown workspace app scope")) {
    return Response.json(
      {
        error: "Unknown appId",
        code: "unknown_app_id",
      },
      { status: 404 },
    );
  }

  if (error instanceof ProductLensGa4ValidationError) {
    return Response.json(
      {
        error: error.message,
        code: error.code,
      },
      { status: 400 },
    );
  }

  return Response.json(
    {
      error: "GA4 ad-hoc query request failed",
      code: productLensGa4ErrorCode(error),
    },
    { status: 500 },
  );
}

export async function POST(request: Request, context: RouteContext<"/api/internal/lens/apps/[appId]/ga4/query">) {
  const authFailure = authorizeLensInternalRequest(request);

  if (authFailure) {
    return authFailure;
  }

  try {
    const { appId } = await context.params;
    const payload = await runProductLensGa4AdHocQuery({
      appId,
      body: await requestBody(request),
    });

    return Response.json(payload);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
