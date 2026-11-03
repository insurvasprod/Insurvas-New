// Client-safe. Says what a valid coupon is worth, in the words the checkout shows under the code.

import type { BillingCycle } from "@/lib/money";

export type CouponTerms = {
  discountType: "percent" | "fixed";
  percentOff: number | null;
  amountOffCents: number | null;
  duration: "once" | "n_periods" | "forever";
  durationPeriods: number | null;
};

const PERIOD: Record<BillingCycle, [string, string]> = {
  monthly: ["month", "months"],
  quarterly: ["quarter", "quarters"],
  yearly: ["year", "years"],
};

const NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/**
 * "20% off the first three months", "$50.00 off the first payment", "10% off every payment".
 *
 * A period is one billing cycle, so the same three-period coupon reads "three months" on a monthly
 * plan and "three quarters" on a quarterly one — which is what the provider will actually apply.
 */
export function couponSummary(terms: CouponTerms, cycle: BillingCycle): string {
  const value =
    terms.discountType === "percent"
      ? `${terms.percentOff}% off`
      : `$${((terms.amountOffCents ?? 0) / 100).toFixed(2)} off`;

  if (terms.duration === "forever") return `${value} every payment`;
  if (terms.duration === "once" || !terms.durationPeriods) return `${value} the first payment`;

  const n = terms.durationPeriods;
  const [one, many] = PERIOD[cycle];
  if (n === 1) return `${value} the first ${one}`;
  return `${value} the first ${NUMBER_WORDS[n] ?? n} ${many}`;
}
