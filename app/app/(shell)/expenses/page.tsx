import { guardPage } from "@/lib/entitlements/guardPage";
import { acquisitionDefaults, ExpenseError, generateRecurring, listExpenses } from "@/lib/accounting/expenseStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ExpensesBoard } from "@/components/app/accounting/expenses-board";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Money › Expenses (LA-7.3, Notion sprint). Tools, insurance and fees; recurring ones arrive each
 * period to be confirmed. Owner and bookkeeper only.
 */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Expenses" description="Tools, insurance and fees, so cost per policy is honest." />;
  }
  if (!["owner", "bookkeeper"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Expenses" detail="Only owners and bookkeepers can see what the agency spends." />;
  }
  const { open } = await searchParams;
  const tenantId = guard.context.tenantId;
  let loaded: { expenses: Awaited<ReturnType<typeof listExpenses>>; defaults: Awaited<ReturnType<typeof acquisitionDefaults>> } | null = null;
  let problem: string | null = null;
  try {
    // Opening the page brings recurring templates up to today (the daily job does the same).
    if (guard.entitlement.access !== "read_only") await generateRecurring(tenantId);
    const [expenses, defaults] = await Promise.all([listExpenses(tenantId), acquisitionDefaults(tenantId)]);
    loaded = { expenses, defaults };
  } catch (error) {
    if (!(error instanceof ExpenseError)) throw error;
    problem = error.message;
  }
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Expenses" description="Everything you spend that is not a lead." />
      {loaded ? <ExpensesBoard expenses={loaded.expenses} defaults={loaded.defaults} readOnly={guard.entitlement.access === "read_only"} openId={open ?? null} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </div>
  );
}
