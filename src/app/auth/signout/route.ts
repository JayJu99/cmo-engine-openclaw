import { NextResponse, type NextRequest } from "next/server";

import { toPublicRedirectUrl } from "@/lib/cmo/redirects";
import { isCmoAuthEnabled } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function signOutIfEnabled() {
  if (!isCmoAuthEnabled()) {
    return;
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}

export async function POST(request: NextRequest) {
  await signOutIfEnabled();

  return NextResponse.redirect(
    toPublicRedirectUrl(request, "/login?error=signed_out", { allowAuthPaths: true }),
  );
}

export async function GET(request: NextRequest) {
  await signOutIfEnabled();

  return NextResponse.redirect(
    toPublicRedirectUrl(request, "/login?error=signed_out", { allowAuthPaths: true }),
  );
}
