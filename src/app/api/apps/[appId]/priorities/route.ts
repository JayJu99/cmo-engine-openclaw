import { readCLevelPriorityState, saveCLevelPriority } from "@/lib/cmo/vault-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readRequestPayload(request: Request): Promise<unknown> {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

function errorResponse(error: unknown, fallback: string, status = 500) {
  return Response.json(
    {
      error: error instanceof Error ? error.message : fallback,
      code: "app_priority_request_failed",
    },
    { status },
  );
}

export async function GET(_request: Request, context: RouteContext<"/api/apps/[appId]/priorities">) {
  try {
    const { appId } = await context.params;

    return Response.json({ data: await readCLevelPriorityState(appId) });
  } catch (error) {
    return errorResponse(error, "Priority note read failed", error instanceof Error && error.message.startsWith("Unknown appId") ? 404 : 500);
  }
}

export async function POST(request: Request, context: RouteContext<"/api/apps/[appId]/priorities">) {
  try {
    const { appId } = await context.params;
    const body = await readRequestPayload(request);

    return Response.json({ data: await saveCLevelPriority(appId, body) }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        {
          error: "Invalid JSON request body",
          code: "app_priority_invalid_json_body",
        },
        { status: 400 },
      );
    }

    return errorResponse(error, "Priority note write failed", error instanceof Error && error.message.startsWith("Unknown appId") ? 404 : 500);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/apps/[appId]/priorities">) {
  return POST(request, context);
}
