import { NextResponse, type NextRequest } from "next/server";

import { getAuthFeatureFlags } from "@/lib/cmo/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  if (value.startsWith("/auth/") || value.startsWith("/login")) {
    return "/";
  }

  return value;
}

export async function GET(request: NextRequest) {
  const flags = getAuthFeatureFlags();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));

  if (!flags.enabled || !flags.hasPublicConfig || !code) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(next)}&error=callback_failed`, request.url),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(next)}&error=callback_failed`, request.url),
    );
  }

  return NextResponse.redirect(new URL(next, request.url));
}
