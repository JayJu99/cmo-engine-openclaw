import { readChannelMetricsSyncStatus } from "@/lib/cmo/channel-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ appId: string }> }) {
  const { appId } = await context.params;
  const url = new URL(request.url);
  const status = await readChannelMetricsSyncStatus({
    appId,
    channel: url.searchParams.get("channel"),
  });

  if (!status) {
    return Response.json(
      {
        error: `Unsupported channel metrics sync status scope: ${appId}`,
        code: "channel_metrics_sync_status_scope_not_supported",
      },
      { status: 404 },
    );
  }

  return Response.json({ data: status });
}
