import { VaultView } from "@/components/dashboard/views";
import { readLatestRun } from "@/lib/cmo/store";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  return <VaultView data={await readLatestRun()} />;
}
