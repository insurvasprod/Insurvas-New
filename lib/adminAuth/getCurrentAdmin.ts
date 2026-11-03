import "server-only";
import { cache } from "react";

import { getAdminSession } from "./requireAdminRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { AdminRole } from "./roles";

export type CurrentAdmin = {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  last_login_at: string | null;
};

/** For use in Server Components/layouts. Returns null if there is no valid, active admin session. */
export async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
  return readCurrentAdmin();
}

// Memoised for one request: the admin layout and the page beneath it both resolve the admin.
const readCurrentAdmin = cache(async (): Promise<CurrentAdmin | null> => {
  const session = await getAdminSession();
  if (!session) return null;

  const supabase = getSupabaseServiceClient();
  const { data: admin } = await supabase
    .from("admin_users")
    .select("id, email, name, role, is_active, last_login_at")
    .eq("id", session.sub)
    .maybeSingle<CurrentAdmin & { is_active: boolean }>();

  if (!admin || !admin.is_active) return null;

  return admin;
});
