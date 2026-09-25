/**
 * The commission ledger, derived: policies × the carrier library.
 *
 * "Carriers, contract levels, commission schedules and advance rules. Everything the ledger
 * multiplies by." Every figure here is a premium multiplied by a rate that exists as a row in
 * commission_schedules (resolveCommissionRate / commissionCentsFromSchedule — LA-0.4 criterion 2);
 * nothing is a literal percentage, and a policy with no matching row produces a gap, never a guess.
 *
 * The rules, stated once:
 *
 *   · the carrier and product are matched from the policy's text to the library by code or name;
 *   · the contract level is the tenant_carriers row in force on the policy's ISSUE date, and every
 *     rate and advance rule is also resolved as of the issue date — "a raise applies to policies
 *     issued after it, never to the ones already paid";
 *   · policy year N starts on the (N−1)th anniversary of the issue date and posts that year's
 *     commission, annual premium × that year's rate, once the year has started;
 *   · with an advance rule, year one posts as an advance of advance_pct of the year-one commission
 *     on the issue date, and the balance once the advance months have run. Without one, year one
 *     posts unadvanced on the issue date ("Commissions will post unadvanced until one exists");
 *   · a lapsed or cancelled policy stops earning at the date it was marked so, and — inside the
 *     clawback months — charges the advance back: all of it for a full clawback, or the share of the
 *     clawback period still to run for a prorated one;
 *   · a pending policy has not been issued and posts nothing.
 *
 * Pure (no I/O) so every rule above is tested directly. Plain module: no server-only imports.
 */
import { commissionCentsFromSchedule, resolveCommissionRate } from "../carriers/resolve.ts";
import type { CommissionScheduleRow } from "../carriers/service-types.ts";

export type LedgerPolicy = {
  id: string;
  policyNumber: string;
  insuredName: string;
  carrier: string;
  product: string;
  /** Issue / effective date, YYYY-MM-DD. */
  effectiveDate: string;
  annualPremiumCents: number;
  status: "active" | "pending" | "lapsed" | "cancelled" | string;
  /** When a lapsed or cancelled policy was marked so (tenant_policies.updated_at). */
  statusChangedAt: string | null;
  /** Who recorded the policy — the only attribution tenant_policies carries. */
  createdBy: string | null;
};

export type LedgerLibrary = {
  carriers: Array<{ id: string; code: string; name: string }>;
  products: Array<{ code: string; name: string }>;
  tenantCarriers: Array<{ carrier_id: string; contract_level_bp: number; effective_from: string }>;
  commissionSchedules: CommissionScheduleRow[];
  advanceRules: Array<{ id: string; carrier_id: string; product_code: string; advance_months: number; advance_pct_bp: number; clawback_months: number; clawback_type: "full" | "prorated"; effective_from: string }>;
};

export type LedgerEntryKind = "advance" | "commission" | "chargeback";

export type LedgerEntry = {
  id: string;
  policyId: string;
  policyNumber: string;
  insuredName: string;
  carrierName: string;
  productName: string;
  kind: LedgerEntryKind;
  policyYear: number;
  /** YYYY-MM-DD. */
  postedOn: string;
  /** Negative for a chargeback. */
  amountCents: number;
  premiumCents: number;
  contractLevelBp: number;
  /** The schedule row the figure came from; null only for a chargeback, which comes from the advance. */
  scheduleId: string | null;
  rateBp: number | null;
  advanceRuleId: string | null;
  producerUserId: string | null;
};

export type LedgerGap = { policyId: string; policyNumber: string; reason: string };

export type ChargebackExposure = {
  policyId: string;
  policyNumber: string;
  insuredName: string;
  carrierName: string;
  productName: string;
  advanceCents: number;
  /** What would be charged back if the policy lapsed today. */
  exposureCents: number;
  clawbackType: "full" | "prorated";
  /** The last day a lapse still charges back, YYYY-MM-DD. */
  clawbackEndsOn: string;
  producerUserId: string | null;
};

