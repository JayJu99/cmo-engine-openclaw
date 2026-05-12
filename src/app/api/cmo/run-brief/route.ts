import { createMockRun } from "@/lib/cmo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const run = await createMockRun();

  return Response.json(run, { status: 201 });
}
