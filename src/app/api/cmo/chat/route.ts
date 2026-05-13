import { startDashboardChat } from "@/lib/cmo/adapter";
import { cmoErrorResponse } from "@/lib/cmo/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readRequestPayload(request: Request): Promise<unknown> {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

export async function POST(request: Request) {
  try {
    const body = await readRequestPayload(request);
    const result = await startDashboardChat(body);

    return Response.json(result.data, { status: result.status });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        {
          error: "Invalid JSON request body",
          code: "cmo_invalid_json_body",
        },
        { status: 400 },
      );
    }

    return cmoErrorResponse(error);
  }
}
