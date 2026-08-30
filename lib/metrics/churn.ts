// SA-3.9 · Churn arithmetic.
//
// Pure, because every one of these divides by something that is legitimately zero in a real
// month — a month with no customers at the start, or no revenue. The ticket's criterion is that a
// month with zero churn shows 0%, not a division-by-zero error.

export type ChurnInput = {
  customersAtStart: number;
  customersChurned: number;
  mrrAtStart: number;
  churnedMrrCents: number;
  expansionMrrCents: number;
  contractionMrrCents: number;
};

export type Churn = {
  /** Customers lost ÷ customers at start, as a fraction. */
  logoChurnRate: number;
  /**
   * (churned + contraction − expansion) ÷ MRR at start.
   *
   * Can be NEGATIVE, and that is the good case: expansion outrunning churn means the existing book
   * grew. Clamping it at zero would hide the single best thing a SaaS can be doing.
   */
  netRevenueChurnRate: number;
  /** Gross revenue churn ignores expansion — always ≥ 0. */
  grossRevenueChurnRate: number;
};

export function computeChurn(input: ChurnInput): Churn {
  return {
    logoChurnRate: safeRate(input.customersChurned, input.customersAtStart),
    netRevenueChurnRate: safeRate(
      input.churnedMrrCents + input.contractionMrrCents - input.expansionMrrCents,
      input.mrrAtStart,
    ),
    grossRevenueChurnRate: safeRate(
      input.churnedMrrCents + input.contractionMrrCents,
      input.mrrAtStart,
    ),
  };
}

/**
 * A rate that is 0 when the denominator is 0.
 *
 * Nothing churned out of nothing is 0%, not NaN and not Infinity — both of which render as
 * something alarming and meaningless on a dashboard.
 */
export function safeRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/** Formats a rate for display. Negative net churn is shown as such, because it is the good case. */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export type MrrMovement = {
  openingCents: number;
  newCents: number;
  expansionCents: number;
  contractionCents: number;
  churnedCents: number;
  closingCents: number;
};

/**
 * The gap between where the movement says MRR should have ended and where it actually did.
 *
 * Non-zero means something moved revenue that we are not accounting for — today that is always
 * true, because expansion and contraction are not recorded, so this surfaces the size of what we
 * cannot see rather than letting the waterfall silently not add up.
 */
export function unexplainedMovementCents(movement: MrrMovement): number {
  const expected =
    movement.openingCents +
    movement.newCents +
    movement.expansionCents -
    movement.contractionCents -
    movement.churnedCents;

  return movement.closingCents - expected;
}

export type TrialConversion = { trialsStarted: number; trialsConverted: number };

export function trialConversionRate(input: TrialConversion): number {
  return safeRate(input.trialsConverted, input.trialsStarted);
}
