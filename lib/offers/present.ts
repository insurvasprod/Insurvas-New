// How the Offers page reads an offer (admin round 1, billing-r2 screen 9): its state, its rule in words, its target,
// and which live offers could apply to the same subscription. Pure and client-safe, so the page's status line and
// tiles (server) and the list, calendar and sheet (client) say the same thing.

import { formatCentsAsCurrency } from "../money.ts";
import { BILLING_CYCLE_LABELS, PLAN_TYPE_LABELS, type OfferRow } from "./constants.ts";

export type OfferState = "active" | "scheduled" | "ended" | "inactive";

export const OFFER_STATE: Record<OfferState, { label: string; tone: "good" | "info" | "neutral" }> = {
  active: { label: "Active", tone: "good" },
  scheduled: { label: "Scheduled", tone: "info" },
  ended: { label: "Ended", tone: "neutral" },
  inactive: { label: "Deactivated", tone: "neutral" },
};

/** Active and scheduled are the two states an operator most needs to tell apart — only the clock separates them. */
export function stateOf(offer: Pick<OfferRow, "ends_at" | "starts_at" | "is_active">, now: number): OfferState {
  if (offer.ends_at && Date.parse(offer.ends_at) < now) return "ended";
  if (!offer.is_active) return "inactive";
  if (offer.starts_at && Date.parse(offer.starts_at) > now) return "scheduled";
  return "active";
}

/** "20% off for 3 billing periods". */
export function ruleOf(offer: Pick<OfferRow, "coupon">): string {
  const c = offer.coupon;
  if (!c) return "Coupon unavailable";
  const amount = c.discount_type === "percent" ? `${c.percent_off ?? 0}% off` : `${formatCentsAsCurrency(c.amount_off_cents ?? 0)} off`;
  const how = c.duration === "once" ? "for one billing period" : c.duration === "forever" ? "forever" : `for ${c.duration_periods ?? 0} billing ${c.duration_periods === 1 ? "period" : "periods"}`;
  return `${amount} ${how}`;
}

/** "Plan type · Individual · new signups · monthly". */
export function targetOf(offer: OfferRow, planName: (id: string) => string | undefined): string {
  const parts: string[] = [];
  if (offer.eligible_plan_ids.length) parts.push(`Plan · ${offer.eligible_plan_ids.map((id) => planName(id) ?? "Removed plan").join(", ")}`);
  else if (offer.eligible_plan_types.length) parts.push(`Plan type · ${offer.eligible_plan_types.map((t) => PLAN_TYPE_LABELS[t]).join(", ")}`);
  else parts.push("Every plan");
  if (offer.new_customers_only) parts.push("new signups");
  if (offer.existing_customers_only) parts.push("existing customers");
  if (offer.eligible_cycles.length) parts.push(offer.eligible_cycles.map((c) => BILLING_CYCLE_LABELS[c].toLowerCase()).join(" / "));
  return parts.join(" · ");
}

type Rules = Pick<OfferRow, "starts_at" | "ends_at" | "eligible_plan_ids" | "eligible_plan_types" | "eligible_cycles" | "new_customers_only" | "existing_customers_only">;

/** Could two offers apply to the same subscription at the same time? Empty lists mean "all". */
export function overlaps(a: Rules, b: Rules): boolean {
  const start = (o: Rules) => (o.starts_at ? Date.parse(o.starts_at) : -Infinity);
  const end = (o: Rules) => (o.ends_at ? Date.parse(o.ends_at) : Infinity);
  if (start(a) > end(b) || start(b) > end(a)) return false;
  const meet = <T,>(x: readonly T[], y: readonly T[]) => x.length === 0 || y.length === 0 || x.some((item) => y.includes(item));
  if (!meet(a.eligible_plan_ids, b.eligible_plan_ids) || !meet(a.eligible_plan_types, b.eligible_plan_types) || !meet(a.eligible_cycles, b.eligible_cycles)) return false;
  if ((a.new_customers_only && b.existing_customers_only) || (a.existing_customers_only && b.new_customers_only)) return false;
  return true;
}

/** The live (active or scheduled) offers that overlap another live one, each with whom. */
export function overlappingOffers<O extends OfferRow>(offers: readonly O[], now: number): Array<{ offer: O; with: O[] }> {
  const live = offers.filter((offer) => {
    const state = stateOf(offer, now);
    return state === "active" || state === "scheduled";
  });
  return live
    .map((offer) => ({ offer, with: live.filter((other) => other.id !== offer.id && overlaps(offer, other)) }))
    .filter((row) => row.with.length > 0);
}
