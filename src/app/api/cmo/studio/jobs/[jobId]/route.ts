import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { getStudioJob } from "@/lib/cmo/studio-job-service";
import { studioRouteErrorResponse } from "@/lib/cmo/studio-route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const user = await requireRequestUserIfAuthRequired();
    const { jobId } = await context.params;

    return Response.json({ job: await getStudioJob(user, jobId) });
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
