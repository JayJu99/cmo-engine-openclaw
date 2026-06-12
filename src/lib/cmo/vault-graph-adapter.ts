import {
  buildMockVaultGraphResponse,
  VAULT_GRAPH_SOURCE_ROOT,
  type VaultGraphApiResponse,
  type VaultGraphSourceRoot,
} from "@/lib/cmo/vault-graph-contract";

export type VaultGraphSource = "mock";

export type VaultGraphAdapter = {
  adapter_name: string;
  source_root: VaultGraphSourceRoot;
  vault_mutation: false;
  getVaultGraph(): Promise<VaultGraphApiResponse>;
};

const SUPPORTED_VAULT_GRAPH_SOURCES: VaultGraphSource[] = ["mock"];

export class MockVaultGraphAdapter implements VaultGraphAdapter {
  adapter_name = "mock-vault-graph-adapter";
  source_root: VaultGraphSourceRoot = VAULT_GRAPH_SOURCE_ROOT;
  vault_mutation = false as const;

  async getVaultGraph() {
    return buildMockVaultGraphResponse();
  }
}

export class VaultAgentVaultGraphAdapter implements VaultGraphAdapter {
  adapter_name = "vault-agent-vault-graph-adapter-disabled";
  source_root: VaultGraphSourceRoot = VAULT_GRAPH_SOURCE_ROOT;
  vault_mutation = false as const;

  async getVaultGraph() {
    const response = buildMockVaultGraphResponse();
    return {
      ...response,
      warnings: [
        ...response.warnings,
        "VaultAgentVaultGraphAdapter is disabled for Phase 2B; returned mock graph without Vault access.",
      ],
    };
  }
}

export function getVaultGraphSource(value = process.env.CMO_VAULT_GRAPH_SOURCE): VaultGraphSource {
  return value === "mock" || !value ? "mock" : "mock";
}

export function isSupportedVaultGraphSource(value: string | undefined): value is VaultGraphSource {
  return SUPPORTED_VAULT_GRAPH_SOURCES.includes(value as VaultGraphSource);
}

export function createVaultGraphAdapter(source = process.env.CMO_VAULT_GRAPH_SOURCE): VaultGraphAdapter {
  const selectedSource = getVaultGraphSource(source);

  if (selectedSource === "mock") {
    return new MockVaultGraphAdapter();
  }

  return new MockVaultGraphAdapter();
}

export async function getVaultGraph(source = process.env.CMO_VAULT_GRAPH_SOURCE) {
  const adapter = createVaultGraphAdapter(source);
  const response = await adapter.getVaultGraph();

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
