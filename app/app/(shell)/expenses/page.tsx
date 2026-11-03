import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { ExpenseError, generateRecurring, listExpenses } from "@/lib/accounting/expenseStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ExpenseActions, ExpensesBoard, type ExpenseView } from "@/components/app/accounting/expenses-board";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Money › Expenses (LA-7.3, Notion sprint). Tools, insurance and fees; recurring ones arrive each
 * period to be confirmed. Owner and bookkeeper only.
 *
 * Foundation pass (2026-11-03): To confirm · Booked · Recurring are the step's tabs on the title line
 * (`?view=`; with none, To confirm while anything waits, else Booked). `?open=<id>` (a P&L drill-through)
 * opens the tab that holds it.
 */
const VIEWS: ExpenseView[] = ["confirm", "booked", "recurring"];

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ open?: string; view?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Expenses" description="Tools, insurance and fees, so cost per policy is honest." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Expenses" detail="Only owners and bookkeepers can see what the agency spends." />;
  }
  const { open, view: asked } = await searchParams;
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
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
    ?? (target ? (target.status === "unconfirmed" ? "confirm" : target.status === "template" ? "recurring" : "booked") : unconfirmed.length ? "confirm" : "booked");
  const tabs = expenses ? (
    <ViewTabs label="Expenses" value={view} tabs={[
      { key: "confirm", label: "To confirm", count: unconfirmed.length, tone: "danger", href: "/app/expenses?view=confirm" },
      { key: "booked", label: "Booked", href: "/app/expenses?view=booked" },
      { key: "recurring", label: "Recurring", count: expenses.filter((e) => e.status === "template").length, href: "/app/expenses?view=recurring" },
    ]} />
  ) : undefined;
  return (
    <AccountingPage
      step="expenses"
      info="Everything the agency spends that is not a lead. Recurring expenses arrive each period unconfirmed and book nothing until someone confirms them. Acquisition costs divide into cost per policy; overhead does not."
      lead={tabs}
      actions={expenses ? <ExpenseActions unconfirmedIds={unconfirmed.map((e) => e.id)} view={view} readOnly={readOnly} /> : undefined}
    >
      {expenses ? <ExpensesBoard key={view} expenses={expenses} view={view} readOnly={readOnly} openId={open ?? null} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </AccountingPage>
  );
}
