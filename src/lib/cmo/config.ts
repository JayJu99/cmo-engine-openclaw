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

export function getCmoLiveAppTurnTimeoutMs(): number {
  return positiveIntEnv("CMO_LIVE_APP_TURN_TIMEOUT_MS", 12_000);
}

export function getCmoFallbackFastAfterMs(): number {
  return positiveIntEnv("CMO_FALLBACK_FAST_AFTER_MS", getCmoLiveAppTurnTimeoutMs());
}

export function getCmoAppTurnRequestTimeoutMs(): number {
  return positiveIntEnv("CMO_APP_TURN_REQUEST_TIMEOUT_MS", getCmoLiveAppTurnTimeoutMs());
}

function booleanEnv(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();

  if (value === "1" || value === "true" || value === "yes") {
    return true;
  }

  if (value === "0" || value === "false" || value === "no") {
    return false;
  }

  return fallback;
}

function commaSeparatedEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

export function isCmoHermesCmoChatEnabled(): boolean {
  return booleanEnv("CMO_HERMES_CMO_CHAT_ENABLED", false);
}

export function getCmoHermesCmoCanaryApps(): string[] {
  return commaSeparatedEnv("CMO_HERMES_CMO_CANARY_APPS");
}

export function isCmoHermesCmoOrchestrationEnabled(): boolean {
  return booleanEnv("CMO_HERMES_CMO_ORCHESTRATION_ENABLED", false);
}

export function getCmoHermesCmoMaxDelegations(): number {
  return positiveIntEnv("CMO_HERMES_CMO_MAX_DELEGATIONS", 2);
}
