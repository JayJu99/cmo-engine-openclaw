import "server-only";

export type LensOAuthRedirectStatus = "connected" | "error";

function fallbackReturnTo(appId?: string | null): string {
  const normalizedAppId = typeof appId === "string" ? appId.trim() : "";

  return normalizedAppId ? `/apps/${encodeURIComponent(normalizedAppId)}?tab=dashboard` : "/";
}

export function normalizeLensOAuthReturnTo(input: string | null | undefined, appId?: string | null): string {
  const fallback = fallbackReturnTo(appId);
  const value = typeof input === "string" ? input.trim() : "";

  if (!value || value.startsWith("//")) {
    return fallback;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return fallback;
  }

  if (!value.startsWith("/")) {
    return fallback;
  }

  try {
    const parsed = new URL(value, "https://cmo.local");

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function buildLensOAuthFinalRedirect(
  baseUrl: string,
  returnTo: string | null | undefined,
  status: LensOAuthRedirectStatus,
  code?: string,
  appId?: string | null,
): URL {
  const base = new URL(baseUrl);
  const redirectUrl = new URL(normalizeLensOAuthReturnTo(returnTo, appId), base);

  redirectUrl.searchParams.set("lensOAuth", status);

  if (code) {
    redirectUrl.searchParams.set("lensOAuthCode", code);
  }

  return redirectUrl;
}
