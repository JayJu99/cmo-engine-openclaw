import { AppsIndexView } from "@/components/cmo-apps/apps-index-view";
import { RouteFallbackView } from "@/components/cmo-apps/route-fallback-view";
import { listAppWorkspaces } from "@/lib/cmo/app-workspaces";

export const dynamic = "force-dynamic";

export default function AppsPage() {
  let apps: ReturnType<typeof listAppWorkspaces> | null = null;
  let errorMessage = "";

  try {
    apps = listAppWorkspaces();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Apps data could not be loaded.";
  }

  if (!apps) {
    return (
      <RouteFallbackView
        title="Apps"
        description="Choose the app context before opening a CMO session."
        message={errorMessage || "Apps data could not be loaded."}
      />
    );
  }

  return <AppsIndexView apps={apps} />;
}
