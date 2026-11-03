// Quote arithmetic (LA-3.4, 3.5, 3.6), client-safe. Integer cents in, integer cents out; the only
// division is the final half-up rounding, so $68.40 a month at 105% for nine months is exactly
// 82 080¢ / 86 184¢ / 64 638¢ every time.

/** a / b rounded half-up, for non-negative integers. */
export function divRoundHalfUp(a: number, b: number) {
  return Math.floor((a * 2 + b) / (b * 2));
}

export type PayoutInput = {
  monthlyPremiumCents: number;
  /** Year-one commission rate at this agent's contract level, basis points (10500 = 105%). */
  rateBp: number;
  advancePctBp: number;
  advanceMonths: number;
};

export type Payout = { annualPremiumCents: number; fycCents: number; advanceCents: number };

/** LA-3.6 payout strip, from `commission_schedules.rate_bp` and `advance_rules` (SCHEMA-PLAN Q7). */
export function estimatePayout(p: PayoutInput): Payout {
  const annualPremiumCents = p.monthlyPremiumCents * 12;
  const fycCents = divRoundHalfUp(annualPremiumCents * p.rateBp, 10_000);
  const advanceCents = divRoundHalfUp(fycCents * p.advancePctBp * p.advanceMonths, 10_000 * 12);
  return { annualPremiumCents, fycCents, advanceCents };
}

/** Monthly premium per $1,000 of face, in dollars to two places (6840¢ on $10,000 → 6.84). */
export function premiumPer1000(monthlyPremiumCents: number, faceCents: number): number | null {
  if (faceCents <= 0) return null;
  // dollars/1000 face = cents * 1000 / faceCents ; keep two decimals via integer hundredths
  return divRoundHalfUp(monthlyPremiumCents * 1000 * 100, faceCents) / 100;
}

export type QuoteWarning = { code: string; message: string };

export const DEFAULT_PER1000_BAND = { min: 0.5, max: 15 } as const;

/** LA-3.5 validation: one hard rule, the rest warnings. */
export function checkQuote(input: {
  monthlyPremiumCents: number;
  faceCents: number;
  age: number | null;
  /** The product's own band; omitted uses the default; 
ull skips the check (term, no band set). */
  band?: { min: number; max: number } | null;
  faceMinCents?: number | null;
  faceMaxCents?: number | null;
  issueAgeMin?: number | null;
  issueAgeMax?: number | null;
}): { error: string | null; warnings: QuoteWarning[] } {
  if (!(input.monthlyPremiumCents > 0)) return { error: "Enter the monthly premium from the carrier's quote.", warnings: [] };
  if (!(input.faceCents > 0)) return { error: "Enter the face amount.", warnings: [] };
  if (input.monthlyPremiumCents >= input.faceCents) return { error: "The monthly premium cannot be as large as the face amount.", warnings: [] };
  const warnings: QuoteWarning[] = [];
  const band = input.band === null ? null : input.band ?? DEFAULT_PER1000_BAND;
  const per = premiumPer1000(input.monthlyPremiumCents, input.faceCents);
  if (band && per !== null && (per < band.min || per > band.max)) {
    warnings.push({ code: "QUOTE_PER1000_BAND", message: `$${per.toFixed(2)} per $1,000${input.age ? ` at age ${input.age}` : ""} looks ${per < band.min ? "low" : "high"} — check the tier.` });
  }
  if (input.faceMinCents && input.faceCents < input.faceMinCents) warnings.push({ code: "QUOTE_FACE_MIN", message: "The face amount is below this product's minimum." });
  if (input.faceMaxCents && input.faceCents > input.faceMaxCents) warnings.push({ code: "QUOTE_FACE_MAX", message: "The face amount is above this product's maximum." });
  if (input.age !== null && input.issueAgeMin && input.age < input.issueAgeMin) warnings.push({ code: "QUOTE_AGE_MIN", message: `Age ${input.age} is under this product's issue age.` });
  if (input.age !== null && input.issueAgeMax && input.age > input.issueAgeMax) warnings.push({ code: "QUOTE_AGE_MAX", message: `Age ${input.age} is over this product's issue age.` });
  return { error: null, warnings };
}

/**
 * Age for rating. `last` is age last birthday. `nearest` rounds up once the next birthday is closer
 * than the last one — so a DOB seven months past the last birthday is one year older (LA-3.4).
 */
export function ratingAge(dob: string, basis: "nearest" | "last", today = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let lastYear = today.getUTCFullYear();
  if (Date.UTC(lastYear, mo - 1, d) > t) lastYear--;
  const age = lastYear - y;
  if (age < 0 || age > 130) return null;
  if (basis === "last") return age;
  const last = Date.UTC(lastYear, mo - 1, d);
  const next = Date.UTC(lastYear + 1, mo - 1, d);
  return t - last > next - t ? age + 1 : age;
}

/**
 * The band a quote is judged by when its product sets none: the Final Expense default, except for
 * term (LA-3.25), which rates at a fraction of it — $0.15 per $1,000 is ordinary there — and is not judged.
 */
export function bandFallback(productCode: string | null | undefined): undefined | null {
  return productCode === "term_life" ? null : undefined;
}
