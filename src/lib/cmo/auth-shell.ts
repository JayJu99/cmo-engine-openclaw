import "server-only";

import { getAuthFeatureFlags, getCurrentUser } from "@/lib/cmo/auth";
import { getCurrentUserWorkspaceMemberships } from "@/lib/cmo/workspace-memberships";

export interface CmoAuthShellStatus {
  authEnabled: boolean;
  authRequired: boolean;
  state: "disabled" | "signed_in" | "signed_out" | "misconfigured";
  email: string | null;
  displayName: string | null;
  workspaceCount: number;
}

export async function getCmoAuthShellStatus(): Promise<CmoAuthShellStatus> {
  const flags = getAuthFeatureFlags();

  if (!flags.enabled) {
    return {
      authEnabled: false,
      authRequired: flags.required,
      state: "disabled",
      email: null,
      displayName: null,
      workspaceCount: 0,
    };
  }

  if (!flags.hasPublicConfig) {
    return {
      authEnabled: true,
      authRequired: flags.required,
      state: "misconfigured",
      email: null,
      displayName: null,
      workspaceCount: 0,
    };
  }

  const user = await getCurrentUser();

  if (!user) {
    return {
      authEnabled: true,
      authRequired: flags.required,
      state: "signed_out",
      email: null,
      displayName: null,
      workspaceCount: 0,
    };
  }

  const memberships = await getCurrentUserWorkspaceMemberships(user);

  return {
    authEnabled: true,
    authRequired: flags.required,
    state: "signed_in",
    email: user.email,
    displayName: user.displayName,
    workspaceCount: memberships?.memberships.length ?? 0,
  };
}
