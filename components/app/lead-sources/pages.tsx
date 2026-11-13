import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { scopeFor } from "@/lib/agency/visibility";
import { isAgencyTenant } from "@/lib/agency/audience";
import { InvoiceError, listBills, listInvoices, listTemplates, type InvoiceListRow } from "@/lib/accounting/invoiceStore";
import { BILL_TABS, billDiffers, billTabFor, onBillTab, type BillTab } from "@/lib/accounting/billTabs";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { LeadListWorkspace } from "@/components/app/lead-list-workspace";
import { InvoiceListActions, InvoicesBoard } from "@/components/app/accounting/invoices-board";
import { VendorReturnsWorkspace } from "@/components/app/vendor-returns-workspace";
import { LeadsInPage } from "@/components/app/lead-sources/leads-in";
import { Callout } from "@/components/app/settings/primitives";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Five pages become two (owner pick 2026-10-26, canvas M2 Â· Vendors, "split by job"):
 *
 *   Lead sources  â€” Lead lists, Vendors & campaigns, and List import (a side sheet)
 *   Vendor bills  â€” Lead invoices and Vendor returns
 *
 * Every gate is the one its page had: each tab is offered only to the plans and roles its old page
 * admitted, so nobody meets a locked tab. The old addresses render these same pages on their tab, so
 * links, bookmarks, `#campaignId` hashes, `?vendor=` and `?open=` keep working.
 */

const READ_ONLY_COPY = "Your plan is read-only. You can look at everything here; adding, importing, scrubbing and claiming are paused until it is active again.";

type Guard = Awaited<ReturnType<typeof guardPage>>;

/**
 * Lead sources › Lists, step 4 of the one Leads page (owner pick B, 2026-10-28; see leads-in.tsx).
 * Vendors & campaigns and List import are steps of their own now, at their own addresses.
 */
export async function LeadSourcesPage({ guards }: {
  /** Already read by the route; read here otherwise (memoised for the request either way). */
  guards?: { lists: Guard; outbound: Guard; returns: Guard };
} = {}) {
  const [lists, outbound, returns] = guards ? [guards.lists, guards.outbound, guards.returns] : await Promise.all([guardPage("lead_import"), guardPage("outbound_dialing"), guardPage("true_cpa")]);
  const context = lists.entitled ? lists.context : outbound.entitled ? outbound.context : null;
  // AG-0.5: inside an agency every one of these is the agency's business; their APIs refuse a narrow session.
  const agencyNarrow = context ? (await scopeFor(context)) !== null : false;
  const canLists = lists.entitled && actAsPage(lists, ["owner", "producer", "assistant"]) && !agencyNarrow;
  const canCampaigns = outbound.entitled && (outbound.role === "owner" || outbound.role === "producer") && !agencyNarrow;
  const canClaim = canLists && returns.entitled && holdsAnyRole(lists.roles, ["owner", "producer"]);
  // Deleting an empty list is deleting its campaign: the campaign route's gate, and never in a read-only plan.
  const canDeleteLists = canCampaigns && outbound.entitled && outbound.entitlement.access !== "read_only";
  // Auto-assign is the bulk list commit (POST /api/app/assignments assign_list): owner / producer,
  // never read-only, never a narrowed agency session, and in an agency the owner only (refuseRoutingInAgency).
  const canAutoAssign = canDeleteLists && outbound.entitled && (outbound.role === "owner" || !(await isAgencyTenant(outbound.context.tenantId)));
  // "Fix in Clean" points at the Clean step only for the people its own route lets in (leads-in.tsx).
  const dupes = await guardPage("duplicate_detection");
  const cleanHref = dupes.entitled && actAsPage(dupes, ["owner", "producer", "assistant"]) && !agencyNarrow ? "/app/duplicates" : null;

  if (!canLists) {
    // Somebody who may see vendors but not lists starts on the step they can open.
    if (canCampaigns) redirect("/app/campaigns");
    if (!lists.entitled) return <FeatureGateNotice guard={lists} featureLabel="Lead flow" description="Your lead vendors, what each list cost, and what is still untouched." />;
    if (agencyNarrow) return <RoleGateNotice reason="agency" featureLabel="Lead flow" detail="In an agency, the owner and admins handle vendors, lists and lead spend." />;
    return <RoleGateNotice featureLabel="Lead flow" detail="Only owners, producers and assistants can see lead lists; only owners and producers see vendors and spend." />;
  }

  const readOnly = lists.entitlement.access === "read_only";
  return (
    <LeadsInPage
      step="lists"
      // "Claim $N" lands here from the index (lead-list-index.tsx), and only while something is owed
      // back (/ui-taste 2026-10-29: no Claim button beside $0.00). The slot exists only for the people
      // Vendor bills › Returns opens for, so the button never leads to a locked tab.
      actions={canClaim ? <span id="leads-in-claim" className="contents" /> : undefined}
    >
      {readOnly && <Callout tone="warning" title={READ_ONLY_COPY} />}
      {/* No "Next step" line here (owner 2026-10-28): the table starts at the top, and the row that
          needs doing first is marked by a green icon on its action (lead-list-index.tsx). */}
      <LeadListWorkspace canClaim={canClaim} scrubHref={canCampaigns ? "/app/campaigns" : null} canDelete={canDeleteLists} cleanHref={cleanHref} canAutoAssign={canAutoAssign} />
    </LeadsInPage>
  );
}

