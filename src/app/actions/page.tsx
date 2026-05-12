import { ActionsView } from "@/components/dashboard/views";
import { readDashboardLatestRun } from "@/lib/cmo/adapter";

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  return <ActionsView data={await readDashboardLatestRun()} />;
}
