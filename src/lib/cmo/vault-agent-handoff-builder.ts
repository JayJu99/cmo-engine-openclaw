import { getCmoVaultAgentHandoffMode, type CmoVaultAgentHandoffMode } from "./config";
import type {
  CMOAppChatRequest,
  CMOChatSession,
  HermesCmoActivityEventSummary,
  HermesCmoAgentUsed,
  HermesCmoDelegationSummaryItem,
} from "./app-workspace-types";
import { buildVaultAgentDryRunReceipt, normalizeVaultRecord } from "./vault-agent-dry-run";
import { callHermesVaultAgentDryRun } from "./vault-agent-remote-client";
import { decideIndexability } from "./vault-scope-policy";
import { CANONICAL_VAULT_LANGUAGE, type TurnCompletedPackage, type VaultAgentWriteReceipt } from "./vault-agent-contracts";
import type { CmoServerUserIdentity } from "./user-metadata";

export type VaultAgentHandoffStatus = "skipped" | "dry_run_valid" | "dry_run_invalid" | "completed" | "failed";

export interface VaultAgentDryRunHandoffMetadata {
  vault_handoff_mode: CmoVaultAgentHandoffMode;
  vault_handoff_status: VaultAgentHandoffStatus;
  dry_run_record_id?: string;
  dry_run_target_path?: string;
  dry_run_indexability?: {
    gbrain_index: boolean;
    gbrain_status: string;
    reason: string;
  };
  vault_handoff_warnings?: string[];
  vault_handoff_errors?: string[];
}

export interface CompletedTurnHandoffInput {
  request: CMOAppChatRequest;
  session: CMOChatSession;
  userIdentity?: CmoServerUserIdentity;
  userMessageId: string;
  assistantMessageId: string;
  answer: string;
  createdAt: string;
  activityEvents?: HermesCmoActivityEventSummary[];
  delegationSummary?: HermesCmoDelegationSummaryItem[];
  agentsUsed?: HermesCmoAgentUsed[];
  surfCalls?: number;
  echoCalls?: number;
}

export interface VaultAgentDryRunHandoffResult {
  mode: CmoVaultAgentHandoffMode;
  status: VaultAgentHandoffStatus;
  package?: TurnCompletedPackage;
  receipt?: VaultAgentWriteReceipt;
  metadata: VaultAgentDryRunHandoffMetadata;
}

function stableUserRef(input: CompletedTurnHandoffInput): string {
  return input.userIdentity?.userEmail?.trim() ||
    input.session.userEmail?.trim() ||
    input.userIdentity?.createdByEmail?.trim() ||
    input.session.createdByEmail?.trim() ||
    "legacy_dashboard_user";
}

function detectOriginalLanguage(text: string): string {
  return /[\u0103\u00e2\u0111\u00ea\u00f4\u01a1\u01b0\u00e1\u00e0\u1ea3\u00e3\u1ea1\u1ea5\u1ea7\u1ea9\u1eab\u1ead\u1eaf\u1eb1\u1eb3\u1eb5\u1eb7\u00e9\u00e8\u1ebb\u1ebd\u1eb9\u1ebf\u1ec1\u1ec3\u1ec5\u1ec7\u00ed\u00ec\u1ec9\u0129\u1ecb\u00f3\u00f2\u1ecf\u00f5\u1ecd\u1ed1\u1ed3\u1ed5\u1ed7\u1ed9\u1edb\u1edd\u1edf\u1ee1\u1ee3\u00fa\u00f9\u1ee7\u0169\u1ee5\u1ee9\u1eeb\u1eed\u1eef\u1ef1\u00fd\u1ef3\u1ef7\u1ef9\u1ef5]/i.test(text)
    ? "vi"
    : "en";
}

