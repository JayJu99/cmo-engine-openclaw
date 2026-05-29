import { getCmoHermesApiKey, getCmoHermesBaseUrl, getCmoHermesTimeoutMs } from "./config";
import { VAULT_AGENT_CONTRACT_VERSION, type SourceIngestionPackage, type TurnCompletedPackage, type VaultAgentContextPackRequest, type VaultAgentWriteReceipt } from "./vault-agent-contracts";

const HERMES_VAULT_AGENT_DRY_RUN_PATH = "/agents/vault-agent/dry-run" as const;
const HERMES_VAULT_AGENT_WRITE_TURN_LOG_PATH = "/agents/vault-agent/write-turn-log" as const;
const HERMES_VAULT_AGENT_INGEST_SOURCE_PATH = "/agents/vault-agent/ingest-source" as const;
const HERMES_VAULT_AGENT_CONTEXT_PACK_PATH = "/agents/vault-agent/get-context-pack" as const;
const HERMES_VAULT_AGENT_RESPONSE_SCHEMA = "hermes.vault_agent.response.v1" as const;
const HERMES_VAULT_AGENT_WRITE_RECEIPT_SCHEMA = "hermes.vault_agent.write_receipt.v1" as const;
const HERMES_VAULT_AGENT_SOURCE_INGESTION_RECEIPT_SCHEMA = "hermes.vault_agent.source_ingestion_receipt.v1" as const;
const HERMES_VAULT_AGENT_CONTEXT_PACK_SCHEMA = "hermes.vault_agent.context_pack.v1" as const;

export interface HermesVaultAgentDryRunResult {
  ok: boolean;
  receipt?: VaultAgentWriteReceipt;
  handoffStatus?: "completed" | "dry_run_invalid";
  indexability?: {
    gbrain_index: boolean;
    gbrain_status: string;
    reason: string;
  };
  error?: string;
  warnings: string[];
}

export interface HermesVaultAgentWriteReceipt {
  schema_version: typeof HERMES_VAULT_AGENT_WRITE_RECEIPT_SCHEMA;
  status: "completed" | "rejected";
  write_performed: boolean;
  deduped: boolean;
  record_id?: string;
  target_path?: string;
  target_relative_path?: string;
  target_absolute_path?: string;
  content_hash?: string;
  path_safety?: unknown;
  warnings: string[];
  errors: string[];
  gbrain_called: false;
  memory_mutation: false;
}

export interface HermesVaultAgentWriteTurnLogResult {
  ok: boolean;
  receipt?: HermesVaultAgentWriteReceipt;
  error?: string;
  warnings: string[];
}

export interface HermesVaultAgentSourceIngestionReceipt {
  schema_version: typeof HERMES_VAULT_AGENT_SOURCE_INGESTION_RECEIPT_SCHEMA;
  status: "completed" | "rejected";
  write_performed: boolean;
  record_ids: Record<string, string>;
  target_paths: Record<string, string>;
  warnings: string[];
  errors: string[];
  gbrain_called: false;
  promotion_performed: false;
}

export interface HermesVaultAgentSourceIngestionResult {
  ok: boolean;
  receipt?: HermesVaultAgentSourceIngestionReceipt;
  error?: string;
  warnings: string[];
}

export interface HermesVaultAgentContextPackSource {
  source_id?: string;
  title: string;
  citation?: string;
  source_path?: string;
  source_type?: string;
  scope?: string;
  visibility?: string;
  confidence?: number;
  excerpt_or_summary?: string;
  excerpt?: string;
  summary?: string;
}

export interface HermesVaultAgentContextPackReceipt {
  schema_version: typeof HERMES_VAULT_AGENT_CONTEXT_PACK_SCHEMA;
  status: "completed" | "empty" | "rejected";
  source_count: number;
  sources: HermesVaultAgentContextPackSource[];
  warnings: string[];
  errors: string[];
  gbrain_called: boolean;
  gbrain_mode?: string;
  vault_mutation: false;
  promotion_performed: false;
}

export interface HermesVaultAgentContextPackResult {
  ok: boolean;
  receipt?: HermesVaultAgentContextPackReceipt;
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

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim()))
      .map(([key, item]) => [key, item.trim()]),
  );
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

