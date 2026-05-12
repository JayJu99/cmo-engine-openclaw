import { readDashboardRun } from "@/lib/cmo/adapter";
import { cmoErrorResponse } from "@/lib/cmo/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const run = await readDashboardRun(runId);

    if (!run) {
      return Response.json(
        {
          error: "CMO run not found",
          code: "cmo_run_not_found",
        },
        { status: 404 },
      );
    }

    return Response.json(run);
  } catch (error) {
    return cmoErrorResponse(error);
  }
}
