import { readAppMetricsSnapshot } from "@/lib/cmo/app-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ appId: string }> }) {
  const { appId } = await context.params;
  const url = new URL(request.url);
  const snapshot = await readAppMetricsSnapshot({
    appId,
    range: url.searchParams.get("range"),
    startDate: url.searchParams.get("startDate"),
    endDate: url.searchParams.get("endDate"),
    compare: url.searchParams.get("compare"),
  });

  if (!snapshot) {
    return Response.json(
      {
        error: `Unsupported app metrics scope: ${appId}`,
        code: "app_metrics_scope_not_supported",
      },
      { status: 404 },
    );
  }

  return Response.json({ data: snapshot });
}
