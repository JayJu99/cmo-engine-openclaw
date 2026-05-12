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
