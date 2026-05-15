import { readPromotionCandidates } from "@/lib/cmo/vault-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<"/api/apps/[appId]/promotion-candidates">) {
  try {
    const { appId } = await context.params;
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? undefined;

    return Response.json({ data: await readPromotionCandidates(appId, date) });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Promotion candidates read failed",
        code: "promotion_candidates_read_failed",
      },
      { status: error instanceof Error && error.message.startsWith("Unknown appId") ? 404 : 500 },
    );
  }
}
