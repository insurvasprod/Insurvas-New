import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { agencyToday } from "./agencyDay";
import { flaggedFiles } from "./carrierAccountsStore";
import { unearnedAdvance } from "./commissionLedger";
import { advanceRuleResolver } from "./commissionLedgerStore";
import { allRows } from "./pages";
import type { BookRow } from "./policyBook";
import { barParts, isBehind, isInForce, moneyFigures, moneySentence, nextDate, policyHealth, type BookStrip, type ListMoney, type MoneyFacts, type RowFlags } from "./policyMoney";

export type { BookStrip, ListMoney } from "./policyMoney";

/**
 * Book of business › Policies, round 5 (boards 6 and 7): the reads behind where every policy's money stands.
 * Read-only. The ledger (commission_entry, statements that don't add up held out, as the ledger does), the
 * rate card's expected rows (expected_commission), the open pay issues (commission_discrepancy), the facts
 * policy_current adds (paid-to, months paid) and the carrier's grace (carrier_retention_rule, the rule
 * policy_current itself was measured against). Nothing here is stored; nothing is guessed.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

/** Pay issues that mean money that should have come and didn't (the list's "Paid short" and "Short or late"). */
export const SHORT_TYPES = ["short_paid", "missing"] as const;

const key = (carrierId: string, policyNumber: string) => `${carrierId}|${policyNumber}`;

type Ledger = { advanced: number; earnedLines: number; chargedBack: number; months: number | null; received: number; any: boolean };

/**
 * Every visible policy's money and the strip over them. `rows` is the list as the viewer may see it
 * (loadBook's scope), so a producer's figures are their own book's.
 */
