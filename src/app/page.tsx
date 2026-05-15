import { CommandCenterView } from "@/components/cmo-apps/command-center-view";
import { RouteFallbackView } from "@/components/cmo-apps/route-fallback-view";
import { readCommandCenterState } from "@/lib/cmo/vault-files";

export const dynamic = "force-dynamic";

export default async function Home() {
  let state: Awaited<ReturnType<typeof readCommandCenterState>> | null = null;
  let errorMessage = "";

  try {
    state = await readCommandCenterState();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Command Center data could not be loaded.";
  }

  if (!state) {
    return (
      <RouteFallbackView
        title="Command Center"
        description="Workspace: Holdstation"
        message={errorMessage || "Command Center data could not be loaded."}
      />
    );
  }

  return <CommandCenterView state={state} />;
}
