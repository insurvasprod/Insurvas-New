import { notFound, redirect } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { EDITABLE } from "@/lib/accounting/invoicesCore";
import { getInvoice, invoiceSources, InvoiceError } from "@/lib/accounting/invoiceStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { BILL_FORM_ACTIONS } from "@/lib/accounting/billTabs";
import { InvoiceEntry } from "@/components/app/accounting/invoices-board";
import { RouteSheet } from "@/components/app/route-sheet";
import { EmptyState } from "@/components/ui/page-states";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Enter (or edit, `?edit=`) a vendor bill, opened from inside the app: a panel from the right (route-sheet.tsx); the
 * same gate and rules as its page. The form's Save buttons, on the page's title line there, sit in the footer here.
 */
export default async function NewInvoiceSheet({ searchParams }: { searchParams: Promise<{ edit?: string; template?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <RouteSheet title="Enter a bill" wide><FeatureGateNotice guard={guard} featureLabel="Vendor bills" description="What you paid for leads, bill by bill." /></RouteSheet>;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RouteSheet title="Enter a bill" wide><RoleGateNotice featureLabel="Vendor bills" detail="Only owners and bookkeepers can see what the agency pays." /></RouteSheet>;
  if (guard.entitlement.access === "read_only") return <RouteSheet title="Enter a bill" wide><RoleGateNotice featureLabel="Vendor bills" detail="This plan is read-only here: bills can be seen, not entered." /></RouteSheet>;
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
    return <RouteSheet title={`Bill ${loaded.initial.invoiceNumber}`} wide><EmptyState title="This bill can no longer be changed" hint="Once a bill is approved, paid or void, correct it by voiding it and entering it again." /></RouteSheet>;
  }
  return (
    <RouteSheet
      title={loaded?.initial ? `Edit bill ${loaded.initial.invoiceNumber}` : "Enter a bill"}
      wide
      footer={loaded ? <span id={BILL_FORM_ACTIONS} className="ml-auto flex items-center gap-2" /> : undefined}
    >
      {loaded ? <InvoiceEntry sources={loaded.sources} initial={loaded.initial} /> : <EmptyState title="Not switched on yet" hint={problem ?? ""} />}
    </RouteSheet>
  );
}
