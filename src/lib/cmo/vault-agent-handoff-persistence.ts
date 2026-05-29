import type { VaultAgentDryRunMetadata } from "./app-workspace-types";
import type { VaultAgentDryRunHandoffResult } from "./vault-agent-handoff-builder";

function completedRemoteReceipt(result: VaultAgentDryRunHandoffResult): boolean {
  const receiptStatus = result.receipt?.status as string | undefined;

  return result.mode === "dry_run_remote" &&
    (result.status === "completed" ||
      receiptStatus === "completed" ||
      receiptStatus === "validated" ||
      receiptStatus === "dry_run");
}

export function vaultAgentDryRunMetadataForPersistence(
  result: VaultAgentDryRunHandoffResult | undefined,
): VaultAgentDryRunMetadata | undefined {
  if (!result || (result.mode !== "dry_run" && result.mode !== "dry_run_remote")) {
    return undefined;
  }

  if (completedRemoteReceipt(result)) {
    return {
      ...result.metadata,
      vault_handoff_status: "completed",
    };
  }

  return result.metadata;
}
