import { routeIntentForMessage, type CmoRouteIntent } from "@/lib/cmo/app-routing-intent";
import {
  getCmoHermesCmoCanaryApps,
  getCmoHermesCmoChatV11CanaryApps,
  isCmoHermesCmoChatEnabled,
  isCmoHermesCmoChatV11Enabled,
  isCmoHermesCmoChatV11FallbackEnabled,
} from "@/lib/cmo/config";

export const HERMES_CMO_EXECUTE_ENDPOINT = "/agents/cmo/execute" as const;
export const HERMES_CMO_TOOL_EXECUTE_ENDPOINT = "/agents/cmo/tool-execute" as const;
export const HERMES_CMO_CHAT_V11_ENDPOINT = "/agents/cmo/chat" as const;

export type HermesCmoRouteEndpointKind = "execute" | "tool_execute" | "agent_chat";

export interface HermesCmoChatRouteInput {
  appId: string;
  message: string;
  forceFallback?: boolean;
  hasSourceOrToolTask?: boolean;
}

export interface HermesCmoChatRouteResolution {
  endpoint: typeof HERMES_CMO_EXECUTE_ENDPOINT | typeof HERMES_CMO_TOOL_EXECUTE_ENDPOINT | typeof HERMES_CMO_CHAT_V11_ENDPOINT;
  endpointKind: HermesCmoRouteEndpointKind;
  requestedEndpoint: string;
  routeIntent: CmoRouteIntent;
  v11Enabled: boolean;
  v11Canary: boolean;
  fallbackEnabled: boolean;
  reason: "forced_fallback" | "source_or_tool_task" | "v11_canary_chat" | "v11_disabled_or_non_canary";
}

function appIsCanary(appId: string, canaryApps: string[]): boolean {
  const normalizedAppId = appId.trim();

  return Boolean(normalizedAppId) && (canaryApps.includes("*") || canaryApps.includes(normalizedAppId));
}

export function shouldUseHermesCmoChat(appId: string): boolean {
  const normalizedAppId = appId.trim();

  if (!normalizedAppId || !isCmoHermesCmoChatEnabled()) {
    return false;
  }

  const canaryApps = getCmoHermesCmoCanaryApps();

  return appIsCanary(normalizedAppId, canaryApps);
}

export function shouldUseHermesCmoChatV11(appId: string): boolean {
  return isCmoHermesCmoChatV11Enabled() && appIsCanary(appId, getCmoHermesCmoChatV11CanaryApps());
}

export function resolveHermesCmoChatRoute(input: HermesCmoChatRouteInput): HermesCmoChatRouteResolution {
  const routeIntent = routeIntentForMessage(input.message);
  const v11Enabled = isCmoHermesCmoChatV11Enabled();
  const v11Canary = appIsCanary(input.appId, getCmoHermesCmoChatV11CanaryApps());
  const fallbackEnabled = isCmoHermesCmoChatV11FallbackEnabled();

  if (input.forceFallback) {
    return {
      endpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      endpointKind: "execute",
      requestedEndpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      routeIntent,
      v11Enabled,
      v11Canary,
      fallbackEnabled,
      reason: "forced_fallback",
    };
  }

  if (input.hasSourceOrToolTask === true) {
    return {
      endpoint: HERMES_CMO_TOOL_EXECUTE_ENDPOINT,
      endpointKind: "tool_execute",
      requestedEndpoint: HERMES_CMO_TOOL_EXECUTE_ENDPOINT,
      routeIntent,
      v11Enabled,
      v11Canary,
      fallbackEnabled,
      reason: "source_or_tool_task",
    };
  }

  if (v11Enabled && v11Canary) {
    return {
      endpoint: HERMES_CMO_CHAT_V11_ENDPOINT,
      endpointKind: "agent_chat",
      requestedEndpoint: HERMES_CMO_CHAT_V11_ENDPOINT,
      routeIntent,
      v11Enabled,
      v11Canary,
      fallbackEnabled,
      reason: "v11_canary_chat",
    };
  }

  return {
    endpoint: HERMES_CMO_EXECUTE_ENDPOINT,
    endpointKind: "execute",
    requestedEndpoint: HERMES_CMO_EXECUTE_ENDPOINT,
    routeIntent,
    v11Enabled,
    v11Canary,
    fallbackEnabled,
    reason: "v11_disabled_or_non_canary",
  };
}
