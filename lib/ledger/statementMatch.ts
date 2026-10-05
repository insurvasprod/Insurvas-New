/**
 * Carrier statement lines against the book: proposing matches, totalling what posted, and
 * reconciling what the carrier reported with what the ledger expected.
 *
 * Matching (a PROPOSAL — nothing posts until a person accepts it):
 *
 *   · the policy number is compared after removing case, spaces and punctuation ("POL-0012" and
 *     "pol 0012" are the same number; leading zeros are kept, because "12" and "0012" are not);
 *   · the policy must be recorded with the statement's carrier — its carrier text resolves to the
 *     statement carrier by code or name, the same way the ledger prices it;
 *   · exactly one policy must satisfy both. Two or none is no proposal, with the reason, and the
 *     line waits for a person to match it by hand or leave it unmatched.
 *
 * Reconciliation, per policy, only where both sides exist: the accepted statement lines for the
 * policy against the expected entries (lib/ledger/compute.ts) that fall inside the periods of the
 * statements those lines came from. A policy the carrier library cannot price has nothing to
 * compare with and says so rather than reading as short.
 *
 * Pure (no I/O), client-safe, tested in statementMatch.test.mjs.
 */
import { RECONCILE_TOLERANCE_CENTS, type StatementLineKind } from "./statementConstants.ts";

const alnum = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

export function normalisePolicyNumber(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

export type MatchCarrier = { id: string; code: string; name: string };
export type MatchablePolicy = { id: string; policyNumber: string; insuredName: string; carrier: string };
export type MatchableLine = { lineNumber: number; policyNumber: string | null; error: string | null };
export type MatchProposal = { policyId: string | null; reason: string };

/** Whether a policy's carrier text names this carrier (by code or name). */
export function policyIsWithCarrier(policyCarrier: string, carrier: MatchCarrier): boolean {
  const key = alnum(policyCarrier);
  return key !== "" && (key === alnum(carrier.code) || key === alnum(carrier.name));
}

/** A proposal (or the reason there is none) for every line, keyed by line number. */
export function proposeExactMatches(lines: MatchableLine[], policies: MatchablePolicy[], carrier: MatchCarrier): Map<number, MatchProposal> {
  const byNumber = new Map<string, MatchablePolicy[]>();
  for (const policy of policies) {
    const key = normalisePolicyNumber(policy.policyNumber);
    if (!key) continue;
    byNumber.set(key, [...(byNumber.get(key) ?? []), policy]);
  }

  const proposals = new Map<number, MatchProposal>();
  for (const line of lines) {
    if (line.error) { proposals.set(line.lineNumber, { policyId: null, reason: "This line could not be read, so it is not matched." }); continue; }
    const key = line.policyNumber ? normalisePolicyNumber(line.policyNumber) : "";
    if (!key) { proposals.set(line.lineNumber, { policyId: null, reason: "No policy number on this line." }); continue; }
    const sameNumber = byNumber.get(key) ?? [];
    if (sameNumber.length === 0) { proposals.set(line.lineNumber, { policyId: null, reason: `No policy ${line.policyNumber} in your book.` }); continue; }
    const withCarrier = sameNumber.filter((policy) => policyIsWithCarrier(policy.carrier, carrier));
    if (withCarrier.length === 1) { proposals.set(line.lineNumber, { policyId: withCarrier[0].id, reason: "Policy number and carrier match." }); continue; }
    if (withCarrier.length > 1) { proposals.set(line.lineNumber, { policyId: null, reason: `${withCarrier.length} ${carrier.name} policies share this number; choose one by hand.` }); continue; }
    const recordedWith = [...new Set(sameNumber.map((policy) => policy.carrier))].join(", ");
    proposals.set(line.lineNumber, { policyId: null, reason: `Policy ${sameNumber[0].policyNumber} is recorded with ${recordedWith}, not ${carrier.name}.` });
  }
  return proposals;
}

/**
 * An insured's name as matching compares it: lower case, letters and digits only, words in order,
 * and "LAST, FIRST" turned round to "first last". Middle initials are dropped, because carriers
 * print them and agents do not type them.
 */
export function normaliseInsuredName(value: string): string {
  let text = value.trim().toLowerCase();
  const comma = /^([^,]+),\s*(.+)$/.exec(text);
  if (comma) text = `${comma[2]} ${comma[1]}`;
  const words = text.replace(/[^a-z0-9\s]+/g, " ").split(/\s+/).filter(Boolean);
  return words.filter((word, index) => !(word.length === 1 && index > 0 && index < words.length - 1)).join(" ");
}

export type NamedLine = MatchableLine & { insuredName: string | null; amountCents: number | null };
export type FallbackProposal = MatchProposal & { method: "name" | null };

/**
 * LA-4.3 · for each line the exact match could not place, a proposal by the insured's name and the
 * statement's carrier. Still only a PROPOSAL: a person accepts it, and its reason says it was made
 * by name so it is read with care.
 *
 *   · exactly one policy with this carrier and this name → proposed;
 *   · more than one → the amount breaks the tie, when the caller passes what the ledger expected
 *     for each policy in the statement's period: the one policy with an expected entry within
 *     `toleranceCents` of the line's amount is proposed;
 *   · otherwise no proposal, with the reason.
 *
 * Lines that already have an exact proposal, have no name, or could not be read are not returned.
 */
export function proposeFallbackMatches(
  lines: NamedLine[],
  policies: MatchablePolicy[],
  carrier: MatchCarrier,
  exact: Map<number, MatchProposal>,
  expected?: ReadonlyMap<string, number[]>,
  toleranceCents = RECONCILE_TOLERANCE_CENTS,
): Map<number, FallbackProposal> {
  const byName = new Map<string, MatchablePolicy[]>();
  for (const policy of policies) {
    if (!policyIsWithCarrier(policy.carrier, carrier)) continue;
    const key = normaliseInsuredName(policy.insuredName);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), policy]);
  }

  const out = new Map<number, FallbackProposal>();
  for (const line of lines) {
    if (line.error || exact.get(line.lineNumber)?.policyId) continue;
    const key = line.insuredName ? normaliseInsuredName(line.insuredName) : "";
    if (!key) continue;
    const named = byName.get(key) ?? [];
    if (named.length === 1) {
      out.set(line.lineNumber, { policyId: named[0].id, method: "name", reason: `Insured name and carrier match (${named[0].policyNumber}); the policy number did not. Check before accepting.` });
      continue;
    }
    if (named.length > 1 && expected && line.amountCents !== null) {
      const amount = line.amountCents;
      const fits = named.filter((policy) => (expected.get(policy.id) ?? []).some((cents) => Math.abs(cents - amount) < toleranceCents));
      if (fits.length === 1) {
        out.set(line.lineNumber, { policyId: fits[0].id, method: "name", reason: `Insured name, carrier and amount match (${fits[0].policyNumber}); the policy number did not. Check before accepting.` });
        continue;
      }
    }
    if (named.length > 1) out.set(line.lineNumber, { policyId: null, method: null, reason: `${named.length} ${carrier.name} policies are for ${line.insuredName}; choose one by hand.` });
  }
  return out;
}

