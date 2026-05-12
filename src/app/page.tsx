import { OverviewView } from "@/components/dashboard/views";
import { readDashboardLatestRun } from "@/lib/cmo/adapter";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <OverviewView data={await readDashboardLatestRun()} />;
}
