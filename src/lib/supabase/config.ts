import "server-only";

export interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}

export interface SupabaseAdminConfig extends SupabasePublicConfig {
  serviceRoleKey: string;
}

function envValue(name: string): string {
  return (process.env[name] ?? "").trim();
}

function missingEnv(names: string[]): string[] {
  return names.filter((name) => !envValue(name));
}

export function isCmoAuthEnabled(): boolean {
  return envValue("CMO_AUTH_ENABLED") === "true";
}

export function isCmoAuthRequired(): boolean {
  return envValue("CMO_AUTH_REQUIRED") === "true";
}

export function isCmoSupabaseIndexingEnabled(): boolean {
  return envValue("CMO_SUPABASE_INDEXING_ENABLED") === "true";
}

export function isCmoIndexedContextEnabled(): boolean {
  return envValue("CMO_INDEXED_CONTEXT_ENABLED") === "true";
}

export function getCmoIndexedContextCanaryApps(): string[] {
  const configured = envValue("CMO_INDEXED_CONTEXT_CANARY_APPS") || "holdstation-mini-app";

  return configured
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getCmoIndexedContextMode(): "supplemental" | string {
  return envValue("CMO_INDEXED_CONTEXT_MODE") || "supplemental";
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const missing = missingEnv(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);

  if (missing.length) {
    throw new Error(`Missing Supabase public env: ${missing.join(", ")}`);
  }

  return {
    url: envValue("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}

export function getSupabaseAdminConfig(): SupabaseAdminConfig {
  const publicConfig = getSupabasePublicConfig();
  const missing = missingEnv(["SUPABASE_SERVICE_ROLE_KEY"]);

  if (missing.length) {
    throw new Error(`Missing Supabase server env: ${missing.join(", ")}`);
  }

  return {
    ...publicConfig,
    serviceRoleKey: envValue("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function getSupabaseEnvStatus(): {
  authEnabled: boolean;
  authRequired: boolean;
  hasUrl: boolean;
  hasAnonKey: boolean;
  hasServiceRoleKey: boolean;
  missingPublic: string[];
  missingAdmin: string[];
} {
  const missingPublic = missingEnv(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
  const missingAdmin = missingEnv(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);

  return {
    authEnabled: isCmoAuthEnabled(),
    authRequired: isCmoAuthRequired(),
    hasUrl: Boolean(envValue("NEXT_PUBLIC_SUPABASE_URL")),
    hasAnonKey: Boolean(envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY")),
    hasServiceRoleKey: Boolean(envValue("SUPABASE_SERVICE_ROLE_KEY")),
    missingPublic,
    missingAdmin,
  };
}
