import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { EDITABLE } from "@/lib/accounting/invoicesCore";
import { getInvoice, invoiceSources, InvoiceError, listTemplates } from "@/lib/accounting/invoiceStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { InvoiceEntry } from "@/components/app/accounting/invoices-board";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Accounting › Vendor bills › Enter an invoice (LA-7.2; foundation pass 2026-11-03, was a 920px pop-up). Blank,
 * or from a monthly template (`?template=<id>`, `first` for the first one) in three fields or fewer; with
 * `?edit=<id>` it edits an invoice that can still change. Owner and bookkeeper, never read-only.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ edit?: string; template?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead invoices" description="What you paid for leads, invoice by invoice." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Lead invoices" detail="Only owners and bookkeepers can see what the agency pays." />;
  if (guard.entitlement.access === "read_only") return <RoleGateNotice featureLabel="Lead invoices" detail="This plan is read-only here: invoices can be seen, not entered." />;
  const { edit, template } = await searchParams;
  if (edit && !UUID.test(edit)) notFound();
  const tenantId = guard.context.tenantId;
  let loaded: { sources: Awaited<ReturnType<typeof invoiceSources>>; templates: Awaited<ReturnType<typeof listTemplates>>; initial: Awaited<ReturnType<typeof getInvoice>> | undefined } | null = null;
  let problem: string | null = null;
  try {
    const [sources, templates, initial] = await Promise.all([invoiceSources(tenantId), listTemplates(tenantId), edit ? getInvoice(tenantId, edit) : Promise.resolve(undefined)]);
    loaded = { sources, templates, initial };
  } catch (error) {
    if (!(error instanceof InvoiceError)) throw error;
    problem = error.message;
  }
  if (loaded?.initial && !EDITABLE.includes(loaded.initial.status)) {
    return <AccountingPage step="bills" title={`Bill ${loaded.initial.invoiceNumber}`}><TableCard><EmptyState title="This bill can no longer be changed" hint="Once a bill is approved, paid or void, correct it by voiding it and entering it again." /></TableCard></AccountingPage>;
  }
  const templateId = template === "first" ? loaded?.templates[0]?.id : template && UUID.test(template) ? template : undefined;
  return (
    <AccountingPage step="bills" title={loaded?.initial ? `Edit bill ${loaded.initial.invoiceNumber}` : "Enter a bill"} facts={loaded?.initial ? loaded.initial.sourceName : undefined}>
      {loaded ? <InvoiceEntry sources={loaded.sources} templates={loaded.templates} initial={loaded.initial} templateId={templateId} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </AccountingPage>
  );
}
