/**
 * LA-4.15 (Notion sprint) · the discrepancy engine, as one plain function: from the policies
 * (LA-4.7), the expected figures (LA-4.13), the ledger (LA-4.12) and the carrier statements
 * (LA-4.14), every money problem of one agency, each with the evidence a person can check.
 *
 * Five types need no rate card (missing, duplicate and unexpected chargeback, missing chargeback,
 * held building up, debit balance growing — six with the account ones); short-paid, over-paid and
 * mis-rated switch on per carrier as rates arrive. Integer cents throughout. The tolerance applied
 * is on every comparison.
 */

import { accountTrend, type StatementCheck } from "./carrierAccounts.ts";
import { unearnedAdvance } from "./commissionLedger.ts";

export const DISCREPANCY_TYPES = ["missing", "short_paid", "over_paid", "mis_rated", "duplicate_chargeback", "unexpected_chargeback", "missing_chargeback", "held_building_up", "debit_balance_growing", "not_received"] as const;
export type DiscrepancyType = (typeof DISCREPANCY_TYPES)[number];
export type Severity = "info" | "warning" | "action";

export const DISCREPANCY_LABELS: Record<DiscrepancyType, { label: string; plural: string; needsRates: boolean }> = {
  missing: { label: "Missing commission", plural: "Missing commission", needsRates: false },
  short_paid: { label: "Paid short", plural: "Paid short", needsRates: true },
  over_paid: { label: "Paid over", plural: "Paid over", needsRates: true },
  mis_rated: { label: "Wrong rate or premium", plural: "Wrong rate or premium", needsRates: true },
  duplicate_chargeback: { label: "Charged back twice", plural: "Charged back twice", needsRates: false },
  unexpected_chargeback: { label: "Chargeback on an active policy", plural: "Chargebacks on active policies", needsRates: false },
  missing_chargeback: { label: "Chargeback coming", plural: "Chargebacks coming", needsRates: false },
  held_building_up: { label: "Held, building up", plural: "Held, building up", needsRates: false },
  debit_balance_growing: { label: "Debit balance growing", plural: "Debit balances growing", needsRates: false },
  // LA-7.6: the carrier says it paid; the bank shows nothing past the carrier's usual lag.
  not_received: { label: "Paid but not received", plural: "Paid but not received", needsRates: false },
};

/** The default when a carrier has no tolerance of its own (LA-4.17 settings): a dollar. */
export const DEFAULT_TOLERANCE_CENTS = 100;

export type EnginePolicy = { carrierId: string; carrierName: string; policyNumber: string; status: string | null; inClawbackWindow: boolean | null; lapsedOn: string | null; monthsPaid: number | null };
export type EngineExpected = {
  carrierId: string; policyNumber: string; policyYear: number; confidence: string; trigger: string; triggerOn: string; overdueFrom: string | null; reason: string | null;
  expectedAmountCents: number | null; expectedAdvanceCents: number | null; scheduleId: string | null; scheduleVersion: string | null; rateBp: number | null; premiumCents: number | null;
};
export type EngineEntry = {
  id: string; carrierId: string; policyNumber: string; type: string; correctsType: string | null; reversesEntryId: string | null; amountCents: number;
  transactionDate: string | null; statementDate: string | null; rateBp: number | null; commissionablePremiumCents: number | null; monthsAdvanced: number | null;
};

export type UnreceivedStatement = { statementId: string; carrierId: string; statementDate: string; paidCents: number; receivedCents: number; lagDays: number; dueBy: string };

export type Finding = {
  carrier_id: string;
  discrepancy_type: DiscrepancyType;
  subject_key: string;
  policy_number: string | null;
  policy_year: number;
  severity: Severity;
  expected_amount_cents: number | null;
  expected_source: Record<string, unknown> | null;
  reported_amount_cents: number | null;
  reported_entry_ids: string[];
  difference_cents: number | null;
  tolerance_applied_cents: number | null;
  explanation: string;
  evidence: Record<string, unknown>;
};

