import "server-only";

import { dayMonth, dayMonthYear, MONTHS } from "@/lib/format/dates";
import { formatCentsAsCurrency } from "@/lib/money";
import { matchQueue, paymentResults } from "./bankStore";
import { listInvoices } from "./invoiceStore";
import { listExpenses } from "./expenseStore";
import { listRuns } from "./payoutStore";
import { contractors } from "./taxStore";
import { bucketOf, EXPENSE_BUCKET_COPY } from "./expensesCore";
import { billItems, depositItems, expenseItems, orderTodo, paymentItems, payoutItems, taxItems, type TodoGroup, type TodoItem } from "./todoCore";

/** Which groups this person may see: the gates of the pages the rows open. */
export type TodoAccess = Record<TodoGroup, boolean>;

const monthOf = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const periodLabel = (start: string | null, end: string | null) => (start && end ? `${dayMonth(start)} – ${dayMonthYear(end)}` : null);

/**
 * Everything waiting in Accounting (round 7, To do). Each source stands alone: one that fails (a table not
 * switched on yet, a read error) leaves its rows out instead of failing the page; `failed` names them.
 */
export async function loadTodo(tenantId: string, access: TodoAccess, today = new Date()): Promise<{ items: TodoItem[]; failed: TodoGroup[] }> {
  const iso = today.toISOString().slice(0, 10);
  const since = new Date(today.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  const year = today.getUTCFullYear();
  const failed: TodoGroup[] = [];
  const guard = <T,>(group: TodoGroup, run: () => Promise<T[]>): Promise<T[]> =>
    access[group] ? run().catch(() => { if (!failed.includes(group)) failed.push(group); return []; }) : Promise.resolve([]);

  const [payments, deposits, bills, expenses, payouts, tax] = await Promise.all([
    guard("bank", async () => {
      const { rows } = await paymentResults(tenantId, { since, today: iso });
      return paymentItems(rows.map((r) => ({
        id: r.id, carrierName: r.carrierName, statementDate: r.statementDate, statementLabel: dayMonthYear(r.statementDate), verdict: r.verdict,
        shortCents: r.shortCents, missingCents: r.missingCents, shortPolicies: r.policies.filter((p) => p.state === "short").length, dueBy: r.dueBy, dueByLabel: dayMonth(r.dueBy),
      })));
    }),
    guard("bank", async () => depositItems((await matchQueue(tenantId, "open")).map((r) => {
      const open = r.matches.find((m) => !m.confirmed) ?? null;
      return { id: r.id, postedOn: r.postedOn, amountCents: r.amountCents, descriptionRaw: r.descriptionRaw, status: r.status, suggestedFor: open ? `${open.carrierName} ${dayMonth(open.statementDate)}` : null };
    }))),
    guard("bills", async () => billItems((await listInvoices(tenantId, { status: "open" })).map((r) => ({
      id: r.id, sourceName: r.sourceName, invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate, dueDate: r.dueDate, dueLabel: r.dueDate ? dayMonth(r.dueDate) : null,
      totalCents: r.totalCents, status: r.status, flagged: r.flagged, differenceCents: r.differenceCents, periodLabel: periodLabel(r.periodStart, r.periodEnd),
    })), formatCentsAsCurrency)),
    guard("expenses", async () => expenseItems((await listExpenses(tenantId)).filter((r) => r.status === "unconfirmed").map((r) => ({
      id: r.id, name: r.vendorName, bucketLabel: EXPENSE_BUCKET_COPY[bucketOf(r.category)].short, monthLabel: monthOf(r.incurredOn), amountCents: r.amountCents, incurredOn: r.incurredOn,
    })))),
    // A $0 draft is nothing to review (Partner payouts' To review, 2026-11-09).
    guard("payouts", async () => payoutItems((await listRuns(tenantId)).runs.filter((r) => r.status === "draft" && r.netCents !== 0).map((r) => ({ netCents: r.netCents, createdOn: r.periodEnd })))),
    guard("tax", async () => taxItems((await contractors(tenantId, year)).rows, year)),
  ]);
  return { items: orderTodo([...payments, ...deposits, ...bills, ...expenses, ...payouts, ...tax]), failed };
}
