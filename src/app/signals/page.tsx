import { SignalsView } from "@/components/dashboard/views";
import { readLatestRun } from "@/lib/cmo/store";

export const dynamic = "force-dynamic";

export default async function SignalsPage() {
  return <SignalsView data={await readLatestRun()} />;
}
