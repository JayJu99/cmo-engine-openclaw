import { AgentsView } from "@/components/dashboard/views";
import { readLatestRun } from "@/lib/cmo/store";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  return <AgentsView data={await readLatestRun()} />;
}
