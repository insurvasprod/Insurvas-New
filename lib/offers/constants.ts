import { PLAN_TYPES, type PlanType } from "@/lib/plans/constants";
import { BILLING_CYCLES, type BillingCycle } from "@/lib/money";
import { DISCOUNT_TYPES, COUPON_DURATIONS, type DiscountType, type CouponDuration } from "@/lib/coupons/constants";

export { PLAN_TYPES, BILLING_CYCLES, DISCOUNT_TYPES, COUPON_DURATIONS };
export type { PlanType, BillingCycle, DiscountType, CouponDuration };

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  individual: "Individual",
  agency_no_teams: "Agency (flat)",
  agency_with_teams: "Agency (with teams)",
  management: "Management",
};

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export const OFFER_DURATION_LABELS: Record<CouponDuration, string> = {
  once: "One billing period",
  n_periods: "A number of billing periods",
  forever: "Forever",
};

export type OfferRow = {
  id: string;
  name: string;
  coupon_id: string;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  redeemed_count: number;
  auto_apply: boolean;
  eligible_plan_types: PlanType[];
  eligible_plan_ids: string[];
  new_customers_only: boolean;
  existing_customers_only: boolean;
  eligible_cycles: BillingCycle[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  coupon: {
    code: string;
    discount_type: DiscountType;
    percent_off: number | null;
    amount_off_cents: number | null;
    duration: CouponDuration;
    duration_periods: number | null;
    max_redemptions: number | null;
  } | null;
  discount_given_cents: number;
  remaining_redemptions: number | null;
};

export type OfferFormInput = {
  name: string;
  discount_type: DiscountType;
  percent_off?: number | null;
  amount_off?: string | null;
  duration: CouponDuration;
  duration_periods?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  max_redemptions?: number | null;
  auto_apply: boolean;
  eligible_plan_types: PlanType[];
  eligible_plan_ids: string[];
  new_customers_only: boolean;
  existing_customers_only: boolean;
  eligible_cycles: BillingCycle[];
  is_active?: boolean;
};
