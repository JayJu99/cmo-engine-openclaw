import { PipelineView } from "@/components/dashboard/views";
import { readLatestRun } from "@/lib/cmo/store";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  return <PipelineView data={await readLatestRun()} />;
}
