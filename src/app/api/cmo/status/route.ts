import { readDashboardStatus } from "@/lib/cmo/adapter";
import { cmoErrorResponse } from "@/lib/cmo/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await readDashboardStatus());
  } catch (error) {
    return cmoErrorResponse(error);
  }
}
