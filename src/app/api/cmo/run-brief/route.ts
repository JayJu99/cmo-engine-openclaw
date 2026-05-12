import { runDashboardBrief } from "@/lib/cmo/adapter";
import { cmoErrorResponse } from "@/lib/cmo/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    const payload = isRecord(body)
      ? {
          workspace: "default",
          requested_by: "dashboard",
          input: {},
          ...body,
        }
      : {
          workspace: "default",
          requested_by: "dashboard",
          input: body,
        };
    const result = await runDashboardBrief(payload);

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
