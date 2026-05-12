import { PipelineView } from "@/components/dashboard/views";
import { readDashboardLatestRun } from "@/lib/cmo/adapter";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  return <PipelineView data={await readDashboardLatestRun()} />;
}
