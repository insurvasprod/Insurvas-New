// SA-3.6 · Client-safe coupon values and labels.
export { CYCLE_MONTHS } from "./discount";
export type { DiscountType, CouponDuration } from "./discount";

export const DISCOUNT_TYPES = ["percent", "fixed"] as const;
export const COUPON_DURATIONS = ["once", "n_periods", "forever"] as const;

export const DISCOUNT_TYPE_LABELS = { percent: "Percentage", fixed: "Fixed amount" } as const;
export const COUPON_DURATION_LABELS = {
  once: "One billing period",
  n_periods: "A number of periods",
  forever: "Forever",
} as const;

export type CouponRow = {
  id: string;
  code: string;
  discount_type: "percent" | "fixed";
  percent_off: number | null;
  amount_off_cents: number | null;
  duration: "once" | "n_periods" | "forever";
  duration_periods: number | null;
  billing_cycle: string | null;
  max_redemptions: number | null;
  redeemed_count: number;
  expires_at: string | null;
  whop_promo_code_id: string | null;
  is_active: boolean;
  created_at: string;
};
