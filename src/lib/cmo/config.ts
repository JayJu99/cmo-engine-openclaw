export type CmoAdapterMode = "local" | "remote";
export type CmoVaultAgentHandoffMode = "off" | "dry_run" | "dry_run_remote" | "write_remote";
export type CmoVaultContextPackMode = "off" | "pilot_remote";

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
  return positiveIntEnv("CMO_LIVE_APP_TURN_TIMEOUT_MS", 240_000);
}

export function getCmoFallbackFastAfterMs(): number {
  return positiveIntEnv("CMO_FALLBACK_FAST_AFTER_MS", getCmoLiveAppTurnTimeoutMs());
}

export function getCmoAppTurnRequestTimeoutMs(): number {
  return positiveIntEnv("CMO_APP_TURN_REQUEST_TIMEOUT_MS", getCmoLiveAppTurnTimeoutMs());
}

export function getCmoHermesBaseUrl(): string {
  return process.env.CMO_HERMES_BASE_URL?.trim().replace(/\/+$/g, "") ?? "";
}

export function getCmoHermesApiKey(): string {
  return process.env.CMO_HERMES_API_KEY?.trim() ?? "";
}

export function getCmoHermesTimeoutMs(): number {
  return positiveIntEnv("CMO_HERMES_TIMEOUT_MS", 240_000);
}

export function getCmoVaultAgentGraphBaseUrl(): string {
  return (process.env.CMO_VAULT_AGENT_GRAPH_BASE_URL?.trim() || getCmoHermesBaseUrl()).replace(/\/+$/g, "");
}

export function getCmoVaultAgentGraphApiKey(): string {
  return process.env.CMO_VAULT_AGENT_GRAPH_API_KEY?.trim() || getCmoHermesApiKey();
}

export function getCmoVaultAgentGraphTimeoutMs(): number {
  return positiveIntEnv("CMO_VAULT_AGENT_GRAPH_TIMEOUT_MS", 10_000);
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

export function isCmoHermesCmoChatV11Enabled(): boolean {
  return booleanEnv("CMO_HERMES_CMO_CHAT_V11_ENABLED", false);
}

export function getCmoHermesCmoChatV11CanaryApps(): string[] {
  return commaSeparatedEnv("CMO_HERMES_CMO_CHAT_V11_CANARY_APPS");
}

export function isCmoHermesCmoChatV11FallbackEnabled(): boolean {
  return booleanEnv("CMO_HERMES_CMO_CHAT_V11_FALLBACK_ENABLED", false);
}

export function isCmoHermesCmoToolChatEnabled(): boolean {
  return booleanEnv("CMO_HERMES_CMO_TOOL_CHAT_ENABLED", false);
}

export function getCmoHermesCmoToolChatCanaryApps(): string[] {
  return commaSeparatedEnv("CMO_HERMES_CMO_TOOL_CHAT_CANARY_APPS");
}

export function isCmoHermesCmoOrchestrationEnabled(): boolean {
  return booleanEnv("CMO_HERMES_CMO_ORCHESTRATION_ENABLED", false);
}

export function getCmoHermesCmoMaxDelegations(): number {
  return positiveIntEnv("CMO_HERMES_CMO_MAX_DELEGATIONS", 2);
}

export function isCmoHermesCmoToolExecuteEnabled(): boolean {
  return booleanEnv("CMO_HERMES_CMO_TOOL_EXECUTE_ENABLED", false);
}

export function getCmoHermesCmoToolEndpoint(): string {
  return (process.env.CMO_HERMES_CMO_TOOL_ENDPOINT?.trim() || "/agents/cmo/tool-execute").replace(/\/+$/g, "") || "/agents/cmo/tool-execute";
}

export function getCmoHermesCmoToolTimeoutMs(): number {
  return positiveIntEnv("CMO_HERMES_CMO_TOOL_TIMEOUT_MS", 240_000);
}

export function getCmoHermesCmoAsyncToolRunTimeoutMs(): number {
  return positiveIntEnv("CMO_HERMES_CMO_ASYNC_TOOL_RUN_TIMEOUT_MS", 300_000);
}

export function getCmoHermesCreativeExecuteTimeoutMs(): number {
  return positiveIntEnv("CMO_HERMES_CREATIVE_EXECUTE_TIMEOUT_MS", 300_000);
}

export function isCmoHermesCreativeEnabled(): boolean {
  return booleanEnv("CMO_HERMES_CREATIVE_ENABLED", true);
}

export function getCmoHermesCreativeCallMode(): "via_cmo" | "direct" {
  return process.env.CMO_HERMES_CREATIVE_CALL_MODE === "direct" ? "direct" : "via_cmo";
}

export function getCmoHermesCreativeProfile(): string {
  return process.env.CMO_HERMES_CREATIVE_PROFILE?.trim() || "creative";
}

export function getCmoCreativeArtifactReadKey(): string {
  return process.env.CMO_CREATIVE_ARTIFACT_READ_KEY?.trim() ?? "";
}

export function getCmoVaultAgentHandoffMode(): CmoVaultAgentHandoffMode {
  const mode = process.env.CMO_VAULT_AGENT_HANDOFF_MODE;

  return mode === "dry_run" || mode === "dry_run_remote" || mode === "write_remote" ? mode : "off";
}

export function getCmoVaultContextPackMode(): CmoVaultContextPackMode {
  return process.env.CMO_VAULT_CONTEXT_PACK_MODE === "pilot_remote" ? "pilot_remote" : "off";
}

export function isCmoDuneNativeEnabled(): boolean {
  return booleanEnv("CMO_DUNE_NATIVE_ENABLED", false);
}

export function isCmoDuneNativeDashboardEnabled(): boolean {
  return booleanEnv("CMO_DUNE_NATIVE_DASHBOARD_ENABLED", false);
}

export function getCmoDuneApiKey(): string {
  return process.env.CMO_DUNE_API_KEY?.trim() ?? "";
}

export function isCmoFacebookNativeEnabled(): boolean {
  return booleanEnv("CMO_FACEBOOK_NATIVE_ENABLED", false);
}

export function isCmoFacebookNativeDashboardEnabled(): boolean {
  return booleanEnv("CMO_FACEBOOK_NATIVE_DASHBOARD_ENABLED", false);
}

export function getMetaAppId(): string {
  return process.env.META_APP_ID?.trim() ?? "";
}

export function getMetaAppSecret(): string {
  return process.env.META_APP_SECRET?.trim() ?? "";
}

export function getMetaRedirectUri(): string {
  return process.env.META_REDIRECT_URI?.trim() ?? "";
}
