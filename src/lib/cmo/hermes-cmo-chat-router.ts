import { isCreativeDraftSessionIntent, isCreativeSessionTransportContinuation, routeIntentForMessage, type CmoRouteIntent } from "@/lib/cmo/app-routing-intent";
import type { CmoCreativeWorkingState } from "@/lib/cmo/app-workspace-types";
import {
  getCmoHermesCmoCanaryApps,
  getCmoHermesCmoChatV11CanaryApps,
  getCmoHermesCmoToolChatCanaryApps,
  getCmoHermesUnifiedAgentCanaryApps,
  getCmoHermesUnifiedAgentEndpoint,
  isCmoHermesCmoChatEnabled,
  isCmoHermesCmoChatV11Enabled,
  isCmoHermesCmoChatV11FallbackEnabled,
  isCmoHermesCmoToolChatEnabled,
  isCmoHermesUnifiedAgentEnabled,
} from "@/lib/cmo/config";

export const HERMES_CMO_EXECUTE_ENDPOINT = "/agents/cmo/execute" as const;
export const HERMES_CMO_TOOL_EXECUTE_ENDPOINT = "/agents/cmo/tool-execute" as const;
export const HERMES_CMO_CHAT_V11_ENDPOINT = "/agents/cmo/chat" as const;
export const HERMES_CMO_UNIFIED_AGENT_ENDPOINT = "/agents/cmo/agent" as const;

export type HermesCmoRouteEndpointKind = "execute" | "tool_execute" | "agent_chat" | "cmo_agent";

export interface HermesCmoChatRouteInput {
  appId: string;
  message: string;
  forceFallback?: boolean;
  weeklyCampaignWorkflow?: boolean;
  hasSourceOrToolTask?: boolean;
  hasCreativeWorkingState?: boolean;
  creativeWorkingState?: CmoCreativeWorkingState;
}

export interface HermesCmoChatRouteResolution {
  endpoint: string;
  endpointKind: HermesCmoRouteEndpointKind;
  requestedEndpoint: string;
  routeIntent: CmoRouteIntent;
  unifiedAgentEnabled: boolean;
  unifiedAgentCanary: boolean;
  v11Enabled: boolean;
  v11Canary: boolean;
  toolChatEnabled: boolean;
  toolChatCanary: boolean;
  fallbackEnabled: boolean;
  reason: "weekly_campaign_workflow" | "unified_agent_canary" | "forced_fallback" | "creative_execution" | "creative_ideation" | "creative_session" | "source_or_tool_task" | "tool_chat_canary" | "v11_canary_chat" | "v11_disabled_or_non_canary";
}

export interface HermesFirstNormalChatTurnInput {
  appId: string;
  message: string;
  forceFallback?: boolean;
  localCommand?: unknown;
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

export function isHermesFirstLegacyDirectCommand(message: string): boolean {
  return /^\s*(?:(?:\/surf|@surf)(?:\s+x)?\b|\/trend\b|\/pulse\b|\/x\b|(?:\/echo|@echo)\b)/i.test(message);
}

export function isHermesFirstNormalChatTurn(input: HermesFirstNormalChatTurnInput): boolean {
  return Boolean(input.appId.trim()) &&
    !input.localCommand &&
    !isHermesFirstLegacyDirectCommand(input.message);
}

export function shouldUseHermesCmoToolChat(appId: string): boolean {
  return isCmoHermesCmoToolChatEnabled() && appIsCanary(appId, getCmoHermesCmoToolChatCanaryApps());
}

export function shouldUseHermesUnifiedAgent(appId: string): boolean {
  return isCmoHermesUnifiedAgentEnabled() && appIsCanary(appId, getCmoHermesUnifiedAgentCanaryApps());
}

export function resolveHermesCmoChatRoute(input: HermesCmoChatRouteInput): HermesCmoChatRouteResolution {
  const creativeWorkingState = input.creativeWorkingState ?? (input.hasCreativeWorkingState === true ? { drafts: [] } : undefined);
  const routeIntent = routeIntentForMessage(input.message, { creativeWorkingState });
  const creativeSessionContinuation = isCreativeSessionTransportContinuation(input.message, creativeWorkingState);
  const unifiedAgentEnabled = isCmoHermesUnifiedAgentEnabled();
  const unifiedAgentCanary = appIsCanary(input.appId, getCmoHermesUnifiedAgentCanaryApps());
  const v11Enabled = isCmoHermesCmoChatV11Enabled();
  const v11Canary = appIsCanary(input.appId, getCmoHermesCmoChatV11CanaryApps());
  const toolChatEnabled = isCmoHermesCmoToolChatEnabled();
  const toolChatCanary = appIsCanary(input.appId, getCmoHermesCmoToolChatCanaryApps());
  const fallbackEnabled = isCmoHermesCmoChatV11FallbackEnabled();

  if (input.weeklyCampaignWorkflow === true) {
    return {
      endpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      endpointKind: "execute",
      requestedEndpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      routeIntent,
      unifiedAgentEnabled,
      unifiedAgentCanary,
      v11Enabled,
      v11Canary,
      toolChatEnabled,
      toolChatCanary,
      fallbackEnabled,
      reason: "weekly_campaign_workflow",
    };
  }

  if (unifiedAgentEnabled && unifiedAgentCanary) {
    const endpoint = getCmoHermesUnifiedAgentEndpoint();

    return {
      endpoint,
      endpointKind: "cmo_agent",
      requestedEndpoint: endpoint,
      routeIntent,
      unifiedAgentEnabled,
      unifiedAgentCanary,
      v11Enabled,
      v11Canary,
      toolChatEnabled,
      toolChatCanary,
      fallbackEnabled,
      reason: "unified_agent_canary",
    };
  }

  if (input.forceFallback) {
    return {
      endpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      endpointKind: "execute",
      requestedEndpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      routeIntent,
      unifiedAgentEnabled,
      unifiedAgentCanary,
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
      unifiedAgentEnabled,
      unifiedAgentCanary,
      v11Enabled,
      v11Canary,
      toolChatEnabled,
      toolChatCanary,
      fallbackEnabled,
      reason: "creative_execution",
    };
  }

  if (creativeSessionContinuation || routeIntent === "creative_ideation" || isCreativeDraftSessionIntent(input.message)) {
    return {
      endpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      endpointKind: "execute",
      requestedEndpoint: HERMES_CMO_EXECUTE_ENDPOINT,
      routeIntent,
      unifiedAgentEnabled,
      unifiedAgentCanary,
      v11Enabled,
      v11Canary,
      toolChatEnabled,
      toolChatCanary,
      fallbackEnabled,
      reason: creativeSessionContinuation ? "creative_session" : "creative_ideation",
    };
  }

  if (input.hasSourceOrToolTask === true) {
    return {
      endpoint: HERMES_CMO_TOOL_EXECUTE_ENDPOINT,
      endpointKind: "tool_execute",
      requestedEndpoint: HERMES_CMO_TOOL_EXECUTE_ENDPOINT,
      routeIntent,
      unifiedAgentEnabled,
      unifiedAgentCanary,
      v11Enabled,
      v11Canary,
      toolChatEnabled,
      toolChatCanary,
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
      unifiedAgentEnabled,
      unifiedAgentCanary,
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
    unifiedAgentEnabled,
    unifiedAgentCanary,
    v11Enabled,
    v11Canary,
    toolChatEnabled,
    toolChatCanary,
    fallbackEnabled,
    reason: "v11_disabled_or_non_canary",
  };
}
