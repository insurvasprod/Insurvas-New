import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * One account, one portal (2026-09-28 security fix).
 *
 * A partner's staff and an agency's staff live in the same `users` table, and nothing stopped one
 * account from holding both a `partner_users` row and a `tenant_users` row. Six demo partner
 * accounts did (role "assistant", left by old seed/verify scripts), so a partner admin who signed
 * in through the agent sign-in landed on /app/dashboard with the agency's leads, and an agent
 * holding a partner row could open the partner portal.
 *
 * The rule is now enforced where it cannot be skipped: both sign-ins refuse the other plane's
 * accounts, and both per-request guards (requireTenant / requirePartner) close the session of an
 * account that belongs to the other plane — so a session issued before this fix, or a membership
 * created later by any path, still cannot open the wrong portal. A failed read closes the session.
 */

// A partner membership that has ended no longer makes someone "a partner account".
const ENDED_PARTNER_STATUSES = "(removed,revoked)";

/** True when the account has a live partner-portal membership (or the read failed). */
export async function holdsPartnerMembership(userId: string): Promise<boolean> {
  const { data, error } = await getSupabaseServiceClient()
    .from("partner_users")
    .select("user_id")
    .eq("user_id", userId)
    .not("status", "in", ENDED_PARTNER_STATUSES)
    .limit(1);
  return Boolean(error) || (data?.length ?? 0) > 0;
}

/** True when the account has an agency (agent-app) membership (or the read failed). */
export async function holdsAgencyMembership(userId: string): Promise<boolean> {
  const { data, error } = await getSupabaseServiceClient()
    .from("tenant_users")
    .select("user_id")
    .eq("user_id", userId)
    .limit(1);
  return Boolean(error) || (data?.length ?? 0) > 0;
}

export const WRONG_PORTAL_CODE = "wrong_portal";
export const PARTNER_ACCOUNT_AT_AGENT_SIGN_IN = "This is a partner account. Sign in at the partner portal.";
export const AGENT_ACCOUNT_AT_PARTNER_SIGN_IN = "This is an agency account. Sign in at the agent app.";
