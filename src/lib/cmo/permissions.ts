import "server-only";

import { getCurrentUser, type CmoCurrentUser } from "@/lib/cmo/auth";
import {
  highestAccessRole,
  isOwnerOrAdmin,
  type CmoAccessRole,
} from "@/lib/cmo/permission-model";
import { getCurrentUserWorkspaceMemberships } from "@/lib/cmo/workspace-memberships";
import { isCmoAuthEnabled } from "@/lib/supabase/config";

export class CmoSystemPermissionError extends Error {
  constructor(public readonly role: CmoAccessRole) {
    super("Owner or admin access is required for this system area.");
    this.name = "CmoSystemPermissionError";
  }
}

export interface CmoCurrentUserRole {
  role: CmoAccessRole;
  isAuthenticated: boolean;
  isOwnerOrAdmin: boolean;
  user: CmoCurrentUser | null;
  workspaceCount: number;
}

export async function getCurrentUserRole(
  user?: CmoCurrentUser | null,
): Promise<CmoCurrentUserRole> {
  if (!isCmoAuthEnabled()) {
    return {
      role: "legacy_admin",
      isAuthenticated: false,
      isOwnerOrAdmin: true,
      user: null,
      workspaceCount: 0,
    };
  }

  const currentUser = user ?? (await getCurrentUser());

  if (!currentUser) {
    return {
      role: "anonymous",
      isAuthenticated: false,
      isOwnerOrAdmin: false,
      user: null,
      workspaceCount: 0,
    };
  }

  const memberships = await getCurrentUserWorkspaceMemberships(currentUser);
  const membershipRoles = memberships?.memberships.map((membership) => membership.role) ?? [];
  const role = highestAccessRole(membershipRoles.length ? membershipRoles : ["member"]);

  return {
    role,
    isAuthenticated: true,
    isOwnerOrAdmin: isOwnerOrAdmin(role),
    user: currentUser,
    workspaceCount: memberships?.memberships.length ?? 0,
  };
}

export async function requireOwnerOrAdminForSystem(): Promise<CmoCurrentUserRole> {
  const currentRole = await getCurrentUserRole();

  if (!currentRole.isOwnerOrAdmin) {
    throw new CmoSystemPermissionError(currentRole.role);
  }

  return currentRole;
}

export { isOwnerOrAdmin };
