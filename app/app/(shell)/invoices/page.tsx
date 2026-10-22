import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { invoiceSources, InvoiceError, listInvoices, listTemplates } from "@/lib/accounting/invoiceStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { InvoicesBoard } from "@/components/app/accounting/invoices-board";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Money › Lead invoices (LA-7.2, Notion sprint). Every invoice from a lead vendor or partner, per
 * line and per campaign, set beside what we counted. Owner and bookkeeper only.
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
  const tenantId = guard.context.tenantId;
  let loaded: { invoices: Awaited<ReturnType<typeof listInvoices>>; sources: Awaited<ReturnType<typeof invoiceSources>>; templates: Awaited<ReturnType<typeof listTemplates>> } | null = null;
  let problem: string | null = null;
  try {
    const [invoices, sources, templates] = await Promise.all([listInvoices(tenantId), invoiceSources(tenantId), listTemplates(tenantId)]);
    loaded = { invoices, sources, templates };
  } catch (error) {
    if (!(error instanceof InvoiceError)) throw error;
    problem = error.message;
  }
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Lead invoices" description="What you paid for leads, and whether it matches what arrived." />
      {loaded ? (
        <InvoicesBoard invoices={loaded.invoices} sources={loaded.sources} templates={loaded.templates} readOnly={guard.entitlement.access === "read_only"} openId={open ?? null} />
      ) : (
        <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>
      )}
    </div>
  );
}
