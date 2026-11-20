import { firstOpenable } from "../roleHome.ts";
import { dayIn, loadBookView, monthKeys, monthLabel, type MonthPoint } from "./book.ts";
import type { DashViewProps } from "@/components/app/home/views/view-props";

/**
 * The Ledger plan's Home (owner 2026-11-19: "exactly how we implemented it for the agency dashboard"). Ledger is the
 * $99 no-CRM plan (Notion, Individual Agent §6.5): the book, carrier statements, discrepancies and the commission
 * ledger. So its Home is the agency dashboard's frame with the money of one agent's book in it:
 *
 *   strip   Commission this month · Owed to you · Chargebacks · In force · Statements to review
 *   main    Commission by month (chargebacks beside it) · Premium by carrier · Where the book stands
 *   right   the commission card · Owed to you · Recent activity
 *
 * Every figure is the one its own page reads, and opens that page.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

export type LedgerEntry = { entryType: string; amountCents: number; on: string; carrierId: string; policyNumber: string };

/** Money in (advances, earned, reversals of a chargeback) and taken back (chargebacks), by month. */
export function commissionByMonth(entries: readonly LedgerEntry[], keys: readonly string[]): { received: MonthPoint[]; chargebacks: MonthPoint[] } {
  const inBy = new Map(keys.map((key) => [key, 0]));
  const backBy = new Map(keys.map((key) => [key, 0]));
  for (const entry of entries) {
    const key = entry.on.slice(0, 7);
    if (!inBy.has(key)) continue;
    if (entry.entryType === "chargeback" || entry.amountCents < 0) backBy.set(key, (backBy.get(key) ?? 0) + Math.abs(entry.amountCents));
    else inBy.set(key, (inBy.get(key) ?? 0) + entry.amountCents);
  }
  const points = (by: Map<string, number>) => keys.map((key) => ({ key, label: monthLabel(key), value: Math.round((by.get(key) ?? 0) / 100) }));
  return { received: points(inBy), chargebacks: points(backBy) };
}

export type LedgerStatement = { id: string; filename: string; carrierName: string | null; status: string; periodEnd: string | null; uploadedAt: string };

export type LedgerHomeData = Awaited<ReturnType<typeof loadLedgerHome>>;

export async function loadLedgerHome(props: DashViewProps) {
  const [{ getSupabaseServiceClient }, { owedToYou }] = await Promise.all([import("@/lib/supabase/service"), import("@/lib/discrepancies/service")]);
  const { context, available, solo, zone, now, gate } = props;
  const { tenantId, role } = context;
  const db = (): Loose => getSupabaseServiceClient();
  const open = (key: string) => firstOpenable([key], available, role, solo, gate);
  const links = {
    ledger: open("book.ledger"),
    statements: open("book.statements"),
    discrepancies: open("book.discrepancies"),
    policies: open("book.policies"),
    files: open("book.carrier_files"),
    appointments: open("book.appointments"),
    scorecards: open("insight.book-scorecards"),
  };
  const today = dayIn(zone, now);
  const keys = monthKeys(today, 12);
  const safe = <T,>(promise: PromiseLike<T>): Promise<T | null> => Promise.resolve(promise).catch((error) => {
    console.error("[dashboard:ledger]", error);
    return null;
  });

  const [book, entryRows, lineRows, owed, statementRows] = await Promise.all([
    loadBookView(props),
    // Two sources of money, as the Commission Ledger page has: carrier commission files (commission_entry) and the
    // statement lines the agent accepted on Commissions › Statements.
    links.ledger ? safe(db().from("commission_entry").select("entry_type, amount_cents, statement_date, transaction_date, carrier_id, policy_number").eq("tenant_id", tenantId).gte("statement_date", `${keys[0]}-01`).order("statement_date").limit(20000)) : null,
    links.statements ? safe(db().from("tenant_commission_statement_lines").select("kind, amount_cents, line_date, policy_number").eq("tenant_id", tenantId).eq("review_status", "accepted").gte("line_date", `${keys[0]}-01`).order("line_date").limit(20000)) : null,
    links.discrepancies ? safe(owedToYou(tenantId)) : null,
    links.statements ? safe(db().from("tenant_commission_statements").select("id, original_filename, status, period_end, uploaded_at, carrier_id, carriers(name)").eq("tenant_id", tenantId).neq("status", "voided").order("uploaded_at", { ascending: false }).limit(200)) : null,
  ]);

  const fileEntries: LedgerEntry[] | null = entryRows && !(entryRows as Loose).error
    ? (((entryRows as Loose).data ?? []) as Loose[]).map((row) => ({ entryType: row.entry_type, amountCents: Number(row.amount_cents), on: String(row.statement_date ?? row.transaction_date ?? ""), carrierId: row.carrier_id, policyNumber: row.policy_number }))
    : null;
  const lineEntries: LedgerEntry[] | null = lineRows && !(lineRows as Loose).error
    ? (((lineRows as Loose).data ?? []) as Loose[]).map((row) => ({ entryType: row.kind ?? "", amountCents: Number(row.amount_cents), on: String(row.line_date ?? ""), carrierId: "", policyNumber: row.policy_number }))
    : null;
  const entries: LedgerEntry[] | null = fileEntries || lineEntries ? [...(fileEntries ?? []), ...(lineEntries ?? [])] : null;
  const byMonth = entries ? commissionByMonth(entries, keys) : null;

  const allStatements: LedgerStatement[] | null = statementRows && !(statementRows as Loose).error
    ? (((statementRows as Loose).data ?? []) as Loose[]).map((row) => ({ id: row.id, filename: row.original_filename, carrierName: row.carriers?.name ?? null, status: row.status, periodEnd: row.period_end, uploadedAt: row.uploaded_at }))
    : null;

  return {
    links,
    today,
    month: keys[keys.length - 1],
    previous: keys[keys.length - 2],
    book,
    entries,
    byMonth,
    owed: owed && owed.available ? owed : null,
    statements: allStatements ? { recent: allStatements.slice(0, 8), total: allStatements.length, toReview: allStatements.filter((row) => row.status === "review").length } : null,
  };
}