export type LedgerResult = {
  entries: LedgerEntry[];
  gaps: LedgerGap[];
  exposure: ChargebackExposure[];
  totals: { entries: number; grossCents: number; advancesCents: number; chargebacksCents: number; exposureCents: number };
};

const normalise = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

/** YYYY-MM-DD plus whole months, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const total = (m - 1) + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, last))).toISOString().slice(0, 10);
}

/** Whole months from `from` to `to` (both YYYY-MM-DD); 0 when `to` is before `from`. */
export function wholeMonthsBetween(from: string, to: string): number {
  if (to <= from) return 0;
  let months = 0;
  while (addMonths(from, months + 1) <= to) months += 1;
  return months;
}

/** The chargeback on an advance for a lapse after `monthsInForce` months. 0 once the period has run. */
export function chargebackCents(advanceCents: number, rule: { clawback_months: number; clawback_type: "full" | "prorated" }, monthsInForce: number): number {
  if (advanceCents <= 0 || monthsInForce >= rule.clawback_months) return 0;
  if (rule.clawback_type === "full") return advanceCents;
  return Math.round((advanceCents * (rule.clawback_months - monthsInForce)) / rule.clawback_months);
}

function resolveCarrier(library: LedgerLibrary, text: string) {
  const key = normalise(text);
  return library.carriers.find((carrier) => normalise(carrier.code) === key || normalise(carrier.name) === key) ?? null;
}

function resolveProduct(library: LedgerLibrary, text: string) {
  const key = normalise(text);
  return library.products.find((product) => normalise(product.code) === key || normalise(product.name) === key) ?? null;
}

function levelOn(library: LedgerLibrary, carrierId: string, asOf: string) {
  return library.tenantCarriers
    .filter((row) => row.carrier_id === carrierId && row.effective_from <= asOf)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
}

function ruleOn(library: LedgerLibrary, carrierId: string, productCode: string, asOf: string) {
  return library.advanceRules
    .filter((rule) => rule.carrier_id === carrierId && rule.product_code === productCode && rule.effective_from <= asOf)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
}

