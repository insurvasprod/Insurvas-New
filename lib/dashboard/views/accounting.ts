import type { DashViewProps } from "../../../components/app/home/views/view-props.ts";
import type { Statement } from "../../accounting/pnlCore.ts";
import type { InvoiceListRow } from "../../accounting/invoiceStore.ts";
import type { RunHeader } from "../../accounting/payoutsCore.ts";
import { firstOpenable } from "../roleHome.ts";

/**
 * The dashboard's Accounting view (owner 2026-11-06, /app/dashboard?view=accounting): did this month make
 * money, where it went, what waits on the bookkeeper. Every figure is read from the same source as the page
 * it opens, and only when that page is open to the reader (firstOpenable, the menu's own rule):
 *
 *   needs        the Accounting rail's counts (/api/app/accounting/steps) and Pay issues' "Open"
 *   big          the P&L's monthly trend (pnl_monthly, as /app/pnl?view=trend reads it), in against out
 *   side         money in reported by the carriers (pnl_lines) against what the bank confirms (pnl_received)
 *   left         this month's statement (pnl_lines → pnlCore.statement), the P&L's own sections
 *   right        producer balances (producer_balances, as /app/producer-splits reads it)
 *   hero         this month's net profit, with producers owed and approved bills not yet paid
 *   list         the newest deposits, vendor bills and payout runs
 *
 * Integer cents throughout; a division rounds in integers. A read that fails leaves its card out. The
 * shaping below is pure (lib/dashboard/views/accounting.test.mjs); the reads load their modules only when
 * the loader runs, and the loader refuses to run anywhere but the server.
 */

/* ── Pure shaping ───────────────────────────────────────────────────────────────────────────────── */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" in the agency's zone; UTC when the zone cannot be read. */
export function localToday(now: number, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

/** The first day of the month `offset` months from the month of `date` ("YYYY-MM-01"). */
export function monthStart(date: string, offset = 0): string {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  const index = y * 12 + (m - 1) + offset;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
}

export function monthLabel(month: string, long = false): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  return long ? `${MONTHS[m - 1]} ${y}` : SHORT[m - 1];
}

