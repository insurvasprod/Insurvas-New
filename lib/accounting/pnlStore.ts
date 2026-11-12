import "server-only";

import { historyStart, issued, persistency, type Bucket, type ScorePolicy } from "@/lib/ingestion/scorecards";
import { addMonths } from "@/lib/ledger/compute";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { moneyEntries, type MoneyFilter } from "./costLedger";
import type { Basis } from "./costLedgerCore";
import { fromRow } from "./settingsCore";
import { chargebackTax, comparisons, inBankFor, mergeStatement, moneyIn, paidByLine, perPolicy, periodRange, persisting, readableDate, SECTIONS, statement, type PaidCost, type PeriodKind, type PnlLine, type Range } from "./pnlCore";

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

/**
 * Round 7 · "In the bank" for an accrual cost line: the period's cost entries that have been paid, read straight
 * from cost_entry by its (tenant_id, incurred_on) index — one read for the whole statement, never one per line —
 * with each entry's expense (category, acquisition or not) read once by id, so the line is placed exactly as
 * pnl_lines places it (costLineOf). Null when either read is not there: the column then says "—", never a guess.
 */
async function paidCosts(tenantId: string, r: Range): Promise<PaidCost[] | null> {
  const out: Loose[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await db().from("cost_entry").select("entry_type, amount_cents, vendor_id, partner_id, expense_id")
      .eq("tenant_id", tenantId).gte("incurred_on", r.from).lt("incurred_on", r.to).not("paid_on", "is", null)
      .order("incurred_on").order("id").range(from, from + 999);
    if (error) return null;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const ids = [...new Set(out.map((c) => c.expense_id).filter(Boolean))] as string[];
  const expense = new Map<string, { category: string | null; acquisition: boolean | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db().from("expense").select("id, category, is_acquisition_cost").eq("tenant_id", tenantId).in("id", ids.slice(i, i + 200));
    if (error) return null;
    for (const x of (data ?? []) as Loose[]) expense.set(x.id, { category: x.category ?? null, acquisition: x.is_acquisition_cost ?? null });
  }
  return out.map((c) => ({
    entryType: c.entry_type, amountCents: Number(c.amount_cents), vendorId: c.vendor_id, partnerId: c.partner_id, expenseId: c.expense_id,
    expenseCategory: c.expense_id ? expense.get(c.expense_id)?.category ?? null : null, expenseAcquisition: c.expense_id ? expense.get(c.expense_id)?.acquisition ?? null : null,
  }));
}

/**
 * The full statement (round 7, 5·A): this period's, the period before's and last year's lines, merged line by
 * line, each with its "In the bank". Every read starts at once: three pnl_lines, pnl_received, and — on accrual
 * only — the period's paid costs.
 */
export async function statementRows(tenantId: string, input: { kind: PeriodKind; range: Range; basis: Basis }) {
  const { previous, lastYear } = comparisons(input.kind, input.range);
  const [cur, prev, ly, received, paid] = await Promise.all([
    lines(tenantId, input.range, input.basis),
    lines(tenantId, previous, input.basis),
    lines(tenantId, lastYear, input.basis),
    db().rpc("pnl_received", { p_tenant_id: tenantId, p_from: input.range.from, p_to: input.range.to }),
    input.basis === "accrual" ? paidCosts(tenantId, input.range) : Promise.resolve(null),
  ]);
  if (received.error) fail(received.error);
  const money = moneyIn(statement(cur).inCents, received.data == null ? null : Number(received.data));
  const paidMap = paid ? paidByLine(paid) : null;
  const rows = mergeStatement(cur, prev, ly);
  for (const section of SECTIONS) for (const row of rows[section]) row.bank = inBankFor(row, input.basis, money.received, paidMap);
  return { previous, lastYear, cur, prev, ly, rows, moneyIn: money };
}

export async function loadPnl(tenantId: string, input: { kind: PeriodKind; range: Range; basis: Basis }) {
  // The six months ending with the period: the direction is the signal, not one month's level.
  const trendFrom = addMonths(`${input.range.to.slice(0, 7)}-01`, -6);
  const [settings, full, trend, book] = await Promise.all([
    reportingSettings(tenantId),
    statementRows(tenantId, input),
    db().rpc("pnl_monthly", { p_tenant_id: tenantId, p_from: trendFrom, p_to: input.range.to, p_basis: input.basis }),
    policies(tenantId),
  ]);
  if (trend.error) fail(trend.error);
  const { previous, lastYear, cur, prev, ly } = full;

  const s = statement(cur);
  const cohortOf = (r: Range) => book.rows.filter((p) => issued(p) && !!p.issueDate && p.issueDate >= r.from && p.issueDate < r.to);
  const cohort = cohortOf(input.range);
  const cell = persistency(cohort, settings.horizon, book.today, historyStart(book.rows));
  const perIssued = perPolicy(s.acquisitionCents, cohort.length, settings.threshold);
  // The cost per issued policy across the columns too (5·A): the same rule on each period's own cohort.
  const prevTotals = totalsOf(prev);
  const lyTotals = totalsOf(ly);
  const perIssuedPrevious = perPolicy(prevTotals.acquisitionCents, cohortOf(previous).length, settings.threshold);
  const perIssuedLastYear = perPolicy(lyTotals.acquisitionCents, cohortOf(lastYear).length, settings.threshold);
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
    rows: full.rows,
    previous: { range: previous, ...prevTotals, perIssued: perIssuedPrevious },
    lastYear: { range: lastYear, ...lyTotals, perIssued: perIssuedLastYear },
    moneyIn: full.moneyIn,
    issued: cohort.length,
    perIssued,
    persisting: lasting,
    chargebackTaxCents: chargebackTax(perIssued, lasting),
    trend: trendRows,
  };
}

