import { NextResponse, type NextRequest } from "next/server";

import { getAuthFeatureFlags } from "@/lib/cmo/auth";
import { toPublicRedirectUrl, toSafeRelativePath } from "@/lib/cmo/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null): string {
  return toSafeRelativePath(value);
}

export async function GET(request: NextRequest) {
  const flags = getAuthFeatureFlags();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));

  if (!flags.enabled || !flags.hasPublicConfig || !code) {
    return NextResponse.redirect(
      toPublicRedirectUrl(request, `/login?next=${encodeURIComponent(next)}&error=callback_failed`, {
        allowAuthPaths: true,
      }),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      toPublicRedirectUrl(request, `/login?next=${encodeURIComponent(next)}&error=callback_failed`, {
        allowAuthPaths: true,
      }),
    );
  }

  return NextResponse.redirect(toPublicRedirectUrl(request, next));
}
