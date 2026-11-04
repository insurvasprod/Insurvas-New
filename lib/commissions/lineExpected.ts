/**
 * What "Expected" says beside a chargeback (QA 2026-11-03). A carrier file's Commissions tab showed a chargeback
 * line of −$202.50 with "Expected $270.00" — the policy's first-year commission (expected_commission), not what
 * was expected of this line — so it read as if the carrier took back less than it should. The finding says what
 * was expected of a chargeback: none at all for one on a policy the files show active (unexpected_chargeback,
 * expected $0.00), the advance's chargeback for a duplicate. Pay issues and the file's lines use these one rule.
 *
 * Pure; no imports (lib/commissions/lineExpected.test.mjs runs it under node).
 */

/** A chargeback kind whose finding expects no chargeback at all. */
export const NO_CHARGEBACK_EXPECTED: ReadonlySet<string> = new Set(["unexpected_chargeback"]);

/** A finding's expected figure as Pay issues shows it: $0.00 for a chargeback none was expected of. */
export function findingExpectedCents(type: string, expectedCents: number | null): number | null {
  return NO_CHARGEBACK_EXPECTED.has(type) ? 0 : expectedCents;
}

/** Whether a file's lines for one policy are chargebacks (or reversals of them) only. */
export function chargebackLines(types: readonly string[]): boolean {
  return types.length > 0 && types.every((type) => /^(reversal of )?chargeback$/.test(type.replaceAll("_", " ").trim()));
}

/**
 * The Expected cell of a carrier file's Commissions tab for one policy's lines. Commission lines keep the
 * policy's expected commission (or advance). Chargeback lines show what the policy's open finding expected
 * (findingExpectedCents), or nothing ("—", null) when no finding speaks to them: the first-year commission is
 * never a chargeback's expectation.
 */
export function fileLineExpectedCents(group: { types: readonly string[]; expectedCents: number | null }, finding: { type: string; expectedCents: number | null } | null): number | null {
  if (!chargebackLines(group.types)) return group.expectedCents;
  return finding && CHARGEBACK_FINDINGS.has(finding.type) ? findingExpectedCents(finding.type, finding.expectedCents) : null;
}

/** The findings about a chargeback (lib/ingestion/discrepancyEngine.ts); another finding on the policy says nothing of one. */
export const CHARGEBACK_FINDINGS: ReadonlySet<string> = new Set(["unexpected_chargeback", "duplicate_chargeback", "missing_chargeback"]);
