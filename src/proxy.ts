import { NextResponse, type NextRequest } from "next/server";

const BASIC_AUTH_REALM = "CMO Engine Dashboard";

function isBasicAuthEnabled(): boolean {
  return process.env.DASHBOARD_BASIC_AUTH_ENABLED === "true";
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

export function proxy(request: NextRequest) {
  if (!isBasicAuthEnabled() || isAuthorized(request)) {
    return NextResponse.next();
  }

  return unauthorizedResponse();
}

export const config = {
  matcher: [
    "/api/cmo/:path*",
    "/((?!api|_next|favicon.ico|.*\\..*).*)",
  ],
};
