import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { acquisitionDefaults, ExpenseError } from "@/lib/accounting/expenseStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ExpenseForm } from "@/components/app/accounting/expenses-board";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Accounting › Expenses › Add an expense (foundation pass 2026-11-03; was a pop-up). A one-off is booked as
 * it is saved; a recurring one arrives each period to be confirmed. Owner and bookkeeper, never read-only.
 */
export default async function NewExpensePage() {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Expenses" description="Tools, insurance and fees, so cost per policy is honest." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Expenses" detail="Only owners and bookkeepers can see what the agency spends." />;
  if (guard.entitlement.access === "read_only") return <RoleGateNotice featureLabel="Expenses" detail="This plan is read-only here: expenses can be seen, not added." />;
  let defaults: Awaited<ReturnType<typeof acquisitionDefaults>> | null = null;
  let problem: string | null = null;
  try {
    defaults = await acquisitionDefaults(guard.context.tenantId);
  } catch (error) {
    if (!(error instanceof ExpenseError)) throw error;
    problem = error.message;
  }
  return (
    <AccountingPage step="expenses" title="Add an expense">
      {defaults ? <ExpenseForm defaults={defaults} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </AccountingPage>
  );
}