function compact(value: string, max = 1200): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trimEnd()}...` : normalized;
}

export function buildTurnCompletedPackage(input: CompletedTurnHandoffInput): TurnCompletedPackage {
  const userMessage = input.request.message;
  const originalText = [
    "## User Message",
    userMessage,
    "",
    "## Final CMO Answer",
    input.answer,
  ].join("\n");
  const userId = input.userIdentity?.userId ?? input.session.userId;
  const userRef = userId ? undefined : stableUserRef(input);

  return {
    tenant_id: input.request.workspaceId,
    workspace_id: input.request.appId,
    ...(userId ? { user_id: userId } : { user_ref: userRef }),
    session_id: input.session.id,
    turn_id: input.userMessageId,
    message_id: input.assistantMessageId,
    source_agent: "CMO",
    user_message: userMessage,
    final_cmo_answer: input.answer,
    activity_events: input.activityEvents ?? input.session.activityEvents ?? [],
    delegation_summary: input.delegationSummary ?? input.session.delegationSummary ?? [],
    agents_used: input.agentsUsed ?? input.session.agentsUsed ?? ["cmo"],
    surf_calls: input.surfCalls ?? input.session.surfCalls ?? 0,
    echo_calls: input.echoCalls ?? input.session.echoCalls ?? 0,
    no_auto_promote: true,
    title: `CMO turn ${input.session.id} ${input.assistantMessageId}`,
    original_text: originalText,
    canonical_summary: compact(input.answer),
    original_language: detectOriginalLanguage(`${userMessage}\n${input.answer}`),
    canonical_language: CANONICAL_VAULT_LANGUAGE,
    source_refs: [
      `session:${input.session.id}`,
      `message:${input.assistantMessageId}`,
      `app:${input.request.appId}`,
    ],
    related_records: [],
    created_at: input.createdAt,
  };
}

function metadataFromReceipt(
  mode: CmoVaultAgentHandoffMode,
  status: VaultAgentHandoffStatus,
  receipt: VaultAgentWriteReceipt,
  pkg: TurnCompletedPackage,
  extraWarnings: string[] = [],
  remoteIndexability?: VaultAgentDryRunHandoffMetadata["dry_run_indexability"],
): VaultAgentDryRunHandoffMetadata {
  const normalized = normalizeVaultRecord(pkg);
  const indexability = decideIndexability(normalized);
  const dryRunIndexability = remoteIndexability ?? (receipt.markdown_preview || receipt.target_path_preview
    ? {
        gbrain_index: indexability.gbrain_index,
        gbrain_status: indexability.gbrain_status,
        reason: indexability.reason,
      }
    : undefined);

  return {
    vault_handoff_mode: mode,
    vault_handoff_status: status,
    dry_run_record_id: receipt.record_id,
    dry_run_target_path: receipt.target_path_preview,
    ...(dryRunIndexability ? { dry_run_indexability: dryRunIndexability } : {}),
    vault_handoff_warnings: [...extraWarnings, ...receipt.validation_warnings],
    vault_handoff_errors: receipt.validation_errors,
  };
}

function handoffStatusFromReceipt(
  receipt: VaultAgentWriteReceipt,
  handoffStatus?: Extract<VaultAgentHandoffStatus, "completed" | "dry_run_invalid">,
): VaultAgentHandoffStatus {
  if (handoffStatus) {
    return handoffStatus;
  }

  const status = receipt.status as string;

  if (status === "dry_run" || status === "validated" || status === "completed") {
    return "completed";
  }

  return "dry_run_invalid";
}

export async function runVaultAgentDryRunHandoff(input: CompletedTurnHandoffInput): Promise<VaultAgentDryRunHandoffResult> {
  const mode = getCmoVaultAgentHandoffMode();

  if (mode === "off") {
    return {
      mode,
      status: "skipped",
      metadata: {
        vault_handoff_mode: mode,
        vault_handoff_status: "skipped",
      },
    };
  }

  try {
    const pkg = buildTurnCompletedPackage(input);

    if (mode === "dry_run_remote") {
      const remote = await callHermesVaultAgentDryRun(pkg);

      if (!remote.ok || !remote.receipt) {
        return {
          mode,
          status: "failed",
          package: pkg,
          metadata: {
            vault_handoff_mode: mode,
            vault_handoff_status: "failed",
            vault_handoff_warnings: remote.warnings,
            vault_handoff_errors: [remote.error ?? "Hermes Vault Agent dry-run failed."],
          },
        };
      }

      const status = handoffStatusFromReceipt(remote.receipt, remote.handoffStatus);

      return {
        mode,
        status,
        package: pkg,
        receipt: remote.receipt,
        metadata: metadataFromReceipt(mode, status, remote.receipt, pkg, remote.warnings, remote.indexability),
      };
    }

    const receipt = buildVaultAgentDryRunReceipt(pkg);
    const status = handoffStatusFromReceipt(receipt);

    return {
      mode,
      status,
      package: pkg,
      receipt,
      metadata: metadataFromReceipt(mode, status, receipt, pkg),
    };
  } catch (error) {
    return {
      mode,
      status: "failed",
      metadata: {
        vault_handoff_mode: mode,
        vault_handoff_status: "failed",
        vault_handoff_errors: [error instanceof Error ? error.message : "Vault Agent dry-run handoff failed"],
      },
    };
  }
}