const money = (cents: number) => {
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${cents < 0 ? "−" : ""}$${Number(digits.slice(0, -2)).toLocaleString("en-US")}.${digits.slice(-2)}`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string | null) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}` : "an unknown date");
const daysBetween = (a: string, b: string) => Math.abs(Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86_400_000));
const kind = (e: EngineEntry) => e.correctsType ?? e.type;
/**
 * A line dated inside policy year `year`, counted in whole years from the trigger: year 1 is the
 * 12 months from the trigger, year 2 the 12 after. An undated line (or no trigger day) belongs to
 * year 1, so it is not silently dropped — and is not counted again against every later year.
 */
export const inPolicyYear = (e: Pick<EngineEntry, "transactionDate" | "statementDate">, triggerOn: string | null, year: number) => {
  const on = e.transactionDate ?? e.statementDate;
  if (!on || !triggerOn) return year === 1;
  const shift = (n: number) => `${Number(triggerOn.slice(0, 4)) + n}${triggerOn.slice(4)}`;
  return (year === 1 || on >= shift(year - 1)) && on < shift(year);
};

/**
 * "Charged back twice for one lapse" (Module 4 §9: same policy, same lapse event). Two equal
 * chargebacks are not enough: carriers take an unearned advance back in equal monthly instalments.
 * A pair of equal chargebacks (within tolerance, within 90 days, so one lapse) is the same lapse
 * taken twice only when
 *   · both carry the same date — one event recorded twice; or
 *   · together with the chargebacks before them in that lapse, they take back more than the policy
 *     was advanced (beyond tolerance) — instalments never exceed the advance.
 * With no advance on the ledger only the same-day rule applies. Returns the pair and what was taken
 * twice (positive cents: owed back to the agent), or null. `chargebacks` are dated-sorted, negative.
 */
export function duplicateChargeback(chargebacks: EngineEntry[], advancedCents: number, tol: number): { first: EngineEntry; second: EngineEntry; excessCents: number; sameDay: boolean; advancedCents: number | null } | null {
  const on = (e: EngineEntry) => e.transactionDate ?? e.statementDate;
  for (let i = 1; i < chargebacks.length; i++) {
    const a = chargebacks[i - 1], b = chargebacks[i];
    const da = on(a), db = on(b);
    if (!da || !db || Math.abs(a.amountCents - b.amountCents) > tol || daysBetween(da, db) > 90) continue;
    if (da === db) return { first: a, second: b, excessCents: -b.amountCents, sameDay: true, advancedCents: advancedCents > 0 ? advancedCents : null };
    if (advancedCents <= 0) continue;
    // Everything taken back in this lapse so far: the chargebacks within 90 days before b.
    const taken = -chargebacks.slice(0, i + 1).filter((e) => on(e) && daysBetween(on(e)!, db) <= 90).reduce((s, e) => s + e.amountCents, 0);
    const excess = taken - advancedCents;
    if (excess > tol) return { first: a, second: b, excessCents: Math.min(excess, -b.amountCents), sameDay: false, advancedCents };
  }
  return null;
}

/** The entries still standing: an entry a reprocess reversed, and that reversal, cancel out. */
function standing(entries: EngineEntry[]) {
  const reversed = new Set(entries.map((e) => e.reversesEntryId).filter(Boolean) as string[]);
  return entries.filter((e) => !reversed.has(e.id) && !e.reversesEntryId);
}

