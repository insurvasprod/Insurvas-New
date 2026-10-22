/**
 * AG-1.3 (Notion sprint, Agency Module 0 / AG-1) · the override computation engine, with no database.
 *
 * Integer cents and integer basis points at EVERY step, intermediate sums included — BigInt does the
 * multiplication so not one float ever exists. Fixed order of operations, never varied:
 *
 *   1. agency commission   agency level   × premium
 *   2. producer pool       producer level × premium   ← computed DIRECTLY from the premium and his level, never
 *                                                       as (1 − 3): that would push every rounding error onto him
 *   3. the owner's override  (1 − 2)                   ← so pool + override = agency commission, to the cent
 *   4. split the pool between producers (AG-1.6, splitPool)
 *
 * Levels are looked up AS OF the policy's effective date (AG-0.9). A missing producer level yields a null pool,
 * a null override and a flag — never the agency's level, never zero. Absent, not guessed.
 * The advance share comes from the carrier's rate card (LA-0.4) — never a hard-coded 75%.
 */

// BigInt constants without literals (tsconfig targets below ES2020).
const B0 = BigInt(0);
const B2 = BigInt(2);
const B5000 = BigInt(5000);
const B10000 = BigInt(10000);

export type LevelRow = { carrierId: string; levelBps: number; effectiveFrom: string; effectiveTo: string | null };

/** The level in force for a carrier on a date, or null when none covers it. */
export function levelAsOf(rows: readonly LevelRow[], carrierId: string, asOf: string): number | null {
  const row = rows.find((r) => r.carrierId === carrierId && r.effectiveFrom <= asOf && (r.effectiveTo === null || asOf <= r.effectiveTo));
  return row ? row.levelBps : null;
}

/** amount × bps / 10000, rounded half away from zero, in integers only. */
export function applyBps(amountCents: number, bps: number): number {
  if (!Number.isInteger(amountCents) || !Number.isInteger(bps)) throw new Error("applyBps: integers only");
  const product = BigInt(amountCents) * BigInt(bps);
  const negative = product < B0;
  const abs = negative ? -product : product;
  const rounded = (abs + B5000) / B10000;
  return Number(negative ? -rounded : rounded);
}

/** amount × numerator / denominator, rounded half away from zero, in integers only. */
export function applyFraction(amountCents: number, numerator: number, denominator: number): number {
  if (!Number.isInteger(amountCents) || !Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new Error("applyFraction: integers only, positive denominator");
  }
  const product = BigInt(amountCents) * BigInt(numerator);
  const negative = product < B0;
  const abs = negative ? -product : product;
  const d = BigInt(denominator);
  const rounded = (abs * B2 + d) / (B2 * d);
  return Number(negative ? -rounded : rounded);
}

export type OverrideResult = {
  agencyCommissionCents: number | null;
  producerPoolCents: number | null;
  overrideCents: number | null;
  /** why a figure is null, in words a screen can show */
  flag: null | "agency_level_missing" | "producer_level_missing";
  /** producer level above agency level: the agency pays out more than it receives */
  negativeSpread: boolean;
};

export function computeOverride(input: { annualPremiumCents: number; agencyLevelBps: number | null; producerLevelBps: number | null }): OverrideResult {
  const agency = input.agencyLevelBps === null ? null : applyBps(input.annualPremiumCents, input.agencyLevelBps);
  const pool = input.producerLevelBps === null ? null : applyBps(input.annualPremiumCents, input.producerLevelBps);
  if (agency === null) return { agencyCommissionCents: null, producerPoolCents: pool, overrideCents: null, flag: "agency_level_missing", negativeSpread: false };
  if (pool === null) return { agencyCommissionCents: agency, producerPoolCents: null, overrideCents: null, flag: "producer_level_missing", negativeSpread: false };
  return { agencyCommissionCents: agency, producerPoolCents: pool, overrideCents: agency - pool, flag: null, negativeSpread: pool > agency };
}

/** The spread in basis points (agency − producer), or null when either is missing. 30% = 3000. */
export function spreadBps(agencyLevelBps: number | null, producerLevelBps: number | null): number | null {
  return agencyLevelBps === null || producerLevelBps === null ? null : agencyLevelBps - producerLevelBps;
}

/** The advance on issue: amount × the carrier's advance share (from the rate card, bps). */
export function advanceCents(commissionCents: number, advanceShareBps: number): number {
  return applyBps(commissionCents, advanceShareBps);
}

/** The clawback on a lapse: the unearned months of a 12-month advance, negative. */
export function chargebackCents(commissionCents: number, unearnedMonths: number, advanceMonths = 12): number {
  return -applyFraction(commissionCents, unearnedMonths, advanceMonths);
}

/**
 * When an expected amount is EXPECTED (the engine computes how much; the carrier's trigger decides when):
 * pay-on-issue carriers expect it at issue, pay-on-first-draft carriers at the first successful draft.
 */
export const PAY_ON_ISSUE = ["AMAM", "RNA", "Americo", "Mutual of Omaha"] as const;
export const PAY_ON_FIRST_DRAFT = ["Corebridge", "Aetna/Accendo", "Aflac/Tier One", "AHL", "Sentinel/SSL", "Transamerica"] as const;

export type Share = { producerUserId: string; shareBps: number };

/**
 * AG-1.6 · split the producer pool. Shares are integer bps and must sum to EXACTLY 10000 — anything else is
 * refused, never normalised. Each share is rounded down; the cents left over go to the first share (the
 * writer), so the parts always add back to the pool with no cent lost.
 */
export function splitPool(poolCents: number, shares: readonly Share[]): Array<Share & { amountCents: number }> {
  const total = shares.reduce((sum, s) => sum + s.shareBps, 0);
  if (shares.length === 0 || total !== 10000 || shares.some((s) => !Number.isInteger(s.shareBps) || s.shareBps <= 0)) {
    throw new Error(`split_must_total_10000:${total}`);
  }
  const parts = shares.map((s) => {
    const product = BigInt(poolCents) * BigInt(s.shareBps);
    return { ...s, amountCents: Number(product / B10000) }; // truncates toward zero
  });
  const remainder = poolCents - parts.reduce((sum, p) => sum + p.amountCents, 0);
  parts[0].amountCents += remainder;
  return parts;
}
