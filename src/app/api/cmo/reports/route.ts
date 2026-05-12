import { CMO_SCHEMA_VERSION } from "@/lib/cmo/types";
import { readDashboardLatestRun } from "@/lib/cmo/adapter";
import { cmoErrorResponse } from "@/lib/cmo/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const run = await readDashboardLatestRun();

    return Response.json({
      schema_version: CMO_SCHEMA_VERSION,
      run_id: run.run_id,
      created_at: run.created_at,
      data: run.reports,
    });
  } catch (error) {
    return cmoErrorResponse(error);
  }
}
