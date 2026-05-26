import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { getAuthFeatureFlags } from "@/lib/cmo/auth";
import { toPublicRedirectUrl, toSafeRelativePath } from "@/lib/cmo/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNextPath(value: FormDataEntryValue | null): string {
  return toSafeRelativePath(typeof value === "string" ? value : "");
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

  return NextResponse.redirect(toPublicRedirectUrl(request, next));
}
