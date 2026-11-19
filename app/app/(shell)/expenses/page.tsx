import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { ExpenseError, generateRecurring, listExpenses, monthScoreboard } from "@/lib/accounting/expenseStore";
import { bucketOf } from "@/lib/accounting/expensesCore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ExpenseActions, ExpenseMonthStrip, ExpensesBoard, type ExpenseView } from "@/components/app/accounting/expenses-board";
import { ExpenseScoreboard } from "@/components/app/accounting/expense-scoreboard";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Money › Expenses (LA-7.3, Notion sprint). Tools, insurance and fees; recurring ones arrive each
 * period to be OK'd. Owner and bookkeeper only.
 *
 * Round 7 (owner 2026-11-10, docs/la4/mockups-r7/accounting.html §3, 3·A): Scoreboard · To OK · All expenses ·
 * Monthly bills on the title line (`?view=scoreboard|confirm|booked|recurring`, `&month=YYYY-MM`; All expenses
 * filters by status, `&status=paid|unpaid|void`, and searches, `&q=`). The Scoreboard's strip sits on every tab,
 * for the month shown. A row opens the expense's page; `?open=<id>` (the P&L's links) lands there too. With no
 * `?view=`, To OK while a bill waits, else the Scoreboard.
 */
const VIEWS: ExpenseView[] = ["scoreboard", "confirm", "booked", "recurring"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ open?: string; view?: string; month?: string; status?: string; q?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Expenses" description="Tools, insurance and fees, so cost per policy is honest." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Expenses" detail="Only owners and bookkeepers can see what the agency spends." />;
  }
  const { open, view: asked, month: askedMonth, status, q } = await searchParams;
  if (open && UUID.test(open)) redirect(`/app/expenses/${open}`);
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const month = askedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(askedMonth) ? askedMonth : new Date().toISOString().slice(0, 7);
  const askedView = VIEWS.find((v) => v === asked);
  // Frame first (UI-CONSISTENCY §7a): the list and the month's scoreboard are read now, awaited by the blocks below.
  const read: ExpensesRead = (async () => {
    try {
      // Opening the page brings recurring templates up to today (the daily job does the same).
      if (!readOnly) await generateRecurring(tenantId);
      return { expenses: await listExpenses(tenantId), problem: null };
    } catch (error) {
      if (!(error instanceof ExpenseError)) throw error;
      return { expenses: null, problem: error.message };
    }
  })();
  const boardRead = read.then(({ expenses }) => (expenses ? monthScoreboard(tenantId, month).catch((error: unknown) => { if (error instanceof ExpenseError) return null; throw error; }) : null));
  // Until the list is read: the same tabs without counts, the one asked for underlined (with no `?view=`, the default
  // depends on whether a bill waits, so none is until then), and Add an expense.
  const tabsOf = (view: ExpenseView, counts: { unconfirmed: number; booked: number; recurring: number } | null) => (
    <ViewTabs label="Expenses" value={view} tabs={[
      { key: "scoreboard", label: "Scoreboard", href: "/app/expenses?view=scoreboard" },
      { key: "confirm", label: "To OK", count: counts?.unconfirmed ?? null, tone: "danger", href: "/app/expenses?view=confirm" },
      { key: "booked", label: "All expenses", count: counts?.booked ?? null, href: "/app/expenses?view=booked" },
      { key: "recurring", label: "Monthly bills", count: counts?.recurring ?? null, href: "/app/expenses?view=recurring" },
    ]} />
  );
  return (
    <AccountingPage
      step="expenses"
      info="Every expense is buying leads, a monthly subscription, or daily & random. A monthly bill comes back each month for you to OK; nothing is paid without you."
      tabs={<Suspense fallback={tabsOf(askedView ?? ("" as ExpenseView), null)}><ExpensesTabs read={read} asked={askedView} tabsOf={tabsOf} /></Suspense>}
      actions={<Suspense fallback={<ExpenseActions toOk={[]} view={askedView ?? "booked"} readOnly={readOnly} />}><ExpensesActions read={read} asked={askedView} readOnly={readOnly} /></Suspense>}
    >
      <StreamSection shape="strip+table">
        <ExpensesBody read={read} boardRead={boardRead} month={month} asked={askedView} readOnly={readOnly} q={q} status={status} />
      </StreamSection>
    </AccountingPage>
  );
}

type ExpensesRead = Promise<{ expenses: Awaited<ReturnType<typeof listExpenses>> | null; problem: string | null }>;
type Expenses = Awaited<ReturnType<typeof listExpenses>>;

const unconfirmedOf = (expenses: Expenses) => expenses.filter((e) => e.status === "unconfirmed");
/** With no `?view=`, To OK while a bill waits, else the Scoreboard. */
const viewOf = (asked: ExpenseView | undefined, expenses: Expenses | null) => asked ?? (expenses && unconfirmedOf(expenses).length ? "confirm" : "scoreboard");

async function ExpensesTabs({ read, asked, tabsOf }: { read: ExpensesRead; asked: ExpenseView | undefined; tabsOf: (view: ExpenseView, counts: { unconfirmed: number; booked: number; recurring: number } | null) => ReactNode }) {
  const { expenses } = await read;
  if (!expenses) return null;
  return tabsOf(viewOf(asked, expenses), {
    unconfirmed: unconfirmedOf(expenses).length,
    booked: expenses.filter((e) => e.status === "confirmed" || e.status === "void").length,
    recurring: expenses.filter((e) => e.status === "template").length,
  });
}

async function ExpensesActions({ read, asked, readOnly }: { read: ExpensesRead; asked: ExpenseView | undefined; readOnly: boolean }) {
  const { expenses } = await read;
  if (!expenses) return null;
  const toOk = unconfirmedOf(expenses).map((e) => ({ id: e.id, vendorName: e.vendorName, amountCents: e.amountCents, category: e.category, isAcquisitionCost: e.isAcquisitionCost, incurredOn: e.incurredOn }));
  return <ExpenseActions toOk={toOk} view={viewOf(asked, expenses)} readOnly={readOnly} />;
}

async function ExpensesBody({ read, boardRead, month, asked, readOnly, q, status }: { read: ExpensesRead; boardRead: Promise<Awaited<ReturnType<typeof monthScoreboard>> | null>; month: string; asked: ExpenseView | undefined; readOnly: boolean; q?: string; status?: string }) {
  const [{ expenses, problem }, board] = await Promise.all([read, boardRead]);
  if (!expenses) return <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>;
  const view = viewOf(asked, expenses);
  const subscriptionsToOk = unconfirmedOf(expenses).filter((e) => bucketOf(e.category) === "subscriptions" && e.incurredOn.startsWith(month)).reduce((s, e) => s + e.amountCents, 0);
  return (
    <>
      {board ? <ExpenseMonthStrip board={board} subscriptionsToOkCents={subscriptionsToOk} /> : null}
      {view === "scoreboard"
        ? (board ? <ExpenseScoreboard board={board} /> : <TableCard><EmptyState title="The scoreboard could not be loaded" hint="Try again in a moment." /></TableCard>)
        : <ExpensesBoard key={view} expenses={expenses} view={view} readOnly={readOnly} initialQuery={q ?? ""} initialStatus={status ?? "all"} />}
    </>
  );
}
