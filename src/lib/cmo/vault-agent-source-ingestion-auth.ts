export type VaultIngestInternalAuthStatus = "authorized" | "unauthorized" | "not_configured" | "absent";

export interface VaultIngestInternalAuthResult {
  status: VaultIngestInternalAuthStatus;
}

export function vaultIngestInternalAuthStatus(request: Request): VaultIngestInternalAuthResult {
  const authorization = request.headers.get("authorization")?.trim() ?? "";

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return { status: "absent" };
  }

  const expectedKey = (process.env.CMO_VAULT_INGEST_API_KEY ?? "").trim();
  if (!expectedKey) {
    return { status: "not_configured" };
  }

  const providedKey = authorization.slice("bearer ".length).trim();
  return providedKey === expectedKey ? { status: "authorized" } : { status: "unauthorized" };
}
