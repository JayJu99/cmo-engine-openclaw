export type CmoAccessRole =
  | "owner"
  | "admin"
  | "member"
  | "viewer"
  | "agent_system"
  | "legacy_admin"
  | "anonymous";

export const CMO_NORMAL_WORKSPACE_ACCESS = "authenticated" as const;

const roleRank: Record<CmoAccessRole, number> = {
  anonymous: 0,
  viewer: 1,
  agent_system: 1,
  member: 2,
  admin: 3,
  owner: 4,
  legacy_admin: 4,
};

export function highestAccessRole(roles: CmoAccessRole[]): CmoAccessRole {
  return roles.reduce<CmoAccessRole>(
    (highest, role) => (roleRank[role] > roleRank[highest] ? role : highest),
    "anonymous",
  );
}

export function isOwnerOrAdmin(role: CmoAccessRole): boolean {
  return role === "owner" || role === "admin" || role === "legacy_admin";
}

export function canUseNormalWorkspace(isAuthenticated: boolean): boolean {
  return isAuthenticated;
}
