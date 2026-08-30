import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { CouponRow } from "./constants";

export async function fetchCoupons(): Promise<CouponRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("coupons")
    .select("*")
    .order("created_at", { ascending: false });

  return (data as CouponRow[] | null) ?? [];
}

export type AppliedCoupon = {
  id: string;
  coupon_id: string;
  code: string;
  discount_type: "percent" | "fixed";
  percent_off: number | null;
  amount_off_cents: number | null;
  periods_remaining: number | null;
  applied_at: string;
};

/** The one active coupon on a subscription, if any. At most one — enforced by a unique index. */
export async function fetchActiveCoupon(subscriptionId: string): Promise<AppliedCoupon | null> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("subscription_coupons")
    .select("id, coupon_id, periods_remaining, applied_at, coupons(code, discount_type, percent_off, amount_off_cents)")
    .eq("subscription_id", subscriptionId)
    .eq("is_active", true)
    .maybeSingle<{
      id: string;
      coupon_id: string;
      periods_remaining: number | null;
      applied_at: string;
      coupons: {
        code: string;
        discount_type: "percent" | "fixed";
        percent_off: number | null;
        amount_off_cents: number | null;
      } | null;
    }>();

  if (!data || !data.coupons) return null;

  return {
    id: data.id,
    coupon_id: data.coupon_id,
    code: data.coupons.code,
    discount_type: data.coupons.discount_type,
    percent_off: data.coupons.percent_off,
    amount_off_cents: data.coupons.amount_off_cents,
    periods_remaining: data.periods_remaining,
    applied_at: data.applied_at,
  };
}
