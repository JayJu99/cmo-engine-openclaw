import { getCmoHermesApiKey, getCmoHermesBaseUrl, getCmoHermesTimeoutMs } from "@/lib/cmo/config";
import type { ProjectContextImportRequestV1 } from "@/lib/cmo/project-context-import-types";

export const HERMES_VAULT_AGENT_IMPORT_PROJECT_CONTEXT_ENDPOINT = "/agents/vault-agent/import-project-context" as const;

export interface ProjectContextImportReceipt {
  schema_version?: string;
  status?: string;
  deduped?: boolean;
  conflict?: boolean;
  workspace_id?: string;
  app_id?: string;
  project_name?: string;
  source_count?: number;
  accepted_count?: number;
  target_paths?: unknown;
  warnings?: string[];
  errors?: string[];
  vault_write_performed?: boolean;
  gbrain_called?: boolean;
  promotion_performed?: boolean;
}

export interface ProjectContextImportResult {
  ok: boolean;
  receipt?: ProjectContextImportReceipt;
  error?: string;
  warnings: string[];
  httpStatus?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, 20)
    : [];
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function normalizeReceipt(value: unknown): ProjectContextImportReceipt | undefined {
  const receipt = isRecord(value) && isRecord(value.receipt) ? value.receipt : value;

  if (!isRecord(receipt)) {
    return undefined;
  }

  return {
    schema_version: stringValue(receipt.schema_version),
    status: stringValue(receipt.status),
    deduped: receipt.deduped === true,
    conflict: receipt.conflict === true || receipt.status === "conflict",
    workspace_id: stringValue(receipt.workspace_id),
    app_id: stringValue(receipt.app_id),
    project_name: stringValue(receipt.project_name),
    source_count: nonNegativeNumber(receipt.source_count),
    accepted_count: nonNegativeNumber(receipt.accepted_count),
    target_paths: receipt.target_paths,
    warnings: stringList(receipt.warnings),
    errors: stringList(receipt.errors),
    vault_write_performed: typeof receipt.vault_write_performed === "boolean" ? receipt.vault_write_performed : undefined,
    gbrain_called: receipt.gbrain_called === true,
    promotion_performed: receipt.promotion_performed === true,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error("Hermes project context import returned an empty response.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Hermes project context import returned malformed JSON.");
  }
}

function resultOk(receipt: ProjectContextImportReceipt | undefined): boolean {
  return Boolean(receipt && receipt.status === "completed" && receipt.conflict !== true);
}

export async function importProjectContextViaVaultAgent(
  request: ProjectContextImportRequestV1,
): Promise<ProjectContextImportResult> {
  const baseUrl = getCmoHermesBaseUrl();
  const apiKey = getCmoHermesApiKey();
  const timeoutMs = getCmoHermesTimeoutMs();

  if (!baseUrl) {
    return { ok: false, error: "CMO_HERMES_BASE_URL is not configured.", warnings: [] };
  }

  if (!apiKey) {
    return { ok: false, error: "CMO_HERMES_API_KEY is not configured.", warnings: [] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${HERMES_VAULT_AGENT_IMPORT_PROJECT_CONTEXT_ENDPOINT}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await readJson(response);
    const receipt = normalizeReceipt(payload);

    if (!receipt) {
      return {
        ok: false,
        error: "Hermes project context import receipt was malformed.",
        warnings: [],
        httpStatus: response.status,
      };
    }

    return {
      ok: response.ok && resultOk(receipt),
      receipt,
      warnings: receipt.warnings ?? [],
      httpStatus: response.status,
      ...(response.ok ? {} : { error: receipt.errors?.[0] ?? `Hermes project context import failed with HTTP ${response.status}.` }),
    };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Hermes project context import request timed out."
      : error instanceof Error
        ? error.message
        : "Hermes project context import failed.";

    return {
      ok: false,
      error: message,
      warnings: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}
