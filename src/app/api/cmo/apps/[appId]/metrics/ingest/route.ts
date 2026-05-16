import { AppMetricsIngestError, ingestAppMetricsSnapshot } from "@/lib/cmo/app-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ingestKeyResponse(request: Request): Response | null {
  const expectedKey = (process.env.CMO_METRICS_INGEST_API_KEY ?? "").trim();
  const providedKey = request.headers.get("x-cmo-metrics-ingest-key")?.trim() ?? "";
  const isProduction = process.env.NODE_ENV === "production";

  if (!expectedKey) {
    if (isProduction) {
      return Response.json(
        {
          error: "CMO_METRICS_INGEST_API_KEY is required before metrics ingestion can write in production.",
          code: "metrics_ingest_key_not_configured",
        },
        { status: 503 },
      );
    }

    return null;
  }

  if (providedKey !== expectedKey) {
    return Response.json(
      {
        error: "Invalid metrics ingest key.",
        code: "metrics_ingest_unauthorized",
      },
      { status: 401 },
    );
  }

  return null;
}

export async function POST(request: Request, context: { params: Promise<{ appId: string }> }) {
  const authResponse = ingestKeyResponse(request);

  if (authResponse) {
    return authResponse;
  }

  const { appId } = await context.params;
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "true";

  try {
    const snapshot = await ingestAppMetricsSnapshot({
      appId,
      payload: await request.json(),
      dryRun,
    });

    return Response.json({ data: snapshot, dryRun });
  } catch (error) {
    if (error instanceof AppMetricsIngestError) {
      return Response.json(
        {
          error: error.message,
          code: error.code,
        },
        { status: error.status },
      );
    }

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Metrics ingest failed.",
        code: "metrics_ingest_failed",
      },
      { status: 500 },
    );
  }
}