export async function loadBookMoney(tenantId: string, rows: BookRow[]): Promise<{ byKey: Map<string, ListMoney>; strip: BookStrip }> {
  const today = await agencyToday(tenantId).catch(() => new Date().toISOString().slice(0, 10));
  const year = today.slice(0, 4);
  const [current, lines, flagged, ruleFor, expected, findings] = await Promise.all([
    allRows(() => db().from("policy_current").select("carrier_id, policy_number, paid_to_date, months_paid, as_of, product_code, effective_date, retention_rule_id").eq("tenant_id", tenantId).order("carrier_id").order("policy_number"), 200_000),
    // Along commission_entry_policy_idx (tenant, carrier, policy, day), id last for a stable page.
    allRows(() => db().from("commission_entry").select("carrier_id, policy_number, entry_type, corrects_type, amount_cents, months_advanced, file_id, transaction_date, statement_date").eq("tenant_id", tenantId).order("carrier_id").order("policy_number").order("transaction_date").order("id"), 200_000),
    flaggedFiles(tenantId),
    advanceRuleResolver(tenantId),
    allRows(() => db().from("expected_commission").select("carrier_id, policy_number, policy_year, confidence, expected_amount_cents, trigger_occurred_on").eq("tenant_id", tenantId).order("carrier_id").order("policy_number").order("policy_year"), 200_000),
    allRows(() => db().from("commission_discrepancy").select("id, carrier_id, policy_number, discrepancy_type, difference_cents").eq("tenant_id", tenantId).in("status", ["open", "disputed"]).in("discrepancy_type", [...SHORT_TYPES]).order("carrier_id").order("policy_number").order("id"), 50_000),
  ]);
  if (current.error && !isSchemaGap(current.error)) throw new Error(`Could not load the policies' payment facts: ${current.error.message}`);
  const ledgerOk = !lines.error;
  const expectedOk = !expected.error;
  const findingsOk = !findings.error;

  const facts = new Map<string, Loose>((current.rows ?? []).map((row: Loose) => [key(row.carrier_id, row.policy_number), row]));
  // The grace of the rule each policy was measured against (first payment or ongoing, as refresh_policy_current picks).
  const ruleIds = [...new Set((current.rows ?? []).map((row: Loose) => row.retention_rule_id).filter(Boolean))] as string[];
  const grace = new Map<string, number | null>();
  for (let i = 0; i < ruleIds.length; i += 200) {
    const { data } = await db().from("carrier_retention_rule").select("id, grace_days").in("id", ruleIds.slice(i, i + 200));
    for (const rule of (data ?? []) as Loose[]) grace.set(rule.id, rule.grace_days ?? null);
  }

  const ledger = new Map<string, Ledger>();
  for (const line of ledgerOk ? lines.rows : []) {
    if (flagged.has(line.file_id)) continue;
    const k = key(line.carrier_id, line.policy_number);
    const m = ledger.get(k) ?? { advanced: 0, earnedLines: 0, chargedBack: 0, months: null, received: 0, any: false };
    const amount = Number(line.amount_cents);
    const kind = line.corrects_type ?? line.entry_type;
    m.any = true;
    if (kind === "advance") { m.advanced += amount; if (line.months_advanced !== null) m.months = Math.max(m.months ?? 0, line.months_advanced); }
    else if (kind === "earned") m.earnedLines += amount;
    else if (kind === "chargeback") m.chargedBack += amount;
    // Received this year: every line but held money, as the ledger's net received (commissionLedger.rollup).
    if (kind !== "held" && String(line.transaction_date ?? line.statement_date ?? "").startsWith(year)) m.received += amount;
    ledger.set(k, m);
  }
  const firstYear = new Map<string, Loose>();
  const dueThisYear = new Map<string, { cents: number; unpriced: boolean }>();
  for (const row of expectedOk ? expected.rows : []) {
    const k = key(row.carrier_id, row.policy_number);
    if (Number(row.policy_year) === 1) firstYear.set(k, row);
    if (String(row.trigger_occurred_on ?? "").startsWith(year)) {
      const now = dueThisYear.get(k) ?? { cents: 0, unpriced: false };
      if (row.confidence === "no_rate_card") now.unpriced = true;
      else now.cents += Number(row.expected_amount_cents ?? 0);
      dueThisYear.set(k, now);
    }
  }
  const short = new Map<string, number>();
  for (const f of findingsOk ? findings.rows : []) {
    const k = key(f.carrier_id, f.policy_number);
    short.set(k, (short.get(k) ?? 0) + Math.abs(Number(f.difference_cents ?? 0)));
  }

  const byKey = new Map<string, ListMoney>();
  const strip: BookStrip = {
    inForce: { count: 0, monthlyCents: 0 },
    expectedThisYear: expectedOk ? { cents: 0, unpriced: 0 } : null,
    receivedThisYear: ledgerOk ? 0 : null,
    atRisk: ledgerOk ? { cents: null, policies: 0, unknown: 0 } : null,
    short: findingsOk ? { cents: 0, policies: 0 } : null,
    year,
  };
  for (const row of rows) {
    const k = key(row.carrierId, row.policyNumber);
    const fact = row.source ? null : facts.get(k);
    const m = row.source ? undefined : ledger.get(k);
    const first = row.source ? undefined : firstYear.get(k);
    const advanced = m?.advanced ?? 0;
    const trace = m && advanced > 0
      ? unearnedAdvance({ advancedCents: advanced, chargedBackCents: m.chargedBack, monthsPaid: fact?.months_paid ?? null, rule: ruleFor(row.carrierId, fact?.product_code ?? null, fact?.as_of ?? null), statementMonths: m.months })
      : null;
    const input: MoneyFacts = {
      status: row.status, source: row.source,
      paidTo: fact?.paid_to_date ?? null, daysPastDue: row.daysPastDue, daysLeft: row.daysLeft, asOf: fact?.as_of ?? null,
      effectiveDate: fact?.effective_date ?? null, premiumMode: row.premiumMode, monthsPaid: fact?.months_paid ?? null,
      expectedCents: first && first.confidence !== "no_rate_card" && first.expected_amount_cents !== null ? Number(first.expected_amount_cents) : null,
      noRate: first?.confidence === "no_rate_card",
      advancedCents: advanced, earnedLineCents: m?.earnedLines ?? 0, chargedBackCents: m?.chargedBack ?? 0,
      unearnedCents: trace ? trace.unearnedCents : advanced > 0 ? null : 0,
      atRiskCents: trace ? trace.atRiskCents : advanced > 0 ? null : 0,
      shortCents: short.get(k) ?? 0, hasLines: Boolean(m?.any),
      graceDays: fact?.retention_rule_id ? grace.get(fact.retention_rule_id) ?? null : null,
    };
    const figures = moneyFigures(input);
    const sentence = moneySentence(input, figures);
    const due = dueThisYear.get(k);
    const flags: RowFlags = {
      behind: isBehind(input),
      short: input.shortCents > 0,
      risk: (figures.atRiskCents ?? 0) > 0,
      lapsed: row.status === "lapsed",
      inforce: isInForce(row.status),
      expected: Boolean(due && due.cents > 0),
      received: Boolean(m && m.received !== 0),
    };
    byKey.set(k, { health: policyHealth(input), bar: row.source || !(m?.any || input.expectedCents !== null) ? null : barParts(figures), sentence: sentence.text, addRate: sentence.addRate, next: nextDate(input, today), flags });

    if (flags.inforce) { strip.inForce.count++; strip.inForce.monthlyCents += Math.round((row.annualCents ?? 0) / 12); }
    if (strip.expectedThisYear && due) { strip.expectedThisYear.cents += due.cents; if (due.unpriced) strip.expectedThisYear.unpriced++; }
    if (strip.receivedThisYear !== null && m) strip.receivedThisYear += m.received;
    if (strip.atRisk && advanced > 0) {
      const risk = trace?.atRiskCents ?? null;
      if (risk === null) strip.atRisk.unknown++;
      else {
        strip.atRisk.cents = (strip.atRisk.cents ?? 0) + risk;
        if (risk > 0) strip.atRisk.policies++;
      }
    }
    if (strip.short && input.shortCents > 0) { strip.short.cents += input.shortCents; strip.short.policies++; }
  }
  return { byKey, strip };
}

/** The carrier's grace and window for one policy: the rule policy_current measured it against, or nulls. */
export async function loadPolicyGrace(tenantId: string, carrierId: string, policyNumber: string): Promise<{ graceDays: number | null; windowDays: number | null; ruleType: string | null }> {
  const { data: row } = await db().from("policy_current").select("retention_rule_id").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).maybeSingle();
  if (!row?.retention_rule_id) return { graceDays: null, windowDays: null, ruleType: null };
  const { data: rule } = await db().from("carrier_retention_rule").select("grace_days, window_days, rule_type").eq("id", row.retention_rule_id).maybeSingle();
  return { graceDays: rule?.grace_days ?? null, windowDays: rule?.window_days ?? null, ruleType: rule?.rule_type ?? null };
}

/** The policy's current client link, for Unlink in the header's More menu; null when it has none (or links can't be read). */
export async function loadCurrentLinkId(tenantId: string, carrierId: string, policyNumber: string): Promise<string | null> {
  const { data, error } = await db().from("policy_match").select("id").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).is("superseded_by_id", null).order("created_at", { ascending: false }).limit(1);
  if (error) return null;
  return ((data ?? [])[0]?.id as string | undefined) ?? null;
}
