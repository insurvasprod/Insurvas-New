/**
 * LA-4.4 · what a carrier owes, found by comparing what it reported (accepted statement lines) with
 * what the book expects (lib/ledger/compute.ts). This is the report Ray pays for: "You appear to be
 * owed $3,412".
 *
 * Five kinds, each with the arithmetic that proves it:
 *
 *   never_paid             an active policy, issued at least the carrier's payment lag ago (its
 *                          expected_lag_days, LA-4.17 carrier rules — the same lag the carrier-file
 *                          engine uses; no lag set, no "never paid" for that carrier), from a carrier
 *                          whose statements cover a period ending after that lag, and not one
 *                          accepted line for it. Owed: only the entries whose payment window (the
 *                          day it fell due to the lag later) a statement reported. A 2025 advance is
 *                          not "never paid" because a 2026 statement does not show it: it may sit
 *                          on a 2025 statement nobody imported.
 *   short_paid             the carrier reported less than the book expects inside the periods it
 *                          reported (reconcileStatements says "short"), and the rate it paid matches
 *                          (or the statement does not show a rate). Owed: expected − received.
 *   mis_rated              short, AND the rate the carrier paid differs from the contract's schedule
 *                          by more than 1 basis point. Owed: expected − received.
 *   duplicate_chargeback   two or more chargebacks on one lapsed or cancelled policy taking back more
 *                          than the advance's chargeback (or the advance received). Owed: the excess.
 *   unexpected_chargeback  a chargeback on a policy the book says is still active. Owed: what it took.
 *
 * The rules that keep it honest:
 *
 *   · a pending policy has not been issued and is never a discrepancy;
 *   · a carrier with no statement covering the period is never "never paid" — no statement is not
 *     the same as no payment;
 *   · only a REVIEWED statement is evidence (user decision 2026-10-06): an unreviewed one is no
 *     coverage for "never paid", and the days it covers are not judged at all (`pending`), because
 *     an undecided line may be the very payment a finding would call missing. An accepted line
 *     counts as received wherever it sits;
 *   · a lapsed policy's chargeback is expected, never "unexpected";
 *   · a difference under RECONCILE_TOLERANCE_CENTS is rounding, not a discrepancy;
 *   · each finding has a fingerprint (kind · policy · where it started) that is the same every time
 *     the same facts are found, so a refresh updates it instead of adding a second one.
 *
 * Fingerprints (v2, migration 20261006110000). Each is anchored where the problem STARTED, so a
 * later statement grows the same finding instead of replacing it (and a dispute is not lost):
 *
 *   never_paid             kind|policy|issue:<effective date>    the policy has been unpaid since issue
 *   short_paid, mis_rated  kind|policy|from:<first period start> the shortfall began in that period
 *   duplicate_chargeback   kind|policy|from:<first chargeback period start>
 *   unexpected_chargeback  kind|policy|<period start>~<period end>, one per chargeback period: each
 *                          chargeback on an active policy is its own event
 *
 * A finding a person resolved or wrote off stays that way unless it gets WORSE (planRefresh): then
 * it reopens, so a carrier that short-pays again is never hidden by last year's decision.
 *
 * v1 (before the migration) keyed never_paid and both chargeback kinds by policy alone, and
 * short_paid / mis_rated by every period reported. `fingerprints: "v1"` reproduces it exactly, so the
 * app can run before the migration re-keys the stored rows.
 *
 * Pure (no I/O), tested in compute.test.mjs.
 */
import { addMonths } from "../ledger/compute.ts";
import { reconcileStatements } from "../ledger/statementMatch.ts";
import { RECONCILE_TOLERANCE_CENTS } from "../ledger/statementConstants.ts";

export const DISCREPANCY_KINDS = ["never_paid", "short_paid", "mis_rated", "duplicate_chargeback", "unexpected_chargeback"] as const;
export type DiscrepancyKind = (typeof DISCREPANCY_KINDS)[number];

