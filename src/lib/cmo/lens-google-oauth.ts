import "server-only";

export const GOOGLE_ANALYTICS_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const GOOGLE_OAUTH_SCOPES = [
  GOOGLE_ANALYTICS_READONLY_SCOPE,
  "openid",
  "email",
  "profile",
] as const;

export interface LensGoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function envValue(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function getLensOAuthConfigStatus(): {
  configured: boolean;
  missing: string[];
} {
  const required = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "LENS_OAUTH_STATE_SECRET",
    "LENS_OAUTH_TOKEN_ENCRYPTION_KEY",
  ];
  const missing = required.filter((name) => !envValue(name));

  return {
    configured: missing.length === 0,
    missing,
  };
}

export function getLensGoogleOAuthConfig(): LensGoogleOAuthConfig {
  const missing = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
  ].filter((name) => !envValue(name));

  if (missing.length) {
    throw new Error(`Missing Google OAuth server env: ${missing.join(", ")}`);
  }

  return {
    clientId: envValue("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: envValue("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: envValue("GOOGLE_OAUTH_REDIRECT_URI"),
  };
}

export function buildGoogleOAuthAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): URL {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);

  return url;
}
