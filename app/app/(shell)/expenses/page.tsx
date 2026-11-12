import { redirect } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { ExpenseError, generateRecurring, listExpenses, monthScoreboard } from "@/lib/accounting/expenseStore";
import { bucketOf } from "@/lib/accounting/expensesCore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ExpenseActions, ExpenseMonthStrip, ExpensesBoard, type ExpenseView } from "@/components/app/accounting/expenses-board";
import { ExpenseScoreboard } from "@/components/app/accounting/expense-scoreboard";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { EmptyState } from "@/components/ui/page-states";
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
  let expenses: Awaited<ReturnType<typeof listExpenses>> | null = null;
  let problem: string | null = null;
  try {
    // Opening the page brings recurring templates up to today (the daily job does the same).
    if (!readOnly) await generateRecurring(tenantId);
    expenses = await listExpenses(tenantId);
  } catch (error) {
    if (!(error instanceof ExpenseError)) throw error;
    problem = error.message;
  }
  const unconfirmed = expenses?.filter((e) => e.status === "unconfirmed") ?? [];
  const view: ExpenseView = VIEWS.find((v) => v === asked) ?? (unconfirmed.length ? "confirm" : "scoreboard");
  const board = expenses ? await monthScoreboard(tenantId, month).catch((error: unknown) => { if (error instanceof ExpenseError) return null; throw error; }) : null;
  const subscriptionsToOk = unconfirmed.filter((e) => bucketOf(e.category) === "subscriptions" && e.incurredOn.startsWith(month)).reduce((s, e) => s + e.amountCents, 0);
  const booked = expenses?.filter((e) => e.status === "confirmed" || e.status === "void").length ?? 0;
  const tabs = expenses ? (
    <ViewTabs label="Expenses" value={view} tabs={[
      { key: "scoreboard", label: "Scoreboard", href: "/app/expenses?view=scoreboard" },
      { key: "confirm", label: "To OK", count: unconfirmed.length, tone: "danger", href: "/app/expenses?view=confirm" },
      { key: "booked", label: "All expenses", count: booked, href: "/app/expenses?view=booked" },
      { key: "recurring", label: "Monthly bills", count: expenses.filter((e) => e.status === "template").length, href: "/app/expenses?view=recurring" },
    ]} />
  ) : undefined;
  const toOk = unconfirmed.map((e) => ({ id: e.id, vendorName: e.vendorName, amountCents: e.amountCents, category: e.category, isAcquisitionCost: e.isAcquisitionCost, incurredOn: e.incurredOn }));
  return (
    <AccountingPage
      step="expenses"
      info="Every expense is buying leads, a monthly subscription, or daily & random. A monthly bill comes back each month for you to OK; nothing is paid without you."
      tabs={tabs}
      actions={expenses ? <ExpenseActions toOk={toOk} view={view} readOnly={readOnly} /> : undefined}
    >
      {!expenses ? <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard> : (
        <>
          {board ? <ExpenseMonthStrip board={board} subscriptionsToOkCents={subscriptionsToOk} /> : null}
          {view === "scoreboard"
            ? (board ? <ExpenseScoreboard board={board} /> : <TableCard><EmptyState title="The scoreboard could not be loaded" hint="Try again in a moment." /></TableCard>)
            : <ExpensesBoard key={view} expenses={expenses} view={view} readOnly={readOnly} initialQuery={q ?? ""} initialStatus={status ?? "all"} />}
        </>
      )}
    </AccountingPage>
  );
}