export type VendorBillsTab = "invoices" | "returns";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Vendor bills (round 7, owner 2026-11-10: mockups-r7/accounting.html 2·A, "Status tabs"). Where a bill stands is
 * the sub-page bar on the title line: To approve · Disputed · To pay · Paid · All, each with its count (`?status=`,
 * old values mapped by billTabFor), then Returns (`?tab=returns`). The title line holds ⋯ (From a monthly
 * template, a dialog; `?template=` opens it) and Enter a bill; on Returns, Review a claim (the workspace fills
 * the slot). No read-only card: the buttons say why they are off.
 */
export async function VendorBillsPage({ tab, open, vendor, status, differs, template, guards }: { tab: VendorBillsTab; open?: string; vendor?: string; status?: string; differs?: string; template?: string; guards?: { money: Guard; returns: Guard } }) {
  const [money, returns] = guards ? [guards.money, guards.returns] : await Promise.all([guardPage("profit_and_loss"), guardPage("true_cpa")]);
  const canInvoices = money.entitled && actAsPage(money, ["owner", "bookkeeper"]);
  const returnsContext = returns.entitled ? returns.context : null;
  const agencyNarrow = returnsContext ? (await scopeFor(returnsContext)) !== null : false;
  const canReturns = returns.entitled && actAsPage(returns, ["owner", "producer", "bookkeeper"]) && !agencyNarrow;

  if (!canInvoices && !canReturns) {
    const guard = tab === "returns" ? returns : money;
    if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Vendor bills" description="What you paid for leads, and what vendors owe you back." />;
    if (tab === "returns" && agencyNarrow) return <RoleGateNotice reason="agency" featureLabel="Vendor bills" detail="In an agency, the owner and admins handle vendor returns." />;
    return <RoleGateNotice featureLabel="Vendor bills" detail="Owners and bookkeepers see invoices; owners, producers and bookkeepers see vendor returns." />;
  }

  // Foundation pass (2026-11-03): an invoice is a detail page; `?open=` (the P&L's links) lands on it.
  if (canInvoices && open && UUID.test(open)) redirect(`/app/vendor-bills/${open}`);
  const shown: VendorBillsTab = tab === "returns" && canReturns ? "returns" : canInvoices ? "invoices" : "returns";
  const moneyReadOnly = money.entitled && money.entitlement.access === "read_only";
  const picked = billTabFor(status);

  let panel: ReactNode = null;
  let actions: ReactNode = undefined;
  let bills: InvoiceListRow[] | null = null;
  if (canInvoices) {
    const tenantId = money.context.tenantId;
    // The list compares the bills still waiting live (listBills); the Returns tab only needs the tab counts.
    const loaded = await Promise.all([shown === "invoices" ? listBills(tenantId) : listInvoices(tenantId), shown === "invoices" ? listTemplates(tenantId) : Promise.resolve([])]).then(
      ([invoices, templates]) => ({ invoices, templates, problem: null }),
      (error: unknown) => {
        if (!(error instanceof InvoiceError)) throw error;
        return { invoices: null, templates: null, problem: error.message };
      },
    );
    bills = loaded.invoices;
    if (shown === "invoices") {
      panel = loaded.invoices
        ? <InvoicesBoard key={picked.tab} invoices={loaded.invoices} readOnly={moneyReadOnly} tab={picked.tab} differs={picked.differs || differs === "1"} />
        : <TableCard><EmptyState title="Not switched on yet" hint={loaded.problem ?? ""} /></TableCard>;
      if (loaded.invoices) actions = <InvoiceListActions templates={loaded.templates ?? []} readOnly={moneyReadOnly} openTemplate={template} />;
    }
  }
  if (shown === "returns") {
    panel = <VendorReturnsWorkspace embedded initialVendorId={vendor && UUID.test(vendor) ? vendor : undefined} />;
    // Review a claim: the workspace portals the title line's primary into this slot (2·6).
    actions = <span id="vendor-returns-actions" className="contents" />;
  }

  const count = (key: BillTab) => (bills ? bills.filter((b) => onBillTab(b.status, key)).length || null : null);
  const differsOn = (key: BillTab) => Boolean(bills?.some((b) => onBillTab(b.status, key) && billDiffers(b)));
  const tabs = canInvoices
    ? <ViewTabs label="Vendor bills" value={shown === "returns" ? "returns" : picked.tab} tabs={[
        ...BILL_TABS.map((t) => ({ key: t.key, label: t.label, count: count(t.key), tone: t.key !== "all" && t.key !== "paid" && differsOn(t.key) ? ("danger" as const) : undefined, href: t.key === "approve" ? "/app/vendor-bills" : `/app/vendor-bills?status=${t.key}` })),
        ...(canReturns ? [{ key: "returns" as const, label: "Returns", href: "/app/vendor-bills?tab=returns" }] : []),
      ]} />
    : undefined;

  return (
    // Accounting › Vendor bills (owner 2026-11-02): a step of the one Accounting page; its tabs on the title line.
    <AccountingPage
      step="bills"
      info={shown === "invoices" ? "Each lead vendor's bill, line by line with its campaign, set beside the leads you really got. Approving books the cost; marking paid records when the money moved; voiding reverses it. Nothing is deleted." : "Return claims against vendors, and what each vendor credited."}
      tabs={tabs}
      actions={actions}
    >
      {panel}
    </AccountingPage>
  );
}
