// Client-safe: the LA-1.19 partner-limit rules that are not database reads.
import type { PartnerType } from "@/lib/partners/constants";
import type { PartnerCapKey } from "./copy";

export const PARTNER_TYPE_CAP_KEY: Record<PartnerType, Exclude<PartnerCapKey, "max_partner_users">> = {
  publisher: "max_publishers",
  marketing: "max_marketing_partners",
  affiliate: "max_affiliates",
};

/** At the cap: only an active partner holds a slot, so this compares the ACTIVE count. Null = no limit. */
export function atPartnerCap(activeCount: number, limit: number | null | undefined): boolean {
  return limit != null && activeCount >= limit;
}

/**
 * Before 20260925709950 is applied, create_partner_with_limits and update_partner_with_limits count
 * draft + active. When the database's refusal counted more partners than are active, the extra are
 * drafts, and the limit passed back in is raised by exactly that many so the database applies the
 * active-only rule. Once the migration is live its count equals the active count and this returns
 * null, so nothing is retried.
 */
export function draftCompensatedLimit(refusedCount: number, activeCount: number, limit: number): number | null {
  const drafts = refusedCount - activeCount;
  return drafts > 0 ? limit + drafts : null;
}

/**
 * Before 20260925709950, transition_partner_with_limits refused a resume when the partner-user count
 * (which includes the partner's own users) merely REACHED the limit. Reaching it is allowed, so a
 * refusal at exactly the limit is retried with the limit one higher, which the old body turns into
 * "over the limit". The migrated body never refuses at exactly the limit, so this returns null.
 */
export function atLimitUserRefusalRetry(refusedCount: number, limit: number): number | null {
  return refusedCount === limit ? limit + 1 : null;
}
