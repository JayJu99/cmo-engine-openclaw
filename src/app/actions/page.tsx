import { ActionsView } from "@/components/dashboard/views";
import { readLatestRun } from "@/lib/cmo/store";

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  return <ActionsView data={await readLatestRun()} />;
}
