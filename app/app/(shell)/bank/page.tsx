import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { BankError, findings, listAccounts, matchQueue, openStatements } from "@/lib/accounting/bankStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { BankBoard, type BankData } from "@/components/app/accounting/bank-board";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Money › Bank deposits (LA-7.6, Notion sprint). What actually landed in the bank, matched by a
 * person to what the carriers said they paid. Owner and bookkeeper only.
 */
export default async function BankPage() {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Bank deposits" description="What actually landed in the bank." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Bank deposits" detail="Only owners and bookkeepers can see the agency's bank lines." />;
  }
  const tenantId = guard.context.tenantId;
  let data: BankData | null = null;
  let problem: string | null = null;
  try {
    const [accounts, queue, statements, found] = await Promise.all([listAccounts(tenantId), matchQueue(tenantId), openStatements(tenantId), findings(tenantId)]);
    data = { accounts, queue, statements, findings: found };
  } catch (error) {
    if (!(error instanceof BankError)) throw error;
    problem = error.message;
  }
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Bank deposits" description="What actually arrived — matched to what the carriers say they paid." />
      {data ? <BankBoard data={data} readOnly={guard.entitlement.access === "read_only"} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </div>
  );
}