/**
 * LA-7.7 · the trailing view: "a separate trailing view shows periods old enough to have the figure". The
 * six months whose cohorts have passed the persistency horizon, newest first, each with its acquisition
 * cost, policies issued, cost per issued and cost per persisting policy, and the chargeback tax between
 * them. Three reads for all six (settings, the monthly ledger, the book), never one P&L per month.
 */
export async function persistingCohorts(tenantId: string, basis: Basis, count = 6) {
  const [settings, book] = await Promise.all([reportingSettings(tenantId), policies(tenantId)]);
  // The newest month whose last day is a full horizon ago: its cohort has its figure today.
  const newest = addMonths(`${book.today.slice(0, 7)}-01`, -(settings.horizon + 1));
  const oldest = addMonths(newest, -(count - 1));
  const { data, error } = await db().rpc("pnl_monthly", { p_tenant_id: tenantId, p_from: oldest, p_to: addMonths(newest, 1), p_basis: basis });
  if (error) fail(error);
  const acquisition = new Map<string, number>();
  for (const r of (data ?? []) as Loose[]) if (r.section === "acquisition") acquisition.set(String(r.month).slice(0, 7), (acquisition.get(String(r.month).slice(0, 7)) ?? 0) + Number(r.amount_cents));
  const start = historyStart(book.rows);
  return Array.from({ length: count }, (_, i) => {
    const range = periodRange("month", addMonths(newest, -i));
    const acquisitionCents = acquisition.get(range.from.slice(0, 7)) ?? 0;
    const cohort = book.rows.filter((p) => issued(p) && !!p.issueDate && p.issueDate >= range.from && p.issueDate < range.to);
    const cell = persistency(cohort, settings.horizon, book.today, start);
    const perIssued = perPolicy(acquisitionCents, cohort.length, settings.threshold);
    const lasting = persisting({ range, horizon: settings.horizon, today: book.today, acquisitionCents, issued: cell.eligible, alive: cell.alive, cohortBuilding: cell.building, threshold: settings.threshold });
    return { month: range.from.slice(0, 7), label: range.label, acquisitionCents, issued: cohort.length, alive: cell.alive, perIssued, persisting: lasting, chargebackTaxCents: chargebackTax(perIssued, lasting) };
  });
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
    // Both tables at once; checked in the old order.
    const reads = await Promise.all(["commission_entry", "commission_account_entry"].map((table) => db().from(table).select("id, corrects_type").in("id", ids)));
    for (const { data, error } of reads as Loose[]) {
      if (error) fail(error);
      for (const c of (data ?? []) as Loose[]) corrects.set(c.id as string, (c.corrects_type as string | null) ?? null);
    }
    rows = rows.filter((r) => (corrects.get(r.entryId) === "held") === (d.section === "held"));
  }
  const names = await sourceNames(tenantId, rows);
  return {
    more: res.more,
    // Round 7 (5·2): an entry opens its source's own page, named as that page names it.
    rows: rows.map((r) => ({
      ...r,
      source: r.invoiceId ? { label: names.invoice.get(r.invoiceId) ?? "Vendor bill", href: `/app/vendor-bills/${r.invoiceId}` }
        : r.expenseId ? { label: names.expense.get(r.expenseId) ?? "Expense", href: `/app/expenses/${r.expenseId}` }
        : r.payoutRunId ? { label: names.run.get(r.payoutRunId) ?? "Payout run", href: `/app/payouts/${r.payoutRunId}` }
        : r.sourceFileId ? { label: "Commission statement", href: `/app/carrier-files/file/${r.sourceFileId}` }
        : null,
    })),
  };
}

