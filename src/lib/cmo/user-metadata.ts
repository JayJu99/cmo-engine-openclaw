export type CmoAuthMode = "supabase" | "legacy";

export interface CmoServerUserIdentity {
  authMode: CmoAuthMode;
  userId?: string;
  userEmail?: string;
  organizationId?: string;
  createdByUserId?: string;
  createdByEmail?: string;
}

export function legacyUserIdentity(): CmoServerUserIdentity {
  return {
    authMode: "legacy",
  };
}

export function supabaseUserIdentity(input: {
  userId: string;
  userEmail?: string | null;
  organizationId?: string;
}): CmoServerUserIdentity {
  const userEmail = input.userEmail ?? undefined;

  return {
    authMode: "supabase",
    userId: input.userId,
    userEmail,
    organizationId: input.organizationId,
    createdByUserId: input.userId,
    createdByEmail: userEmail,
  };
}

export function applyServerUserIdentity<T extends object>(
  value: T,
  identity: CmoServerUserIdentity,
): T & CmoServerUserIdentity {
  return {
    ...value,
    authMode: identity.authMode,
    userId: identity.userId,
    userEmail: identity.userEmail,
    organizationId: identity.organizationId,
    createdByUserId: identity.createdByUserId,
    createdByEmail: identity.createdByEmail,
  };
}
