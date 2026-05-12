import { CMO_SCHEMA_VERSION } from "@/lib/cmo/types";
import { readRuns } from "@/lib/cmo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    schema_version: CMO_SCHEMA_VERSION,
    data: await readRuns(),
  });
}
