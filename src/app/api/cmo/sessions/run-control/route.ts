import { stopAppChatRun } from "@/lib/cmo/app-chat-store";
import { cmoErrorResponse } from "@/lib/cmo/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const record = typeof body === "object" && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    const action = stringField(record, "action");

    if (action !== "stop") {
      return Response.json({ error: "Unsupported CMO run control action", code: "cmo_run_control_unsupported_action" }, { status: 400 });
    }

    const appId = stringField(record, "appId");
    const sessionId = stringField(record, "sessionId");
    const assistantMessageId = stringField(record, "assistantMessageId");
    const cmoRunId = stringField(record, "cmoRunId") || undefined;

    if (!appId || !sessionId || !assistantMessageId) {
      return Response.json({ error: "appId, sessionId, and assistantMessageId are required", code: "cmo_run_control_invalid_request" }, { status: 400 });
    }

    const session = await stopAppChatRun({ appId, sessionId, assistantMessageId, cmoRunId });

    if (!session) {
      return Response.json({ error: "CMO session not found", code: "cmo_run_control_session_not_found" }, { status: 404 });
    }

    return Response.json({ data: session }, { status: 200 });
  } catch (error) {
    return cmoErrorResponse(error);
  }
}