export const DISCREPANCY_KIND_LABELS: Record<DiscrepancyKind, { label: string; plural: string; meaning: string }> = {
  never_paid: { label: "Never paid", plural: "issued but never paid", meaning: "In force, and the carrier's statements cover the period, but no commission was ever paid." },
  short_paid: { label: "Short-paid", plural: "paid less than owed", meaning: "Paid, but less than your contract says for the periods the carrier reported." },
  mis_rated: { label: "Wrong rate", plural: "paid at the wrong rate", meaning: "Paid at a different commission rate than your contract level's schedule." },
  duplicate_chargeback: { label: "Duplicate chargeback", plural: "charged back twice", meaning: "Charged back more than the advance's chargeback for one lapse." },
  unexpected_chargeback: { label: "Unexpected chargeback", plural: "charged back while active", meaning: "A chargeback for a policy your book says is still in force." },
};


export type DiscrepancyPolicy = {
  id: string;
  policyNumber: string;
  insuredName: string;
  /** The library carrier this policy is with (resolved the way the ledger prices it), or null. */
  carrierId: string | null;
  carrierName: string;
  status: string;
  effectiveDate: string;
};

/** A ledger entry the book expects (lib/ledger/compute.ts LedgerEntry, the fields used here). */
export type ExpectedEntry = { id: string; policyId: string; kind: "advance" | "commission" | "chargeback"; amountCents: number; postedOn: string; rateBp: number | null; premiumCents: number };

/** An accepted statement line (lib/ledger/statementService.ts), with the rate and premium when the carrier showed them. */
export type ReceivedEntry = {
  id: string;
  policyId: string;
  statementId: string;
  carrierId: string;
  kind: "advance" | "commission" | "chargeback" | "adjustment";
  amountCents: number;
  postedOn: string;
  periodStart: string;
  periodEnd: string;
  rateBp: number | null;
  premiumCents: number | null;
};

/** A statement that is not voided and has its lines (so it says what the carrier paid in its period). */
export type CoveredPeriod = { statementId: string; carrierId: string; periodStart: string; periodEnd: string };

export type DiscrepancyFinding = {
  fingerprint: string;
  kind: DiscrepancyKind;
  policyId: string;
  carrierId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  owedCents: number;
  detail: {
    expectedCents: number;
    receivedCents: number;
    /** The schedule's rate and the rate the carrier paid, when both are known (mis_rated). */
    expectedRateBp?: number | null;
    paidRateBp?: number | null;
    /** For chargebacks: what the advance's chargeback allows, and what was taken. */
    allowedCents?: number;
    takenCents?: number;
    periods: Array<{ start: string; end: string }>;
    expectedEntryIds: string[];
    receivedLineIds: string[];
    statementIds: string[];
    explanation: string;
  };
};

