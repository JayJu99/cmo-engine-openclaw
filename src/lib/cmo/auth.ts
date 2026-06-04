import type { User } from "@supabase/supabase-js";

import {
  getSupabaseEnvStatus,
  isCmoAuthEnabled,
  isCmoAuthRequired,
} from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { legacyUserIdentity, supabaseUserIdentity, type CmoServerUserIdentity } from "@/lib/cmo/user-metadata";

export interface CmoCurrentUser {
  id: string;
  email: string | null;
  displayName: string | null;
  userSlug: string | null;
  user: User;
}

export interface CmoAuthFeatureFlags {
  enabled: boolean;
  required: boolean;
  hasPublicConfig: boolean;
  hasAdminConfig: boolean;
}

export interface CmoLegacyOwnerContext {
  mode: "legacy_admin";
  userId: null;
  email: null;
  isAuthenticated: false;
  reason: "auth_disabled";
}

export type CmoRequestUserContext =
  | {
      mode: "supabase";
      userId: string;
      email: string | null;
      displayName: string | null;
      userSlug: string | null;
      isAuthenticated: true;
    }
  | CmoLegacyOwnerContext
  | {
      mode: "anonymous";
      userId: null;
      email: null;
      displayName: null;
      isAuthenticated: false;
    };

export function getAuthFeatureFlags(): CmoAuthFeatureFlags {
  const envStatus = getSupabaseEnvStatus();

  return {
    enabled: isCmoAuthEnabled(),
    required: isCmoAuthRequired(),
    hasPublicConfig: envStatus.missingPublic.length === 0,
    hasAdminConfig: envStatus.missingAdmin.length === 0,
  };
}

function metadataString(metadata: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export async function getCurrentUser(): Promise<CmoCurrentUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    displayName: metadataString(data.user.user_metadata, ["user_display_name", "display_name", "full_name", "name"]),
    userSlug: metadataString(data.user.user_metadata, ["user_slug", "profile_slug", "slug"])
      ?? metadataString(data.user.app_metadata, ["user_slug", "profile_slug", "slug"]),
    user: data.user,
  };
}

export async function requireCurrentUser(): Promise<CmoCurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Authentication required.");
  }

  return user;
}

export async function getCurrentUserIfAuthRequired(): Promise<CmoCurrentUser | null> {
  if (!isCmoAuthRequired()) {
    return null;
  }

  return requireCurrentUser();
}

export async function getOptionalRequestUser(): Promise<CmoRequestUserContext> {
  if (!isCmoAuthEnabled()) {
    return {
      mode: "legacy_admin",
      userId: null,
      email: null,
      isAuthenticated: false,
      reason: "auth_disabled",
    };
  }

  const user = await getCurrentUser();

  if (!user) {
    return {
      mode: "anonymous",
      userId: null,
      email: null,
      displayName: null,
      isAuthenticated: false,
    };
  }

  return {
    mode: "supabase",
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    userSlug: user.userSlug,
    isAuthenticated: true,
  };
}

export async function requireRequestUserIfAuthRequired(): Promise<CmoRequestUserContext> {
  if (!isCmoAuthRequired()) {
    return getOptionalRequestUser();
  }

  const user = await requireCurrentUser();

  return {
    mode: "supabase",
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    userSlug: user.userSlug,
    isAuthenticated: true,
  };
}

export function getLegacyOwnerContextIfAuthDisabled(): CmoLegacyOwnerContext | null {
  if (isCmoAuthEnabled()) {
    return null;
  }

  return {
    mode: "legacy_admin",
    userId: null,
    email: null,
    isAuthenticated: false,
    reason: "auth_disabled",
  };
}

export async function getServerUserIdentity(): Promise<CmoServerUserIdentity> {
  const context = await requireRequestUserIfAuthRequired();

  if (context.mode === "supabase") {
    return supabaseUserIdentity({
      userId: context.userId,
      userEmail: context.email,
      userDisplayName: context.displayName,
      userSlug: context.userSlug,
    });
  }

  return legacyUserIdentity();
}
