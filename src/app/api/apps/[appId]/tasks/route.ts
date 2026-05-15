import { readAppTaskSummary } from "@/lib/cmo/vault-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/apps/[appId]/tasks">) {
  try {
    const { appId } = await context.params;

    return Response.json({ data: await readAppTaskSummary(appId) });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Task summary read failed",
        code: "app_tasks_read_failed",
      },
      { status: error instanceof Error && error.message.startsWith("Unknown appId") ? 404 : 500 },
    );
  }
}
