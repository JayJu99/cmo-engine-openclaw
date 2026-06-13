import {
  getCmoVaultAgentGraphApiKey,
  getCmoVaultAgentGraphBaseUrl,
  getCmoVaultAgentGraphTimeoutMs,
} from "@/lib/cmo/config";
import {
  buildMockVaultGraphResponse,
  isVaultGraphApiResponse,
  VAULT_GRAPH_SCHEMA_VERSION,
  VAULT_GRAPH_SOURCE_ROOT,
  VAULT_GRAPH_VAULT_AGENT_SOURCE_ROOT,
  type VaultGraphApiResponse,
  type VaultGraphSourceRoot,
} from "@/lib/cmo/vault-graph-contract";

export type VaultGraphSource = "mock" | "vault-agent";

export type VaultGraphRequestOptions = {
  workspace_id?: string;
  include_runtime_aggregates?: string;
  include_archive?: string;
  limit_nodes?: string;
  limit_edges?: string;
  operator_mode?: string;
};

export type VaultGraphAdapter = {
  adapter_name: string;
  source_root: VaultGraphSourceRoot;
  vault_mutation: false;
  getVaultGraph(options?: VaultGraphRequestOptions): Promise<VaultGraphApiResponse>;
};

const SUPPORTED_VAULT_GRAPH_SOURCES: VaultGraphSource[] = ["mock", "vault-agent"];
const VAULT_AGENT_GRAPH_ENDPOINT = "/agents/vault-agent/vault-graph" as const;
const VAULT_AGENT_UNAVAILABLE_WARNING = "Vault Agent graph source unavailable; returned safe empty graph.";
type VaultAgentGraphDiagnosticCode =
  | "missing_base_url"
  | "missing_api_key"
  | "fetch_failed"
  | "timeout"
  | "non_200_status"
  | "invalid_json"
  | "invalid_schema_version"
  | "vault_mutation_not_false"
  | "source_root_mismatch"
  | "missing_nodes_edges"
  | "forbidden_token_detected";

type ForbiddenResponseTokenCategory = "absolute_path" | "pii_key" | "raw_content_marker";

type VaultAgentGraphDiagnostic = {
  code: VaultAgentGraphDiagnosticCode;
  message: string;
  status?: number;
  tokenCategory?: ForbiddenResponseTokenCategory;
};

const FORBIDDEN_RESPONSE_TOKENS: { token: string; category: ForbiddenResponseTokenCategory }[] = [
  { token: "/Users/jay", category: "absolute_path" },
  { token: "/Users/", category: "absolute_path" },
  { token: "C:\\", category: "absolute_path" },
  { token: "supabase_user_id", category: "pii_key" },
  { token: "raw_activity_text", category: "raw_content_marker" },
  { token: "original_user_message", category: "raw_content_marker" },
  { token: "final_answer", category: "raw_content_marker" },
  { token: "content_hash", category: "raw_content_marker" },
  { token: "email", category: "pii_key" },
];

export class MockVaultGraphAdapter implements VaultGraphAdapter {
  adapter_name = "mock-vault-graph-adapter";
  source_root: VaultGraphSourceRoot = VAULT_GRAPH_SOURCE_ROOT;
  vault_mutation = false as const;

  async getVaultGraph() {
    return buildMockVaultGraphResponse();
  }
}

export class VaultAgentVaultGraphAdapter implements VaultGraphAdapter {
  adapter_name = "vault-agent-vault-graph-adapter";
  source_root: VaultGraphSourceRoot = VAULT_GRAPH_VAULT_AGENT_SOURCE_ROOT;
  vault_mutation = false as const;