const money = (cents: number) => `$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (bp: number) => `${(bp / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
const periodKey = (periods: Array<{ start: string; end: string }>) => periods.map((period) => `${period.start}~${period.end}`).join(",");

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The rate a line was paid at: the carrier's rate column, else commission ÷ premium for a commission line. */
function paidRate(line: ReceivedEntry): number | null {
  if (line.rateBp !== null) return line.rateBp;
  if (line.kind === "commission" && line.premiumCents && line.premiumCents > 0) return Math.round((line.amountCents / line.premiumCents) * 10_000);
  return null;
}

/**
 * Each carrier's payment lag from its operating settings (LA-4.17): the agency's own value, else the
 * platform's — the same resolution the carrier-file engine uses (expectedCommissionStore). A carrier
 * with no lag at either level is absent, never defaulted.
 */
export function carrierLagDays(rows: Array<{ tenant_id: string | null; carrier_id: string; expected_lag_days: number | null }>, tenantId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) if (row.tenant_id === null && row.expected_lag_days !== null) out.set(row.carrier_id, Number(row.expected_lag_days));
  for (const row of rows) if (row.tenant_id === tenantId && row.expected_lag_days !== null) out.set(row.carrier_id, Number(row.expected_lag_days));
  return out;
}

export type FingerprintVersion = "v1" | "v2";

export function computeDiscrepancies(input: {
  policies: DiscrepancyPolicy[];
  expected: ExpectedEntry[];
  received: ReceivedEntry[];
  coverage: CoveredPeriod[];
  today: string;
  /**
   * Each carrier's payment lag in days (carrier rules, LA-4.17): how long after issue a payment is
   * due before its absence is "never paid". A carrier with none is never judged "never paid" — no
   * hard-coded window stands in for a rule nobody entered.
   */
  lagDays?: ReadonlyMap<string, number>;
  toleranceCents?: number;
  /** v2 unless the stored rows have not been re-keyed yet (see the header). */
  fingerprints?: FingerprintVersion;
  /**
   * Statements a person has not finished reviewing (in review, or a PDF waiting for its lines). The
   * periods they cover are not judged yet, for their carrier: nothing expected or received inside
   * them counts, so an undecided line can neither hide a payment nor be double counted against
   * another statement covering the same days (user decision 2026-10-06: only a reviewed statement
   * is evidence).
   */
  pending?: CoveredPeriod[];
}): DiscrepancyFinding[] {
  const v2 = (input.fingerprints ?? "v2") === "v2";
  const tolerance = input.toleranceCents ?? RECONCILE_TOLERANCE_CENTS;
  const findings: DiscrepancyFinding[] = [];
  const policyById = new Map(input.policies.map((policy) => [policy.id, policy]));
  const pending = input.pending ?? [];
  const underReview = (carrierId: string | null, day: string) => Boolean(carrierId) && pending.some((period) => period.carrierId === carrierId && day >= period.periodStart && day <= period.periodEnd);
  const judged = {
    expected: input.expected.filter((entry) => !underReview(policyById.get(entry.policyId)?.carrierId ?? null, entry.postedOn)),
    received: input.received.filter((line) => !underReview(line.carrierId, line.postedOn)),
  };
  const expectedByPolicy = new Map<string, ExpectedEntry[]>();
  for (const entry of judged.expected) expectedByPolicy.set(entry.policyId, [...(expectedByPolicy.get(entry.policyId) ?? []), entry]);
  const receivedByPolicy = new Map<string, ReceivedEntry[]>();
  for (const line of judged.received) receivedByPolicy.set(line.policyId, [...(receivedByPolicy.get(line.policyId) ?? []), line]);

  // ── never paid ───────────────────────────────────────────────────────────────
  for (const policy of input.policies) {
    if (policy.status !== "active" || !policy.carrierId) continue;
    if (receivedByPolicy.has(policy.id)) continue;
    const grace = input.lagDays?.get(policy.carrierId);
    if (grace === undefined) continue;
    const graceEnds = addDays(policy.effectiveDate, grace);
    if (graceEnds > input.today) continue;
    const covering = input.coverage.filter((period) => period.carrierId === policy.carrierId && period.periodEnd >= graceEnds);
    if (!covering.length) continue;
    const reported = (entry: ExpectedEntry) => covering.filter((period) => period.periodEnd >= entry.postedOn && period.periodStart <= addDays(entry.postedOn, grace));
    const owedEntries = (expectedByPolicy.get(policy.id) ?? []).filter((entry) => entry.kind !== "chargeback" && reported(entry).length > 0);
    const owed = owedEntries.reduce((total, entry) => total + entry.amountCents, 0);
    if (owed < tolerance) continue;
    const evidence = covering.filter((period) => owedEntries.some((entry) => reported(entry).includes(period)));
    const lastCovered = evidence.map((period) => period.periodEnd).sort().at(-1) as string;
    const periods = evidence.map((period) => ({ start: period.periodStart, end: period.periodEnd })).sort((a, b) => a.start.localeCompare(b.start));
    findings.push({
      fingerprint: v2 ? `never_paid|${policy.id}|issue:${policy.effectiveDate.slice(0, 10)}` : `never_paid|${policy.id}`,
      kind: "never_paid",
      policyId: policy.id,
      carrierId: policy.carrierId,
      periodStart: periods[0].start,
      periodEnd: lastCovered,
      owedCents: owed,
      detail: {
        expectedCents: owed,
        receivedCents: 0,
        periods,
        expectedEntryIds: owedEntries.map((entry) => entry.id),
        receivedLineIds: [],
        statementIds: evidence.map((period) => period.statementId),
        explanation: `Issued ${policy.effectiveDate}. ${evidence.length === 1 ? "One statement" : `${evidence.length} statements`} from ${policy.carrierName} ${evidence.length === 1 ? "covers" : "cover"} the time ${owedEntries.length === 1 ? "this payment was" : "these payments were"} due, to ${lastCovered}, and none pays this policy. Your contract expects ${money(owed)} in that time.`,
      },
    });
  }

  // ── short-paid and paid at the wrong rate ─────────────────────────────────────
  const commissionLines = judged.received.filter((line) => line.kind !== "chargeback");
  const priced = new Set(input.expected.map((entry) => entry.policyId));
  const rows = reconcileStatements(
    judged.expected.filter((entry) => entry.kind !== "chargeback"),
    commissionLines.map((line) => ({ policyId: line.policyId, amountCents: line.amountCents, periodStart: line.periodStart, periodEnd: line.periodEnd })),
    priced,
    tolerance,
  );
  for (const row of rows) {
    if (row.status !== "short") continue;
    const policy = policyById.get(row.policyId);
    if (!policy || policy.status === "pending") continue;
    const lines = commissionLines.filter((line) => line.policyId === row.policyId);
    const inPeriod = (expectedByPolicy.get(row.policyId) ?? []).filter((entry) => entry.kind !== "chargeback" && row.periods.some((period) => entry.postedOn >= period.start && entry.postedOn <= period.end));
    const expectedRate = inPeriod.find((entry) => entry.rateBp !== null)?.rateBp ?? null;
    const paidRates = lines.map(paidRate).filter((rate): rate is number => rate !== null);
    const paid = paidRates.length ? paidRates[0] : null;
    const misRated = expectedRate !== null && paid !== null && Math.abs(paid - expectedRate) > 1;
    const kind: DiscrepancyKind = misRated ? "mis_rated" : "short_paid";
    const owed = -row.differenceCents;
    findings.push({
      fingerprint: v2 ? `${kind}|${row.policyId}|from:${row.periods[0]?.start ?? ""}` : `${kind}|${row.policyId}|${periodKey(row.periods)}`,
      kind,
      policyId: row.policyId,
      carrierId: policy.carrierId,
      periodStart: row.periods[0]?.start ?? null,
      periodEnd: row.periods.at(-1)?.end ?? null,
      owedCents: owed,
      detail: {
        expectedCents: row.expectedCents,
        receivedCents: row.receivedCents,
        expectedRateBp: expectedRate,
        paidRateBp: paid,
        periods: row.periods,
        expectedEntryIds: inPeriod.map((entry) => entry.id),
        receivedLineIds: lines.map((line) => line.id),
        statementIds: [...new Set(lines.map((line) => line.statementId))],
        explanation: misRated
          ? `Paid at ${pct(paid as number)}; your contract's schedule is ${pct(expectedRate as number)}. ${money(row.receivedCents)} received against ${money(row.expectedCents)} expected.`
          : `${money(row.receivedCents)} received against ${money(row.expectedCents)} your contract expects for the periods reported.`,
      },
    });
  }

  // ── chargebacks ──────────────────────────────────────────────────────────────
  for (const [policyId, lines] of receivedByPolicy) {
    const policy = policyById.get(policyId);
    if (!policy || policy.status === "pending") continue;
    const chargebacks = lines.filter((line) => line.kind === "chargeback");
    if (!chargebacks.length) continue;
    const taken = chargebacks.reduce((total, line) => total + Math.abs(line.amountCents), 0);
    const periods = [...new Map(chargebacks.map((line) => [`${line.periodStart}|${line.periodEnd}`, { start: line.periodStart, end: line.periodEnd }])).values()].sort((a, b) => a.start.localeCompare(b.start));
    const base = { policyId, carrierId: policy.carrierId, periodStart: periods[0].start, periodEnd: periods.at(-1)?.end ?? null };

    if (policy.status === "active") {
      // v2: each chargeback period is its own event, so a new chargeback is never hidden by an old
      // one a person already resolved. v1 summed them into one finding per policy.
      const groups = v2
        ? periods.map((period) => ({ period, lines: chargebacks.filter((line) => line.periodStart === period.start && line.periodEnd === period.end) }))
        : [{ period: null, lines: chargebacks }];
      for (const group of groups) {
        const groupTaken = group.lines.reduce((total, line) => total + Math.abs(line.amountCents), 0);
        // Under the tolerance is rounding, as everywhere else (v2; v1 kept every chargeback).
        if (v2 && groupTaken < tolerance) continue;
        const groupPeriods = group.period ? [group.period] : periods;
        findings.push({
          ...base,
          periodStart: groupPeriods[0].start,
          periodEnd: groupPeriods.at(-1)?.end ?? null,
          fingerprint: group.period ? `unexpected_chargeback|${policyId}|${group.period.start}~${group.period.end}` : `unexpected_chargeback|${policyId}`,
          kind: "unexpected_chargeback",
          owedCents: groupTaken,
          detail: {
            expectedCents: 0, receivedCents: -groupTaken, allowedCents: 0, takenCents: groupTaken, periods: groupPeriods,
            expectedEntryIds: [], receivedLineIds: group.lines.map((line) => line.id), statementIds: [...new Set(group.lines.map((line) => line.statementId))],
            explanation: `${money(groupTaken)} charged back, but your book has this policy in force. Three things can explain it: the policy lapsed and your book is out of date, the carrier made an error, or the chargeback belongs to another policy. Check which before disputing.`,
          },
        });
      }
      continue;
    }

    if (chargebacks.length < 2) continue;
    const computed = (expectedByPolicy.get(policyId) ?? []).filter((entry) => entry.kind === "chargeback").reduce((total, entry) => total + Math.abs(entry.amountCents), 0);
    const advanced = lines.filter((line) => line.kind === "advance").reduce((total, line) => total + line.amountCents, 0);
    const allowed = computed > 0 ? computed : advanced > 0 ? advanced : Math.max(...chargebacks.map((line) => Math.abs(line.amountCents)));
    const excess = taken - allowed;
    if (excess < tolerance) continue;
    findings.push({
      ...base,
      fingerprint: v2 ? `duplicate_chargeback|${policyId}|from:${periods[0].start}` : `duplicate_chargeback|${policyId}`,
      kind: "duplicate_chargeback",
      owedCents: excess,
      detail: {
        expectedCents: -allowed, receivedCents: -taken, allowedCents: allowed, takenCents: taken, periods,
        expectedEntryIds: (expectedByPolicy.get(policyId) ?? []).filter((entry) => entry.kind === "chargeback").map((entry) => entry.id),
        receivedLineIds: chargebacks.map((line) => line.id), statementIds: [...new Set(chargebacks.map((line) => line.statementId))],
        explanation: `${chargebacks.length} chargebacks took ${money(taken)}; ${computed > 0 ? "the advance's chargeback is" : advanced > 0 ? "the advance received was" : "the largest single chargeback is"} ${money(allowed)}. ${money(excess)} was taken twice.`,
      },
    });
  }

  const weight: Record<DiscrepancyKind, number> = { never_paid: 0, unexpected_chargeback: 1, duplicate_chargeback: 2, mis_rated: 3, short_paid: 4 };
  return findings.sort((a, b) => b.owedCents - a.owedCents || weight[a.kind] - weight[b.kind] || a.fingerprint.localeCompare(b.fingerprint));
}

/** A stored finding, as much of it as the refresh needs. */
export type StoredFinding = {
  id: string;
  fingerprint: string;
  status: "open" | "disputed" | "resolved" | "written_off" | "cleared";
  owedCents: number;
  statusChangedBy: string | null;
  statusChangedAt: string | null;
};

export type RefreshWrite = {
  finding: DiscrepancyFinding;
  status: StoredFinding["status"];
  /** Who and when for the status this write leaves: the stored ones, or (null, now) when the refresh changed it. */
  statusChangedBy: string | null;
  statusChangedAt: string | null;
};

export type RefreshPlan = {
  writes: RefreshWrite[];
  /** Stored open or disputed findings that no longer apply. */
  clearIds: string[];
  /** New findings, and cleared ones that apply again. */
  opened: number;
  /** Resolved or written-off findings reopened because they got worse. */
  reopened: number;
};

/**
 * What a refresh changes, decided without I/O (refreshDiscrepancies applies it):
 *
 *   · a new finding is opened;
 *   · a cleared one that applies again is reopened;
 *   · an open or disputed one keeps its status and gets today's figures;
 *   · a resolved or written-off one is left as the person decided, UNLESS the carrier now owes at
 *     least `toleranceCents` more than when it was decided: then it reopens. A decision covers the
 *     money it was made about, not money the carrier takes or withholds afterwards;
 *   · an open or disputed one that no longer applies is cleared.
 *
 * Applying the same plan's result again changes nothing (refresh is idempotent).
 */
export function planRefresh(stored: StoredFinding[], findings: DiscrepancyFinding[], now: string, toleranceCents = RECONCILE_TOLERANCE_CENTS): RefreshPlan {
  const byFingerprint = new Map(stored.map((row) => [row.fingerprint, row]));
  const writes: RefreshWrite[] = [];
  let opened = 0;
  let reopened = 0;
  for (const finding of findings) {
    const row = byFingerprint.get(finding.fingerprint);
    if (!row || row.status === "cleared") {
      opened += 1;
      writes.push({ finding, status: "open", statusChangedBy: null, statusChangedAt: row ? now : null });
      continue;
    }
    if (row.status === "resolved" || row.status === "written_off") {
      if (finding.owedCents < row.owedCents + toleranceCents) continue;
      reopened += 1;
      writes.push({ finding, status: "open", statusChangedBy: null, statusChangedAt: now });
      continue;
    }
    writes.push({ finding, status: row.status, statusChangedBy: row.statusChangedBy, statusChangedAt: row.statusChangedAt });
  }
  const live = new Set(findings.map((finding) => finding.fingerprint));
  const clearIds = stored.filter((row) => !live.has(row.fingerprint) && (row.status === "open" || row.status === "disputed")).map((row) => row.id);
  return { writes, clearIds, opened, reopened };
}

/**
 * Kinds whose figure is money the carrier owes. An unexpected chargeback asserts no cause (the book
 * may be out of date, or the line matched to the wrong policy), so its figure is listed but never
 * counted as owed.
 */
export const OWED_KINDS: ReadonlySet<DiscrepancyKind> = new Set(["never_paid", "short_paid", "mis_rated", "duplicate_chargeback"]);

/** The total owed, and the split by kind, over findings (or stored rows) still open or disputed. */
export function owedSummary(items: Array<{ kind: DiscrepancyKind; owedCents: number }>): { totalCents: number; count: number; byKind: Record<DiscrepancyKind, { count: number; cents: number }> } {
  const byKind = Object.fromEntries(DISCREPANCY_KINDS.map((kind) => [kind, { count: 0, cents: 0 }])) as Record<DiscrepancyKind, { count: number; cents: number }>;
  for (const item of items) { byKind[item.kind].count += 1; byKind[item.kind].cents += item.owedCents; }
  return { totalCents: items.filter((item) => OWED_KINDS.has(item.kind)).reduce((total, item) => total + item.owedCents, 0), count: items.length, byKind };
}

/** Re-exported so callers date the window the same way the ledger does. */
export { addMonths };
