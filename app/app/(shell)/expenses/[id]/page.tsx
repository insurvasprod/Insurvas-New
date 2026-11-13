import Link from "next/link";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { acquisitionDefaults, ExpenseError, listExpenses, type ExpenseRow } from "@/lib/accounting/expenseStore";
import {
  EXPENSE_BUCKET_COPY,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_LISTS,
  bucketOf,
  expenseFor,
  expenseHref,
  expenseShortName,
  expenseState,
  expenseTitle,
  homeListOf,
  inExpenseList,
  monthName,
  shiftMonth,
  shortDate,
  type ExpenseList,
} from "@/lib/accounting/expensesCore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ExpenseFacts, ExpenseRecordActions } from "@/components/app/accounting/expenses-board";
import { ExpenseReceipt } from "@/components/app/accounting/expense-record";
import { RecordStepper, neighboursOf } from "@/components/app/accounting/record-stepper";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { ClickRow } from "@/components/app/book/policy/click-row";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { formatCentsAsCurrency } from "@/lib/money";

/**
 * Accounting › Expenses › one expense (round 7, owner 2026-11-10, docs/la4/mockups-r7/accounting.html board 3·2).
 * The title alone ("CloseRight CRM · November 2026"); Details · Months (a monthly bill's copies) · Receipt on the
 * title line; ‹ › name the neighbours in the list it was opened from (`?from=`); the strip (Amount · Bucket ·
 * Counts as · Status · In the P&L); Details is a table of facts, each row opening its pop-up. The primary follows
 * the status: OK it, Mark paid, or none. Owner and bookkeeper; a read-only plan sees it all and changes nothing.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Tab = "details" | "months" | "receipt";
const money = (cents: number) => formatCentsAsCurrency(cents);

function stateChip(e: ExpenseRow) {
  const state = expenseState(e);
  if (state === "waiting") return <StatusChip tone="warning">Waiting for OK</StatusChip>;
  if (state === "unpaid") return <StatusChip tone="warning">Booked, unpaid</StatusChip>;
  if (state === "paid") return <StatusChip tone="good">Paid {shortDate(e.paidOn!)}</StatusChip>;
  if (state === "void") return <StatusChip tone="neutral">Void</StatusChip>;
  return <StatusChip tone="neutral">Monthly bill</StatusChip>;
}

export default async function ExpensePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; from?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Expenses" description="Tools, insurance and fees, so cost per policy is honest." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Expenses" detail="Only owners and bookkeepers can see what the agency spends." />;
  const [{ id }, { tab: askedTab, from: askedFrom }] = await Promise.all([params, searchParams]);
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  let expenses: ExpenseRow[] | null = null;
  let defaults: Awaited<ReturnType<typeof acquisitionDefaults>> | null = null;
  let problem: string | null = null;
  try {
    [expenses, defaults] = await Promise.all([listExpenses(tenantId), acquisitionDefaults(tenantId)]);
  } catch (error) {
    if (!(error instanceof ExpenseError)) throw error;
    problem = error.message;
  }
  const row = UUID.test(id) ? expenses?.find((e) => e.id === id) ?? null : null;
  if (!expenses || !defaults || !row) {
    return (
      <AccountingPage step="expenses" title="Expense">
        <TableCard><EmptyState title={problem ? "Not switched on yet" : "That expense isn't in this agency"} hint={problem ?? "It may have been opened from an old link."} action={<Link className="text-sm font-medium text-[var(--accent-ink)] hover:underline" href="/app/expenses">All expenses</Link>} /></TableCard>
      </AccountingPage>
    );
  }

  const state = expenseState(row);
  const from: ExpenseList = (EXPENSE_LISTS as readonly string[]).includes(askedFrom ?? "") ? (askedFrom as ExpenseList) : homeListOf(row);
  // ‹ › walk the list the expense was opened from, in its order (newest first, as the list shows it).
  const parentId = from === "months" ? row.parentExpenseId : null;
  const list = expenses.filter((e) => inExpenseList(e, from, parentId));
  const { previous, next } = neighboursOf(list, row.id, (e) => e.id);
  const template = row.parentExpenseId ? expenses.find((e) => e.id === row.parentExpenseId) ?? null : null;
  const copies = expenses.filter((e) => e.parentExpenseId === (row.status === "template" ? row.id : row.parentExpenseId ?? "—"));
  const monthly = row.status === "template" || row.parentExpenseId !== null;
  const needsReceipt = state === "waiting" || state === "unpaid" || state === "paid";
  const missing = needsReceipt && !row.hasReceipt ? 1 : 0;
  const tab: Tab = askedTab === "months" && monthly ? "months" : askedTab === "receipt" && state !== "template" ? "receipt" : "details";
  const at = (t: Tab) => expenseHref(row.id, from, t === "details" ? undefined : t);
  const tabs = (
    <ViewTabs label="Expense" value={tab} tabs={[
      { key: "details", label: "Details", href: at("details") },
      ...(monthly ? [{ key: "months" as const, label: "Months", count: copies.length, href: at("months") }] : []),
      ...(state !== "template" ? [{ key: "receipt" as const, label: "Receipt", count: missing || null, tone: "danger" as const, href: at("receipt") }] : []),
    ]} />
  );

  // The strip: Amount · Bucket · Counts as · Status · In the P&L.
  const bucket = bucketOf(row.category);
  const detail = EXPENSE_CATEGORY_LABELS[row.category];
  const month = row.incurredOn.slice(0, 7);
  const pnlHref = `/app/pnl?kind=month&anchor=${month}&basis=accrual`;
  const before = row.parentExpenseId ? copies.find((e) => e.incurredOn.startsWith(shiftMonth(month, -1)) && e.status !== "void") ?? null : null;
  const priorName = monthName(shiftMonth(month, -1)).split(" ")[0];
  const amountNote = row.status === "template" ? "a month"
    : before ? (before.amountCents === row.amountCents ? `same as ${priorName}` : `${money(Math.abs(row.amountCents - before.amountCents))} ${row.amountCents > before.amountCents ? "more" : "less"} than ${priorName}`)
    : expenseFor(row);
  const bucketHref = bucket === "leads" ? "/app/vendor-bills" : bucket === "subscriptions" ? "/app/expenses?view=recurring" : "/app/expenses?view=booked";
  const inPnl = state === "waiting" ? { value: "Not yet", note: `OK books it in ${monthName(month).split(" ")[0]}` }
    : state === "template" ? { value: "Each copy", note: "once you OK it" }
    : state === "void" ? { value: "Reversed", note: `in ${monthName(month)}` }
    : { value: `Booked · ${monthName(month).slice(0, 3)}`, note: row.isAcquisitionCost ? "in cost per policy" : "net profit only" };
  const statusNote = state === "waiting" ? (row.createdAt ? `came back ${shortDate(row.createdAt)}` : "came back this month")
    : state === "paid" ? (row.paymentReference ? `ref ${row.paymentReference}` : "paid")
    : state === "unpaid" ? "booked, not paid yet"
    : state === "void" ? (row.voidReason ?? "voided")
    : row.recurrenceEndOn ? `until ${shortDate(row.recurrenceEndOn)}` : "no end";

  const thisYear = new Date().getUTCFullYear();
  const stepper = (
    <RecordStepper noun="expense"
      previous={previous ? { href: expenseHref(previous.id, from), label: expenseShortName(previous, thisYear) } : null}
      next={next ? { href: expenseHref(next.id, from), label: expenseShortName(next, thisYear) } : null} />
  );
  const actions = <ExpenseRecordActions row={row} readOnly={readOnly} receiptHref={at("receipt")} />;

  return (
    <AccountingPage step="expenses" title={expenseTitle(row, thisYear)} tabs={tabs} stepper={stepper} actions={actions}>
      <StatStrip label={`${row.vendorName} at a glance`}>
        <StatTile label="Amount" value={money(row.amountCents)} footnote={amountNote} href={state === "paid" || state === "unpaid" ? pnlHref : undefined} />
        <StatTile label="Bucket" valueSize="text" value={EXPENSE_BUCKET_COPY[bucket].short} footnote={detail} href={bucketHref} />
        <StatTile label="Counts as" valueSize="text" value={row.isAcquisitionCost ? "Acquisition" : "Overhead"} footnote={row.acquisitionOverridden ? "your choice for this one" : "the category default"} href="/app/accounting-settings" />
        <StatTile label="Status" valueSize="text" value={stateChip(row)} footnote={statusNote} href={state === "waiting" ? "/app/expenses?view=confirm" : state === "template" ? "/app/expenses?view=recurring" : `/app/expenses?view=booked&status=${state}`} />
        <StatTile label="In the P&L" valueSize="text" value={inPnl.value} footnote={inPnl.note} href={state === "template" ? undefined : pnlHref} />
      </StatStrip>
      {tab === "details" ? (
        <ExpenseFacts row={row} defaults={defaults} readOnly={readOnly} pnlHref={state === "template" ? null : pnlHref}
          template={template ? { href: expenseHref(template.id, "recurring"), name: template.vendorName } : null} />
      ) : tab === "months" ? (
        <TableCard footer={<span>{copies.length} month{copies.length === 1 ? "" : "s"} · {money(copies.filter((e) => e.status === "confirmed").reduce((s, e) => s + e.amountCents, 0))} booked</span>}>
          {copies.length === 0 ? <EmptyState title="No months yet" hint="Each month a copy comes back for you to OK." /> : (
            <table className="portal-lead-table w-full min-w-160 text-left text-sm">
              <thead><tr><th>Month</th><th className="text-right">Amount</th><th>Status</th><th>Receipt</th><th><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {copies.map((e) => (
                  <ClickRow key={e.id} href={expenseHref(e.id, "months")} label={`Open ${monthName(e.incurredOn)}`} className={e.id === row.id ? "bg-[var(--surface-alt)]" : undefined}>
                    <td className="whitespace-nowrap font-medium text-foreground">{monthName(e.incurredOn)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{money(e.amountCents)}</td>
                    <td>{stateChip(e)}</td>
                    <td className="whitespace-nowrap">{e.hasReceipt ? "Attached" : e.status === "void" ? <span className="text-muted-foreground">—</span> : "Missing"}</td>
                  </ClickRow>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : (
        <ExpenseReceipt id={row.id} documentName={row.documentName} hasReceipt={row.hasReceipt}
          canAttach={!readOnly && state !== "void"} reason={readOnly ? "This plan is read-only here: the receipt can be opened, not replaced." : state === "void" ? "A void expense keeps the receipt it had." : null} />
      )}
    </AccountingPage>
  );
}
