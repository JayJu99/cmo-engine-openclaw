import { AppWorkspaceView } from "@/components/cmo-apps/app-workspace-view";
import { RouteFallbackView } from "@/components/cmo-apps/route-fallback-view";
import { readAppWorkspaceState } from "@/lib/cmo/vault-files";

export const dynamic = "force-dynamic";

export default async function AppWorkspacePage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  let state: Awaited<ReturnType<typeof readAppWorkspaceState>> | null = null;
  let errorMessage = "";

  try {
    state = await readAppWorkspaceState(appId);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "App Workspace data could not be loaded.";
  }

  if (!state) {
    return (
      <RouteFallbackView
        title="App Workspace"
        description="Tab-based App Operating Workspace for CMO context, planning, tasks, sessions, and Vault capture."
        message={errorMessage || `Unknown app workspace: ${appId}.`}
      />
    );
  }

  return <AppWorkspaceView state={state} />;
}
