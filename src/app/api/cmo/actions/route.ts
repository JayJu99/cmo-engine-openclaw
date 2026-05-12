import { CMO_SCHEMA_VERSION } from "@/lib/cmo/types";
import { readLatestRun } from "@/lib/cmo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const run = await readLatestRun();

  return Response.json({
    schema_version: CMO_SCHEMA_VERSION,
    run_id: run.run_id,
    created_at: run.created_at,
    data: run.actions,
  });
}