async function httpFailureReason(response: Response, operation = "dry-run"): Promise<string> {
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

  const base = `Hermes Vault Agent ${operation} returned HTTP ${response.status}.`;
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

function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  return isRecord(value[key]) ? value[key] : undefined;
}

function booleanFalseIfPresent(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || value[key] === false;
}

function responseWarnings(payload: Record<string, unknown>, result?: Record<string, unknown>): string[] {
  return [
    ...stringList(payload.warnings),
    ...stringList(payload.validation_warnings),
    ...(result ? stringList(result.warnings) : []),
    ...(result ? stringList(result.validation_warnings) : []),
  ];
}

function responseErrors(payload: Record<string, unknown>, result?: Record<string, unknown>): string[] {
  return [
    ...stringList(payload.errors),
    ...stringList(payload.validation_errors),
    ...(result ? stringList(result.errors) : []),
    ...(result ? stringList(result.validation_errors) : []),
  ];
}

function normalizeIndexability(value: unknown): HermesVaultAgentDryRunResult["indexability"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const status = stringValue(value.gbrain_status) ?? stringValue(value.status) ?? "not_indexable";
  const reason = stringValue(value.reason) ?? stringValue(value.summary) ?? "Hermes Vault Agent dry-run indexability decision.";

  return {
    gbrain_index: value.gbrain_index === true || value.indexable === true,
    gbrain_status: status,
    reason,
  };
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizePathSafety(value: unknown): unknown {
  return value === undefined ? undefined : value;
}

function normalizeHermesSourceIngestionReceipt(payload: Record<string, unknown>): {
  receipt?: HermesVaultAgentSourceIngestionReceipt;
  errors: string[];
  warnings: string[];
} {
  const result = nestedRecord(payload, "result");
  const source = result ?? payload;
  const safety = nestedRecord(source, "safety") ?? nestedRecord(payload, "safety");
  const schemaVersion = stringValue(payload.schema_version) ?? stringValue(source.schema_version);
  const status = stringValue(source.status);
  const writePerformed = booleanValue(source.write_performed);
  const recordIds = stringRecord(source.record_ids);
  const targetPaths = stringRecord(source.target_paths);
  const gbrainCalled = booleanValue(source.gbrain_called) ?? (safety ? booleanValue(safety.gbrain_called) : undefined);
  const promotionPerformed = booleanValue(source.promotion_performed) ?? (safety ? booleanValue(safety.promotion_performed) : undefined);
  const warnings = responseWarnings(payload, result);
  const responseValidationErrors = responseErrors(payload, result);
  const contractErrors: string[] = [];

  if (schemaVersion !== HERMES_VAULT_AGENT_SOURCE_INGESTION_RECEIPT_SCHEMA) {
    contractErrors.push("Hermes Vault Agent source ingestion receipt schema_version must be hermes.vault_agent.source_ingestion_receipt.v1.");
  }

  if (status !== "completed" && status !== "rejected") {
    contractErrors.push("Hermes Vault Agent source ingestion receipt status must be completed or rejected.");
  }

  if (typeof writePerformed !== "boolean") {
    contractErrors.push("Hermes Vault Agent source ingestion receipt must include write_performed boolean.");
  }

  if (!Object.keys(recordIds).length) {
    contractErrors.push("Hermes Vault Agent source ingestion receipt is missing record_ids.");
  }

  if (!Object.keys(targetPaths).length) {
    contractErrors.push("Hermes Vault Agent source ingestion receipt is missing target_paths.");
  }

  if (gbrainCalled !== false) {
    contractErrors.push("Hermes Vault Agent source ingestion receipt must have gbrain_called=false.");
  }

  if (promotionPerformed !== false) {
    contractErrors.push("Hermes Vault Agent source ingestion receipt must have promotion_performed=false.");
  }

  const errors = [...contractErrors, ...responseValidationErrors];

  if (contractErrors.length || typeof writePerformed !== "boolean" || (status !== "completed" && status !== "rejected")) {
    return { errors, warnings };
  }

  return {
    receipt: {
      schema_version: HERMES_VAULT_AGENT_SOURCE_INGESTION_RECEIPT_SCHEMA,
      status,
      write_performed: writePerformed,
      record_ids: recordIds,
      target_paths: targetPaths,
      warnings,
      errors: responseValidationErrors,
      gbrain_called: false,
      promotion_performed: false,
    },
    errors: [],
    warnings,
  };
}

function sourceCandidateList(source: Record<string, unknown>): unknown[] {
  for (const key of ["context_items", "sources", "context_sources", "items", "results"]) {
    if (Array.isArray(source[key])) {
      return source[key];
    }
  }

  const nestedContextPack = nestedRecord(source, "context_pack") ?? nestedRecord(source, "contextPack");
  if (nestedContextPack) {
    return sourceCandidateList(nestedContextPack);
  }

  return [];
}

function normalizeContextPackSource(value: unknown, index: number): HermesVaultAgentContextPackSource | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = stringValue(value.title) ?? stringValue(value.source_title) ?? stringValue(value.name) ?? `Vault source ${index + 1}`;
  const excerptOrSummary = stringValue(value.excerpt_or_summary);
  const excerpt = stringValue(value.excerpt) ?? stringValue(value.content_excerpt) ?? stringValue(value.preview);
  const summary = stringValue(value.summary) ?? stringValue(value.canonical_summary) ?? stringValue(value.text);

  return {
    source_id: stringValue(value.source_id) ?? stringValue(value.record_id) ?? stringValue(value.id),
    title,
    citation: stringValue(value.citation) ?? stringValue(value.citation_key),
    source_path: stringValue(value.source_path) ?? stringValue(value.path) ?? stringValue(value.target_path) ?? stringValue(value.target_relative_path),
    source_type: stringValue(value.source_type) ?? stringValue(value.record_type) ?? stringValue(value.type),
    scope: stringValue(value.scope),
    visibility: stringValue(value.visibility),
    confidence: numberValue(value.confidence),
    excerpt_or_summary: excerptOrSummary,
    excerpt,
    summary,
  };
}

