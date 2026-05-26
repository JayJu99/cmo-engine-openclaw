import { NextResponse, type NextRequest } from "next/server";

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

  return NextResponse.redirect(new URL("/login?error=signed_out", request.url));
}

export async function GET(request: NextRequest) {
  await signOutIfEnabled();

  return NextResponse.redirect(new URL("/login?error=signed_out", request.url));
}
