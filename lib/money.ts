// Money is integer cents everywhere (SA-00's locked decisions). These helpers are the only
// place dollars and cents convert, and they do it with string manipulation and integer maths —
// never `parseFloat(x) * 100`, which gives 44998.999999999996 for "449.99".

/** Accepts "449.99", "$1,299", ".5", "449." — rejects anything with more than 2 decimals. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (cleaned === "") return null;

  const match = /^(-?)(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;

  const [, sign, whole, frac] = match;
  // "." or "-" alone isn't a number.
  if (whole === "" && (frac === undefined || frac === "")) return null;

  // Both halves are integer strings, so this never touches a float.
  const wholeCents = Number(whole || "0") * 100;
  const fracCents = Number(((frac ?? "") + "00").slice(0, 2));
  const cents = wholeCents + fracCents;

  if (!Number.isSafeInteger(cents)) return null;
  return sign === "-" ? -cents : cents;
}

/** 44999 -> "449.99". Pure integer maths, so no toFixed rounding surprises. */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** 44999 -> "$449.99", with thousands separators. For display only. */
export function formatCentsAsCurrency(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${whole}.${frac}`;
}

export const BILLING_CYCLES = ["monthly", "quarterly", "yearly"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export type PlanPrices = {
  price_monthly_cents: number | null;
  price_quarterly_cents: number | null;
  price_yearly_cents: number | null;
  setup_fee_cents: number;
  trial_days: number;
  currency: string;
};

/**
 * Which cycles a plan can actually be bought on — a null price means that cycle isn't offered.
 * SA-5.2's checkout should offer exactly this, and nothing else.
 */
export function availableBillingCycles(prices: PlanPrices | null): BillingCycle[] {
  if (!prices) return [];
  const cycles: BillingCycle[] = [];
  if (prices.price_monthly_cents !== null) cycles.push("monthly");
  if (prices.price_quarterly_cents !== null) cycles.push("quarterly");
  if (prices.price_yearly_cents !== null) cycles.push("yearly");
  return cycles;
}

export function priceForCycle(prices: PlanPrices | null, cycle: BillingCycle): number | null {
  if (!prices) return null;
  if (cycle === "monthly") return prices.price_monthly_cents;
  if (cycle === "quarterly") return prices.price_quarterly_cents;
  return prices.price_yearly_cents;
}

/** Months per cycle — used to compare cycles like-for-like. */
export const CYCLE_MONTHS: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * Effective cost per month of a cycle, in cents, rounded half-up.
 *
 * Display only — never bill from this. A yearly price of 44900c is 3741.66…c/month, and
 * charging a rounded per-month figure twelve times would not sum back to the yearly price.
 */
export function monthlyEquivalentCents(totalCents: number, cycle: BillingCycle): number {
  const months = CYCLE_MONTHS[cycle];
  return Math.round(totalCents / months);
}
