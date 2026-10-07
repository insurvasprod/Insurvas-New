/**
 * LA-4.12 (Notion sprint) · the commission ledger, as plain functions.
 *
 * Integer cents and integer basis points only: no float is produced or accepted anywhere here. A
 * value that is not a safe integer is refused, not rounded. Amounts are signed — chargebacks, fees
 * and advance interest are negative — so net is a plain sum.
 *
 * Safe for the browser; commissionLedgerStore.ts does the reading and writing.
 */

export const ENTRY_TYPES = ["advance", "earned", "chargeback", "reversal", "fee", "override", "advance_interest", "held"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const ENTRY_LABELS: Record<EntryType, { label: string; meaning: string }> = {
  advance: { label: "Advance", meaning: "Most of year one, paid up front before the client has paid it" },
  earned: { label: "Earned", meaning: "Commission the client's payments have earned" },
  chargeback: { label: "Chargeback", meaning: "Unearned advance taken back because the policy stopped" },
  reversal: { label: "Reversal", meaning: "A correction of an earlier line" },
  fee: { label: "Fee", meaning: "A policy or statement fee the carrier deducted" },
  override: { label: "Override", meaning: "Commission on someone else's sale, paid to an upline" },
  advance_interest: { label: "Advance interest", meaning: "Interest the carrier charges on advanced money" },
  held: { label: "Held", meaning: "Earned and acknowledged, not paid yet (under the minimum, or absorbed by a debit balance)" },
};

/** "-430.06" from -43006, by integer division only: the ledger never makes a float, even to print. */
export function centsText(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Not whole cents: ${cents}`);
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${cents < 0 ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

const NEGATIVE: ReadonlySet<EntryType> = new Set(["chargeback", "fee", "advance_interest"]);
const POSITIVE: ReadonlySet<EntryType> = new Set(["advance", "earned", "override", "held"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type LedgerLine = {
  row_number: number;
  policy_number: string;
  entry_type: EntryType;
  corrects_type: EntryType | null;
  amount_cents: number;
  transaction_date: string | null;
  statement_date: string | null;
  rate_bp: number | null;
  commissionable_premium_cents: number | null;
  months_advanced: number | null;
  agent_identifier: string | null;
  payee_level: "writing_agent" | "upline" | null;
};

export type LineOutcome = { ok: true; line: LedgerLine } | { ok: false; rowNumber: number; reason: string };

const int = (value: unknown): number | null | undefined => {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined; // undefined: present but not an integer
};
const day = (value: unknown): string | null => (typeof value === "string" && DAY.test(value) ? value : null);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * One parsed line (LA-4.3's typed values) as a ledger line, or why it can't be one. The carrier's
 * sign convention is not trusted: a chargeback, fee or interest line is made negative; a negative
 * advance, earned, override or held line is the carrier taking that money back, so it is recorded
 * as a reversal of that type.
 */
export function normalizeLine(row: { rowNumber: number; values: Record<string, string | number | null> }): LineOutcome {
  const v = row.values;
  const policy = text(v.policy_number);
  if (!policy) return { ok: false, rowNumber: row.rowNumber, reason: "no policy number" };
  const type = v.entry_type;
  if (typeof type !== "string" || !(ENTRY_TYPES as readonly string[]).includes(type)) return { ok: false, rowNumber: row.rowNumber, reason: "no entry type (the layout maps the carrier's code to one)" };
  const amount = int(v.amount_cents);
  if (amount === null) return { ok: false, rowNumber: row.rowNumber, reason: "no amount" };
  if (amount === undefined) return { ok: false, rowNumber: row.rowNumber, reason: "the amount is not whole cents" };
  const numbers = { rate_bp: int(v.rate_bp), commissionable_premium_cents: int(v.commissionable_premium_cents), months_advanced: int(v.months_advanced) };
  for (const [field, value] of Object.entries(numbers)) if (value === undefined) return { ok: false, rowNumber: row.rowNumber, reason: `${field} is not a whole number` };

  let entryType = type as EntryType;
  let corrects: EntryType | null = null;
  let signed = amount;
  if (NEGATIVE.has(entryType)) signed = -Math.abs(amount);
  else if (POSITIVE.has(entryType) && amount < 0) { corrects = entryType; entryType = "reversal"; }
  const payee = v.payee_level === "writing_agent" || v.payee_level === "upline" ? v.payee_level : null;

  return {
    ok: true,
    line: {
      row_number: row.rowNumber,
      policy_number: policy,
      entry_type: entryType,
      corrects_type: corrects,
      amount_cents: signed,
      transaction_date: day(v.transaction_date),
      statement_date: day(v.statement_date),
      rate_bp: numbers.rate_bp ?? null,
      commissionable_premium_cents: numbers.commissionable_premium_cents ?? null,
      months_advanced: numbers.months_advanced ?? null,
      agent_identifier: text(v.agent_identifier),
      payee_level: payee,
    },
  };
}

export type Entry = { entry_type: string; corrects_type: string | null; amount_cents: number | string };

/** The same arithmetic as the commission_policy_totals view: a reversal counts toward the type it corrects; held is apart. */
export function rollup(entries: Entry[]) {
  const total = { advancedCents: 0, earnedCents: 0, chargedBackCents: 0, overrideCents: 0, feeCents: 0, interestCents: 0, otherReversalCents: 0, heldCents: 0, netReceivedCents: 0 };
  for (const entry of entries) {
    const amount = Number(entry.amount_cents);
    if (!Number.isSafeInteger(amount)) throw new Error(`A ledger amount is not whole cents: ${entry.amount_cents}`);
    const kind = entry.corrects_type ?? entry.entry_type;
    if (kind === "advance") total.advancedCents += amount;
    else if (kind === "earned") total.earnedCents += amount;
    else if (kind === "chargeback") total.chargedBackCents += amount;
    else if (kind === "override") total.overrideCents += amount;
    else if (kind === "fee") total.feeCents += amount;
    else if (kind === "advance_interest") total.interestCents += amount;
    else if (kind === "held") total.heldCents += amount;
    else total.otherReversalCents += amount;
    if (kind !== "held") total.netReceivedCents += amount;
  }
  return total;
}

export type AdvanceRule = { advanceMonths: number; clawbackMonths: number; clawbackType: "full" | "prorated" } | null;

export type UnearnedTrace = {
  advancedCents: number;
  months: number | null;
  monthsSource: "advance rule" | "statement" | null;
  monthsPaid: number | null;
  clawbackType: "full" | "prorated" | null;
  unearnedCents: number | null;
  chargedBackCents: number;
  atRiskCents: number | null;
  reason: string | null;
};

/** a × b / c, rounded half up, in integers only (inputs are cents and month counts, far inside 2^53). */
const mulDivRound = (a: number, b: number, c: number) => {
  const sign = a < 0 ? -1 : 1;
  const numerator = Math.abs(a) * b * 2 + c;
  const denominator = 2 * c;
  // Exact integer division: the numerator less its remainder is a multiple of the denominator.
  return sign * ((numerator - (numerator % denominator)) / denominator);
};

/**
 * The unearned advance and what is still at risk, with every input it used. Unearned is the advance
 * minus what the months paid have earned; at risk is that, less what the carrier already took back.
 * Months advanced come from the LA-0.4 advance rule, else from the statement's own line; with
 * neither, or no months paid, the answer is null (Unknown) — never zero.
 */
export function unearnedAdvance(input: { advancedCents: number; chargedBackCents: number; monthsPaid: number | null; rule: AdvanceRule; statementMonths: number | null }): UnearnedTrace {
  const base = { advancedCents: input.advancedCents, chargedBackCents: input.chargedBackCents, monthsPaid: input.monthsPaid };
  if (input.advancedCents <= 0) return { ...base, months: null, monthsSource: null, clawbackType: null, unearnedCents: 0, atRiskCents: 0, reason: input.advancedCents < 0 ? "more advance reversed than paid" : "no advance on this policy" };
  const months = input.rule?.advanceMonths ?? input.statementMonths;
  const monthsSource = input.rule ? "advance rule" : input.statementMonths !== null ? "statement" : null;
  if (!months || months <= 0) return { ...base, months: null, monthsSource: null, clawbackType: null, unearnedCents: null, atRiskCents: null, reason: "no advance rule for this carrier and product, and the statement doesn't say how many months were advanced" };
  if (input.monthsPaid === null) return { ...base, months, monthsSource, clawbackType: input.rule?.clawbackType ?? "prorated", unearnedCents: null, atRiskCents: null, reason: "months paid is not known yet (no paid-to date)" };
  const clawbackType = input.rule?.clawbackType ?? "prorated";
  const unearned = clawbackType === "full"
    ? (input.monthsPaid < (input.rule?.clawbackMonths ?? months) ? input.advancedCents : 0)
    : mulDivRound(input.advancedCents, Math.max(0, months - input.monthsPaid), months);
  return { ...base, months, monthsSource, clawbackType, unearnedCents: unearned, atRiskCents: Math.max(0, unearned + Math.min(0, input.chargedBackCents)), reason: null };
}
