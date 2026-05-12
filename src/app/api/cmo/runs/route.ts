import { CMO_SCHEMA_VERSION } from "@/lib/cmo/types";
import { readDashboardRuns } from "@/lib/cmo/adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    schema_version: CMO_SCHEMA_VERSION,
    data: await readDashboardRuns(),
  });
}