export function computeLedger(policies: LedgerPolicy[], library: LedgerLibrary, today: string): LedgerResult {
  const entries: LedgerEntry[] = [];
  const gaps: LedgerGap[] = [];
  const exposure: ChargebackExposure[] = [];

  for (const policy of policies) {
    if (policy.status === "pending") continue;
    const gap = (reason: string) => gaps.push({ policyId: policy.id, policyNumber: policy.policyNumber, reason });
    const issued = policy.effectiveDate.slice(0, 10);
    if (issued > today) continue;

    const carrier = resolveCarrier(library, policy.carrier);
    if (!carrier) { gap(`“${policy.carrier}” is not a carrier in the library.`); continue; }
    const product = resolveProduct(library, policy.product);
    if (!product) { gap(`“${policy.product}” is not a product in the library.`); continue; }
    const contract = levelOn(library, carrier.id, issued);
    if (!contract) { gap(`No ${carrier.name} contract level was in force on the issue date.`); continue; }

    const ended = policy.status === "lapsed" || policy.status === "cancelled";
    const endedOn = ended ? (policy.statusChangedAt ?? today).slice(0, 10) : null;
    // A year earns only if it started while the policy was in force.
    const earnsBy = endedOn && endedOn < today ? endedOn : today;

    const base = {
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      insuredName: policy.insuredName,
      carrierName: carrier.name,
      productName: product.name,
      premiumCents: policy.annualPremiumCents,
      contractLevelBp: contract.contract_level_bp,
      producerUserId: policy.createdBy,
    };
    const rateFor = (policyYear: number) =>
      resolveCommissionRate(library.commissionSchedules, { carrierId: carrier.id, productCode: product.code, contractLevelBp: contract.contract_level_bp, policyYear, asOf: issued });

    const yearOne = rateFor(1);
    if (!yearOne) { gap(`No year-one rate for ${carrier.name} · ${product.name} at ${contract.contract_level_bp} bps on the issue date.`); continue; }
    const yearOneCents = commissionCentsFromSchedule(policy.annualPremiumCents, yearOne);
    const rule = ruleOn(library, carrier.id, product.code, issued);
    const advanceCents = rule && rule.advance_pct_bp > 0 ? Math.min(yearOneCents, Math.round((yearOneCents * rule.advance_pct_bp) / 10000)) : 0;

    if (advanceCents > 0 && rule) {
      entries.push({ ...base, id: `${policy.id}:advance`, kind: "advance", policyYear: 1, postedOn: issued, amountCents: advanceCents, scheduleId: yearOne.id, rateBp: yearOne.rate_bp, advanceRuleId: rule.id });
      const balanceOn = addMonths(issued, rule.advance_months);
      if (yearOneCents - advanceCents > 0 && balanceOn <= earnsBy) {
        entries.push({ ...base, id: `${policy.id}:1`, kind: "commission", policyYear: 1, postedOn: balanceOn, amountCents: yearOneCents - advanceCents, scheduleId: yearOne.id, rateBp: yearOne.rate_bp, advanceRuleId: rule.id });
      }
    } else {
      entries.push({ ...base, id: `${policy.id}:1`, kind: "commission", policyYear: 1, postedOn: issued, amountCents: yearOneCents, scheduleId: yearOne.id, rateBp: yearOne.rate_bp, advanceRuleId: null });
    }

    for (let policyYear = 2; policyYear <= 100; policyYear += 1) {
      const starts = addMonths(issued, (policyYear - 1) * 12);
      if (starts > earnsBy || (endedOn && starts >= endedOn)) break;
      const row = rateFor(policyYear);
      if (!row) { gap(`No year-${policyYear} rate for ${carrier.name} · ${product.name}; that year is not posted.`); continue; }
      entries.push({ ...base, id: `${policy.id}:${policyYear}`, kind: "commission", policyYear, postedOn: starts, amountCents: commissionCentsFromSchedule(policy.annualPremiumCents, row), scheduleId: row.id, rateBp: row.rate_bp, advanceRuleId: null });
    }

    if (!rule || advanceCents === 0) continue;
    const clawbackEndsOn = addMonths(issued, rule.clawback_months);
    if (endedOn) {
      const back = chargebackCents(advanceCents, rule, wholeMonthsBetween(issued, endedOn));
      if (back > 0) entries.push({ ...base, id: `${policy.id}:chargeback`, kind: "chargeback", policyYear: 1, postedOn: endedOn, amountCents: -back, scheduleId: null, rateBp: null, advanceRuleId: rule.id });
    } else if (policy.status === "active" && today < clawbackEndsOn) {
      const atRisk = chargebackCents(advanceCents, rule, wholeMonthsBetween(issued, today));
      if (atRisk > 0) exposure.push({ policyId: policy.id, policyNumber: policy.policyNumber, insuredName: policy.insuredName, carrierName: carrier.name, productName: product.name, advanceCents, exposureCents: atRisk, clawbackType: rule.clawback_type, clawbackEndsOn, producerUserId: policy.createdBy });
    }
  }

  entries.sort((a, b) => b.postedOn.localeCompare(a.postedOn) || a.policyNumber.localeCompare(b.policyNumber) || a.policyYear - b.policyYear);
  exposure.sort((a, b) => b.exposureCents - a.exposureCents || a.clawbackEndsOn.localeCompare(b.clawbackEndsOn));
  return { entries, gaps, exposure, totals: totalsOf(entries, exposure) };
}

export function totalsOf(entries: LedgerEntry[], exposure: ChargebackExposure[]): LedgerResult["totals"] {
  const sum = (items: Array<{ amountCents: number }>) => items.reduce((total, item) => total + item.amountCents, 0);
  return {
    entries: entries.length,
    grossCents: sum(entries.filter((entry) => entry.kind !== "chargeback")),
    advancesCents: sum(entries.filter((entry) => entry.kind === "advance")),
    chargebacksCents: -sum(entries.filter((entry) => entry.kind === "chargeback")),
    exposureCents: exposure.reduce((total, item) => total + item.exposureCents, 0),
  };
}
