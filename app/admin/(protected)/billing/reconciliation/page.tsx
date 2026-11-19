import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices, canVoidInvoices } from "@/lib/invoices/permissions";
import { fetchReconciliation } from "@/lib/invoices/reconcileQueries";
import { reconciliationFacts, reconciliationRows } from "@/lib/invoices/reconcile";
import { refundApprovalThresholdCents } from "@/lib/settings/queries";
import { formatCentsAsCurrency } from "@/lib/money";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { BillingPage } from "@/components/admin/billing/billing-page";
import { ReconTable } from "@/components/admin/billing/recon-table";

/**
 * Admin › Billing › Reconciliation (billing-r2 screen 7, new; Notion §12's provider reconciliation report): what
 * we billed against what the provider charged, invoice by invoice, with the likely reason and a way to settle
 * each — and the provider charges no invoice of ours accounts for. Same gate as the invoices it reconciles.
 *
 * Address parameters: lens=mismatched|provider|settled, reason=<likely reason key>, q=<text>,
 * invoice=<invoice id> or payment=<payment id> opens that row's Settle sheet.
 */
export default async function ReconciliationPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const [data, thresholdCents] = await Promise.all([fetchReconciliation(), refundApprovalThresholdCents()]);
  const rows = reconciliationRows(data.invoices, data.payments, data.explanations);
  const facts = reconciliationFacts(rows);

  return (
    <BillingPage step="reconciliation" info="What we billed against what the provider charged, invoice by invoice, with the likely reason and a way to settle each.">
      <div className="flex min-w-0 flex-col gap-4">
        <StatStrip label="Reconciliation figures">
          <StatTile label="Don't match" value={facts.mismatched.toLocaleString("en-US")} footnote={`of ${data.totalInvoices.toLocaleString("en-US")} invoices`} />
          <StatTile label="Difference" value={formatCentsAsCurrency(facts.differenceCents)} footnote={facts.mismatched ? `we billed more on ${facts.billedMoreOn.toLocaleString("en-US")}` : "nothing to settle"} />
          <StatTile label="Provider only" value={facts.providerOnly.toLocaleString("en-US")} footnote="charges with no invoice of ours" />
        </StatStrip>

        <ReconTable rows={rows} canAct={canVoidInvoices(admin.role)} explanationsReady={data.explanationsReady} approvalThresholdCents={thresholdCents} />
      </div>
    </BillingPage>
  );
}
