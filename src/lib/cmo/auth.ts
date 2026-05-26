import type { User } from "@supabase/supabase-js";

import { isCmoAuthRequired } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface CmoCurrentUser {
  id: string;
  email: string | null;
  user: User;
}

export async function getCurrentUser(): Promise<CmoCurrentUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    user: data.user,
  };
}

export async function requireCurrentUser(): Promise<CmoCurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Authentication required.");
  }

  return user;
}

export async function getCurrentUserIfAuthRequired(): Promise<CmoCurrentUser | null> {
  if (!isCmoAuthRequired()) {
    return null;
  }

  return requireCurrentUser();
}
