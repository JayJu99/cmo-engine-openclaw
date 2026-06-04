export type CmoAuthMode = "supabase" | "legacy";

export interface CmoServerUserIdentity {
  authMode: CmoAuthMode;
  userId?: string;
  userEmail?: string;
  userDisplayName?: string;
  userSlug?: string;
  organizationId?: string;
  createdByUserId?: string;
  createdByEmail?: string;
}

export function legacyUserIdentity(): CmoServerUserIdentity {
  return {
    authMode: "legacy",
  };
}

export interface CmoRuntimeUserIdentity {
  user_id?: string;
  user_slug: string;
  user_display_name?: string;
  email?: string;
}

export type CmoRuntimeUserIdentityInput = Pick<CmoServerUserIdentity, "userId" | "userEmail" | "userDisplayName" | "userSlug" | "createdByEmail">;

export type CmoRuntimeUserPathKind = "raw_activity" | "daily_notes" | "weekly_notes" | "monthly_rollups";

const UNKNOWN_RUNTIME_USER_SLUG = "unknown_user";

function compactString(value?: string | null): string | undefined {
  const compacted = value?.replace(/\s+/g, " ").trim();
  return compacted || undefined;
}

function emailLocalPart(email?: string | null): string | undefined {
  const normalized = compactString(email);
  const at = normalized?.indexOf("@") ?? -1;
  if (!normalized || at <= 0) return undefined;
  return normalized.slice(0, at);
}

function shortUserId(userId?: string | null): string | undefined {
  const normalized = cmoRuntimeUserSlug(userId);
  return normalized?.slice(0, 8);
}

function displayNameFromEmail(email?: string | null): string | undefined {
  const localPart = emailLocalPart(email);
  if (!localPart) return undefined;
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function cmoRuntimeUserSlug(value?: string | null): string | undefined {
  const normalized = compactString(value)
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  if (!normalized) return undefined;

  const withoutUserPrefix = normalized.replace(/^user-+/, "");
  return withoutUserPrefix || normalized;
}

export function cmoRuntimeUserSlugFromProfile(input: {
  profileSlug?: string | null;
  profileDisplayName?: string | null;
  email?: string | null;
  userId?: string | null;
}): string {
  return cmoRuntimeUserSlug(input.profileSlug)
    ?? cmoRuntimeUserSlug(input.profileDisplayName)
    ?? cmoRuntimeUserSlug(emailLocalPart(input.email))
    ?? shortUserId(input.userId)
    ?? UNKNOWN_RUNTIME_USER_SLUG;
}

export function normalizeCmoRuntimeUserIdentity(identity?: Partial<CmoRuntimeUserIdentityInput> | null): CmoRuntimeUserIdentity {
  const email = compactString(identity?.userEmail) ?? compactString(identity?.createdByEmail);
  const displayName = compactString(identity?.userDisplayName) ?? displayNameFromEmail(email);
  const explicitSlug = cmoRuntimeUserSlug(identity?.userSlug);
  const emailSlug = cmoRuntimeUserSlug(emailLocalPart(email));
  const displayNameSlug = cmoRuntimeUserSlug(displayName);
  const userIdSuffix = shortUserId(identity?.userId);
  const derivedSlug = explicitSlug
    ?? emailSlug
    ?? (displayNameSlug && userIdSuffix ? `${displayNameSlug}-${userIdSuffix}` : undefined)
    ?? displayNameSlug
    ?? userIdSuffix
    ?? UNKNOWN_RUNTIME_USER_SLUG;

  return {
    ...(identity?.userId ? { user_id: identity.userId } : {}),
    user_slug: derivedSlug,
    ...(displayName ? { user_display_name: displayName } : {}),
    ...(email ? { email } : {}),
  };
}

function slugForRuntimePath(value: string): string {
  return cmoRuntimeUserSlug(value) ?? "unknown_workspace";
}

function isoWeek(input: Date): string {
  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function buildCmoRuntimeUserPath(input: {
  kind: CmoRuntimeUserPathKind;
  workspaceId: string;
  userIdentity?: Partial<CmoRuntimeUserIdentityInput> | null;
  now?: Date | string;
}): string {
  const date = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
  const day = date.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const workspaceId = slugForRuntimePath(input.workspaceId);
  const userSlug = normalizeCmoRuntimeUserIdentity(input.userIdentity).user_slug;

  if (input.kind === "raw_activity") {
    return `90 Runtime/Raw Activity/${workspaceId}/${userSlug}/${day}/`;
  }

  if (input.kind === "daily_notes") {
    return `90 Runtime/Daily Notes/${workspaceId}/${userSlug}/${day}.md`;
  }

  if (input.kind === "weekly_notes") {
    return `90 Runtime/Weekly Notes/${workspaceId}/${userSlug}/${isoWeek(date)}.md`;
  }

  return `90 Runtime/Monthly Rollups/${workspaceId}/${userSlug}/${month}.md`;
}

export function supabaseUserIdentity(input: {
  userId: string;
  userEmail?: string | null;
  userDisplayName?: string | null;
  userSlug?: string | null;
  organizationId?: string;
}): CmoServerUserIdentity {
  const userEmail = input.userEmail ?? undefined;
  const userDisplayName = input.userDisplayName ?? undefined;
  const userSlug = input.userSlug ?? undefined;

  return {
    authMode: "supabase",
    userId: input.userId,
    userEmail,
    userDisplayName,
    userSlug,
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
    userDisplayName: identity.userDisplayName,
    userSlug: identity.userSlug,
    organizationId: identity.organizationId,
    createdByUserId: identity.createdByUserId,
    createdByEmail: identity.createdByEmail,
  };
}
