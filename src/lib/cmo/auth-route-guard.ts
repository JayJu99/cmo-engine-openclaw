export const CMO_AUTH_PUBLIC_PATHS = ["/login", "/logout"] as const;

export const CMO_AUTH_PROTECTED_PAGE_PATHS = [
  "/",
  "/apps",
  "/chat",
  "/vault",
  "/daily",
  "/runs",
  "/reports",
  "/signals",
  "/pipeline",
  "/ops",
  "/actions",
  "/agents",
] as const;

export function isSupabaseAuthPublicPath(pathname: string): boolean {
  return (
    CMO_AUTH_PUBLIC_PATHS.includes(pathname as (typeof CMO_AUTH_PUBLIC_PATHS)[number]) ||
    pathname.startsWith("/auth/")
  );
}

export function isSupabaseAuthProtectedPath(pathname: string): boolean {
  if (isSupabaseAuthPublicPath(pathname)) {
    return false;
  }

  if (CMO_AUTH_PROTECTED_PAGE_PATHS.includes(pathname as (typeof CMO_AUTH_PROTECTED_PAGE_PATHS)[number])) {
    return true;
  }

  return (
    pathname.startsWith("/apps/") ||
    pathname.startsWith("/api/apps/") ||
    pathname === "/api/cmo/chat" ||
    pathname.startsWith("/api/cmo/vault/") ||
    pathname === "/api/cmo/vault" ||
    pathname.startsWith("/api/vault/")
  );
}
