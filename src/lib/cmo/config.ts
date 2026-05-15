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

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getOpenClawCmoTimeoutMs(): number {
  return positiveIntEnv("OPENCLAW_CMO_TIMEOUT_MS", 60_000);
}

export function getCmoAppTurnRequestTimeoutMs(): number {
  return positiveIntEnv("CMO_APP_TURN_REQUEST_TIMEOUT_MS", positiveIntEnv("OPENCLAW_CMO_TIMEOUT_MS", 120_000));
}
