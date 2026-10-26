import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { VendorBillsPage } from "@/components/app/lead-sources/pages";

/**
 * Money › Lead invoices (LA-7.2), now the Invoices tab of Vendor bills (2026-10-26). `?open=<id>`
 * still opens an invoice — the P&L links here. Owner and bookkeeper only.
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Lead invoices" description="What you paid for leads, invoice by invoice." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Lead invoices" detail="Only owners and bookkeepers can see what the agency pays." />;
  }
  const { open } = await searchParams;
  return <VendorBillsPage tab="invoices" open={open} />;
}
