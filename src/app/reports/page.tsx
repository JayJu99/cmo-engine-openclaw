import { ReportsView } from "@/components/dashboard/views";
import { readDashboardLatestRun } from "@/lib/cmo/adapter";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  return <ReportsView data={await readDashboardLatestRun()} />;
}
