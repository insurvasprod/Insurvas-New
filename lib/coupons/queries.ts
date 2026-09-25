import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { CouponRow } from "./constants";
import type { CouponPlanRef } from "./format";

export async function fetchCoupons(): Promise<CouponRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("coupons")
    .select("*")
    .order("created_at", { ascending: false });

  return (data as CouponRow[] | null) ?? [];
}

/**
 * The coupons page's read. Unlike fetchCoupons it reports a failure, because an empty list reads as
 * "no coupons exist" — the wrong answer on the screen where coupons are switched off.
 */
export async function fetchCouponList(): Promise<{ coupons: CouponRow[]; failed: boolean }> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("coupons").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error(`[coupons] list failed: ${error.message}`);
    return { coupons: [], failed: true };
  }
  return { coupons: (data as CouponRow[] | null) ?? [], failed: false };
}

/**
 * Every plan a coupon can name, archived ones included so an old restriction still reads as a plan
 * rather than an id. `latest` marks the newest version of each plan code, so the list can show
 * "Growth v1" when a coupon is pinned to a version customers are no longer sold.
 */
export async function fetchCouponPlans(): Promise<(CouponPlanRef & { is_archived: boolean })[] | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("plans")
    .select("id, name, code, version, is_archived")
    .order("name", { ascending: true })
    .order("version", { ascending: false });
  if (error) {
    console.error(`[coupons] plans could not be read: ${error.message}`);
    return null;
  }

  const rows = (data ?? []) as { id: string; name: string; code: string; version: number; is_archived: boolean }[];
  const newest = new Map<string, number>();
  for (const row of rows) newest.set(row.code, Math.max(newest.get(row.code) ?? 0, row.version));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    latest: newest.get(row.code) === row.version,
    is_archived: row.is_archived,
  }));
}

const IN_CHUNK = 150;
const PAGE = 1000;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_CHUNK) out.push(items.slice(i, i + IN_CHUNK));
  return out;
}

/**
 * What each coupon has actually taken off our invoices, in cents.
 *
 * Only invoices we generated for a subscription that carried the coupon, matched on the discount
 * line's label (`Coupon <code>`, lib/invoices/generate.ts) — codes are unique and never edited, and
 * there is no coupon id on an invoice line to join on instead. So this counts coupons applied by
 * staff or by an offer; a coupon redeemed at Whop's checkout never reaches subscription_coupons and
 * is not in this figure (a known billing gap, not this screen's to paper over).
 *
 * Reducing lines are stored negative (20260913220000), older ones positive — abs() reads both.
 * Returns null when any read fails, so the tile says it could not be read instead of showing a
 * smaller number that looks true.
 */
export async function fetchDiscountGivenByCoupon(
  coupons: readonly Pick<CouponRow, "id" | "code">[],
): Promise<Map<string, number> | null> {
  const totals = new Map<string, number>();
  if (coupons.length === 0) return totals;
  const supabase = getSupabaseServiceClient();

  const applications: { coupon_id: string; subscription_id: string }[] = [];
  for (const ids of chunks(coupons.map((c) => c.id))) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("subscription_coupons")
        .select("coupon_id, subscription_id")
        .in("coupon_id", ids)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) return null;
      applications.push(...((data ?? []) as typeof applications));
      if ((data ?? []).length < PAGE) break;
    }
  }
  if (applications.length === 0) return totals;

  const invoices: { id: string; subscription_id: string }[] = [];
  for (const ids of chunks([...new Set(applications.map((a) => a.subscription_id))])) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("platform_invoices")
        .select("id, subscription_id")
        .in("subscription_id", ids)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) return null;
      invoices.push(...((data ?? []) as typeof invoices));
      if ((data ?? []).length < PAGE) break;
    }
  }
  if (invoices.length === 0) return totals;

  const codeById = new Map(coupons.map((c) => [c.id, c.code]));
  const couponByLabel = new Map<string, Map<string, string>>(); // subscription -> label -> coupon id
  for (const a of applications) {
    const code = codeById.get(a.coupon_id);
    if (!code) continue;
    const labels = couponByLabel.get(a.subscription_id) ?? new Map<string, string>();
    labels.set(`Coupon ${code}`, a.coupon_id);
    couponByLabel.set(a.subscription_id, labels);
  }
  const subscriptionOfInvoice = new Map(invoices.map((i) => [i.id, i.subscription_id]));

  for (const ids of chunks(invoices.map((i) => i.id))) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("platform_invoice_lines")
        .select("id, invoice_id, label, amount_cents")
        .eq("kind", "discount")
        .in("invoice_id", ids)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) return null;
      const lines = (data ?? []) as { invoice_id: string; label: string; amount_cents: number }[];
      for (const line of lines) {
        const subscriptionId = subscriptionOfInvoice.get(line.invoice_id);
        const couponId = subscriptionId ? couponByLabel.get(subscriptionId)?.get(line.label) : undefined;
        if (!couponId) continue;
        totals.set(couponId, (totals.get(couponId) ?? 0) + Math.abs(line.amount_cents));
      }
      if (lines.length < PAGE) break;
    }
  }

  return totals;
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
