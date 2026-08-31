import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { OfferRow } from "./constants";

type RawOffer = Omit<OfferRow, "coupon" | "discount_given_cents" | "remaining_redemptions"> & {
  coupon: NonNullable<OfferRow["coupon"]> | null;
};

type OfferApplication = { coupon_id: string; subscription_id: string };
type Invoice = { id: string; subscription_id: string | null };
type DiscountLine = { invoice_id: string; amount_cents: number; label: string };

const OFFER_COLUMNS =
  "id, name, coupon_id, starts_at, ends_at, max_redemptions, redeemed_count, auto_apply, eligible_plan_types, eligible_plan_ids, new_customers_only, existing_customers_only, eligible_cycles, is_active, created_by, created_at, updated_at, coupon:coupons(code, discount_type, percent_off, amount_off_cents, duration, duration_periods, max_redemptions)";

async function decorateOffers(rows: RawOffer[]): Promise<OfferRow[]> {
  if (rows.length === 0) return [];

  const supabase = getSupabaseServiceClient();
  const couponIds = rows.map((row) => row.coupon_id);
  const { data: applications } = await supabase
    .from("subscription_coupons")
    .select("coupon_id, subscription_id")
    .in("coupon_id", couponIds)
    .returns<OfferApplication[]>();

  const subscriptionIds = [...new Set((applications ?? []).map((row) => row.subscription_id))];
  const invoices: Invoice[] = [];
  if (subscriptionIds.length > 0) {
    const { data } = await supabase
      .from("invoices")
      .select("id, subscription_id")
      .in("subscription_id", subscriptionIds)
      .returns<Invoice[]>();
    invoices.push(...(data ?? []));
  }

  const invoiceIds = invoices.map((invoice) => invoice.id);
  const { data: lines } = invoiceIds.length
    ? await supabase
        .from("invoice_lines")
        .select("invoice_id, amount_cents, label")
        .eq("kind", "discount")
        .in("invoice_id", invoiceIds)
        .returns<DiscountLine[]>()
    : { data: [] as DiscountLine[] };

  const invoiceSubscription = new Map(invoices.map((invoice) => [invoice.id, invoice.subscription_id]));
  const couponsBySubscription = new Map<string, Set<string>>();
  for (const application of applications ?? []) {
    const coupons = couponsBySubscription.get(application.subscription_id) ?? new Set<string>();
    coupons.add(application.coupon_id);
    couponsBySubscription.set(application.subscription_id, coupons);
  }
  const discountByCoupon = new Map<string, number>();

  for (const line of lines ?? []) {
    const subscriptionId = invoiceSubscription.get(line.invoice_id);
    const couponIdsForSubscription = subscriptionId ? couponsBySubscription.get(subscriptionId) : undefined;
    if (!couponIdsForSubscription) continue;
    const offer = rows.find((row) => couponIdsForSubscription.has(row.coupon_id) && line.label === `Coupon ${row.coupon?.code ?? ""}`);
    if (!offer) continue;
    discountByCoupon.set(offer.coupon_id, (discountByCoupon.get(offer.coupon_id) ?? 0) + line.amount_cents);
  }

  return rows.map((row) => ({
    ...row,
    discount_given_cents: discountByCoupon.get(row.coupon_id) ?? 0,
    remaining_redemptions:
      row.max_redemptions === null ? null : Math.max(0, row.max_redemptions - row.redeemed_count),
  }));
}

export async function fetchOffers(): Promise<OfferRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("offers")
    .select(OFFER_COLUMNS)
    .order("created_at", { ascending: false })
    .returns<RawOffer[]>();
  if (error) throw new Error(`Could not load offers: ${error.message}`);
  return decorateOffers(data ?? []);
}

export async function fetchOffer(id: string): Promise<OfferRow | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("offers")
    .select(OFFER_COLUMNS)
    .eq("id", id)
    .maybeSingle<RawOffer>();
  if (error) throw new Error(`Could not load offer: ${error.message}`);
  if (!data) return null;
  return (await decorateOffers([data]))[0] ?? null;
}

export async function fetchOfferForApplication(id: string): Promise<RawOffer | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("offers")
    .select(OFFER_COLUMNS)
    .eq("id", id)
    .maybeSingle<RawOffer>();
  if (error) throw new Error(`Could not load offer: ${error.message}`);
  return data;
}
