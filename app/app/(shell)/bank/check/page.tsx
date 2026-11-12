import Link from "next/link";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { BankError, listAccounts, paymentResults } from "@/lib/accounting/bankStore";
import { addDays, paymentHref, paymentsFrom } from "@/lib/accounting/bankResultsCore";
import { fileCarrierChoices } from "@/lib/carriers/agency";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { CheckDropZones } from "@/components/app/accounting/bank-check";
import { RecentPayments } from "@/components/app/accounting/bank-results";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Bank deposits › Check a payment (owner's Accounting doc, step 1 "Gathering the clues"; round 1 board B1,
 * 2026-11-07; round 7 board 1·5, owner 2026-11-10). Its own page: the title alone, no Cancel (there is nothing to
 * cancel), two drop zones side by side — the carrier's commission file (the Carrier files door, read with the
 * carrier's layout) and the bank statement (the bank import) — and what came in during the last 30 days filling the
 * rest; a row opens the payment's page. Either file can come alone.
 */
export default async function BankCheckPage() {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Bank deposits" description="What actually landed in the bank." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Bank deposits" detail="Only owners and bookkeepers can see the agency's bank lines." />;
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  let data: { accounts: Awaited<ReturnType<typeof listAccounts>>; carriers: Awaited<ReturnType<typeof fileCarrierChoices>>; recent: Awaited<ReturnType<typeof paymentResults>> } | null = null;
  let problem: string | null = null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [accounts, carriers, recent] = await Promise.all([listAccounts(tenantId), fileCarrierChoices(tenantId), paymentResults(tenantId, { since: addDays(today, -30), today })]);
    data = { accounts, carriers, recent };
  } catch (error) {
    if (!(error instanceof BankError)) throw error;
    problem = error.message;
  }
  if (!data) return <AccountingPage step="bank" title="Check a carrier payment"><TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></AccountingPage>;
  const { accounts, carriers, recent } = data;
  const from = paymentsFrom("30", "all");
  const rows = [...recent.rows].sort((a, b) => b.statementDate.localeCompare(a.statementDate)).map((r) => ({ id: r.id, carrierName: r.carrierName, statementDate: r.statementDate, paidCents: r.paidCents, verdict: r.verdict, missingCents: r.missingCents, shortCents: r.shortCents, href: paymentHref(r.id, from) }));
  return (
    <AccountingPage
      step="bank"
      title="Check a carrier payment"
      info="Drop the carrier's commission file and your bank statement. Insurvas links what the carrier said it paid to what landed, then checks every policy against your rate card. Either file can come on its own."
      actions={<Button asChild><Link href="/app/bank?view=payments&period=30">See the results</Link></Button>}
    >
      <div className="flex flex-col gap-4">
        <CheckDropZones accounts={accounts} carriers={carriers} readOnly={readOnly} bankThrough={recent.bankThrough} />
        <RecentPayments rows={rows} />
      </div>
    </AccountingPage>
  );
}
