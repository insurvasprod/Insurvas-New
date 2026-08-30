// SA-3.4 · Proration for a mid-period plan change.
//
// This is entirely ours: Whop has no proration concept anywhere in its API, and
// `PATCH /memberships/{id}` cannot change a plan at all. So there is no risk of both systems
// prorating the same change — but equally, nothing else will make an upgrade fair.
//
// Pure and integer-cents throughout, so it is unit-tested against the ticket's worked example.

export type ProrationInput = {
  oldPriceCents: number;
  newPriceCents: number;
  /** Length of the billing period in days — 31 for a month billed on the 14th, not always 30. */
  periodDays: number;
  /** Whole days already consumed at the moment of the change. */
  daysElapsed: number;
};

export type Proration = {
  remainingDays: number;
  /** Unused value of the plan being left. Always positive. */
  creditCents: number;
  /** Cost of the new plan for the days that remain. Always positive. */
  chargeCents: number;
  /**
   * charge − credit. Positive means the customer owes us today (an upgrade); negative means we
   * owe them, which for a downgrade we do NOT refund — the change applies at period end instead.
   */
  netCents: number;
};

export function prorate(input: ProrationInput): Proration {
  const { oldPriceCents, newPriceCents, periodDays, daysElapsed } = input;

  if (!Number.isInteger(oldPriceCents) || !Number.isInteger(newPriceCents)) {
    throw new Error("Prices must be integer cents");
  }
  if (periodDays <= 0) throw new Error("periodDays must be positive");

  // A change on or after the last day of the period leaves nothing to prorate; it is simply the
  // next period's plan. Clamped rather than allowed to go negative, which would invert the credit.
  const remainingDays = Math.max(0, Math.min(periodDays, periodDays - daysElapsed));

  // Each side is rounded to whole cents before netting, matching how the amounts appear on an
  // invoice. Netting first and rounding once would produce a total that its own two lines do not
  // add up to — the customer would be able to spot the discrepancy on the document.
  const creditCents = Math.round((oldPriceCents * remainingDays) / periodDays);
  const chargeCents = Math.round((newPriceCents * remainingDays) / periodDays);

  return {
    remainingDays,
    creditCents,
    chargeCents,
    netCents: chargeCents - creditCents,
  };
}

/**
 * Whole days between two instants, floored.
 *
 * Floored deliberately: a customer eleven and a half days into a period has consumed eleven whole
 * days, and rounding that up would bill them for half a day they have not had.
 */
export function daysElapsedBetween(periodStart: Date, at: Date): number {
  return Math.max(0, Math.floor((at.getTime() - periodStart.getTime()) / 86_400_000));
}

export function periodLengthInDays(periodStart: Date, periodEnd: Date): number {
  return Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000));
}
