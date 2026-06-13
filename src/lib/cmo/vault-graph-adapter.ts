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
const VAULT_AGENT_UNAVAILABLE_ERROR = "Vault Agent graph source unavailable";
const FORBIDDEN_RESPONSE_TOKENS = [
  "/Users/jay",
  "/Users/",
  "C:\\",
  "supabase_user_id",
  "raw_activity_text",
  "original_user_message",
  "final_answer",
  "content_hash",
  "email",
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
      return buildSafeVaultAgentGraphErrorResponse();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getCmoVaultAgentGraphTimeoutMs());

    try {
      const response = await fetch(buildVaultAgentGraphUrl(baseUrl, options), {
        method: "GET",
        headers: buildVaultAgentGraphHeaders(),
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        return buildSafeVaultAgentGraphErrorResponse();
      }

      const payload = await readJson(response);
      return validateVaultAgentGraphResponse(payload)
        ? payload
        : buildSafeVaultAgentGraphErrorResponse();
    } catch {
      return buildSafeVaultAgentGraphErrorResponse();
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

export function buildSafeVaultAgentGraphErrorResponse(indexedAt = new Date().toISOString()): VaultGraphApiResponse {
  return {
    schema_version: VAULT_GRAPH_SCHEMA_VERSION,
    vault_mutation: false,
    source_root: VAULT_GRAPH_VAULT_AGENT_SOURCE_ROOT,
    indexed_at: indexedAt,
    nodes: [],
    edges: [],
    hidden_counts: {},
    warnings: [VAULT_AGENT_UNAVAILABLE_WARNING],
    parse_errors: [
      {
        code: "vault_agent_graph_unavailable",
        message: VAULT_AGENT_UNAVAILABLE_ERROR,
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

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function validateVaultAgentGraphResponse(value: unknown): value is VaultGraphApiResponse {
  if (!isVaultGraphApiResponse(value)) {
    return false;
  }

  if (value.source_root !== VAULT_GRAPH_VAULT_AGENT_SOURCE_ROOT) {
    return false;
  }

  return !containsForbiddenVaultGraphToken(value);
}

function containsForbiddenVaultGraphToken(value: VaultGraphApiResponse) {
  const serialized = JSON.stringify(value).toLowerCase();
  return FORBIDDEN_RESPONSE_TOKENS.some((token) => serialized.includes(token.toLowerCase()));
}
