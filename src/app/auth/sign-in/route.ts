import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { getAuthFeatureFlags } from "@/lib/cmo/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNextPath(value: FormDataEntryValue | null): string {
  const candidate = typeof value === "string" ? value : "";

  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/";
  }

  if (candidate.startsWith("/auth/") || candidate.startsWith("/login")) {
    return "/";
  }

  return candidate;
}

export async function POST(request: NextRequest) {
  const flags = getAuthFeatureFlags();
  const formData = await request.formData();
  const next = safeNextPath(formData.get("next"));

  if (!flags.enabled) {
    redirect(`/login?next=${encodeURIComponent(next)}&error=auth_disabled`);
  }

  if (!flags.hasPublicConfig) {
    redirect(`/login?next=${encodeURIComponent(next)}&error=auth_config`);
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect(`/login?next=${encodeURIComponent(next)}&error=invalid_credentials`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/login?next=${encodeURIComponent(next)}&error=invalid_credentials`);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
