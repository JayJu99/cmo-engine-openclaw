import type { VaultAgentDryRunMetadata } from "./app-workspace-types";
import type { VaultAgentDryRunHandoffResult } from "./vault-agent-handoff-builder";

function hasErrors(metadata: VaultAgentDryRunMetadata): boolean {
  return Boolean(metadata.vault_handoff_errors?.length);
}

function hasRecordAndTarget(metadata: VaultAgentDryRunMetadata): boolean {
  return Boolean(metadata.dry_run_record_id && metadata.dry_run_target_path);
}

function mappedHandoffStatus(result: VaultAgentDryRunHandoffResult): VaultAgentDryRunMetadata["vault_handoff_status"] {
  if (result.status === "failed") {
    return "failed";
  }

  const receiptStatus = result.receipt?.status as string | undefined;

  if (
    result.status === "completed" ||
    receiptStatus === "completed" ||
    receiptStatus === "validated" ||
    receiptStatus === "dry_run"
  ) {
    return "completed";
  }

  if (receiptStatus === "rejected" || result.status === "dry_run_invalid") {
    return "dry_run_invalid";
  }

  if (!hasRecordAndTarget(result.metadata) && hasErrors(result.metadata)) {
    return result.mode === "dry_run_remote" ? "failed" : "dry_run_invalid";
  }

  return result.metadata.vault_handoff_status;
}

export function vaultAgentDryRunMetadataForPersistence(
  result: VaultAgentDryRunHandoffResult | undefined,
): VaultAgentDryRunMetadata | undefined {
  if (!result || (result.mode !== "dry_run" && result.mode !== "dry_run_remote")) {
    return undefined;
  }

  return {
    ...result.metadata,
    vault_handoff_status: mappedHandoffStatus(result),
  };
}
