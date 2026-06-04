import type { User } from "@supabase/supabase-js";

import {
  getSupabaseEnvStatus,
  isCmoAuthEnabled,
  isCmoAuthRequired,
} from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  cmoRuntimeUserDisplayNameFromProfile,
  cmoRuntimeUserSlugFromProfile,
  legacyUserIdentity,
  supabaseUserIdentity,
  type CmoServerUserIdentity,
} from "@/lib/cmo/user-metadata";

export interface CmoCurrentUser {
  id: string;
  email: string | null;
  displayName: string | null;
  userSlug: string | null;
  profileEmail: string | null;
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
      profileEmail: string | null;
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

interface CmoProfileIdentityRow {
  id?: unknown;
  email?: unknown;
  display_name?: unknown;
}

function profileString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function getProfileIdentity(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
): Promise<CmoProfileIdentityRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,display_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[cmo-auth] Failed to load profile identity; falling back to auth user metadata.", {
      userId,
      reason: error.message,
    });
    return null;
  }

  return data;
}

export async function getCurrentUser(): Promise<CmoCurrentUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  const profile = await getProfileIdentity(supabase, data.user.id);
  const profileEmail = profileString(profile?.email);
  const authEmail = data.user.email ?? null;
  const email = profileEmail ?? authEmail;
  const profileDisplayName = profileString(profile?.display_name);
  const metadataDisplayName = metadataString(data.user.user_metadata, ["full_name", "name", "display_name", "user_display_name"]);
  const displayName = cmoRuntimeUserDisplayNameFromProfile({
    profileDisplayName,
    metadataDisplayName,
    email,
    userId: data.user.id,
  }) ?? null;
  const userSlug = profileDisplayName
    ? cmoRuntimeUserSlugFromProfile({
        profileDisplayName: displayName ?? profileDisplayName,
        email,
        userId: data.user.id,
      })
    : cmoRuntimeUserSlugFromProfile({
        profileDisplayName: displayName,
        email,
        userId: data.user.id,
      });

  return {
    id: data.user.id,
    email,
    displayName,
    userSlug,
    profileEmail,
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
    profileEmail: user.profileEmail,
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
    profileEmail: user.profileEmail,
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
