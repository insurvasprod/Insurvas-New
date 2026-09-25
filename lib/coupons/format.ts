// Display rules for the coupons list (board p-adm-coupons).
//
// Client-safe and import-free apart from the pure arithmetic module, so the server page, the client
// table and node:test (format.test.mjs) all load the same functions. Every string a row shows is
// derived here from the coupon's own columns — nothing on the list is typed by hand.

import { couponStatus, type BillingCycle, type CouponDuration, type CouponStatus, type DiscountType } from "./discount.ts";

export type CouponDisplayInput = {
  id: string;
  code: string;
  discount_type: DiscountType;
  percent_off: number | null;
  amount_off_cents: number | null;
  duration: CouponDuration;
  duration_periods: number | null;
  billing_cycle: string | null;
  max_redemptions: number | null;
  redeemed_count: number;
  expires_at: string | null;
  restricted_to_plan_ids: string[] | null;
  is_active: boolean;
  created_at: string;
};

/** A plan a coupon can be restricted to. `latest` is false for an older version of the same plan code. */
export type CouponPlanRef = { id: string; name: string; version: number; latest: boolean };

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "20% off" or "$50.00 off" — the board's rule that a discount always says which kind it is. */
export function describeDiscount(coupon: Pick<CouponDisplayInput, "discount_type" | "percent_off" | "amount_off_cents">): string {
  return coupon.discount_type === "percent"
    ? `${coupon.percent_off ?? 0}% off`
    : `${USD.format((coupon.amount_off_cents ?? 0) / 100)} off`;
}

const PERIOD_NOUN: Record<BillingCycle, [string, string]> = {
  monthly: ["month", "months"],
  quarterly: ["quarter", "quarters"],
  yearly: ["year", "years"],
};

function isCycle(value: string | null): value is BillingCycle {
  return value === "monthly" || value === "quarterly" || value === "yearly";
}

/** How long the discount lasts, in the words of the cycle it is for. */
export function describeDuration(coupon: Pick<CouponDisplayInput, "duration" | "duration_periods" | "billing_cycle">): string {
  if (coupon.duration === "forever") return "Recurring";
  if (coupon.duration === "once") return "First invoice";
  const n = coupon.duration_periods ?? 0;
  if (!isCycle(coupon.billing_cycle)) return `First ${n} ${n === 1 ? "period" : "periods"}`;
  const [one, many] = PERIOD_NOUN[coupon.billing_cycle];
  return n === 1 ? `First ${one}` : `First ${n} ${many}`;
}

/** A plan's name, with its version when it is not the current one — a coupon for v1 refuses v2. */
export function planLabel(plan: CouponPlanRef): string {
  return plan.latest ? plan.name : `${plan.name} v${plan.version}`;
}

/**
 * The Restrictions cell: duration · cycle · plans. The cycle is always stated, because the apply
 * RPC refuses a coupon on any other cycle and "any plan" alone would read as no restriction at all.
 */
export function describeRestrictions(
  coupon: Pick<CouponDisplayInput, "duration" | "duration_periods" | "billing_cycle" | "restricted_to_plan_ids">,
  /** Null when the plans could not be read: the count is still true, the names are not guessed. */
  plans: ReadonlyMap<string, CouponPlanRef> | null,
): string {
  const cycle = isCycle(coupon.billing_cycle) ? `${coupon.billing_cycle} only` : "any cycle";
  const ids = coupon.restricted_to_plan_ids ?? [];
  let planText: string;
  if (ids.length === 0) {
    planText = "any plan";
  } else if (!plans) {
    planText = ids.length === 1 ? "1 plan only" : `${ids.length} plans only`;
  } else {
    const known = ids.map((id) => plans.get(id)).filter((plan): plan is CouponPlanRef => Boolean(plan));
    const missing = ids.length - known.length;
    const names = known.map(planLabel);
    if (missing > 0) names.push(missing === 1 ? "1 removed plan" : `${missing} removed plans`);
    planText = names.length === 1 ? `${names[0]} only` : names.join(", ");
  }
  return [describeDuration(coupon), cycle, planText].join(" · ");
}

/** "412 / 1,000", or "38 / ∞" when there is no cap — never a blank. */
export function describeRedemptions(redeemed: number, max: number | null): string {
  return `${redeemed.toLocaleString("en-US")} / ${max === null ? "∞" : max.toLocaleString("en-US")}`;
}

export const COUPON_STATUS_LABEL: Record<CouponStatus, string> = {
  active: "Active",
  deactivated: "Deactivated",
  expired: "Expired",
  exhausted: "Exhausted",
};

/** Only "active" is coloured: the others are all simply "no longer applies", which is not an alarm. */
export const COUPON_STATUS_TONE: Record<CouponStatus, "success" | "neutral"> = {
  active: "success",
  deactivated: "neutral",
  expired: "neutral",
  exhausted: "neutral",
};

export function statusOf(coupon: Pick<CouponDisplayInput, "is_active" | "expires_at" | "max_redemptions" | "redeemed_count">, now: Date): CouponStatus {
  return couponStatus(
    { isActive: coupon.is_active, expiresAt: coupon.expires_at, maxRedemptions: coupon.max_redemptions, redeemedCount: coupon.redeemed_count },
    now,
  );
}

/** Active first, then newest first — what the footer says the order is. */
export function sortActiveFirst<T extends CouponDisplayInput>(coupons: readonly T[], now: Date): T[] {
  return [...coupons].sort((a, b) => {
    const rank = (c: T) => (statusOf(c, now) === "active" ? 0 : 1);
    return rank(a) - rank(b) || b.created_at.localeCompare(a.created_at);
  });
}

export const EXPIRING_SOON_DAYS = 30;

/** Usable today and stops applying inside the next 30 days. */
export function expiresSoon(coupon: CouponDisplayInput, now: Date, days = EXPIRING_SOON_DAYS): boolean {
  if (!coupon.expires_at || statusOf(coupon, now) !== "active") return false;
  const at = new Date(coupon.expires_at).getTime();
  return at > now.getTime() && at <= now.getTime() + days * 86_400_000;
}

export type ExpiryFilter = "any" | "soon" | "dated" | "none";

export function matchesExpiry(coupon: CouponDisplayInput, filter: ExpiryFilter, now: Date): boolean {
  switch (filter) {
    case "any":
      return true;
    case "soon":
      return expiresSoon(coupon, now);
    case "dated":
      return coupon.expires_at !== null;
    case "none":
      return coupon.expires_at === null;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "31 Dec 2026", in UTC so the server and the browser print the same day. */
export function utcDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "31 Dec 2026 23:59:59 UTC" — the expiry to the second, for the hover. */
export function utcDayTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${utcDay(iso)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

/**
 * A date picked in the create dialog ("2026-12-31") as the moment it stops working: the last second
 * of that day, UTC. Null for anything that is not a real calendar date.
 */
export function endOfUtcDay(date: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return null;
  const [, y, m, d] = match.map(Number) as unknown as [number, number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null;
  return at.toISOString();
}
