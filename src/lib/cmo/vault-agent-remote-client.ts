import { getCmoHermesApiKey, getCmoHermesBaseUrl, getCmoHermesTimeoutMs } from "./config";
import { VAULT_AGENT_CONTRACT_VERSION, type TurnCompletedPackage, type VaultAgentWriteReceipt } from "./vault-agent-contracts";

const HERMES_VAULT_AGENT_DRY_RUN_PATH = "/agents/vault-agent/dry-run" as const;
const HERMES_VAULT_AGENT_RESPONSE_SCHEMA = "hermes.vault_agent.response.v1" as const;

export interface HermesVaultAgentDryRunResult {
  ok: boolean;
  receipt?: VaultAgentWriteReceipt;
  error?: string;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

function compactText(value: string, max = 500): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trimEnd()}...` : normalized;
}

function structuredErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return stringValue(value.error) ?? stringValue(value.message) ?? stringValue(value.failureReason);
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Hermes Vault Agent returned invalid JSON: ${compactText(text)}`);
  }
}

async function httpFailureReason(response: Response): Promise<string> {
  let detail = "";

  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      detail = structuredErrorMessage(data) ?? compactText(JSON.stringify(data));
    } else {
      detail = compactText(await response.text());
    }
  } catch {
    detail = "";
  }

  const base = `Hermes Vault Agent dry-run returned HTTP ${response.status}.`;
  const category =
    response.status === 404
      ? " Endpoint not found; check Hermes Vault Agent route configuration."
      : response.status === 401 || response.status === 403
        ? " Authentication/authorization failed; check Hermes API key configuration."
        : "";

  return detail ? `${base}${category} Detail: ${detail}` : `${base}${category}`;
}

function receiptCandidate(payload: Record<string, unknown>): unknown {
  if (isRecord(payload.receipt)) {
    return payload.receipt;
  }

  if (isRecord(payload.dry_run_receipt)) {
    return payload.dry_run_receipt;
  }

  if (isRecord(payload.result)) {
    if (isRecord(payload.result.receipt)) {
      return payload.result.receipt;
    }

    if (isRecord(payload.result.dry_run_receipt)) {
      return payload.result.dry_run_receipt;
    }

    if (typeof payload.result.record_id === "string") {
      return payload.result;
    }
  }

  return typeof payload.record_id === "string" ? payload : undefined;
}

function normalizeRemoteReceipt(value: unknown): { receipt?: VaultAgentWriteReceipt; errors: string[] } {
  if (!isRecord(value)) {
    return { errors: ["Hermes Vault Agent response did not include a receipt object."] };
  }

  const status = value.status === "dry_run" || value.status === "validated" || value.status === "rejected"
    ? value.status
    : undefined;
  const recordId = stringValue(value.record_id);

  const errors: string[] = [];

  if (!recordId) {
    errors.push("Hermes Vault Agent receipt is missing record_id.");
  }

  if (!status) {
    errors.push("Hermes Vault Agent receipt has an invalid status.");
  }

  if (value.write_confirmed !== false) {
    errors.push("Hermes Vault Agent dry-run receipt must have write_confirmed=false.");
  }

  if (value.no_filesystem_write !== true) {
    errors.push("Hermes Vault Agent dry-run receipt must have no_filesystem_write=true.");
  }

  if (value.no_gbrain_call !== true) {
    errors.push("Hermes Vault Agent dry-run receipt must have no_gbrain_call=true.");
  }

  if (errors.length || !recordId || !status) {
    return { errors };
  }

  return {
    receipt: {
      schema_version: VAULT_AGENT_CONTRACT_VERSION,
      record_id: recordId,
      status,
      write_confirmed: false,
      target_path_preview: stringValue(value.target_path_preview),
      markdown_preview: stringValue(value.markdown_preview),
      validation_errors: stringList(value.validation_errors),
      validation_warnings: stringList(value.validation_warnings),
      no_filesystem_write: true,
      no_gbrain_call: true,
    },
    errors: [],
  };
}

function extractReceipt(payload: unknown): { receipt?: VaultAgentWriteReceipt; errors: string[]; warnings: string[] } {
  if (!isRecord(payload)) {
    return { errors: ["Hermes Vault Agent response body must be an object."], warnings: [] };
  }

  const warnings: string[] = [];

  if (payload.schema_version !== HERMES_VAULT_AGENT_RESPONSE_SCHEMA) {
    warnings.push("Hermes Vault Agent response schema_version was not hermes.vault_agent.response.v1.");
  }

  const candidate = receiptCandidate(payload);
  const normalized = normalizeRemoteReceipt(candidate);

  return {
    ...normalized,
    warnings,
  };
}

export async function callHermesVaultAgentDryRun(pkg: TurnCompletedPackage): Promise<HermesVaultAgentDryRunResult> {
  const baseUrl = getCmoHermesBaseUrl();
  const apiKey = getCmoHermesApiKey();

  if (!baseUrl) {
    return { ok: false, error: "CMO_HERMES_BASE_URL is not configured.", warnings: [] };
  }

  if (!apiKey) {
    return { ok: false, error: "CMO_HERMES_API_KEY is not configured.", warnings: [] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getCmoHermesTimeoutMs());

  try {
    const response = await fetch(`${baseUrl}${HERMES_VAULT_AGENT_DRY_RUN_PATH}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(pkg),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, error: await httpFailureReason(response), warnings: [] };
    }

    const payload = await parseJson(response);
    const extracted = extractReceipt(payload);

    if (!extracted.receipt) {
      return {
        ok: false,
        error: extracted.errors.join(" "),
        warnings: extracted.warnings,
      };
    }

    return {
      ok: true,
      receipt: extracted.receipt,
      warnings: extracted.warnings,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "Hermes Vault Agent dry-run request timed out.", warnings: [] };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : "Hermes Vault Agent dry-run request failed.",
      warnings: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}
