/**
 * LA-4.14 (Notion sprint) · a carrier's account across its statements: the checks each statement
 * passed (from the carrier_account_checks view), and the direction of the balance, because a debit
 * balance that is growing matters more than its size today.
 *
 * Pure; integer cents only.
 */

export type StatementCheck = {
  id: string;
  carrierId: string;
  statementDate: string;
  fileId: string | null;
  openingCents: number;
  activityCents: number;
  closingCents: number;
  debitCents: number;
  amountPaidCents: number | null;
  heldCents: number | null;
  minimumPayoutCents: number | null;
  entriesCents: number | null;
  entries: number | null;
  arithmeticOk: boolean;
  entriesOk: boolean;
  continuityOk: boolean;
  previousStatementDate: string | null;
};

export type Trend = "improving" | "worsening" | "steady" | "first";

/** Each statement with its change from the one before, oldest first; and where the account is heading. */
export function accountTrend(statements: StatementCheck[]) {
  const sorted = [...statements].sort((a, b) => a.statementDate.localeCompare(b.statementDate));
  const rows = sorted.map((s, i) => {
    const before = i > 0 ? sorted[i - 1] : null;
    const change = before ? s.closingCents - before.closingCents : null;
    const trend: Trend = change === null ? "first" : change > 0 ? "improving" : change < 0 ? "worsening" : "steady";
    return { ...s, changeCents: change, trend };
  });
  const last = rows.at(-1) ?? null;
  // A debit balance that grew on the latest statement: the agent is paid nothing until it clears.
  const growingDebit = Boolean(last && last.closingCents < 0 && last.trend === "worsening");
  // Statements in a row the balance has fallen, ending at the latest.
  let fallingFor = 0;
  for (let i = rows.length - 1; i >= 0 && rows[i].trend === "worsening"; i--) fallingFor++;
  return { rows, latest: last, growingDebit, fallingFor, gaps: rows.filter((r) => !r.continuityOk).length, flagged: rows.filter((r) => !r.arithmeticOk || !r.entriesOk).length };
}

/** Why a statement is flagged, in words, or null. */
export function statementProblem(s: Pick<StatementCheck, "arithmeticOk" | "entriesOk" | "openingCents" | "activityCents" | "closingCents" | "entriesCents">): string | null {
  const money = (cents: number) => `${cents < 0 ? "−" : ""}$${String(Math.abs(cents)).padStart(3, "0").replace(/(\d\d)$/, ".$1")}`;
  if (!s.arithmeticOk) return `Opening ${money(s.openingCents)} plus activity ${money(s.activityCents)} is ${money(s.openingCents + s.activityCents)}, not the closing ${money(s.closingCents)}.`;
  if (!s.entriesOk && s.entriesCents !== null) return `Its lines add up to ${money(s.entriesCents)}, not the stated activity of ${money(s.activityCents)}.`;
  return null;
}
