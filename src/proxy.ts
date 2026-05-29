import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import {
  isSupabaseAuthProtectedPath,
  isSupabaseAuthPublicPath,
} from "@/lib/cmo/auth-route-guard";
import { toPublicRedirectUrl } from "@/lib/cmo/redirects";
import { vaultIngestInternalAuthStatus } from "@/lib/cmo/vault-agent-source-ingestion-auth";

const BASIC_AUTH_REALM = "CMO Engine Dashboard";

function isBasicAuthEnabled(): boolean {
  return process.env.DASHBOARD_BASIC_AUTH_ENABLED === "true";
}

function isCmoAuthEnabled(): boolean {
  return process.env.CMO_AUTH_ENABLED === "true";
}

function isCmoAuthRequired(): boolean {
  return process.env.CMO_AUTH_REQUIRED === "true";
}

function isBasicAuthProtectedPath(pathname: string): boolean {
  return pathname.startsWith("/api/cmo/") || !pathname.startsWith("/api/");
}

function safeReturnPath(request: NextRequest): string {
  return `${request.nextUrl.pathname}${request.nextUrl.search}`;
}

function fixedTimeEqual(actual: string, expected: string): boolean {
  let mismatch = actual.length ^ expected.length;
  const maxLength = Math.max(actual.length, expected.length);

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |=
      (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }

  return mismatch === 0;
}

function decodeBasicCredentials(
  headerValue: string | null,
): { username: string; password: string } | null {
  const match = headerValue?.match(/^Basic\s+(.+)$/i);

  if (!match) {
    return null;
  }

  try {
    const bytes = Uint8Array.from(atob(match[1]), (char) =>
      char.charCodeAt(0),
    );
    const decoded = new TextDecoder().decode(bytes);
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function isAuthorized(request: NextRequest): boolean {
  const expectedUsername = process.env.DASHBOARD_BASIC_AUTH_USERNAME ?? "";
  const expectedPassword = process.env.DASHBOARD_BASIC_AUTH_PASSWORD ?? "";
  const credentials = decodeBasicCredentials(
    request.headers.get("authorization"),
  );

  if (!expectedUsername || !expectedPassword) {
    return false;
  }

  if (!credentials) {
    return false;
  }

  return (
    fixedTimeEqual(credentials.username, expectedUsername) &&
    fixedTimeEqual(credentials.password, expectedPassword)
  );
}

function unauthorizedResponse(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": `Basic realm="${BASIC_AUTH_REALM}", charset="UTF-8"`,
    },
  });
}

function isVaultSourceIngestionPath(pathname: string): boolean {
  return pathname === "/api/cmo/vault/ingest-source";
}

function vaultSourceIngestionInternalAuthResponse(request: NextRequest): NextResponse | null {
  if (!isVaultSourceIngestionPath(request.nextUrl.pathname)) {
    return null;
  }

  const internalAuth = vaultIngestInternalAuthStatus(request);

  if (internalAuth.status === "authorized") {
    return NextResponse.next();
  }

  if (internalAuth.status === "unauthorized" || internalAuth.status === "not_configured") {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  return null;
}

function supabaseConfigAvailable(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

async function resolveSupabaseAuth(request: NextRequest): Promise<NextResponse | null> {
  if (
    !isCmoAuthEnabled() ||
    !isCmoAuthRequired() ||
    isSupabaseAuthPublicPath(request.nextUrl.pathname) ||
    !isSupabaseAuthProtectedPath(request.nextUrl.pathname)
  ) {
    return NextResponse.next();
  }

  if (!supabaseConfigAvailable()) {
    return NextResponse.json(
      { error: "Supabase auth is required but not configured." },
      { status: 503 },
    );
  }

  let supabaseResponse = NextResponse.next({
    request,
  });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return supabaseResponse;
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  return NextResponse.redirect(
    toPublicRedirectUrl(
      request,
      `/login?next=${encodeURIComponent(safeReturnPath(request))}`,
      { allowAuthPaths: true },
    ),
  );
}

export async function proxy(request: NextRequest) {
  const vaultIngestAuth = vaultSourceIngestionInternalAuthResponse(request);
  if (vaultIngestAuth) {
    return vaultIngestAuth;
  }

  if (
    isBasicAuthEnabled() &&
    isBasicAuthProtectedPath(request.nextUrl.pathname) &&
    !isAuthorized(request)
  ) {
    return unauthorizedResponse();
  }

  return resolveSupabaseAuth(request);
}

export const config = {
  matcher: [
    "/api/cmo/:path*",
    "/api/apps/:path*",
    "/api/vault/:path*",
    "/((?!api|_next|favicon.ico|.*\\..*).*)",
  ],
};
