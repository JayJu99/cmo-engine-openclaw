import { resolveBusinessMetrics } from "@/lib/cmo/business-metrics-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ appId: string }> }) {
  const { appId } = await context.params;
  const url = new URL(request.url);
  const result = await resolveBusinessMetrics({
    appId,
    source: url.searchParams.get("source"),
  });

  if (!result) {
    return Response.json(
      {
        error: `Unsupported business metrics resolver scope: ${appId}`,
        code: "business_metrics_resolver_scope_not_supported",
      },
      { status: 404 },
    );
  }

  return Response.json({ data: result });
}
