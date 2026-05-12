import { OverviewView } from "@/components/dashboard/views";
import { readLatestRun } from "@/lib/cmo/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <OverviewView data={await readLatestRun()} />;
}
