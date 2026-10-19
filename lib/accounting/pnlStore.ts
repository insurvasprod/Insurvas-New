import "server-only";

import { historyStart, issued, persistency, type Bucket, type ScorePolicy } from "@/lib/ingestion/scorecards";
import { addMonths } from "@/lib/ledger/compute";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { moneyEntries, type MoneyFilter } from "./costLedger";
import type { Basis } from "./costLedgerCore";
import { fromRow } from "./settingsCore";
import { chargebackTax, comparisons, moneyIn, perPolicy, persisting, statement, type PeriodKind, type PnlLine, type Range } from "./pnlCore";

/**
 * LA-7.7 (Notion sprint, Module 7 — Accounting) · the P&L, server side. Computed live from the
 * ledgers (20261015230000) — no snapshot — with the issued and persisting counts from LA-4's policy
 * book through LA-4.18's own functions (issued, persistency, historyStart), so "issued" and
 * "still paying at month 9" mean here exactly what they mean on the scorecards.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const PNL_PENDING_MESSAGE = "The P&L needs a database update (20261015200000–20261015230000).";

export class PnlError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function fail(error: { code?: string; message: string }): never {
  if (isSchemaGap(error) || error.code === "PGRST202" || error.code === "42883") throw new PnlError(PNL_PENDING_MESSAGE, 503);
  throw new Error(error.message);
}

export type ReportingSettings = { basis: Basis; fyStartMonth: number; horizon: Bucket; threshold: number };

export async function reportingSettings(tenantId: string): Promise<ReportingSettings> {
  const { data } = await db().from("accounting_settings").select("default_basis, fy_start_month, persistency_month, sample_threshold").eq("tenant_id", tenantId).maybeSingle();
  const s = fromRow(data);
  return { basis: s.defaultBasis, fyStartMonth: s.fyStartMonth, horizon: s.persistencyMonth as Bucket, threshold: s.sampleThreshold };
}

async function lines(tenantId: string, r: Range, basis: Basis): Promise<PnlLine[]> {
  const { data, error } = await db().rpc("pnl_lines", { p_tenant_id: tenantId, p_from: r.from, p_to: r.to, p_basis: basis });
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map((l) => ({ section: l.section, entryType: l.entry_type, sourceType: l.source_type, sourceId: l.source_id, sourceName: l.source_name, amountCents: Number(l.amount_cents), entries: Number(l.entries) }));
}

/** The policy book as LA-4.18 reads it — only the fields "issued" and persistency need. Paged past the 1,000-row cap. */
async function policies(tenantId: string): Promise<{ rows: ScorePolicy[]; today: string }> {
  const out: Loose[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await db().from("policy_current").select("carrier_id, policy_number, status_normalized, issue_date, effective_date, lapsed_on, termination_date, months_paid, annualised_premium_cents, first_seen_date, as_of")
      .eq("tenant_id", tenantId).order("carrier_id").order("policy_number").range(from, from + 999);
    if (error) {
      if (isSchemaGap(error)) return { rows: [], today: new Date().toISOString().slice(0, 10) };
      throw new Error(error.message);
    }
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const today = out.reduce((max: string, r: Loose) => (r.as_of > max ? r.as_of : max), "") || new Date().toISOString().slice(0, 10);
  const rows = out.map((r): ScorePolicy => ({
    key: `${r.carrier_id}|${r.policy_number}`, carrierId: r.carrier_id, carrierName: "", policyNumber: r.policy_number, clientName: null, status: r.status_normalized,
    issueDate: r.issue_date ?? r.effective_date ?? null, lapsedOn: r.lapsed_on, terminationDate: r.termination_date, monthsPaid: r.months_paid,
    annualCents: r.annualised_premium_cents === null ? null : Number(r.annualised_premium_cents), productKey: "", productName: "", agentKey: "", agentName: "",
    agencyKey: "", agencyName: "", sourceKey: "", sourceName: "", firstSeen: r.first_seen_date, applicationId: null, advancedCents: null, chargedBackCents: null, netCents: null,
  }));
  return { rows, today };
}

export async function loadPnl(tenantId: string, input: { kind: PeriodKind; range: Range; basis: Basis }) {
  const settings = await reportingSettings(tenantId);
  const { previous, lastYear } = comparisons(input.kind, input.range);
  // The six months ending with the period: the direction is the signal, not one month's level.
  const trendFrom = addMonths(`${input.range.to.slice(0, 7)}-01`, -6);
  const [cur, prev, ly, trend, received, book] = await Promise.all([
    lines(tenantId, input.range, input.basis),
    lines(tenantId, previous, input.basis),
    lines(tenantId, lastYear, input.basis),
    db().rpc("pnl_monthly", { p_tenant_id: tenantId, p_from: trendFrom, p_to: input.range.to, p_basis: input.basis }),
    db().rpc("pnl_received", { p_tenant_id: tenantId, p_from: input.range.from, p_to: input.range.to }),
    policies(tenantId),
  ]);
  if (trend.error) fail(trend.error);
  if (received.error) fail(received.error);

  const s = statement(cur);
  const inPeriod = (p: ScorePolicy) => !!p.issueDate && p.issueDate >= input.range.from && p.issueDate < input.range.to;
  const cohort = book.rows.filter((p) => issued(p) && inPeriod(p));
  const cell = persistency(cohort, settings.horizon, book.today, historyStart(book.rows));
  const perIssued = perPolicy(s.acquisitionCents, cohort.length, settings.threshold);
  const lasting = persisting({ range: input.range, horizon: settings.horizon, today: book.today, acquisitionCents: s.acquisitionCents, issued: cell.eligible, alive: cell.alive, cohortBuilding: cell.building, threshold: settings.threshold });

  const months = new Map<string, { month: string; inCents: number; acquisitionCents: number; overheadCents: number; splitsCents: number }>();
  for (const r of (trend.data ?? []) as Loose[]) {
    const key = String(r.month).slice(0, 7);
    const m = months.get(key) ?? { month: key, inCents: 0, acquisitionCents: 0, overheadCents: 0, splitsCents: 0 };
    const v = Number(r.amount_cents);
    if (r.section === "in") m.inCents += v;
    else if (r.section === "acquisition") m.acquisitionCents += v;
    else if (r.section === "overhead") m.overheadCents += v;
    else m.splitsCents += v;
    months.set(key, m);
  }
  const trendRows = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, netCents: m.inCents + m.acquisitionCents + m.overheadCents + m.splitsCents }));

  return {
    range: input.range, kind: input.kind, basis: input.basis, settings, today: book.today,
    statement: s,
    previous: { range: previous, ...totalsOf(prev) },
    lastYear: { range: lastYear, ...totalsOf(ly) },
    moneyIn: moneyIn(s.inCents, received.data == null ? null : Number(received.data)),
    issued: cohort.length,
    perIssued,
    persisting: lasting,
    chargebackTaxCents: chargebackTax(perIssued, lasting),
    trend: trendRows,
  };
}

