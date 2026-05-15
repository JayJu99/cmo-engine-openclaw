import { promoteAppMemoryCandidate } from "@/lib/cmo/vault-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readRequestPayload(request: Request): Promise<unknown> {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

function statusForError(error: unknown): number {
  if (!(error instanceof Error)) {
    return 500;
  }

  if (error.message.startsWith("Unknown appId")) {
    return 404;
  }

  if (
    error.message.startsWith("Invalid") ||
    error.message.includes("required") ||
    error.message.includes("relative path") ||
    error.message.includes("draft memory")
  ) {
    return 400;
  }

  return 500;
}

export async function POST(request: Request, context: RouteContext<"/api/apps/[appId]/promotions">) {
  try {
    const { appId } = await context.params;
    const body = await readRequestPayload(request);

    return Response.json(await promoteAppMemoryCandidate(appId, body), { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        {
          error: "Invalid JSON request body",
          code: "promotion_invalid_json_body",
        },
        { status: 400 },
      );
    }

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Promotion write failed",
        code: "promotion_write_failed",
      },
      { status: statusForError(error) },
    );
  }
}
