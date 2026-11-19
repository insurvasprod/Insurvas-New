import { Suspense } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { acquisitionDefaults, ExpenseError } from "@/lib/accounting/expenseStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ExpenseDraftProvider, ExpenseForm, ExpenseFormActions } from "@/components/app/accounting/expenses-board";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";

/**
 * Accounting › Expenses › Add an expense (round 7, board 3·3): four numbered questions, nothing hidden; Save
 * ("Set up monthly bill" / "Add expense") and Discard on the title line. A one-off is booked as it is saved; a
 * monthly one comes back each month to be OK'd. Owner and bookkeeper, never read-only.
 */
export default async function NewExpensePage() {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Expenses" description="Tools, insurance and fees, so cost per policy is honest." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Expenses" detail="Only owners and bookkeepers can see what the agency spends." />;
  if (guard.entitlement.access === "read_only") return <RoleGateNotice featureLabel="Expenses" detail="This plan is read-only here: expenses can be seen, not added." />;
  // Frame first (UI-CONSISTENCY §7a): the title line and its Save draw at once; the form fills in as one block.
  const read: DefaultsRead = acquisitionDefaults(guard.context.tenantId).then(
    (defaults) => ({ defaults, problem: null }),
    (error: unknown) => {
      if (!(error instanceof ExpenseError)) throw error;
      return { defaults: null, problem: error.message };
    },
  );
  return (
    <ExpenseDraftProvider>
      <AccountingPage step="expenses" title="Add an expense" actions={<Suspense fallback={<ExpenseFormActions />}><FormActions read={read} /></Suspense>}>
        <StreamSection shape="form" rows={6}><NewExpenseForm read={read} /></StreamSection>
      </AccountingPage>
    </ExpenseDraftProvider>
  );
}

type DefaultsRead = Promise<{ defaults: Awaited<ReturnType<typeof acquisitionDefaults>> | null; problem: string | null }>;

async function FormActions({ read }: { read: DefaultsRead }) {
  const { defaults } = await read;
  return defaults ? <ExpenseFormActions /> : null;
}

async function NewExpenseForm({ read }: { read: DefaultsRead }) {
  const { defaults, problem } = await read;
  return defaults ? <ExpenseForm defaults={defaults} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>;
}
