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

export const DISCREPANCY_TYPES = ["missing", "short_paid", "over_paid", "mis_rated", "duplicate_chargeback", "unexpected_chargeback", "missing_chargeback", "held_building_up", "debit_balance_growing"] as const;
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
    if (!policy || ["declined", "withdrawn", "submitted"].includes(policy.status ?? "")) continue;
    const rows = byPolicy.get(key) ?? [];
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
    else if (advanced === 0 && earned > 0 && (policy.monthsPaid ?? 0) >= 12) compare = { expected: x.expectedAmountCents, reported: earned, what: "the first year's commission", entryIds: ids(rows, ["earned"]) };
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
    // Two chargebacks of the same size within one lapse (90 days): the second is the suspect.
    for (let i = 1; i < chargebacks.length; i++) {
      const a = chargebacks[i - 1], b = chargebacks[i];
      const da = a.transactionDate ?? a.statementDate, db = b.transactionDate ?? b.statementDate;
      if (Math.abs(a.amountCents - b.amountCents) <= tol && da && db && daysBetween(da, db) <= 90) {
        findings.push({
          carrier_id: carrierId, discrepancy_type: "duplicate_chargeback", subject_key: policyNumber, policy_number: policyNumber, policy_year: 1, severity: "action",
          expected_amount_cents: a.amountCents, expected_source: null, reported_amount_cents: a.amountCents + b.amountCents, reported_entry_ids: [a.id, b.id],
          difference_cents: -b.amountCents, tolerance_applied_cents: tol,
          explanation: `Two chargebacks of ${money(a.amountCents)} and ${money(b.amountCents)} on ${day(da)} and ${day(db)}, within one lapse. A policy is charged back once per lapse; the second looks like a duplicate.`,
          evidence: { first_entry: a.id, second_entry: b.id },
        });
        break;
      }
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
  return findings;
}

/** What the agent is owed, what will be taken back, and what is held, from open findings. */
export function moneySummary(rows: Array<{ discrepancy_type: string; difference_cents: number | null; expected_amount_cents: number | null; reported_amount_cents: number | null; status: string }>) {
  const open = rows.filter((r) => r.status === "open" || r.status === "disputed");
  const owed = open.filter((r) => ["missing", "short_paid", "duplicate_chargeback", "unexpected_chargeback"].includes(r.discrepancy_type) && (r.difference_cents ?? 0) > 0).reduce((s, r) => s + (r.difference_cents ?? 0), 0);
  const coming = open.filter((r) => r.discrepancy_type === "missing_chargeback").reduce((s, r) => s + Math.abs(r.expected_amount_cents ?? 0), 0);
  const held = open.filter((r) => r.discrepancy_type === "held_building_up").reduce((s, r) => s + (r.reported_amount_cents ?? 0), 0);
  const unpriced = open.filter((r) => r.discrepancy_type === "missing" && r.difference_cents === null).length;
  return { owedCents: owed, comingBackCents: coming, heldCents: held, unpricedMissing: unpriced, open: open.length };
}
