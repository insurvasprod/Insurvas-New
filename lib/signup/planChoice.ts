import { BILLING_CYCLES, type BillingCycle } from "../money.ts";

/**
 * Step 4 of 5, Your plan (owner pick B, 2026-10-26): who it is for, plan and billing, seats, and
 * any add-on modules the plan offers, with the total worked out as you go.
 *
 * Pure, so the page, the route that saves the choice and the tests agree on one set of rules.
 * Agency plans are flat seat bands (AG-0.12): the seat count picks the band, and the band is the
 * plan. A one-agent plan has one seat.
 */

export type PlanChoiceAddon = { code: string; name: string; description: string | null; priceCents: number; cycle: BillingCycle };

export type PlanChoiceOption = {
  code: string;
  name: string;
  blurb: string | null;
  audience: "individual" | "agency";
  /** Price per cycle in cents; null when the plan is not sold on that cycle. */
  cents: Record<BillingCycle, number | null>;
  trialDays: number;
  /** Seat band. A one-agent plan is 1–1; the last agency band has no ceiling (null). */
  minSeats: number;
  maxSeats: number | null;
  featureKeys: string[];
  addons: PlanChoiceAddon[];
};

/** The whole feature catalog by module, so a plan can say "2 of 3" for each. */
export type PlanChoiceModule = { key: string; label: string; features: { key: string; label: string }[] };

export type PlanChoice = { planCode: string; billingCycle: BillingCycle; seats: number; addonCodes: string[] };

/**
 * Gives each agency plan its band floor: one more than the previous band's ceiling. One-agent plans
 * are 1–1. Plans come back in the order given.
 */
export function withSeatBands<T extends { audience: "individual" | "agency"; maxSeats: number | null }>(plans: T[]): (T & { minSeats: number })[] {
  const agency = plans.filter((plan) => plan.audience === "agency").sort((a, b) => (a.maxSeats ?? Infinity) - (b.maxSeats ?? Infinity));
  const floor = new Map<T, number>();
  let next = 1;
  for (const plan of agency) {
    floor.set(plan, next);
    next = plan.maxSeats == null ? next : plan.maxSeats + 1;
  }
  return plans.map((plan) => plan.audience === "agency" ? { ...plan, minSeats: floor.get(plan) ?? 1 } : { ...plan, minSeats: 1, maxSeats: 1 });
}

export function seatsFit(plan: Pick<PlanChoiceOption, "minSeats" | "maxSeats">, seats: number) {
  return seats >= plan.minSeats && (plan.maxSeats == null || seats <= plan.maxSeats);
}

/** The agency band a seat count falls in. */
export function agencyPlanForSeats<T extends Pick<PlanChoiceOption, "audience" | "minSeats" | "maxSeats">>(plans: T[], seats: number): T | null {
  return plans.find((plan) => plan.audience === "agency" && seatsFit(plan, seats)) ?? null;
}

export function cyclesFor(plan: Pick<PlanChoiceOption, "cents">): BillingCycle[] {
  return BILLING_CYCLES.filter((cycle) => plan.cents[cycle] != null);
}

/** Add-ons a plan offers on a cycle: one billed on another cycle cannot attach to this subscription. */
export function addonsFor(plan: Pick<PlanChoiceOption, "addons">, cycle: BillingCycle): PlanChoiceAddon[] {
  return plan.addons.filter((addon) => addon.cycle === cycle);
}

/** Plan price plus the add-ons picked, per cycle, in cents. Null when the plan is not sold on the cycle. */
export function choiceTotalCents(plan: Pick<PlanChoiceOption, "cents" | "addons">, cycle: BillingCycle, addonCodes: string[]): number | null {
  const base = plan.cents[cycle];
  if (base == null) return null;
  return base + addonsFor(plan, cycle).filter((addon) => addonCodes.includes(addon.code)).reduce((sum, addon) => sum + addon.priceCents, 0);
}

/** The server's check of a posted choice. Unknown add-ons and seats outside the band are refused, not dropped. */
export function checkPlanChoice(plans: PlanChoiceOption[], input: PlanChoice):
  | { ok: true; plan: PlanChoiceOption; billingCycle: BillingCycle; seats: number; addons: PlanChoiceAddon[] }
  | { ok: false; error: string } {
  const plan = plans.find((candidate) => candidate.code === input.planCode);
  if (!plan) return { ok: false, error: "That plan is no longer available." };
  if (plan.cents[input.billingCycle] == null) return { ok: false, error: `${plan.name} is not sold on this billing cycle.` };
  const seats = plan.audience === "individual" ? 1 : Math.trunc(input.seats);
  if (!Number.isFinite(seats) || !seatsFit(plan, seats)) {
    return { ok: false, error: plan.maxSeats == null ? `${plan.name} starts at ${plan.minSeats} seats.` : `${plan.name} is for ${plan.minSeats}–${plan.maxSeats} seats.` };
  }
  const offered = addonsFor(plan, input.billingCycle);
  const codes = [...new Set(input.addonCodes)];
  const addons = codes.map((code) => offered.find((addon) => addon.code === code));
  if (addons.some((addon) => !addon)) return { ok: false, error: "One of those add-ons is not offered on this plan." };
  return { ok: true, plan, billingCycle: input.billingCycle, seats, addons: addons as PlanChoiceAddon[] };
}