function normalizeHermesContextPackReceipt(payload: Record<string, unknown>): {
  receipt?: HermesVaultAgentContextPackReceipt;
  errors: string[];
  warnings: string[];
} {
  const result = nestedRecord(payload, "result");
  const source = result ?? payload;
  const safety = nestedRecord(source, "safety") ?? nestedRecord(payload, "safety");
  const schemaVersion = stringValue(payload.schema_version) ?? stringValue(source.schema_version);
  const status = stringValue(source.status);
  const sources = sourceCandidateList(source)
    .map(normalizeContextPackSource)
    .filter((item): item is HermesVaultAgentContextPackSource => Boolean(item))
    .slice(0, 10);
  const rawSourceCount = Number(source.source_count ?? source.sourceCount ?? sources.length);
  const sourceCount = Number.isFinite(rawSourceCount) ? Math.max(0, Math.floor(rawSourceCount)) : sources.length;
  const gbrainCalled = booleanValue(source.gbrain_called) ?? (safety ? booleanValue(safety.gbrain_called) : undefined);
  const vaultMutation = booleanValue(source.vault_mutation) ?? booleanValue(source.vault_write) ?? (safety ? booleanValue(safety.vault_mutation ?? safety.vault_write) : undefined);
  const promotionPerformed = booleanValue(source.promotion_performed) ?? (safety ? booleanValue(safety.promotion_performed) : undefined);
  const warnings = responseWarnings(payload, result);
  const responseValidationErrors = responseErrors(payload, result);
  const contractErrors: string[] = [];

  if (schemaVersion !== HERMES_VAULT_AGENT_CONTEXT_PACK_SCHEMA) {
    contractErrors.push("Hermes Vault Agent context pack schema_version must be hermes.vault_agent.context_pack.v1.");
  }

  if (status !== "completed" && status !== "empty" && status !== "rejected") {
    contractErrors.push("Hermes Vault Agent context pack status must be completed, empty, or rejected.");
  }

  if (sourceCount > 0 && sources.length === 0) {
    contractErrors.push("Hermes Vault Agent context pack source_count is positive but no sources were provided.");
  }

  if (typeof gbrainCalled !== "boolean") {
    contractErrors.push("Hermes Vault Agent context pack must include gbrain_called boolean.");
  }

  if (vaultMutation !== false) {
    contractErrors.push("Hermes Vault Agent context pack must have vault_mutation=false.");
  }

  if (promotionPerformed !== false) {
    contractErrors.push("Hermes Vault Agent context pack must have promotion_performed=false.");
  }

  const errors = [...contractErrors, ...responseValidationErrors];

  if (contractErrors.length || typeof gbrainCalled !== "boolean" || (status !== "completed" && status !== "empty" && status !== "rejected")) {
    return { errors, warnings };
  }

  return {
    receipt: {
      schema_version: HERMES_VAULT_AGENT_CONTEXT_PACK_SCHEMA,
      status,
      source_count: sourceCount,
      sources,
      warnings,
      errors: responseValidationErrors,
      gbrain_called: gbrainCalled,
      gbrain_mode: stringValue(source.gbrain_mode) ?? (safety ? stringValue(safety.gbrain_mode) : undefined),
      vault_mutation: false,
      promotion_performed: false,
    },
    errors: [],
    warnings,
  };
}

