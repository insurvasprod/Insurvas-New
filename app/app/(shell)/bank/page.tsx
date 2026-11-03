import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { BankError, findings, listAccounts, matchQueue, openStatements } from "@/lib/accounting/bankStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { BankActions, BankBoard, type BankData, type BankView } from "@/components/app/accounting/bank-board";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Money › Bank deposits (LA-7.6, Notion sprint). What actually landed in the bank, matched by a
 * person to what the carriers said they paid. Owner and bookkeeper only.
 *
 * Foundation pass (2026-11-03): To match · Not explained · Not received · Accounts are the step's tabs on the
 * title line, each at its own address (`?view=`); `?add=1` opens the Add an account row.
 */
const VIEWS: BankView[] = ["queue", "unexplained", "not_received", "accounts"];

export default async function BankPage({ searchParams }: { searchParams: Promise<{ view?: string; add?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Bank deposits" description="What actually landed in the bank." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Bank deposits" detail="Only owners and bookkeepers can see the agency's bank lines." />;
  }
  const q = await searchParams;
  const view = VIEWS.find((v) => v === q.view) ?? "queue";
  const readOnly = guard.entitlement.access === "read_only";
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
  const tabs = data ? (
    <ViewTabs label="Bank deposits" value={view} tabs={[
      { key: "queue", label: "To match", count: data.queue.length, href: "/app/bank" },
      { key: "unexplained", label: "Not explained", count: data.findings.unexplained.length, href: "/app/bank?view=unexplained" },
      { key: "not_received", label: "Not received", count: data.findings.notReceived.length, tone: "danger", href: "/app/bank?view=not_received" },
      { key: "accounts", label: "Accounts", count: data.accounts.length, href: "/app/bank?view=accounts" },
    ]} />
  ) : undefined;
  return (
    <AccountingPage
      step="bank"
      info="The system suggests a match for each deposit; nothing is matched until a person confirms it. Statements past the carrier's usual lag with no deposit are listed as not received."
      lead={tabs}
      actions={data ? <BankActions accounts={data.accounts} readOnly={readOnly} /> : undefined}
    >
      {data ? <BankBoard key={view} data={data} view={view} adding={q.add === "1"} readOnly={readOnly} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </AccountingPage>
  );
}