/** "Nov 4" from "2026-11-04". */
export function shortDate(date: string | null | undefined): string | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return undefined;
  return `${SHORT[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

/** Whole dollars, rounded half up in integers: 1234550 → "$12,346". For display only. */
export function wholeDollars(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor((abs + 50) / 100);
  return `${cents < 0 && dollars > 0 ? "-" : ""}$${dollars.toLocaleString("en-US")}`;
}

export type MonthlyRow = { month: string; section: string; amountCents: number };
export type MonthPoint = { month: string; label: string; inCents: number; outCents: number };

/**
 * pnl_monthly's rows as money in and money out per month, every month of the window present (a month with
 * no entries is a zero, not a gap). In is the commission sections' sum; out is every cost section turned
 * positive. A month whose net is the other way (a refund larger than the costs, chargebacks larger than the
 * advances) draws at zero: the line is a picture, the P&L behind each point has the signed figure.
 */
export function monthlyInOut(rows: readonly MonthlyRow[], months: readonly string[]): MonthPoint[] {
  const by = new Map(months.map((month) => [month.slice(0, 7), { inCents: 0, costCents: 0 }]));
  for (const row of rows) {
    const cell = by.get(row.month.slice(0, 7));
    if (!cell) continue;
    if (row.section === "in") cell.inCents += row.amountCents;
    else if (row.section === "acquisition" || row.section === "overhead" || row.section === "splits") cell.costCents += row.amountCents;
  }
  return months.map((month) => {
    const cell = by.get(month.slice(0, 7))!;
    return { month: month.slice(0, 10), label: monthLabel(month), inCents: Math.max(0, cell.inCents), outCents: Math.max(0, -cell.costCents) };
  });
}

export type MoneyBar = { key: "in" | "producers" | "leads" | "other" | "profit"; label: string; cents: number; tone: "good" | "info" | "warning" | "neutral" | "danger" };

/**
 * Where this month's money went, from the P&L's own statement: commission in, the producers' splits, lead
 * spend (acquisition lines booked as lead costs), every other cost, and what was left. Costs are shown as
 * positive amounts; profit keeps its sign (a loss is a danger bar of its size).
 */
export function whereMoneyWent(s: Pick<Statement, "inCents" | "splitsCents" | "acquisition" | "acquisitionCents" | "overheadCents" | "netProfitCents">): MoneyBar[] {
  const leads = s.acquisition.filter((line) => line.entryType === "lead_cost").reduce((sum, line) => sum + line.amountCents, 0);
  const other = s.acquisitionCents - leads + s.overheadCents;
  return [
    { key: "in", label: "Commission in", cents: s.inCents, tone: "good" },
    { key: "producers", label: "Paid to producers", cents: -s.splitsCents, tone: "info" },
    { key: "leads", label: "Lead spend", cents: -leads, tone: "warning" },
    { key: "other", label: "Other costs", cents: -other, tone: "neutral" },
    { key: "profit", label: s.netProfitCents < 0 ? "Loss" : "Profit", cents: s.netProfitCents, tone: s.netProfitCents < 0 ? "danger" : "good" },
  ];
}

/** Received of reported as a whole percent, rounded down in integers; null when there is nothing to compare. */
export function receivedShare(reportedCents: number, receivedCents: number | null): number | null {
  if (receivedCents === null || reportedCents <= 0) return null;
  return Math.floor((Math.max(0, receivedCents) * 100) / reportedCents);
}

export type BalanceRow = { producerUserId: string; balanceCents: number };
export type ProducerBalance = { userId: string; name: string; owedCents: number; owesBackCents: number };

/** Producers with money either way, the largest first: a positive balance is owed to them, a negative one they owe back. */
export function producerBalances(rows: readonly BalanceRow[], names: ReadonlyMap<string, string>, limit = 5): ProducerBalance[] {
  return rows
    .filter((row) => row.balanceCents !== 0)
    .sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents) || a.producerUserId.localeCompare(b.producerUserId))
    .slice(0, limit)
    .map((row) => ({ userId: row.producerUserId, name: names.get(row.producerUserId) ?? "Producer", owedCents: Math.max(0, row.balanceCents), owesBackCents: Math.max(0, -row.balanceCents) }));
}

/** Everything owed to producers: the sum of the positive balances. */
export function owedToProducers(rows: readonly BalanceRow[]): number {
  return rows.reduce((sum, row) => sum + Math.max(0, row.balanceCents), 0);
}

export type RecentKind = "deposit" | "bill" | "partnerRun" | "producerRun";
export type RecentMoney = { key: string; kind: RecentKind; on: string; title: string; detail: string; cents: number; tone: "good" | "warning" | "info" | "neutral" | "danger"; href: string };

export type DepositRow = { id: string; postedOn: string; amountCents: number; description: string; status: string };
export type ProducerRunRow = { id: string; producerUserId: string; periodEnd: string; status: string; netCents: number; paidOn: string | null };

const OPEN_DEPOSIT = new Set(["unmatched", "suggested", "partially_matched"]);
const BILL_STATUS: Record<string, string> = { draft: "Draft", received: "To approve", disputed: "Disputed", approved: "Approved, not paid", paid: "Paid" };

/**
 * The newest money movements, newest first: bank deposits (matched or waiting), vendor bills, partner and
 * producer payout runs. Each opens its own record where one exists (a bill, a run, a statement); a deposit
 * opens Bank deposits, which lists it. Void records are left out.
 */
export function recentMoney(input: {
  deposits: readonly DepositRow[] | null;
  bills: readonly Pick<InvoiceListRow, "id" | "sourceName" | "invoiceNumber" | "invoiceDate" | "totalCents" | "status" | "paidOn">[] | null;
  partnerRuns: ReadonlyArray<Pick<RunHeader, "id" | "periodEnd" | "status" | "netCents" | "paidOn" | "publishedAt"> & { partnerName: string }> | null;
  producerRuns: readonly ProducerRunRow[] | null;
  names: ReadonlyMap<string, string>;
  hrefs: { bank: string | null; bills: string | null; payouts: string | null; producerPayouts: string | null };
}, limit = 6): RecentMoney[] {
  const out: RecentMoney[] = [];
  if (input.hrefs.bank) {
    for (const d of input.deposits ?? []) {
      const open = OPEN_DEPOSIT.has(d.status);
      const matched = d.status === "matched";
      out.push({ key: `deposit-${d.id}`, kind: "deposit", on: d.postedOn, title: open ? "Deposit to match" : matched ? "Deposit matched" : "Deposit", detail: d.description || "Bank deposit", cents: d.amountCents, tone: open ? "warning" : matched ? "good" : "neutral", href: input.hrefs.bank });
    }
  }
  if (input.hrefs.bills) {
    for (const b of input.bills ?? []) {
      if (b.status === "void") continue;
      out.push({ key: `bill-${b.id}`, kind: "bill", on: b.paidOn ?? b.invoiceDate, title: `${b.sourceName} bill`, detail: `${BILL_STATUS[b.status] ?? b.status} · ${b.invoiceNumber}`, cents: -b.totalCents, tone: b.status === "paid" ? "neutral" : b.status === "disputed" ? "danger" : "warning", href: `${input.hrefs.bills}/${b.id}` });
    }
  }
  if (input.hrefs.payouts) {
    for (const r of input.partnerRuns ?? []) {
      if (r.status === "void") continue;
      out.push({ key: `prun-${r.id}`, kind: "partnerRun", on: r.paidOn ?? r.publishedAt?.slice(0, 10) ?? r.periodEnd, title: `Payout to ${r.partnerName}`, detail: r.status === "paid" ? "Paid" : r.status === "published" ? "Published, not paid" : "Draft to review", cents: -r.netCents, tone: r.status === "paid" ? "neutral" : r.status === "draft" ? "warning" : "info", href: `/app/payouts/${r.id}` });
    }
  }
  if (input.hrefs.producerPayouts) {
    for (const r of input.producerRuns ?? []) {
      if (r.status === "void") continue;
      out.push({ key: `run-${r.id}`, kind: "producerRun", on: r.paidOn ?? r.periodEnd, title: `Pay to ${input.names.get(r.producerUserId) ?? "a producer"}`, detail: r.status === "paid" ? "Paid" : r.status === "published" ? "To pay" : "Draft", cents: -r.netCents, tone: r.status === "paid" ? "neutral" : r.status === "published" ? "warning" : "info", href: `/app/producer-statements/${r.id}` });
    }
  }
  return out.sort((a, b) => b.on.localeCompare(a.on) || a.key.localeCompare(b.key)).slice(0, limit);
}

/** The P&L for one month on the agency's basis (pnlLinks' own address shape). */
export function pnlMonthHref(base: string, month: string, basis: string): string {
  return `${base}?${new URLSearchParams({ kind: "month", basis, anchor: month.slice(0, 10) })}`;
}

/* ── The read ───────────────────────────────────────────────────────────────────────────────────── */

export type AccountingViewData = {
  month: { from: string; to: string; label: string };
  basis: "accrual" | "cash";
  /** Each page's own path when the reader may open it, else null. */
  hrefs: { pnl: string | null; bank: string | null; bills: string | null; expenses: string | null; discrepancies: string | null; payouts: string | null; producerPayouts: string | null; splits: string | null };
  needs: { bank: number | null; bills: number | null; expenses: number | null; payIssues: number | null; partnerDrafts: number | null; producerToPay: number | null };
  trend: MonthPoint[] | null;
  statement: Statement | null;
  receivedCents: number | null;
  depositsCents: number | null;
  payIssuesOwedCents: number | null;
  producers: { rows: ProducerBalance[]; owedCents: number } | null;
  billsToPayCents: number | null;
  recent: RecentMoney[] | null;
};

const TREND_MONTHS = 6;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const safe = <T,>(work: () => PromiseLike<T> | T): Promise<T | null> => Promise.resolve().then(work).then((value) => value, (error: unknown) => {
  console.error("[dashboard/accounting] a read failed", error);
  return null;
});

/** Accounting's figures for this reader; null when they open none of its pages. */
export async function loadAccountingView(props: DashViewProps): Promise<AccountingViewData | null> {
  // The server-only marker, loaded with the reads (not at the top) so the pure shaping above stays testable under node.
  await import("server-only");
  // The agency's books are agency-wide: a reader narrowed to a producer scope never gets them (AG-0.5).
  if (props.scope !== null) return null;

  const open = (key: string) => firstOpenable([key], props.available, props.context.role, props.solo);
  const hrefs = {
    pnl: open("accounting.pnl"),
    bank: open("accounting.bank"),
    bills: open("accounting.invoices"),
    expenses: open("accounting.expenses"),
    discrepancies: open("book.discrepancies"),
    payouts: open("partners.payouts"),
    producerPayouts: open("team.payouts"),
    splits: open("accounting.producer_splits"),
  };
  if (!Object.values(hrefs).some(Boolean)) return null;

  const [{ getSupabaseServiceClient }, pnlCore, pnlStore, invoiceStore, payoutStore, agencyPayouts, discrepancyStore, discrepancyService, discrepancyEngine] = await Promise.all([
    import("@/lib/supabase/service"),
    import("@/lib/accounting/pnlCore"),
    import("@/lib/accounting/pnlStore"),
    import("@/lib/accounting/invoiceStore"),
    import("@/lib/accounting/payoutStore"),
    import("@/lib/agency/payoutStore"),
    import("@/lib/ingestion/discrepancyStore"),
    import("@/lib/discrepancies/service"),
    import("@/lib/ingestion/discrepancyEngine"),
  ]);
  const tenantId = props.context.tenantId;
  const db = getSupabaseServiceClient() as Loose;
  const money = !props.noMoney;

  const today = localToday(props.now, props.zone);
  const from = monthStart(today);
  const to = monthStart(today, 1);
  const months = Array.from({ length: TREND_MONTHS }, (_, index) => monthStart(today, index - (TREND_MONTHS - 1)));
  const head = async (query: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  };
  const count = (table: string) => db.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);

  const settings = hrefs.pnl && money ? await safe(() => pnlStore.reportingSettings(tenantId)) : null;
  const basis = settings?.basis ?? "accrual";

  const [bank, bills, expenses, partnerRuns, producerRuns, payIssues, trendRows, lines, received, deposits, balances, members, recentDeposits] = await Promise.all([
    hrefs.bank ? safe(() => head(count("bank_transaction").gt("amount_cents", 0).in("match_status", ["unmatched", "suggested", "partially_matched"]))) : null,
    hrefs.bills ? safe(() => invoiceStore.listInvoices(tenantId)) : null,
    hrefs.expenses ? safe(() => head(count("expense").eq("status", "unconfirmed"))) : null,
    hrefs.payouts ? safe(() => payoutStore.listRuns(tenantId)) : null,
    hrefs.producerPayouts ? safe(() => agencyPayouts.readRuns(tenantId)) : null,
    // Pay issues' "Open" and "You appear to be owed": carrier-file findings plus statements imported by hand.
    hrefs.discrepancies ? safe(async () => {
      const [carrier, hand] = await Promise.all([discrepancyStore.loadDiscrepancies(tenantId), discrepancyService.owedToYou(tenantId)]);
      const sum = discrepancyEngine.moneySummary((carrier.available ? carrier.items : []).map((item) => ({
        discrepancy_type: item.type, difference_cents: item.differenceCents, expected_amount_cents: item.expectedCents, reported_amount_cents: item.reportedCents, status: item.status,
      })));
      if (!carrier.available && !hand.available) return null;
      return { open: sum.open + (hand.available ? hand.count : 0), owedCents: sum.owedCents + (hand.available ? Math.max(0, hand.totalCents) : 0) };
    }) : null,
    hrefs.pnl && money ? safe(async () => {
      const { data, error } = await db.rpc("pnl_monthly", { p_tenant_id: tenantId, p_from: months[0], p_to: to, p_basis: basis });
      if (error) throw error;
      return ((data ?? []) as Loose[]).map((r): MonthlyRow => ({ month: String(r.month), section: String(r.section), amountCents: Number(r.amount_cents) }));
    }) : null,
    hrefs.pnl && money ? safe(async () => {
      const { data, error } = await db.rpc("pnl_lines", { p_tenant_id: tenantId, p_from: from, p_to: to, p_basis: basis });
      if (error) throw error;
      return pnlCore.statement(((data ?? []) as Loose[]).map((l) => ({ section: l.section, entryType: l.entry_type, sourceType: l.source_type, sourceId: l.source_id, sourceName: l.source_name, amountCents: Number(l.amount_cents), entries: Number(l.entries) })));
    }) : null,
    hrefs.pnl && hrefs.bank && money ? safe(async () => {
      const { data, error } = await db.rpc("pnl_received", { p_tenant_id: tenantId, p_from: from, p_to: to });
      if (error) throw error;
      return { cents: data == null ? null : Number(data) };
    }) : null,
    hrefs.bank && money ? safe(async () => {
      const { data, error } = await db.from("bank_transaction").select("amount_cents").eq("tenant_id", tenantId).gt("amount_cents", 0).gte("posted_on", from).lt("posted_on", to).limit(5000);
      if (error) throw error;
      return ((data ?? []) as Loose[]).reduce((sum: number, r) => sum + Number(r.amount_cents), 0);
    }) : null,
    hrefs.splits && money ? safe(async () => {
      const { data, error } = await db.rpc("producer_balances", { p_tenant_id: tenantId, p_producer: null });
      if (error) throw error;
      return ((data ?? []) as Loose[]).map((b): BalanceRow => ({ producerUserId: String(b.producer_user_id), balanceCents: Number(b.balance_cents) }));
    }) : null,
    hrefs.splits || hrefs.producerPayouts ? safe(async () => {
      const { data, error } = await db.from("tenant_users").select("user_id, users!inner(name, email)").eq("tenant_id", tenantId);
      if (error) throw error;
      return new Map<string, string>(((data ?? []) as Loose[]).map((m) => [String(m.user_id), (m.users?.name as string | null) ?? (m.users?.email as string | null) ?? "Unnamed"]));
    }) : null,
    hrefs.bank && money ? safe(async () => {
      const { data, error } = await db.from("bank_transaction").select("id, posted_on, amount_cents, description_raw, match_status").eq("tenant_id", tenantId).gt("amount_cents", 0).order("posted_on", { ascending: false }).order("id").limit(4);
      if (error) throw error;
      return ((data ?? []) as Loose[]).map((t): DepositRow => ({ id: String(t.id), postedOn: String(t.posted_on), amountCents: Number(t.amount_cents), description: String(t.description_raw ?? ""), status: String(t.match_status) }));
    }) : null,
  ]);

  const names = members ?? new Map<string, string>();
  const { EDITABLE } = await import("@/lib/accounting/invoicesCore");
  return {
    month: { from, to, label: monthLabel(from, true) },
    basis,
    hrefs,
    needs: {
      bank,
      bills: bills ? bills.filter((b) => EDITABLE.includes(b.status)).length : null,
      expenses,
      payIssues: payIssues?.open ?? null,
      partnerDrafts: partnerRuns ? partnerRuns.runs.filter((r) => r.status === "draft").length : null,
      producerToPay: producerRuns ? producerRuns.filter((r) => r.status === "published").length : null,
    },
    trend: trendRows ? monthlyInOut(trendRows, months) : null,
    statement: lines,
    receivedCents: received?.cents ?? null,
    depositsCents: deposits,
    payIssuesOwedCents: money ? payIssues?.owedCents ?? null : null,
    producers: balances ? { rows: producerBalances(balances, names), owedCents: owedToProducers(balances) } : null,
    billsToPayCents: bills && money ? bills.filter((b) => b.status === "approved").reduce((sum, b) => sum + b.totalCents, 0) : null,
    recent: money ? recentMoney({
      deposits: recentDeposits,
      bills: bills ? bills.slice(0, 4) : null,
      partnerRuns: partnerRuns ? partnerRuns.runs.slice(0, 3) : null,
      producerRuns: producerRuns ? producerRuns.slice(0, 3).map((r) => ({ id: r.id, producerUserId: r.producerUserId, periodEnd: r.periodEnd, status: r.status, netCents: r.netCents, paidOn: r.paidOn })) : null,
      names,
      hrefs: { bank: hrefs.bank, bills: hrefs.bills, payouts: hrefs.payouts, producerPayouts: hrefs.producerPayouts },
    }) : null,
  };
}