function normalizeHermesWriteReceipt(payload: Record<string, unknown>): {
  receipt?: HermesVaultAgentWriteReceipt;
  errors: string[];
  warnings: string[];
} {
  const result = nestedRecord(payload, "result");
  const source = result ?? payload;
  const safety = nestedRecord(source, "safety") ?? nestedRecord(payload, "safety");
  const schemaVersion = stringValue(payload.schema_version) ?? stringValue(source.schema_version);
  const status = stringValue(source.status);
  const writePerformed = booleanValue(source.write_performed);
  const deduped = booleanValue(source.deduped) ?? false;
  const recordId = stringValue(source.record_id);
  const targetRelativePath = stringValue(source.target_relative_path) ?? stringValue(source.target_path) ?? stringValue(source.target_path_preview);
  const targetAbsolutePath = stringValue(source.target_absolute_path);
  const contentHash = stringValue(source.content_hash);
  const gbrainCalled = booleanValue(source.gbrain_called) ?? (safety ? booleanValue(safety.gbrain_called) : undefined);
  const memoryMutation = booleanValue(source.memory_mutation) ?? (safety ? booleanValue(safety.memory_mutation) : undefined);
  const warnings = responseWarnings(payload, result);
  const responseValidationErrors = responseErrors(payload, result);
  const contractErrors: string[] = [];

  if (schemaVersion !== HERMES_VAULT_AGENT_WRITE_RECEIPT_SCHEMA) {
    contractErrors.push("Hermes Vault Agent write receipt schema_version must be hermes.vault_agent.write_receipt.v1.");
  }

  if (status !== "completed" && status !== "rejected") {
    contractErrors.push("Hermes Vault Agent write receipt status must be completed or rejected.");
  }

  if (typeof writePerformed !== "boolean") {
    contractErrors.push("Hermes Vault Agent write receipt must include write_performed boolean.");
  }

  if (status === "completed" && !writePerformed && !deduped) {
    contractErrors.push("Hermes Vault Agent completed write receipt must either write or dedupe.");
  }

  if (!recordId) {
    contractErrors.push("Hermes Vault Agent write receipt is missing record_id.");
  }

  if (!targetRelativePath) {
    contractErrors.push("Hermes Vault Agent write receipt is missing target_relative_path.");
  }

  if (gbrainCalled !== false) {
    contractErrors.push("Hermes Vault Agent write receipt must have gbrain_called=false.");
  }

  if (memoryMutation !== false) {
    contractErrors.push("Hermes Vault Agent write receipt must have memory_mutation=false.");
  }

  const errors = [...contractErrors, ...responseValidationErrors];

  if (contractErrors.length || !recordId || !targetRelativePath || typeof writePerformed !== "boolean" || (status !== "completed" && status !== "rejected")) {
    return { errors, warnings };
  }

  return {
    receipt: {
      schema_version: HERMES_VAULT_AGENT_WRITE_RECEIPT_SCHEMA,
      status,
      write_performed: writePerformed,
      deduped,
      record_id: recordId,
      target_path: targetRelativePath,
      target_relative_path: targetRelativePath,
      target_absolute_path: targetAbsolutePath,
      content_hash: contentHash,
      path_safety: normalizePathSafety(source.path_safety),
      warnings,
      errors: responseValidationErrors,
      gbrain_called: false,
      memory_mutation: false,
    },
    errors: [],
    warnings,
  };
}

