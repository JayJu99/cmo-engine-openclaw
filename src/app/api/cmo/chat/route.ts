import { readDashboardChats, startDashboardChat } from "@/lib/cmo/adapter";
import { createAppChatSession, isAppChatPayload, readAppChatSessions } from "@/lib/cmo/app-chat-store";
import { cmoErrorResponse } from "@/lib/cmo/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function limitFromRequest(request: Request): number {
  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

  return Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 20;
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

    if (isAppChatPayload(body)) {
      return Response.json(await createAppChatSession(body), { status: 200 });
    }

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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    if (url.searchParams.get("scope") === "app") {
      const appId = url.searchParams.get("appId") ?? undefined;

      return Response.json({
        data: await readAppChatSessions(limitFromRequest(request), appId),
      });
    }

    return Response.json(await readDashboardChats(limitFromRequest(request)));
  } catch (error) {
    return cmoErrorResponse(error);
  }
}
