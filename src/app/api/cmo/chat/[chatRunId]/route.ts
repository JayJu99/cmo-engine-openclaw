import { readDashboardChat } from "@/lib/cmo/adapter";
import { cmoErrorResponse } from "@/lib/cmo/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ chatRunId: string }> }) {
  try {
    const { chatRunId } = await context.params;
    const chatRun = await readDashboardChat(chatRunId);

    if (!chatRun) {
      return Response.json(
        {
          error: "CMO chat run not found",
          code: "cmo_chat_run_not_found",
        },
        { status: 404 },
      );
    }

    return Response.json(chatRun);
  } catch (error) {
    return cmoErrorResponse(error);
  }
}