function normalizeHermesDryRunResponse(payload: Record<string, unknown>): {
  receipt?: VaultAgentWriteReceipt;
  handoffStatus?: "completed" | "dry_run_invalid";
  indexability?: HermesVaultAgentDryRunResult["indexability"];
  errors: string[];
  warnings: string[];
} {
  const result = nestedRecord(payload, "result");
  const safety = nestedRecord(payload, "safety") ?? (result ? nestedRecord(result, "safety") : undefined);
  const recordId = stringValue(payload.record_id) ?? (result ? stringValue(result.record_id) : undefined);
  const status = stringValue(payload.status) ?? (result ? stringValue(result.status) : undefined);
  const mode = stringValue(payload.mode) ?? (result ? stringValue(result.mode) : undefined);
  const targetPath = stringValue(payload.target_path_preview) ?? (result ? stringValue(result.target_path_preview) : undefined);
  const validationErrors = responseErrors(payload, result);
  const contractErrors: string[] = [];
  const warnings = responseWarnings(payload, result);

  if (payload.schema_version !== HERMES_VAULT_AGENT_RESPONSE_SCHEMA) {
    contractErrors.push("Hermes Vault Agent response schema_version must be hermes.vault_agent.response.v1.");
  }

  if (mode !== "vault.write_turn_log.dry_run") {
    contractErrors.push("Hermes Vault Agent response mode must be vault.write_turn_log.dry_run.");
  }

  if (!recordId) {
    contractErrors.push("Hermes Vault Agent response is missing record_id.");
  }

  if (status !== "completed" && status !== "rejected") {
    contractErrors.push("Hermes Vault Agent response status must be completed or rejected.");
  }

  if ((payload.write_performed ?? result?.write_performed) !== false) {
    contractErrors.push("Hermes Vault Agent dry-run response must have write_performed=false.");
  }

  if ((payload.gbrain_called ?? result?.gbrain_called) !== false) {
    contractErrors.push("Hermes Vault Agent dry-run response must have gbrain_called=false.");
  }

  if ((payload.memory_mutation ?? result?.memory_mutation) !== false) {
    contractErrors.push("Hermes Vault Agent dry-run response must have memory_mutation=false.");
  }

  if (safety && !booleanFalseIfPresent(safety, "vault_write")) {
    contractErrors.push("Hermes Vault Agent dry-run safety.vault_write must be false when present.");
  }

  if (safety && !booleanFalseIfPresent(safety, "gbrain_called")) {
    contractErrors.push("Hermes Vault Agent dry-run safety.gbrain_called must be false when present.");
  }

  if (safety && !booleanFalseIfPresent(safety, "memory_mutation")) {
    contractErrors.push("Hermes Vault Agent dry-run safety.memory_mutation must be false when present.");
  }

  const handoffStatus = status === "completed" ? "completed" : status === "rejected" ? "dry_run_invalid" : undefined;

  if (contractErrors.length || !recordId || !handoffStatus) {
    return { errors: contractErrors, warnings };
  }

  const indexability = normalizeIndexability(payload.indexability ?? result?.indexability);

  return {
    receipt: {
      schema_version: VAULT_AGENT_CONTRACT_VERSION,
      record_id: recordId,
      status: handoffStatus === "completed" ? "validated" : "rejected",
      write_confirmed: false,
      target_path_preview: targetPath,
      markdown_preview: stringValue(payload.markdown_preview) ?? (result ? stringValue(result.markdown_preview) : undefined),
      validation_errors: validationErrors,
      validation_warnings: warnings,
      no_filesystem_write: true,
      no_gbrain_call: true,
    },
    handoffStatus,
    indexability,
    errors: [],
    warnings,
  };
}

