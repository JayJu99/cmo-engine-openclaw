import { readAppMemoryNotes } from "@/lib/cmo/vault-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/apps/[appId]/memory">) {
  try {
    const { appId } = await context.params;

    return Response.json({ data: await readAppMemoryNotes(appId) });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "App memory read failed",
        code: "app_memory_read_failed",
      },
      { status: error instanceof Error && error.message.startsWith("Unknown appId") ? 404 : 500 },
    );
  }
}
