import "server-only";

import { getCurrentUser, type CmoCurrentUser } from "@/lib/cmo/auth";
import { isCmoAuthEnabled } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface CmoWorkspaceMembership {
  workspaceId: string;
  workspaceKey: string;
  workspaceName: string;
  workspaceGroup: string | null;
  project: string | null;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: "owner" | "admin" | "member" | "viewer" | "agent_system";
  status: "active" | "invited" | "disabled";
}

export interface CmoCurrentUserMemberships {
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
  };
  memberships: CmoWorkspaceMembership[];
}

type WorkspaceMembershipRow = {
  role: CmoWorkspaceMembership["role"];
  status: CmoWorkspaceMembership["status"];
  workspaces:
    | {
    id: string;
    workspace_key: string;
    name: string;
    workspace_group: string | null;
    project: string | null;
    organization_id: string;
        organizations:
          | {
              id: string;
              name: string;
              slug: string;
            }
          | {
              id: string;
              name: string;
              slug: string;
            }[]
          | null;
      }
    | {
        id: string;
        workspace_key: string;
        name: string;
        workspace_group: string | null;
        project: string | null;
        organization_id: string;
        organizations:
          | {
              id: string;
              name: string;
              slug: string;
            }
          | {
              id: string;
              name: string;
              slug: string;
            }[]
          | null;
      }[]
    | null;
};

function firstItem<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

export async function getCurrentUserWorkspaceMemberships(
  user?: CmoCurrentUser | null,
): Promise<CmoCurrentUserMemberships | null> {
  if (!isCmoAuthEnabled()) {
    return null;
  }

  const currentUser = user ?? (await getCurrentUser());

  if (!currentUser) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select(
      "role,status,workspaces(id,workspace_key,name,workspace_group,project,organization_id,organizations(id,name,slug))",
    )
    .eq("user_id", currentUser.id)
    .eq("status", "active");

  if (error) {
    return {
      user: {
        id: currentUser.id,
        email: currentUser.email,
        displayName: currentUser.displayName,
      },
      memberships: [],
    };
  }

  const memberships = (data as unknown as WorkspaceMembershipRow[])
    .map((row) => {
      const workspace = firstItem(row.workspaces);
      const organization = firstItem(workspace?.organizations ?? null);

      if (!workspace || !organization) {
        return null;
      }

      return {
        workspaceId: workspace.id,
        workspaceKey: workspace.workspace_key,
        workspaceName: workspace.name,
        workspaceGroup: workspace.workspace_group,
        project: workspace.project,
        organizationId: organization.id,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        role: row.role,
        status: row.status,
      } satisfies CmoWorkspaceMembership;
    })
    .filter((membership): membership is CmoWorkspaceMembership => Boolean(membership));

  return {
    user: {
      id: currentUser.id,
      email: currentUser.email,
      displayName: currentUser.displayName,
    },
    memberships,
  };
}
