import { SignalsView } from "@/components/dashboard/views";
import { readDashboardLatestRun } from "@/lib/cmo/adapter";

export const dynamic = "force-dynamic";

export default async function SignalsPage() {
  return <SignalsView data={await readDashboardLatestRun()} />;
}
