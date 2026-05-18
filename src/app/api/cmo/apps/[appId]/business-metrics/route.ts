import { readBusinessMetricsSnapshot } from "@/lib/cmo/business-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ appId: string }> }) {
  const { appId } = await context.params;
  const url = new URL(request.url);
  const snapshot = await readBusinessMetricsSnapshot({
    appId,
    source: url.searchParams.get("source"),
    group: url.searchParams.get("group"),
  });

  if (!snapshot) {
    return Response.json(
      {
        error: `Unsupported business metrics scope: ${appId}`,
        code: "business_metrics_scope_not_supported",
      },
      { status: 404 },
    );
  }

  return Response.json({ data: snapshot });
}
