import { classifyCreativeSessionFollowup, isCreativeDraftSessionIntent, routeIntentForMessage, type CmoRouteIntent } from "@/lib/cmo/app-routing-intent";
import type { CmoCreativeWorkingState } from "@/lib/cmo/app-workspace-types";
import {
  getCmoHermesCmoCanaryApps,
  getCmoHermesCmoChatV11CanaryApps,
  getCmoHermesCmoToolChatCanaryApps,
  isCmoHermesCmoChatEnabled,
  isCmoHermesCmoChatV11Enabled,
  isCmoHermesCmoChatV11FallbackEnabled,
  isCmoHermesCmoToolChatEnabled,
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
  hasCreativeWorkingState?: boolean;
  creativeWorkingState?: CmoCreativeWorkingState;
}

export interface HermesCmoChatRouteResolution {
  endpoint: typeof HERMES_CMO_EXECUTE_ENDPOINT | typeof HERMES_CMO_TOOL_EXECUTE_ENDPOINT | typeof HERMES_CMO_CHAT_V11_ENDPOINT;
  endpointKind: HermesCmoRouteEndpointKind;
  requestedEndpoint: string;
  routeIntent: CmoRouteIntent;
  v11Enabled: boolean;
  v11Canary: boolean;
  toolChatEnabled: boolean;
  toolChatCanary: boolean;
  fallbackEnabled: boolean;
  reason: "forced_fallback" | "creative_execution" | "creative_ideation" | "creative_session" | "source_or_tool_task" | "tool_chat_canary" | "v11_canary_chat" | "v11_disabled_or_non_canary";
}

function appIsCanary(appId: string, canaryApps: string[]): boolean {
  const normalizedAppId = appId.trim().toLowerCase();
  const normalizedCanaryApps = canaryApps.map((value) => value.trim().toLowerCase());

  return Boolean(normalizedAppId) && (normalizedCanaryApps.includes("*") || normalizedCanaryApps.includes(normalizedAppId));
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

export function shouldUseHermesCmoToolChat(appId: string): boolean {
  return isCmoHermesCmoToolChatEnabled() && appIsCanary(appId, getCmoHermesCmoToolChatCanaryApps());
}

export function resolveHermesCmoChatRoute(input: HermesCmoChatRouteInput): HermesCmoChatRouteResolution {
  const creativeWorkingState = input.creativeWorkingState ?? (input.hasCreativeWorkingState === true ? { drafts: [] } : undefined);
  const routeIntent = routeIntentForMessage(input.message, { creativeWorkingState });
  const creativeSessionClassification = classifyCreativeSessionFollowup(input.message, creativeWorkingState);
  const v11Enabled = isCmoHermesCmoChatV11Enabled();
  const v11Canary = appIsCanary(input.appId, getCmoHermesCmoChatV11CanaryApps());
  const toolChatEnabled = isCmoHermesCmoToolChatEnabled();
  const toolChatCanary = appIsCanary(input.appId, getCmoHermesCmoToolChatCanaryApps());
  const fallbackEnabled = isCmoHermesCmoChatV11FallbackEnabled();

  if (input.forceFallback) {
    return {
      endpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      endpointKind: "execute",
      requestedEndpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      routeIntent,
      v11Enabled,
      v11Canary,
      toolChatEnabled,
      toolChatCanary,
      fallbackEnabled,
      reason: "forced_fallback",
    };
  }

  if (routeIntent === "creative_execution") {
    return {
      endpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      endpointKind: "execute",
      requestedEndpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      routeIntent,
      v11Enabled,
      v11Canary,
      toolChatEnabled,
      toolChatCanary,
      fallbackEnabled,
      reason: "creative_execution",
    };
  }

  const creativeSessionFollowup = creativeSessionClassification.detected;

  if (creativeSessionFollowup || routeIntent === "creative_ideation" || isCreativeDraftSessionIntent(input.message)) {
    return {
      endpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      endpointKind: "execute",
      requestedEndpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      routeIntent,
      v11Enabled,
      v11Canary,
      toolChatEnabled,
      toolChatCanary,
      fallbackEnabled,
      reason: creativeSessionFollowup ? "creative_session" : "creative_ideation",
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
      toolChatEnabled,
      toolChatCanary,
      fallbackEnabled,
      reason: "source_or_tool_task",
    };
  }

  if (toolChatEnabled && toolChatCanary) {
    return {
      endpoint: HERMES_CMO_TOOL_EXECUTE_ENDPOINT,
      endpointKind: "tool_execute",
      requestedEndpoint: HERMES_CMO_TOOL_EXECUTE_ENDPOINT,
      routeIntent,
      v11Enabled,
      v11Canary,
      toolChatEnabled,
      toolChatCanary,
      fallbackEnabled,
      reason: "tool_chat_canary",
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
      toolChatEnabled,
      toolChatCanary,
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
    toolChatEnabled,
    toolChatCanary,
    fallbackEnabled,
    reason: "v11_disabled_or_non_canary",
  };
}
