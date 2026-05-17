import { readChannelMetricsSnapshot } from "@/lib/cmo/channel-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ appId: string }> }) {
  const { appId } = await context.params;
  const url = new URL(request.url);
  const snapshot = await readChannelMetricsSnapshot({
    appId,
    channel: url.searchParams.get("channel"),
    range: url.searchParams.get("range"),
    startDate: url.searchParams.get("startDate"),
    endDate: url.searchParams.get("endDate"),
  });

  if (!snapshot) {
    return Response.json(
      {
        error: `Unsupported channel metrics scope: ${appId}`,
        code: "channel_metrics_scope_not_supported",
      },
      { status: 404 },
    );
  }

  return Response.json({ data: snapshot });
}
