import type { NextRequest } from "next/server";

const DEFAULT_PRODUCTION_ORIGIN = "https://cmo.jayju.cloud";

function firstHeaderValue(value: string | null): string {
  return (value ?? "").split(",")[0]?.trim() ?? "";
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizeOrigin(value: string): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    if (process.env.NODE_ENV === "production" && isLocalHost(url.hostname)) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function toSafeRelativePath(
  value: string | null | undefined,
  options: { allowAuthPaths?: boolean } = {},
): string {
  const candidate = (value ?? "").trim();

  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/";
  }

  if (
    candidate.includes("\\") ||
    (!options.allowAuthPaths &&
      (candidate.startsWith("/auth/") || candidate.startsWith("/login")))
  ) {
    return "/";
  }

  return candidate;
}

export function getPublicAppOrigin(request: Pick<NextRequest, "headers" | "url">): string {
  const configuredOrigin = normalizeOrigin(process.env.CMO_PUBLIC_APP_URL ?? "");

  if (configuredOrigin) {
    return configuredOrigin;
  }

  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost || firstHeaderValue(request.headers.get("host"));
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const proto = forwardedProto || (host && !host.startsWith("localhost") ? "https" : "http");
  const forwardedOrigin = normalizeOrigin(host ? `${proto}://${host}` : "");

  if (forwardedOrigin) {
    return forwardedOrigin;
  }

  const requestOrigin = normalizeOrigin(new URL(request.url).origin);

  if (requestOrigin) {
    return requestOrigin;
  }

  return process.env.NODE_ENV === "production" ? DEFAULT_PRODUCTION_ORIGIN : "http://localhost:3000";
}

export function toPublicRedirectUrl(
  request: Pick<NextRequest, "headers" | "url">,
  value: string | null | undefined,
  options: { allowAuthPaths?: boolean } = {},
): URL {
  return new URL(toSafeRelativePath(value, options), getPublicAppOrigin(request));
}
