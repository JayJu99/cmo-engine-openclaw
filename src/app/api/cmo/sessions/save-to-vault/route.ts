import { saveCmoSessionToVault } from "@/lib/cmo/vault-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readRequestPayload(request: Request): Promise<unknown> {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

export async function POST(request: Request) {
  try {
    const body = await readRequestPayload(request);

    if (!isRecord(body) || typeof body.appId !== "string" || typeof body.sessionId !== "string") {
      return Response.json(
        {
          error: "appId and sessionId are required",
          code: "cmo_session_save_invalid_request",
        },
        { status: 400 },
      );
    }

    return Response.json(
      await saveCmoSessionToVault({
        appId: body.appId,
        sessionId: body.sessionId,
        topic: typeof body.topic === "string" ? body.topic : undefined,
        relatedPriority: typeof body.relatedPriority === "string" ? body.relatedPriority : undefined,
        relatedPlan: typeof body.relatedPlan === "string" ? body.relatedPlan : undefined,
        relatedTasks: stringList(body.relatedTasks),
      }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        {
          error: "Invalid JSON request body",
          code: "cmo_session_save_invalid_json_body",
        },
        { status: 400 },
      );
    }

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Session save failed",
        code: "cmo_session_save_failed",
      },
      { status: error instanceof Error && error.message.startsWith("No session found") ? 404 : 500 },
    );
  }
}