export function detect(input: {
  today: string;
  policies: EnginePolicy[];
  expected: EngineExpected[];
  entries: EngineEntry[];
  statements: StatementCheck[];
  carrierNames: Map<string, string>;
  tolerance: (carrierId: string) => number;
  /** LA-7.6: statements whose payment the imported bank data does not show, past the expected lag. */
  unreceived?: UnreceivedStatement[];
}): Finding[] {
  const findings: Finding[] = [];
  const byPolicy = new Map<string, EngineEntry[]>();
  for (const e of input.entries) byPolicy.set(`${e.carrierId}|${e.policyNumber}`, [...(byPolicy.get(`${e.carrierId}|${e.policyNumber}`) ?? []), e]);
  const policyOf = new Map(input.policies.map((p) => [`${p.carrierId}|${p.policyNumber}`, p]));
  const name = (carrierId: string) => input.carrierNames.get(carrierId) ?? "The carrier";
  const sum = (rows: EngineEntry[], k: string) => rows.filter((e) => kind(e) === k).reduce((s, e) => s + e.amountCents, 0);
  const ids = (rows: EngineEntry[], k: string[]) => rows.filter((e) => k.includes(kind(e))).map((e) => e.id);

  // ── expected against reported (missing needs no rate; the rest do) ──────────────────────────
  for (const x of input.expected) {
    const key = `${x.carrierId}|${x.policyNumber}`;
    const policy = policyOf.get(key);
    if (!policy || ["declined", "withdrawn", "submitted", "not_taken"].includes(policy.status ?? "")) continue;
    // A policy that lapsed before a single payment was never really in force: nothing is owed on it.
    if (policy.status === "lapsed" && !(policy.monthsPaid ?? 0)) continue;
    // Lines a reprocess or a corrected reissue reversed, and those reversals, cancel out.
    // Each expected row is one policy year's figure: only that year's lines are compared with it.
    const rows = standing(byPolicy.get(key) ?? []).filter((e) => inPolicyYear(e, x.triggerOn, x.policyYear));
    const tol = input.tolerance(x.carrierId);
    const source = x.scheduleId ? { schedule_id: x.scheduleId, schedule_version: x.scheduleVersion, rate_bp: x.rateBp, commissionable_premium_cents: x.premiumCents, confidence: x.confidence } : { confidence: x.confidence, reason: x.reason };
    const paidLines = rows.filter((e) => ["advance", "earned", "held"].includes(kind(e)));
    const paid = paidLines.reduce((s, e) => s + e.amountCents, 0);

    if (x.overdueFrom && x.overdueFrom <= input.today && paid <= 0) {
      findings.push({
        carrier_id: x.carrierId, discrepancy_type: "missing", subject_key: x.policyNumber, policy_number: x.policyNumber, policy_year: x.policyYear, severity: "action",
        expected_amount_cents: x.expectedAmountCents, expected_source: source, reported_amount_cents: 0, reported_entry_ids: paidLines.map((e) => e.id),
        difference_cents: x.expectedAmountCents, tolerance_applied_cents: null,
        explanation: `${name(x.carrierId)} pays ${x.trigger === "on_issue" ? "on issue" : "on the first draft"}; that happened on ${day(x.triggerOn)}, and it normally pays by ${day(x.overdueFrom)}. No commission line has come in for this policy.${x.expectedAmountCents === null ? ` The amount owed can't be worked out yet: ${x.reason ?? "no rate entered"}.` : ""}`,
        evidence: { trigger: x.trigger, trigger_on: x.triggerOn, overdue_from: x.overdueFrom },
      });
      continue;
    }
    if (x.expectedAmountCents === null || x.confidence === "no_rate_card") continue;

    const advanced = sum(rows, "advance");
    const earned = sum(rows, "earned");
    let compare: { expected: number; reported: number; what: string; entryIds: string[] } | null = null;
    if (advanced > 0 && x.expectedAdvanceCents !== null) compare = { expected: x.expectedAdvanceCents, reported: advanced, what: "the advance", entryIds: ids(rows, ["advance"]) };
    else if (advanced === 0 && earned > 0 && (policy.monthsPaid ?? 0) >= 12 * x.policyYear) {
      // This policy year only (rows above): renewals paid after it are not part of its figure.
      compare = { expected: x.expectedAmountCents, reported: earned, what: x.policyYear === 1 ? "the first year's commission" : `policy year ${x.policyYear}'s commission`, entryIds: ids(rows, ["earned"]) };
    }
    if (compare) {
      const diff = compare.expected - compare.reported;
      if (Math.abs(diff) > tol) {
        const short = diff > 0;
        findings.push({
          carrier_id: x.carrierId, discrepancy_type: short ? "short_paid" : "over_paid", subject_key: x.policyNumber, policy_number: x.policyNumber, policy_year: x.policyYear, severity: short ? "action" : "warning",
          expected_amount_cents: compare.expected, expected_source: source, reported_amount_cents: compare.reported, reported_entry_ids: compare.entryIds,
          difference_cents: diff, tolerance_applied_cents: tol,
          explanation: `${compare.what[0].toUpperCase()}${compare.what.slice(1)} should be ${money(compare.expected)} at ${x.rateBp !== null ? `${x.rateBp / 100}%` : "your rate"} of ${x.premiumCents !== null ? money(x.premiumCents) : "the premium"}; ${money(compare.reported)} came in, ${short ? "short" : "over"} by ${money(Math.abs(diff))} (more than the ${money(tol)} tolerance).${short ? "" : " An overpayment is usually taken back later; keep it aside."}`,
          evidence: { compared: compare.what },
        });
      }
    }
    // Mis-rated: a line paid at a different rate, or on a different premium, than our record.
    const rated = rows.filter((e) => ["advance", "earned"].includes(kind(e)) && e.amountCents > 0);
    const wrongRate = x.rateBp !== null ? rated.filter((e) => e.rateBp !== null && e.rateBp !== x.rateBp) : [];
    const wrongPremium = x.premiumCents !== null ? rated.filter((e) => e.commissionablePremiumCents !== null && Math.abs(e.commissionablePremiumCents - x.premiumCents!) > tol) : [];
    if (wrongRate.length || wrongPremium.length) {
      const line = wrongRate[0] ?? wrongPremium[0];
      findings.push({
        carrier_id: x.carrierId, discrepancy_type: "mis_rated", subject_key: x.policyNumber, policy_number: x.policyNumber, policy_year: x.policyYear, severity: "warning",
        expected_amount_cents: x.expectedAmountCents, expected_source: source, reported_amount_cents: null, reported_entry_ids: [...new Set([...wrongRate, ...wrongPremium].map((e) => e.id))],
        difference_cents: null, tolerance_applied_cents: tol,
        explanation: wrongRate.length
          ? `The carrier paid at ${line.rateBp! / 100}%; your rate card says ${x.rateBp! / 100}% for this product and level. Check the contract level and age band before disputing.`
          : `The carrier paid on a premium of ${money(line.commissionablePremiumCents!)}; the policy's annual premium is ${money(x.premiumCents!)} (tolerance ${money(tol)}). A policy fee or rider the carrier doesn't commission can explain it.`,
        evidence: { line_rate_bp: line.rateBp, line_premium_cents: line.commissionablePremiumCents },
      });
    }
  }

  // ── chargebacks (no rate card needed) ───────────────────────────────────────────────────────
  for (const [key, all] of byPolicy) {
    const rows = standing(all);
    const [carrierId, policyNumber] = key.split("|");
    const policy = policyOf.get(key);
    const tol = input.tolerance(carrierId);
    const chargebacks = rows.filter((e) => e.type === "chargeback").sort((a, b) => (a.transactionDate ?? a.statementDate ?? "").localeCompare(b.transactionDate ?? b.statementDate ?? ""));
    const duplicate = duplicateChargeback(chargebacks, rows.filter((e) => kind(e) === "advance").reduce((s, e) => s + e.amountCents, 0), tol);
    if (duplicate) {
      const { first: a, second: b, excessCents } = duplicate;
      const da = a.transactionDate ?? a.statementDate, db = b.transactionDate ?? b.statementDate;
      findings.push({
        carrier_id: carrierId, discrepancy_type: "duplicate_chargeback", subject_key: policyNumber, policy_number: policyNumber, policy_year: 1, severity: "action",
        expected_amount_cents: a.amountCents, expected_source: null, reported_amount_cents: a.amountCents + b.amountCents, reported_entry_ids: [a.id, b.id],
        difference_cents: excessCents, tolerance_applied_cents: tol,
        explanation: duplicate.sameDay
          ? `Two chargebacks of ${money(a.amountCents)} and ${money(b.amountCents)}, both dated ${day(da)}: the same lapse taken back twice. The second looks like a duplicate.`
          : `Two chargebacks of ${money(a.amountCents)} and ${money(b.amountCents)} on ${day(da)} and ${day(db)}, within one lapse, take back ${money(excessCents)} more than was advanced on this policy. A policy is charged back once per lapse; the second looks like a duplicate.`,
        evidence: { first_entry: a.id, second_entry: b.id, same_day: duplicate.sameDay, advanced_cents: duplicate.advancedCents },
      });
    }
    const chargedBack = rows.filter((e) => kind(e) === "chargeback").reduce((s, e) => s + e.amountCents, 0);
    if (policy?.status === "active" && chargedBack < 0) {
      findings.push({
        carrier_id: carrierId, discrepancy_type: "unexpected_chargeback", subject_key: policyNumber, policy_number: policyNumber, policy_year: 1, severity: "action",
        expected_amount_cents: 0, expected_source: null, reported_amount_cents: chargedBack, reported_entry_ids: ids(rows, ["chargeback"]),
        difference_cents: -chargedBack, tolerance_applied_cents: null,
        explanation: `${money(-chargedBack)} was charged back, but the carrier's latest policy file shows this policy active. Three things can explain it, and only one is the carrier's mistake: the policy lapsed and the policy file is out of date; the carrier made an error; or this chargeback was matched to the wrong policy. Check which before disputing.`,
        evidence: { causes: ["the policy file is out of date", "a carrier error", "the chargeback belongs to another policy"], policy_status: policy.status },
      });
    }
    // A lapse inside the clawback window with an advance standing and nothing taken back yet.
    const advanced = rows.filter((e) => kind(e) === "advance").reduce((s, e) => s + e.amountCents, 0);
    if (policy && ["lapsed", "not_taken"].includes(policy.status ?? "") && policy.inClawbackWindow === true && advanced > 0 && chargedBack === 0) {
      const months = Math.max(0, ...rows.filter((e) => kind(e) === "advance" && e.monthsAdvanced !== null).map((e) => e.monthsAdvanced as number));
      const coming = unearnedAdvance({ advancedCents: advanced, chargedBackCents: 0, monthsPaid: policy.monthsPaid, rule: null, statementMonths: months || null });
      findings.push({
        carrier_id: carrierId, discrepancy_type: "missing_chargeback", subject_key: policyNumber, policy_number: policyNumber, policy_year: 1, severity: "info",
        expected_amount_cents: coming.unearnedCents === null ? null : -coming.unearnedCents, expected_source: { advanced_cents: advanced, months_advanced: months || null, months_paid: policy.monthsPaid },
        reported_amount_cents: 0, reported_entry_ids: ids(rows, ["advance"]), difference_cents: null, tolerance_applied_cents: null,
        explanation: `The policy ${policy.status === "not_taken" ? "was not taken" : "lapsed"}${policy.lapsedOn ? ` on ${day(policy.lapsedOn)}` : ""}, inside the chargeback window, and ${money(advanced)} was advanced. No chargeback has come yet, so it is coming${coming.unearnedCents !== null ? `: about ${money(coming.unearnedCents)}` : ""}. Don't count on that money.`,
        evidence: { lapsed_on: policy.lapsedOn },
      });
    }
  }

  // ── the carrier's account (no rate card needed) ─────────────────────────────────────────────
  const byCarrier = new Map<string, StatementCheck[]>();
  for (const s of input.statements) byCarrier.set(s.carrierId, [...(byCarrier.get(s.carrierId) ?? []), s]);
  for (const [carrierId, rows] of byCarrier) {
    const trend = accountTrend(rows);
    const sorted = trend.rows;
    const last = sorted.at(-1);
    const prev = sorted.at(-2);
    if (last && prev && last.heldCents !== null && prev.heldCents !== null && last.heldCents > prev.heldCents && prev.heldCents > 0
        && (last.minimumPayoutCents === null || last.heldCents < last.minimumPayoutCents)) {
      findings.push({
        carrier_id: carrierId, discrepancy_type: "held_building_up", subject_key: "*", policy_number: null, policy_year: 1, severity: "info",
        expected_amount_cents: null, expected_source: null, reported_amount_cents: last.heldCents, reported_entry_ids: [],
        difference_cents: null, tolerance_applied_cents: null,
        explanation: `${name(carrierId)} is holding ${money(last.heldCents)}, up from ${money(prev.heldCents)}${last.minimumPayoutCents !== null ? `, below its ${money(last.minimumPayoutCents)} minimum payout` : ""}. This money is withheld, not missing: the carrier pays it once the balance clears the minimum. Nothing to chase.`,
        evidence: { statement_date: last.statementDate, previous_statement_date: prev.statementDate },
      });
    }
    if (trend.growingDebit && last && prev) {
      findings.push({
        carrier_id: carrierId, discrepancy_type: "debit_balance_growing", subject_key: "*", policy_number: null, policy_year: 1, severity: "warning",
        expected_amount_cents: null, expected_source: null, reported_amount_cents: last.closingCents, reported_entry_ids: [],
        difference_cents: last.closingCents - prev.closingCents, tolerance_applied_cents: null,
        explanation: `You owe ${name(carrierId)} ${money(-last.closingCents)}, up from ${money(-Math.min(0, prev.closingCents))} on the previous statement${trend.fallingFor > 1 ? ` (falling for ${trend.fallingFor} statements)` : ""}. Until the balance is back above zero the carrier keeps every new commission, so sales won't show up as payments.`,
        evidence: { statement_date: last.statementDate, previous_statement_date: prev.statementDate },
      });
    }
  }
  // ── LA-7.6: reported paid, never received (bank data covers the date it should have landed by) ──
  // An account-level finding, like the two above: one per carrier (subject "*"), its statements in the evidence.
  const unreceived = new Map<string, UnreceivedStatement[]>();
  for (const u of input.unreceived ?? []) unreceived.set(u.carrierId, [...(unreceived.get(u.carrierId) ?? []), u]);
  for (const [carrierId, list] of unreceived) {
    const sorted = [...list].sort((a, b) => a.statementDate.localeCompare(b.statementDate));
    const paid = sorted.reduce((s, u) => s + u.paidCents, 0);
    const received = sorted.reduce((s, u) => s + u.receivedCents, 0);
    const first = sorted[0];
    const explanation = sorted.length === 1
      ? `${name(carrierId)}'s statement of ${day(first.statementDate)} says it paid ${money(first.paidCents)}. ${first.receivedCents ? `Only ${money(first.receivedCents)} has been matched to a deposit` : "No deposit has been matched to it"}, and it normally lands within ${first.lagDays} days (by ${day(first.dueBy)}). ${money(paid - received)} is unaccounted for.`
      : `${name(carrierId)}'s statements of ${sorted.map((u) => day(u.statementDate)).join(", ")} say it paid ${money(paid)}; ${received ? `only ${money(received)} has been matched to deposits` : "no deposit has been matched to them"}, past its usual ${first.lagDays}-day lag. ${money(paid - received)} is unaccounted for.`;
    findings.push({
      carrier_id: carrierId, discrepancy_type: "not_received", subject_key: "*", policy_number: null, policy_year: 1, severity: "action",
      expected_amount_cents: paid, expected_source: { source: "carrier_account_statement", statement_ids: sorted.map((u) => u.statementId) }, reported_amount_cents: received, reported_entry_ids: [],
      difference_cents: paid - received, tolerance_applied_cents: null,
      explanation,
      evidence: { statements: sorted.map((u) => ({ id: u.statementId, statement_date: u.statementDate, paid_cents: u.paidCents, received_cents: u.receivedCents, due_by: u.dueBy })), lag_days: first.lagDays },
    });
  }
  return findings;
}