  async getVaultGraph(options: VaultGraphRequestOptions = {}) {
    const baseUrl = getCmoVaultAgentGraphBaseUrl();

    if (!baseUrl) {
      return buildSafeVaultAgentGraphErrorResponse(
        vaultAgentGraphDiagnostic("missing_base_url"),
        baseUrl,
      );
    }

    if (!getCmoVaultAgentGraphApiKey()) {
      return buildSafeVaultAgentGraphErrorResponse(
        vaultAgentGraphDiagnostic("missing_api_key"),
        baseUrl,
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getCmoVaultAgentGraphTimeoutMs());

    let status: number | undefined;

    try {
      const response = await fetch(buildVaultAgentGraphUrl(baseUrl, options), {
        method: "GET",
        headers: buildVaultAgentGraphHeaders(),
        cache: "no-store",
        signal: controller.signal,
      });
      status = response.status;

      if (!response.ok) {
        return buildSafeVaultAgentGraphErrorResponse(
          vaultAgentGraphDiagnostic("non_200_status", { status: response.status }),
          baseUrl,
        );
      }

      const payload = await readJson(response);

      if (!payload.ok) {
        return buildSafeVaultAgentGraphErrorResponse(
          vaultAgentGraphDiagnostic("invalid_json"),
          baseUrl,
          status,
        );
      }

      const validationDiagnostic = getVaultAgentGraphValidationDiagnostic(payload.value);
      return validationDiagnostic
        ? buildSafeVaultAgentGraphErrorResponse(validationDiagnostic, baseUrl, status)
        : payload.value as VaultGraphApiResponse;
    } catch {
      const diagnostic = controller.signal.aborted
        ? vaultAgentGraphDiagnostic("timeout")
        : vaultAgentGraphDiagnostic("fetch_failed");
      return buildSafeVaultAgentGraphErrorResponse(diagnostic, baseUrl, status);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function getVaultGraphSource(value = process.env.CMO_VAULT_GRAPH_SOURCE): VaultGraphSource {
  return isSupportedVaultGraphSource(value) ? value : "mock";
}

export function isSupportedVaultGraphSource(value: string | undefined): value is VaultGraphSource {
  return SUPPORTED_VAULT_GRAPH_SOURCES.includes(value as VaultGraphSource);
}

export function createVaultGraphAdapter(source = process.env.CMO_VAULT_GRAPH_SOURCE): VaultGraphAdapter {
  const selectedSource = getVaultGraphSource(source);

  if (selectedSource === "vault-agent") {
    return new VaultAgentVaultGraphAdapter();
  }

  return new MockVaultGraphAdapter();
}

export async function getVaultGraph(
  source = process.env.CMO_VAULT_GRAPH_SOURCE,
  options: VaultGraphRequestOptions = {},
) {
  const adapter = createVaultGraphAdapter(source);
  const response = await adapter.getVaultGraph(options);

  if (isSupportedVaultGraphSource(source) || !source) {
    return response;
  }

  return {
    ...response,
    warnings: [
      ...response.warnings,
      `Unsupported CMO_VAULT_GRAPH_SOURCE="${source}" ignored; mock adapter used without Vault access.`,
    ],
  };
}

export function buildSafeVaultAgentGraphErrorResponse(
  diagnostic: VaultAgentGraphDiagnostic = vaultAgentGraphDiagnostic("fetch_failed"),
  baseUrl = getCmoVaultAgentGraphBaseUrl(),
  status?: number,
  indexedAt = new Date().toISOString(),
): VaultGraphApiResponse {
  logVaultAgentGraphDiagnostic(diagnostic, baseUrl, status);

  return {
    schema_version: VAULT_GRAPH_SCHEMA_VERSION,
    vault_mutation: false,
    source_root: VAULT_GRAPH_VAULT_AGENT_SOURCE_ROOT,
    indexed_at: indexedAt,
    nodes: [],
    edges: [],
    hidden_counts: {},
    warnings: [`${VAULT_AGENT_UNAVAILABLE_WARNING} Diagnostic: ${diagnostic.message}`],
    parse_errors: [
      {
        code: diagnostic.code,
        message: diagnostic.message,
      },
    ],
  };
}

function buildVaultAgentGraphHeaders(): HeadersInit {
  const apiKey = getCmoVaultAgentGraphApiKey();
  return {
    Accept: "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

function buildVaultAgentGraphUrl(baseUrl: string, options: VaultGraphRequestOptions) {
  const url = new URL(VAULT_AGENT_GRAPH_ENDPOINT, `${baseUrl}/`);

  for (const key of [
    "workspace_id",
    "include_runtime_aggregates",
    "include_archive",
    "limit_nodes",
    "limit_edges",
    "operator_mode",
  ] as const) {
    const value = options[key]?.trim();
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

async function readJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await response.text();

  if (!text.trim()) {
    return { ok: false };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function getVaultAgentGraphValidationDiagnostic(value: unknown): VaultAgentGraphDiagnostic | null {
  if (!value || typeof value !== "object") {
    return vaultAgentGraphDiagnostic("invalid_schema_version");
  }

  const response = value as Partial<VaultGraphApiResponse>;

  if (response.schema_version !== VAULT_GRAPH_SCHEMA_VERSION) {
    return vaultAgentGraphDiagnostic("invalid_schema_version");
  }

  if (response.vault_mutation !== false) {
    return vaultAgentGraphDiagnostic("vault_mutation_not_false");
  }

  if (response.source_root !== VAULT_GRAPH_VAULT_AGENT_SOURCE_ROOT) {
    return vaultAgentGraphDiagnostic("source_root_mismatch");
  }

  if (!Array.isArray(response.nodes) || !Array.isArray(response.edges)) {
    return vaultAgentGraphDiagnostic("missing_nodes_edges");
  }

  if (!isVaultGraphApiResponse(value)) {
    return vaultAgentGraphDiagnostic("missing_nodes_edges");
  }

  const forbiddenToken = findForbiddenVaultGraphToken(value);
  if (forbiddenToken) {
    return vaultAgentGraphDiagnostic("forbidden_token_detected", {
      tokenCategory: forbiddenToken.category,
    });
  }

  return null;
}

function findForbiddenVaultGraphToken(value: VaultGraphApiResponse) {
  const serialized = JSON.stringify(value).toLowerCase();
  return FORBIDDEN_RESPONSE_TOKENS.find(({ token }) => serialized.includes(token.toLowerCase()));
}

function vaultAgentGraphDiagnostic(
  code: VaultAgentGraphDiagnosticCode,
  details: Pick<VaultAgentGraphDiagnostic, "status" | "tokenCategory"> = {},
): VaultAgentGraphDiagnostic {
  switch (code) {
    case "missing_base_url":
      return { code, message: "missing_base_url: Vault Agent graph base URL is not configured." };
    case "missing_api_key":
      return { code, message: "missing_api_key: Vault Agent graph API key is not configured." };
    case "fetch_failed":
      return { code, message: "fetch_failed: Vault Agent graph request failed before a valid response was received." };
    case "timeout":
      return { code, message: "timeout: Vault Agent graph request exceeded the configured timeout." };
    case "non_200_status":
      return {
        code,
        status: details.status,
        message: `non_200_status: Vault Agent graph endpoint returned HTTP ${details.status ?? "unknown"}.`,
      };
    case "invalid_json":
      return { code, message: "invalid_json: Vault Agent graph response was not valid JSON." };
    case "invalid_schema_version":
      return { code, message: "invalid_schema_version: Vault Agent graph response schema_version was invalid." };
    case "vault_mutation_not_false":
      return { code, message: "vault_mutation_not_false: Vault Agent graph response did not declare vault_mutation=false." };
    case "source_root_mismatch":
      return { code, message: "source_root_mismatch: Vault Agent graph response source_root was not vault-agent." };
    case "missing_nodes_edges":
      return { code, message: "missing_nodes_edges: Vault Agent graph response did not include valid nodes and edges arrays." };
    case "forbidden_token_detected":
      return {
        code,
        tokenCategory: details.tokenCategory,
        message: `forbidden_token_detected: Vault Agent graph response contained a forbidden ${details.tokenCategory ?? "unknown"} token category.`,
      };
  }
}

function logVaultAgentGraphDiagnostic(
  diagnostic: VaultAgentGraphDiagnostic,
  baseUrl: string,
  status = diagnostic.status,
) {
  const safeUrl = safeVaultAgentBaseUrl(baseUrl);
  console.warn("Vault Agent graph source unavailable", {
    source: "vault-agent",
    base_url_origin: safeUrl.origin,
    base_url_host: safeUrl.host,
    status,
    diagnostic_code: diagnostic.code,
  });
}

function safeVaultAgentBaseUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return { origin: url.origin, host: url.host };
  } catch {
    return { origin: "unconfigured", host: "unconfigured" };
  }
}