/**
 * The names of a page of entries' sources, one read per kind for the whole page (never one per row): "Vendor bill
 * CVL-10442 · Crestview Lists", "Expense · Staples", "Payout run · Apex Health Partners · Sep 1 to Sep 30, 2026".
 * A failed read leaves the plain kind as the label; the link still opens the record.
 */
async function sourceNames(tenantId: string, rows: { invoiceId: string | null; expenseId: string | null; payoutRunId: string | null }[]) {
  const ids = (pick: (r: (typeof rows)[number]) => string | null) => [...new Set(rows.map(pick).filter(Boolean))] as string[];
  const [invoiceIds, expenseIds, runIds] = [ids((r) => r.invoiceId), ids((r) => r.expenseId), ids((r) => r.payoutRunId)];
  const read = (table: string, columns: string, list: string[]) => (list.length ? db().from(table).select(columns).eq("tenant_id", tenantId).in("id", list) : Promise.resolve({ data: [] }));
  const [invoices, expenses, runs] = (await Promise.all([
    read("vendor_invoice", "id, invoice_number, vendor_id, partner_id", invoiceIds),
    read("expense", "id, vendor_name", expenseIds),
    read("payout_run", "id, partner_id, period_start, period_end", runIds),
  ])) as Loose[];
  const inv = (invoices.data ?? []) as Loose[];
  const rn = (runs.data ?? []) as Loose[];
  const vendorIds = [...new Set(inv.map((i) => i.vendor_id).filter(Boolean))];
  const partnerIds = [...new Set([...inv.map((i) => i.partner_id), ...rn.map((r) => r.partner_id)].filter(Boolean))];
  const [vendors, partners] = (await Promise.all([
    vendorIds.length ? db().from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId).in("id", vendorIds) : Promise.resolve({ data: [] }),
    partnerIds.length ? db().from("partners").select("id, name").eq("tenant_id", tenantId).in("id", partnerIds) : Promise.resolve({ data: [] }),
  ])) as Loose[];
  const name = new Map<string, string>([...((vendors.data ?? []) as Loose[]), ...((partners.data ?? []) as Loose[])].map((x) => [x.id as string, x.name as string]));
  const tail = (id: string | null) => (id && name.get(id) ? ` · ${name.get(id)}` : "");
  return {
    invoice: new Map<string, string>(inv.map((i) => [i.id, `Vendor bill ${i.invoice_number}${tail(i.vendor_id ?? i.partner_id)}`])),
    expense: new Map<string, string>(((expenses.data ?? []) as Loose[]).map((x) => [x.id, x.vendor_name ? `Expense · ${x.vendor_name}` : "Expense"])),
    run: new Map<string, string>(rn.map((r) => [r.id, `Payout run${tail(r.partner_id)} · ${readableDate(r.period_start)} to ${readableDate(r.period_end)}`])),
  };
}