function totalsOf(ls: PnlLine[]) {
  const s = statement(ls);
  return { inCents: s.inCents, acquisitionCents: s.acquisitionCents, overheadCents: s.overheadCents, splitsCents: s.splitsCents, netProfitCents: s.netProfitCents };
}

export type DrillRequest = { range: Range; basis: Basis; section: PnlLine["section"]; entryType: string; sourceType: PnlLine["sourceType"]; sourceId: string | null; category: string | null; page: number };

/** The entries behind one P&L line, each with a link to where it came from. */
export async function drill(tenantId: string, d: DrillRequest) {
  // Held money is never money in (pnl_lines puts it in its own section): a drill that pairs them,
  // either way round, lists nothing rather than held lines under "in" (E2E 2026-10-16).
  if ((d.section === "in" && d.entryType === "held") || (d.section === "held" && d.entryType !== "held" && d.entryType !== "reversal")) return { rows: [], more: false };
  const filter: MoneyFilter = { period: { from: d.range.from, to: d.range.to }, basis: d.basis, side: d.section === "in" || d.section === "held" ? "commission" : "cost", entryTypes: [d.entryType] };
  if (d.sourceType === "partner" && d.sourceId) filter.partnerId = d.sourceId;
  // A partner invoice can carry its campaign's vendor too; the P&L lists it under the partner.
  if (d.sourceType === "vendor" && d.sourceId) { filter.vendorId = d.sourceId; filter.noPartner = true; }
  if (d.sourceType === "expense_category" && d.category) {
    const { data, error } = await db().from("expense").select("id").eq("tenant_id", tenantId).eq("category", d.category).in("status", ["confirmed", "void"]).limit(2000);
    if (error) fail(error);
    filter.expenseIds = ((data ?? []) as Loose[]).map((r) => r.id as string);
    if (!filter.expenseIds.length) return { rows: [], more: false };
  } else if (d.section !== "in" && d.section !== "held") {
    filter.noExpense = true;
  }
  const res = await moneyEntries(tenantId, filter, d.page);
  // A reversal belongs where what it reverses belongs (pnl_lines): under Held only a held one, under
  // In never one. The money view does not carry corrects_type, so it is read here, as the tax summary does.
  let rows = res.rows;
  if (d.entryType === "reversal" && (d.section === "in" || d.section === "held") && rows.length) {
    const corrects = new Map<string, string | null>();
    const ids = rows.map((r) => r.entryId);
    for (const table of ["commission_entry", "commission_account_entry"]) {
      const { data, error } = await db().from(table).select("id, corrects_type").in("id", ids);
      if (error) fail(error);
      for (const c of (data ?? []) as Loose[]) corrects.set(c.id as string, (c.corrects_type as string | null) ?? null);
    }
    rows = rows.filter((r) => (corrects.get(r.entryId) === "held") === (d.section === "held"));
  }
  return {
    more: res.more,
    rows: rows.map((r) => ({
      ...r,
      source: r.invoiceId ? { label: "Invoice", href: `/app/invoices?open=${r.invoiceId}` }
        : r.expenseId ? { label: "Expense", href: `/app/expenses?open=${r.expenseId}` }
        : r.payoutRunId ? { label: "Payout run", href: `/app/payouts?open=${r.payoutRunId}` }
        : r.sourceFileId ? { label: "Carrier file", href: `/app/carrier-files/file/${r.sourceFileId}` }
        : null,
    })),
  };
}