function normalizeRemoteReceipt(value: unknown): { receipt?: VaultAgentWriteReceipt; errors: string[] } {
  if (!isRecord(value)) {
    return { errors: ["Hermes Vault Agent response did not include a receipt object."] };
  }

  const status = value.status === "dry_run" || value.status === "validated" || value.status === "completed" || value.status === "rejected"
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
      status: status === "completed" ? "validated" : status,
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

function extractReceipt(payload: unknown): {
  receipt?: VaultAgentWriteReceipt;
  handoffStatus?: "completed" | "dry_run_invalid";
  indexability?: HermesVaultAgentDryRunResult["indexability"];
  errors: string[];
  warnings: string[];
} {
  if (!isRecord(payload)) {
    return { errors: ["Hermes Vault Agent response body must be an object."], warnings: [] };
  }

  if (payload.schema_version === HERMES_VAULT_AGENT_RESPONSE_SCHEMA) {
    return normalizeHermesDryRunResponse(payload);
  }

  const candidate = receiptCandidate(payload);
  const normalized = normalizeRemoteReceipt(candidate);

  return {
    ...normalized,
    warnings: [],
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
      handoffStatus: extracted.handoffStatus,
      indexability: extracted.indexability,
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

export async function callHermesVaultAgentWriteTurnLog(pkg: TurnCompletedPackage): Promise<HermesVaultAgentWriteTurnLogResult> {
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
    const response = await fetch(`${baseUrl}${HERMES_VAULT_AGENT_WRITE_TURN_LOG_PATH}`, {
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
      return { ok: false, error: await httpFailureReason(response, "write-turn-log"), warnings: [] };
    }

    const payload = await parseJson(response);
    if (!isRecord(payload)) {
      return { ok: false, error: "Hermes Vault Agent write receipt body must be an object.", warnings: [] };
    }

    const normalized = normalizeHermesWriteReceipt(payload);
    if (!normalized.receipt) {
      return {
        ok: false,
        error: normalized.errors.join(" "),
        warnings: normalized.warnings,
      };
    }

    return {
      ok: true,
      receipt: normalized.receipt,
      warnings: normalized.warnings,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "Hermes Vault Agent write-turn-log request timed out.", warnings: [] };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : "Hermes Vault Agent write-turn-log request failed.",
      warnings: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function callHermesVaultAgentIngestSource(pkg: SourceIngestionPackage): Promise<HermesVaultAgentSourceIngestionResult> {
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
    const response = await fetch(`${baseUrl}${HERMES_VAULT_AGENT_INGEST_SOURCE_PATH}`, {
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
      return { ok: false, error: await httpFailureReason(response, "source ingestion"), warnings: [] };
    }

    const payload = await parseJson(response);
    if (!isRecord(payload)) {
      return { ok: false, error: "Hermes Vault Agent source ingestion receipt body must be an object.", warnings: [] };
    }

    const normalized = normalizeHermesSourceIngestionReceipt(payload);
    if (!normalized.receipt) {
      return {
        ok: false,
        error: normalized.errors.join(" "),
        warnings: normalized.warnings,
      };
    }

    return {
      ok: true,
      receipt: normalized.receipt,
      warnings: normalized.warnings,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "Hermes Vault Agent source ingestion request timed out.", warnings: [] };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : "Hermes Vault Agent source ingestion request failed.",
      warnings: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function callHermesVaultAgentContextPack(request: VaultAgentContextPackRequest): Promise<HermesVaultAgentContextPackResult> {
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
    const response = await fetch(`${baseUrl}${HERMES_VAULT_AGENT_CONTEXT_PACK_PATH}`, {
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

    if (!response.ok) {
      return { ok: false, error: await httpFailureReason(response, "context pack"), warnings: [] };
    }

    const payload = await parseJson(response);
    if (!isRecord(payload)) {
      return { ok: false, error: "Hermes Vault Agent context pack body must be an object.", warnings: [] };
    }

    const normalized = normalizeHermesContextPackReceipt(payload);
    if (!normalized.receipt) {
      return {
        ok: false,
        error: normalized.errors.join(" "),
        warnings: normalized.warnings,
      };
    }

    return {
      ok: true,
      receipt: normalized.receipt,
      warnings: normalized.warnings,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "Hermes Vault Agent context pack request timed out.", warnings: [] };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : "Hermes Vault Agent context pack request failed.",
      warnings: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}
