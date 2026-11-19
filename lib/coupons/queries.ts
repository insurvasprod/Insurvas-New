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
  return (await fetchCouponUsage(coupons))?.given ?? null;
}

/** One time a coupon was put on a subscription here: who, when, and the first invoice it took money off. */
export type CouponRedemption = {
  id: string;
  couponId: string;
  subscriptionId: string;
  tenantId: string | null;
  tenantName: string | null;
  appliedAt: string;
  /** Still on the subscription (false once removed or used up). */
  isActive: boolean;
  removedAt: string | null;
  periodsRemaining: number | null;
  /** The earliest of our invoices carrying this coupon's discount line, if one has been raised yet. */
  invoice: { id: string; number: string } | null;
  /** Cents taken off this subscription's invoices by the coupon so far. */
  givenCents: number;
};

export type CouponUsage = {
  /** Cents taken off our invoices per coupon id. */
  given: Map<string, number>;
  /** Every application per coupon id, newest first. */
  redemptions: Map<string, CouponRedemption[]>;
};

/**
 * What each coupon has done here: the discount it has given (the tile and the row's hover) and who it was applied
 * to, when, and on which invoice (the coupon sheet's Redemptions tab, admin round 1).
 *
 * Only coupons applied by staff or by an offer reach subscription_coupons; a code redeemed at Whop's checkout never
 * does (a known billing gap, said on the page). Invoices are matched on the discount line's label (`Coupon <code>`,
 * lib/invoices/generate.ts): codes are unique and never edited, and an invoice line carries no coupon id.
 *
 * Reducing lines are stored negative (20260913220000), older ones positive — abs() reads both. Returns null when any
 * read fails, so the page says it could not be read instead of showing a smaller number that looks true.
 */
export async function fetchCouponUsage(coupons: readonly Pick<CouponRow, "id" | "code">[]): Promise<CouponUsage | null> {
  const given = new Map<string, number>();
  const redemptions = new Map<string, CouponRedemption[]>();
  if (coupons.length === 0) return { given, redemptions };
  const supabase = getSupabaseServiceClient();

  type Application = {
    id: string;
    coupon_id: string;
    subscription_id: string;
    applied_at: string;
    is_active: boolean;
    removed_at: string | null;
    periods_remaining: number | null;
    subscription: { tenant_id: string; tenant: { name: string } | null } | null;
  };
  const applications: Application[] = [];
  for (const ids of chunks(coupons.map((c) => c.id))) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("subscription_coupons")
        .select("id, coupon_id, subscription_id, applied_at, is_active, removed_at, periods_remaining, subscription:subscriptions(tenant_id, tenant:tenants(name))")
        .in("coupon_id", ids)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) {
        console.error(`[coupons] applications could not be read: ${error.message}`);
        return null;
      }
      applications.push(...((data ?? []) as unknown as Application[]));
      if ((data ?? []).length < PAGE) break;
    }
  }
  if (applications.length === 0) return { given, redemptions };

  const invoices: { id: string; number: string; subscription_id: string; created_at: string }[] = [];
  for (const ids of chunks([...new Set(applications.map((a) => a.subscription_id))])) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("platform_invoices")
        .select("id, number, subscription_id, created_at")
        .in("subscription_id", ids)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) {
        console.error(`[coupons] invoices could not be read: ${error.message}`);
        return null;
      }
      invoices.push(...((data ?? []) as typeof invoices));
      if ((data ?? []).length < PAGE) break;
    }
  }

  const codeById = new Map(coupons.map((c) => [c.id, c.code]));
  const couponByLabel = new Map<string, Map<string, string>>(); // subscription -> label -> coupon id
  for (const a of applications) {
    const code = codeById.get(a.coupon_id);
    if (!code) continue;
    const labels = couponByLabel.get(a.subscription_id) ?? new Map<string, string>();
    labels.set(`Coupon ${code}`, a.coupon_id);
    couponByLabel.set(a.subscription_id, labels);
  }
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  // subscription|coupon -> cents, and -> the earliest invoice carrying the line.
  const givenBySubscription = new Map<string, number>();
  const firstInvoice = new Map<string, { id: string; number: string; created_at: string }>();

  for (const ids of chunks(invoices.map((i) => i.id))) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("platform_invoice_lines")
        .select("id, invoice_id, label, amount_cents")
        .eq("kind", "discount")
        .in("invoice_id", ids)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) {
        console.error(`[coupons] invoice lines could not be read: ${error.message}`);
        return null;
      }
      const lines = (data ?? []) as { invoice_id: string; label: string; amount_cents: number }[];
      for (const line of lines) {
        const invoice = invoiceById.get(line.invoice_id);
        const couponId = invoice ? couponByLabel.get(invoice.subscription_id)?.get(line.label) : undefined;
        if (!invoice || !couponId) continue;
        const cents = Math.abs(line.amount_cents);
        given.set(couponId, (given.get(couponId) ?? 0) + cents);
        const key = `${invoice.subscription_id}|${couponId}`;
        givenBySubscription.set(key, (givenBySubscription.get(key) ?? 0) + cents);
        const first = firstInvoice.get(key);
        if (!first || invoice.created_at < first.created_at) firstInvoice.set(key, invoice);
      }
      if (lines.length < PAGE) break;
    }
  }

  for (const a of applications) {
    const key = `${a.subscription_id}|${a.coupon_id}`;
    const invoice = firstInvoice.get(key);
    const list = redemptions.get(a.coupon_id) ?? [];
    list.push({
      id: a.id,
      couponId: a.coupon_id,
      subscriptionId: a.subscription_id,
      tenantId: a.subscription?.tenant_id ?? null,
      tenantName: a.subscription?.tenant?.name ?? null,
      appliedAt: a.applied_at,
      isActive: a.is_active,
      removedAt: a.removed_at,
      periodsRemaining: a.periods_remaining,
      invoice: invoice ? { id: invoice.id, number: invoice.number } : null,
      givenCents: givenBySubscription.get(key) ?? 0,
    });
    redemptions.set(a.coupon_id, list);
  }
  for (const list of redemptions.values()) list.sort((x, y) => y.appliedAt.localeCompare(x.appliedAt));

  return { given, redemptions };
}

/** An offer built on a coupon, for the coupons list's "Used by offers" column and the sheet's Offers tab. */
export type CouponOfferRef = { id: string; name: string; couponId: string; startsAt: string | null; endsAt: string | null; isActive: boolean };

/** Every offer, by the coupon it is built on. Null when the offers could not be read. */
export async function fetchOffersByCoupon(): Promise<Map<string, CouponOfferRef[]> | null> {
  const { data, error } = await getSupabaseServiceClient()
    .from("offers")
    .select("id, name, coupon_id, starts_at, ends_at, is_active")
    .order("created_at", { ascending: false });
  if (error) {
    console.error(`[coupons] offers could not be read: ${error.message}`);
    return null;
  }
  const byCoupon = new Map<string, CouponOfferRef[]>();
  for (const row of (data ?? []) as { id: string; name: string; coupon_id: string; starts_at: string | null; ends_at: string | null; is_active: boolean }[]) {
    const list = byCoupon.get(row.coupon_id) ?? [];
    list.push({ id: row.id, name: row.name, couponId: row.coupon_id, startsAt: row.starts_at, endsAt: row.ends_at, isActive: row.is_active });
    byCoupon.set(row.coupon_id, list);
  }
  return byCoupon;
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
