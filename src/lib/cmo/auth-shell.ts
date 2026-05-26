import "server-only";

import { getAuthFeatureFlags, getCurrentUser } from "@/lib/cmo/auth";
import { getCurrentUserRole } from "@/lib/cmo/permissions";
import type { CmoAccessRole } from "@/lib/cmo/permission-model";

export interface CmoAuthShellStatus {
  authEnabled: boolean;
  authRequired: boolean;
  state: "disabled" | "signed_in" | "signed_out" | "misconfigured";
  email: string | null;
  displayName: string | null;
  workspaceCount: number;
  role: CmoAccessRole;
  isOwnerOrAdmin: boolean;
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
      role: "legacy_admin",
      isOwnerOrAdmin: true,
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
      role: "anonymous",
      isOwnerOrAdmin: false,
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
      role: "anonymous",
      isOwnerOrAdmin: false,
    };
  }

  const role = await getCurrentUserRole(user);

  return {
    authEnabled: true,
    authRequired: flags.required,
    state: "signed_in",
    email: user.email,
    displayName: user.displayName,
    workspaceCount: role.workspaceCount,
    role: role.role,
    isOwnerOrAdmin: role.isOwnerOrAdmin,
  };
}
