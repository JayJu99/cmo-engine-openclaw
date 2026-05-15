export type CmoAdapterMode = "local" | "remote";

export function getCmoAdapterMode(): CmoAdapterMode {
  return process.env.CMO_ADAPTER_MODE === "remote" ? "remote" : "local";
}

export function isRemoteCmoAdapter(): boolean {
  return getCmoAdapterMode() === "remote";
}

export function getRemoteAdapterUrl(): string {
  return (process.env.CMO_REMOTE_ADAPTER_URL ?? "").trim().replace(/\/+$/, "");
}

export function getRemoteAdapterApiKey(): string {
  return (process.env.CMO_REMOTE_ADAPTER_API_KEY ?? "").trim();
}

export function getOpenClawCmoEndpoint(): string {
  return (process.env.OPENCLAW_CMO_ENDPOINT ?? "").trim().replace(/\/+$/, "");
}

export function getOpenClawApiKey(): string {
  return (process.env.OPENCLAW_API_KEY ?? "").trim();
}

export function getOpenClawWorkspaceId(): string {
  return (process.env.OPENCLAW_WORKSPACE_ID ?? "").trim();
}

export function getOpenClawCmoTimeoutMs(): number {
  const value = Number.parseInt(process.env.OPENCLAW_CMO_TIMEOUT_MS ?? "", 10);

  return Number.isFinite(value) && value > 0 ? value : 60_000;
}
