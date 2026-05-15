import { VaultVisibilityView } from "@/components/cmo-apps/vault-visibility-view";
import { RouteFallbackView } from "@/components/cmo-apps/route-fallback-view";
import { readVaultVisibilityState } from "@/lib/cmo/vault-files";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  let state: Awaited<ReturnType<typeof readVaultVisibilityState>> | null = null;
  let errorMessage = "";

  try {
    state = await readVaultVisibilityState();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Vault data could not be loaded.";
  }

  if (!state) {
    return (
      <RouteFallbackView
        title="Vault"
        description="Minimal Phase 1 visibility for Raw Vault, Daily Notes, and selected app note paths."
        message={errorMessage || "Vault data could not be loaded."}
      />
    );
  }

  return <VaultVisibilityView state={state} />;
}
