/**
 * One policy's money check (owner 2026-11-19, board ledger-r1 1·A): every line the contract expects beside
 * the statement line that paid it, so the page opens on the answer — expected, paid, difference — and each
 * row says where both sides came from.
 *
 * Pure: the page passes in computeLedger's entries for the policy and its accepted statement lines.
 */

export type ExpectedSide = { id: string; kind: "advance" | "commission" | "chargeback"; policyYear: number; postedOn: string; amountCents: number; rateBp: number | null };
export type PaidSide = { id: string; kind: string; postedOn: string; amountCents: number; statementId: string; lineNumber: number; periodStart: string; periodEnd: string };

export type MoneyRow = {
  key: string;
  /** The day the row is dated by: the carrier's line when there is one, else the day the contract expects it. */
  date: string;
  kind: string;
  policyYear: number | null;
  rateBp: number | null;
  expectedCents: number | null;
  paidCents: number | null;
  line: { statementId: string; lineNumber: number; periodStart: string; periodEnd: string } | null;
  /** Paid minus expected; negative is short. */
  gapCents: number;
  /** Within a dollar either way. */
  matches: boolean;
};

export type PolicyMoneyCheck = {
  rows: MoneyRow[];
  expectedCents: number;
  paidCents: number;
  /** Paid minus expected over the whole policy; negative is short. */
  differenceCents: number;
  /** Positive money the carrier paid, and what it took back (as a positive number). */
  paidOutCents: number;
  takenBackCents: number;
};

/** A dollar either way is rounding, not a pay issue (the discrepancy engine's own tolerance). */
export const MATCH_TOLERANCE_CENTS = 100;

const dayNumber = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000;

/**
 * Pairs each expected entry with an accepted line of the same kind, nearest pairs first (each line used
 * once). An expected entry nobody paid, and a line the contract did not expect (an adjustment, a kind the
 * contract has no rule for), each stand alone with the other side empty. Newest first.
 */
export function pairPolicyMoney(expected: readonly ExpectedSide[], paid: readonly PaidSide[]): PolicyMoneyCheck {
  const free = new Set(paid.map((line) => line.id));
  const rows: MoneyRow[] = [];
  // The closest pairs of the same kind are taken first, so an early entry never takes a later year's line.
  const candidates = expected.flatMap((entry) => paid.filter((line) => line.kind === entry.kind).map((line) => ({ entry, line, distance: Math.abs(dayNumber(line.postedOn) - dayNumber(entry.postedOn)) })));
  candidates.sort((a, b) => a.distance - b.distance || a.entry.postedOn.localeCompare(b.entry.postedOn));
  const paidBy = new Map<string, PaidSide>();
  for (const { entry, line } of candidates) {
    if (paidBy.has(entry.id) || !free.has(line.id)) continue;
    paidBy.set(entry.id, line);
    free.delete(line.id);
  }
  for (const entry of expected) {
    const best = paidBy.get(entry.id) ?? null;
    const gap = (best?.amountCents ?? 0) - entry.amountCents;
    rows.push({
      key: entry.id,
      date: best?.postedOn ?? entry.postedOn,
      kind: entry.kind,
      policyYear: entry.kind === "commission" ? entry.policyYear : null,
      rateBp: entry.rateBp,
      expectedCents: entry.amountCents,
      paidCents: best ? best.amountCents : null,
      line: best ? { statementId: best.statementId, lineNumber: best.lineNumber, periodStart: best.periodStart, periodEnd: best.periodEnd } : null,
      gapCents: gap,
      matches: Math.abs(gap) <= MATCH_TOLERANCE_CENTS,
    });
  }
  for (const line of paid) {
    if (!free.has(line.id)) continue;
    rows.push({
      key: `line:${line.id}`,
      date: line.postedOn,
      kind: line.kind,
      policyYear: null,
      rateBp: null,
      expectedCents: null,
      paidCents: line.amountCents,
      line: { statementId: line.statementId, lineNumber: line.lineNumber, periodStart: line.periodStart, periodEnd: line.periodEnd },
      gapCents: line.amountCents,
      matches: Math.abs(line.amountCents) <= MATCH_TOLERANCE_CENTS,
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  const expectedCents = expected.reduce((sum, entry) => sum + entry.amountCents, 0);
  const paidCents = paid.reduce((sum, line) => sum + line.amountCents, 0);
  return {
    rows,
    expectedCents,
    paidCents,
    differenceCents: paidCents - expectedCents,
    paidOutCents: paid.filter((line) => line.amountCents > 0).reduce((sum, line) => sum + line.amountCents, 0),
    takenBackCents: -paid.filter((line) => line.amountCents < 0).reduce((sum, line) => sum + line.amountCents, 0),
  };
}
