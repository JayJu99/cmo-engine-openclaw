import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAuthFeatureFlags, getCurrentUser } from "@/lib/cmo/auth";
import { toSafeRelativePath } from "@/lib/cmo/redirects";

export const dynamic = "force-dynamic";

function safeNextPath(value: string | string[] | undefined): string {
  return toSafeRelativePath(Array.isArray(value) ? value[0] : value);
}

function errorMessage(code: string | string[] | undefined): string {
  const value = Array.isArray(code) ? code[0] : code;

  if (value === "invalid_credentials") {
    return "Email or password was not accepted.";
  }

  if (value === "auth_disabled") {
    return "Supabase auth is currently disabled for this environment.";
  }

  if (value === "auth_config") {
    return "Supabase auth is enabled but the public config is missing.";
  }

  if (value === "callback_failed") {
    return "The auth callback could not complete.";
  }

  if (value === "signed_out") {
    return "You have been signed out.";
  }

  return "";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const message = errorMessage(params.error);
  const flags = getAuthFeatureFlags();
  const user = flags.enabled && flags.hasPublicConfig ? await getCurrentUser() : null;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-md items-center">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-indigo-700">CMO Engine</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Login</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Supabase Auth is feature-flagged. Basic Auth remains active during this migration.
          </p>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Status:{" "}
          <span className="font-semibold text-slate-900">
            {flags.enabled
              ? flags.required
                ? "enabled and required"
                : "enabled, optional"
              : "disabled"}
          </span>
        </div>

        {user ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Signed in as {user.email ?? user.id}.
          </div>
        ) : null}

        {message ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {message}
          </div>
        ) : null}

        {flags.enabled ? (
          <form action="/auth/sign-in" method="post" className="mt-6 space-y-4">
            <input type="hidden" name="next" value={next} />
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Email</span>
              <Input name="email" type="email" autoComplete="email" required />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Password</span>
              <Input name="password" type="password" autoComplete="current-password" required />
            </label>
            <Button type="submit" className="w-full">
              Login
            </Button>
          </form>
        ) : (
          <div className="mt-6 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
            Login is available after `CMO_AUTH_ENABLED=true`. The app remains in legacy admin mode.
          </div>
        )}

        <div className="mt-5 text-sm">
          <Link href={next} className="font-semibold text-indigo-700 hover:text-indigo-900">
            Return to app
          </Link>
        </div>
      </section>
    </div>
  );
}
