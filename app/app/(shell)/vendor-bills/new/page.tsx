import { notFound, redirect } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { EDITABLE } from "@/lib/accounting/invoicesCore";
import { getInvoice, invoiceSources, InvoiceError } from "@/lib/accounting/invoiceStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { BILL_FORM_ACTIONS } from "@/lib/accounting/billTabs";
import { InvoiceEntry } from "@/components/app/accounting/invoices-board";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Accounting › Vendor bills › Enter a bill (LA-7.2; round 7, owner 2026-11-10: mockups-r7/accounting.html 2·3).
 * Four numbered questions; a line is a row that opens its dialog; Discard · Save as draft · Save bill sit on the
 * title line (the form fills BILL_FORM_ACTIONS). With `?edit=<id>` it edits a bill that can still change ("Edit
 * bill SLL-2609", Save changes). From a monthly template is a dialog on the list now: `?template=` goes there.
 * Owner and bookkeeper, never read-only.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ edit?: string; template?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Vendor bills" description="What you paid for leads, bill by bill." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Vendor bills" detail="Only owners and bookkeepers can see what the agency pays." />;
  if (guard.entitlement.access === "read_only") return <RoleGateNotice featureLabel="Vendor bills" detail="This plan is read-only here: bills can be seen, not entered." />;
  const { edit, template } = await searchParams;
  if (!edit && template && (template === "first" || UUID.test(template))) redirect(`/app/vendor-bills?template=${template}`);
  if (edit && !UUID.test(edit)) notFound();
  const tenantId = guard.context.tenantId;
  let loaded: { sources: Awaited<ReturnType<typeof invoiceSources>>; initial: Awaited<ReturnType<typeof getInvoice>> | undefined } | null = null;
  let problem: string | null = null;
  try {
    const [sources, initial] = await Promise.all([invoiceSources(tenantId), edit ? getInvoice(tenantId, edit) : Promise.resolve(undefined)]);
    loaded = { sources, initial };
  } catch (error) {
    if (!(error instanceof InvoiceError)) throw error;
    if (error.status === 404) notFound();
    problem = error.message;
  }
  if (loaded?.initial && !EDITABLE.includes(loaded.initial.status)) {
    return <AccountingPage step="bills" title={`Bill ${loaded.initial.invoiceNumber}`}><TableCard><EmptyState title="This bill can no longer be changed" hint="Once a bill is approved, paid or void, correct it by voiding it and entering it again." /></TableCard></AccountingPage>;
  }
  return (
    <AccountingPage
      step="bills"
      title={loaded?.initial ? `Edit bill ${loaded.initial.invoiceNumber}` : "Enter a bill"}
      actions={loaded ? <span id={BILL_FORM_ACTIONS} className="contents" /> : undefined}
    >
      {loaded ? <InvoiceEntry sources={loaded.sources} initial={loaded.initial} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </AccountingPage>
  );
}
