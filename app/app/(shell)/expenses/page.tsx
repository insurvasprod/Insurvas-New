import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { ExpenseError, generateRecurring, listExpenses, monthScoreboard } from "@/lib/accounting/expenseStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ExpenseActions, ExpensesBoard, type ExpenseView } from "@/components/app/accounting/expenses-board";
import { ExpenseScoreboard } from "@/components/app/accounting/expense-scoreboard";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Money › Expenses (LA-7.3, Notion sprint). Tools, insurance and fees; recurring ones arrive each
 * period to be confirmed. Owner and bookkeeper only.
 *
 * Foundation pass (2026-11-03): the step's tabs sit on the title line (`?view=`). `?open=<id>` (a P&L
 * drill-through) opens the tab that holds it.
 *
 * Expenses tracker (owner, 2026-11-06): Scoreboard · To OK · Paid · Monthly bills. With no `?view=`, To OK
 * while a monthly bill waits, else the Scoreboard (`&month=YYYY-MM`, this month by default): what the month
 * cost in total and per bucket — leads (vendor bills included), subscriptions, daily & random.
 */
const VIEWS: ExpenseView[] = ["scoreboard", "confirm", "booked", "recurring"];

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ open?: string; view?: string; month?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Expenses" description="Tools, insurance and fees, so cost per policy is honest." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Expenses" detail="Only owners and bookkeepers can see what the agency spends." />;
  }
  const { open, view: asked, month: askedMonth } = await searchParams;
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
  const target = open ? expenses?.find((e) => e.id === open) : undefined;
  const view: ExpenseView = VIEWS.find((v) => v === asked)
    ?? (target ? (target.status === "unconfirmed" ? "confirm" : target.status === "template" ? "recurring" : "booked") : unconfirmed.length ? "confirm" : "scoreboard");
  const board = expenses && view === "scoreboard" ? await monthScoreboard(tenantId, month).catch((error: unknown) => { if (error instanceof ExpenseError) return null; throw error; }) : null;
  const tabs = expenses ? (
    <ViewTabs label="Expenses" value={view} tabs={[
      { key: "scoreboard", label: "Scoreboard", href: "/app/expenses?view=scoreboard" },
      { key: "confirm", label: "To OK", count: unconfirmed.length, tone: "danger", href: "/app/expenses?view=confirm" },
      { key: "booked", label: "Paid", href: "/app/expenses?view=booked" },
      { key: "recurring", label: "Monthly bills", count: expenses.filter((e) => e.status === "template").length, href: "/app/expenses?view=recurring" },
    ]} />
  ) : undefined;
  return (
    <AccountingPage
      step="expenses"
      info="Every expense goes into one of three buckets: buying leads, monthly subscriptions, or daily & random. A monthly bill comes back each month as a to-do; OK books it and marks it paid, and nothing is paid without you. The Scoreboard shows what each month cost, with lead invoices from Vendor bills counted under Leads. Acquisition costs divide into cost per policy; overhead does not."
      tabs={tabs}
      actions={expenses ? <ExpenseActions unconfirmedIds={unconfirmed.map((e) => e.id)} view={view} readOnly={readOnly} /> : undefined}
    >
      {!expenses ? <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>
        : view === "scoreboard" ? (board ? <ExpenseScoreboard board={board} /> : <TableCard><EmptyState title="The scoreboard could not be loaded" hint="Try again in a moment." /></TableCard>)
        : <ExpensesBoard key={view} expenses={expenses} view={view} readOnly={readOnly} openId={open ?? null} />}
    </AccountingPage>
  );
}
