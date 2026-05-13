import { readDashboardRuns } from "@/lib/cmo/adapter";
import { cmoErrorResponse } from "@/lib/cmo/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function limitFromRequest(request: Request): number {
  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

  return Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 20;
}

export async function GET(request: Request) {
  try {
    return Response.json(await readDashboardRuns(limitFromRequest(request)));
  } catch (error) {
    return cmoErrorResponse(error);
  }
}
