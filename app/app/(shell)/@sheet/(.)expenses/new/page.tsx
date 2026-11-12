import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { acquisitionDefaults, ExpenseError } from "@/lib/accounting/expenseStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ExpenseDraftProvider, ExpenseForm, ExpenseFormActions } from "@/components/app/accounting/expenses-board";
import { RouteSheet } from "@/components/app/route-sheet";
import { EmptyState } from "@/components/ui/page-states";

/**
 * Add an expense, opened from inside the app: a panel from the right (route-sheet.tsx); the same gate as its page. The
 * page's title-line Save and Discard sit in the panel's footer.
 */
export default async function NewExpenseSheet() {
  const title = "Add an expense";
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <RouteSheet title={title} wide><FeatureGateNotice guard={guard} featureLabel="Expenses" description="Tools, insurance and fees, so cost per policy is honest." /></RouteSheet>;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RouteSheet title={title} wide><RoleGateNotice featureLabel="Expenses" detail="Only owners and bookkeepers can see what the agency spends." /></RouteSheet>;
  if (guard.entitlement.access === "read_only") return <RouteSheet title={title} wide><RoleGateNotice featureLabel="Expenses" detail="This plan is read-only here: expenses can be seen, not added." /></RouteSheet>;
  let defaults: Awaited<ReturnType<typeof acquisitionDefaults>> | null = null;
  let problem: string | null = null;
  try {
    defaults = await acquisitionDefaults(guard.context.tenantId);
  } catch (error) {
    if (!(error instanceof ExpenseError)) throw error;
    problem = error.message;
  }
  return (
    <ExpenseDraftProvider>
      <RouteSheet title={title} wide footer={defaults ? <div className="ml-auto flex items-center gap-2"><ExpenseFormActions /></div> : undefined}>
        {defaults ? <ExpenseForm defaults={defaults} /> : <EmptyState title="Not switched on yet" hint={problem ?? ""} />}
      </RouteSheet>
    </ExpenseDraftProvider>
  );
}