export type StatementTotals ={ entries: number; grossCents: number; advancesCents: number; chargebacksCents: number; adjustmentsCents: number };

/**
 * The four figures the ledger's tiles carry, over statement entries. Gross is everything received
 * (advances, commission and adjustments); chargebacks are reported as a positive amount taken back,
 * the same convention as totalsOf in compute.ts.
 */
export function statementTotals(entries: Array<{ kind: StatementLineKind; amountCents: number }>): StatementTotals {
  const sum = (kind: StatementLineKind) => entries.filter((entry) => entry.kind === kind).reduce((total, entry) => total + entry.amountCents, 0);
  const adjustmentsCents = sum("adjustment");
  return {
    entries: entries.length,
    grossCents: sum("advance") + sum("commission") + adjustmentsCents,
    advancesCents: sum("advance"),
    chargebacksCents: 0 - sum("chargeback") || 0,
    adjustmentsCents,
  };
}

export type ReceivedLine = { policyId: string; amountCents: number; periodStart: string; periodEnd: string };
export type ExpectedLine = { policyId: string; amountCents: number; postedOn: string };

export type ReconciliationStatus = "agrees" | "short" | "over" | "unpriced";

export type ReconciliationRow = {
  policyId: string;
  /** Expected entries posted inside the reported periods. */
  expectedCents: number;
  receivedCents: number;
  /** Received minus expected: negative when the carrier paid less than the book expects. */
  differenceCents: number;
  status: ReconciliationStatus;
  periods: Array<{ start: string; end: string }>;
  receivedLines: number;
  expectedEntries: number;
};

/**
 * One row per policy that has accepted statement lines. `priced` is the set of policies the ledger
 * could price at all; one outside it has no expected figure and is `unpriced`, not short.
 */
export function reconcileStatements(expected: ExpectedLine[], received: ReceivedLine[], priced: ReadonlySet<string>, toleranceCents = RECONCILE_TOLERANCE_CENTS): ReconciliationRow[] {
  const byPolicy = new Map<string, ReceivedLine[]>();
  for (const line of received) byPolicy.set(line.policyId, [...(byPolicy.get(line.policyId) ?? []), line]);

  const rows: ReconciliationRow[] = [];
  for (const [policyId, lines] of byPolicy) {
    const periods = [...new Map(lines.map((line) => [`${line.periodStart}|${line.periodEnd}`, { start: line.periodStart, end: line.periodEnd }])).values()]
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    const inPeriod = expected.filter((entry) => entry.policyId === policyId && periods.some((period) => entry.postedOn >= period.start && entry.postedOn <= period.end));
    const expectedCents = inPeriod.reduce((total, entry) => total + entry.amountCents, 0);
    const receivedCents = lines.reduce((total, line) => total + line.amountCents, 0);
    const differenceCents = receivedCents - expectedCents;
    const status: ReconciliationStatus = !priced.has(policyId)
      ? "unpriced"
      : Math.abs(differenceCents) < toleranceCents
        ? "agrees"
        : differenceCents < 0 ? "short" : "over";
    rows.push({ policyId, expectedCents, receivedCents, differenceCents, status, periods, receivedLines: lines.length, expectedEntries: inPeriod.length });
  }

  const weight: Record<ReconciliationStatus, number> = { short: 0, over: 1, unpriced: 2, agrees: 3 };
  return rows.sort((a, b) => weight[a.status] - weight[b.status] || Math.abs(b.differenceCents) - Math.abs(a.differenceCents) || a.policyId.localeCompare(b.policyId));
}
