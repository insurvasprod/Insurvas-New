import "server-only";
import { cache } from "react";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { MEMBER_ROLE_LABELS, type MemberRole, type TenantRole } from "./roles";
import { readAvatar } from "@/lib/users/avatar";

/**
 * Who the top bar says you are.
 *
 * Kept apart from `resolveTenantContext`, which answers "may this request proceed" and is read on
 * every route. This is display copy for one component, so it is its own cached read rather than
 * two more columns on the hot path.
 */
export async function readTopBarIdentity(input: { userId: string; tenantId: string; role: TenantRole; memberRole?: MemberRole }) {
  const { user, tenant, avatar } = await prefetchTopBarIdentity(input.userId, input.tenantId);
  return {
    // A blank name is possible on an invited account that has not finished onboarding; the email
    // is the next best thing a person recognises as themselves.
    name: user?.name?.trim() || user?.email?.split("@")[0] || "Your account",
    email: user?.email ?? "",
    // AG-0.2: an agency admin reads "Admin", not the "Owner" whose authority the title rides on.
    roleLabel: MEMBER_ROLE_LABELS[input.memberRole ?? input.role],
    workspaceName: tenant?.name?.trim() || "Your workspace",
    // The profile picture's version, so the bar can show it in place of the initials; null when none.
    avatarVersion: avatar?.version ?? null,
  };
}

/**
 * The two reads behind the identity, keyed by plain ids so it can be started from the session JWT
 * alongside the shell's other reads — before the role is known — and then picked up by
 * `readTopBarIdentity` without a second trip. Memoised per request only; `cache` compares
 * arguments by identity, which is why this takes strings rather than the context object.
 */
export const prefetchTopBarIdentity = cache(async (userId: string, tenantId: string) => {
  const supabase = getSupabaseServiceClient();
  const [{ data: user }, { data: tenant }, avatar] = await Promise.all([
    supabase.from("users").select("name, email").eq("id", userId).maybeSingle<{ name: string | null; email: string | null }>(),
    supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle<{ name: string | null }>(),
    // Its own read: before 20261005120000 the column is missing and this is simply "no picture".
    readAvatar(userId),
  ]);
  return { user, tenant, avatar };
});
