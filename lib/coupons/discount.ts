// SA-3.6 · Coupon arithmetic and duration translation.
//
// Pure and integer-cents, so both are unit-tested. These are the two places a discount can quietly
// become the wrong number: the percentage rounding, and the fact that Whop counts a discount's
// life in MONTHS while our plans bill in periods that are not always a month long.

export type DiscountType = "percent" | "fixed";
export type CouponDuration = "once" | "n_periods" | "forever";
export type BillingCycle = "monthly" | "quarterly" | "yearly";

export const CYCLE_MONTHS: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

export type CouponValue = {
  discountType: DiscountType;
  /** 1–100 when discountType is "percent". */
  percentOff?: number | null;
  /** Integer cents when discountType is "fixed". */
  amountOffCents?: number | null;
};

/**
 * What a coupon takes off one period's charge.
 *
 * Never more than the amount being discounted: a $100-off coupon on a $99 plan is a free month,
 * not a dollar owed back to the customer.
 */
export function discountCentsFor(amountCents: number, coupon: CouponValue): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error(`amountCents must be a non-negative integer, got ${amountCents}`);
  }

  if (coupon.discountType === "percent") {
    const percent = coupon.percentOff;
    if (percent === null || percent === undefined) throw new Error("A percent coupon needs percentOff");
    if (percent <= 0 || percent > 100) throw new Error(`percentOff must be 1–100, got ${percent}`);
    return Math.min(amountCents, Math.round((amountCents * percent) / 100));
  }

  const amountOff = coupon.amountOffCents;
  if (amountOff === null || amountOff === undefined) throw new Error("A fixed coupon needs amountOffCents");
  if (!Number.isInteger(amountOff)) throw new Error("amountOffCents must be integer cents");
  return Math.min(amountCents, amountOff);
}

/**
 * Translates our "n billing periods" into the months Whop counts in.
 *
 * The ticket's criterion is that a 3-period coupon discounts exactly three invoices and then stops.
 * On a monthly plan three periods is three months; on a yearly plan it is thirty-six. Passing the
 * period count straight through would silently discount only the first year.
 *
 * `forever` returns 0. Whop requires promo_duration_months and its documentation never says what
 * value means unlimited, so this was checked against the sandbox rather than assumed: creating a
 * promo with 0 comes back stored as `duration: "forever"`, and 3 comes back as `repeating`.
 */
export function durationInMonths(
  duration: CouponDuration,
  durationPeriods: number | null,
  cycle: BillingCycle,
): number {
  const months = CYCLE_MONTHS[cycle];
  if (!months) throw new Error(`Unknown billing cycle "${cycle}"`);

  switch (duration) {
    case "once":
      // One billing period, whatever length that is.
      return months;
    case "n_periods":
      if (!durationPeriods || durationPeriods < 1) {
        throw new Error("n_periods needs a positive duration_periods");
      }
      return durationPeriods * months;
    case "forever":
      return 0;
  }
}

export type CouponState = {
  isActive: boolean;
  expiresAt: string | Date | null;
  maxRedemptions: number | null;
  redeemedCount: number;
};

/**
 * Why a coupon cannot be used, or null if it can.
 *
 * A reason rather than a boolean so the admin is told which of the three it is — "expired" and
 * "exhausted" need different responses from a salesperson.
 */
export function couponRejectionReason(coupon: CouponState, now: Date = new Date()): string | null {
  if (!coupon.isActive) return "This coupon has been deactivated.";

  if (coupon.expiresAt) {
    const expiry = coupon.expiresAt instanceof Date ? coupon.expiresAt : new Date(coupon.expiresAt);
    if (expiry.getTime() <= now.getTime()) {
      return `This coupon expired on ${expiry.toLocaleDateString()}.`;
    }
  }

  if (coupon.maxRedemptions !== null && coupon.redeemedCount >= coupon.maxRedemptions) {
    return `This coupon has been used ${coupon.redeemedCount} of ${coupon.maxRedemptions} times and is exhausted.`;
  }

  return null;
}

/** How many periods a freshly applied coupon has left. Null means forever. */
export function initialPeriodsRemaining(duration: CouponDuration, durationPeriods: number | null): number | null {
  if (duration === "forever") return null;
  if (duration === "once") return 1;
  return durationPeriods;
}
