import "server-only";
import { cache } from "react";

import { getAdminSession } from "./requireAdminRole";
import {
  adminSessionIsCurrent,
  readAdminWithSessionVersion,
  tokenSessionVersion,
  type SessionVersionClient,
} from "./sessionVersion";
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

  const { row: admin, version } = await readAdminWithSessionVersion<CurrentAdmin & { is_active: boolean; session_version?: number }>(
    getSupabaseServiceClient() as unknown as SessionVersionClient,
    session.sub,
    "id, email, name, role, is_active, last_login_at",
  );

  if (!admin || !admin.is_active) return null;
  // Security review 2026-11, M-2: the same session-version check as resolveAdminContext, so a page
  // never renders for a session that the API would refuse.
  if (!adminSessionIsCurrent(tokenSessionVersion(session), version)) return null;

  return { id: admin.id, email: admin.email, name: admin.name, role: admin.role, last_login_at: admin.last_login_at };
});
