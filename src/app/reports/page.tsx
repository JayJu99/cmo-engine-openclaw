import { ReportsView } from "@/components/dashboard/views";
import { readLatestRun } from "@/lib/cmo/store";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  return <ReportsView data={await readLatestRun()} />;
}
