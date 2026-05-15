import { DailyNotesView } from "@/components/cmo-apps/daily-notes-view";
import { RouteFallbackView } from "@/components/cmo-apps/route-fallback-view";
import { readDailyNotesState } from "@/lib/cmo/vault-files";

export const dynamic = "force-dynamic";

export default async function DailyPage() {
  let state: Awaited<ReturnType<typeof readDailyNotesState>> | null = null;
  let errorMessage = "";

  try {
    state = await readDailyNotesState();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Daily Notes data could not be loaded.";
  }

  if (!state) {
    return (
      <RouteFallbackView
        title="Daily Notes"
        description="Daily Review"
        message={errorMessage || "Daily Notes data could not be loaded."}
      />
    );
  }

  return <DailyNotesView state={state} />;
}
