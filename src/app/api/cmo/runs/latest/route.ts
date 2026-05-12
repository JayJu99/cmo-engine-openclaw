import { readLatestRun } from "@/lib/cmo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await readLatestRun());
}