/**
 * The kinds that say the carrier owes the agent money. An unexpected chargeback is not one of them:
 * it asserts no cause (the policy file may be out of date, or the line matched to the wrong policy),
 * so it is a question for the carrier, never money counted as owed.
 */
export const OWED_TYPES: ReadonlySet<DiscrepancyType> = new Set(["missing", "short_paid", "duplicate_chargeback"]);

/** What the agent is owed, what will be taken back, and what is held, from open findings. */
export function moneySummary(rows: Array<{ discrepancy_type: string; difference_cents: number | null; expected_amount_cents: number | null; reported_amount_cents: number | null; status: string }>) {
  const open = rows.filter((r) => r.status === "open" || r.status === "disputed");
  const owed = open.filter((r) => OWED_TYPES.has(r.discrepancy_type as DiscrepancyType) && (r.difference_cents ?? 0) > 0).reduce((s, r) => s + (r.difference_cents ?? 0), 0);
  const coming = open.filter((r) => r.discrepancy_type === "missing_chargeback").reduce((s, r) => s + Math.abs(r.expected_amount_cents ?? 0), 0);
  const held = open.filter((r) => r.discrepancy_type === "held_building_up").reduce((s, r) => s + (r.reported_amount_cents ?? 0), 0);
  const unpriced = open.filter((r) => r.discrepancy_type === "missing" && r.difference_cents === null).length;
  return { owedCents: owed, comingBackCents: coming, heldCents: held, unpricedMissing: unpriced, open: open.length };
}
