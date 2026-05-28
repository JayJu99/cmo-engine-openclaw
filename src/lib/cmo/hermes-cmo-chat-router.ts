import { getCmoHermesCmoCanaryApps, isCmoHermesCmoChatEnabled } from "@/lib/cmo/config";

export function shouldUseHermesCmoChat(appId: string): boolean {
  const normalizedAppId = appId.trim();

  if (!normalizedAppId || !isCmoHermesCmoChatEnabled()) {
    return false;
  }

  return getCmoHermesCmoCanaryApps().includes(normalizedAppId);
}
