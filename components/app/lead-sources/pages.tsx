import { redirect } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { scopeFor } from "@/lib/agency/visibility";
import { isAgencyTenant } from "@/lib/agency/audience";
import { invoiceSources, InvoiceError, listInvoices, listTemplates } from "@/lib/accounting/invoiceStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { LeadListWorkspace } from "@/components/app/lead-list-workspace";
import { InvoicesBoard } from "@/components/app/accounting/invoices-board";
import { VendorReturnsWorkspace } from "@/components/app/vendor-returns-workspace";
import { NeedsYou } from "@/components/app/lead-sources/needs-you";
import { SourceTabs, type SourceTab } from "@/components/app/lead-sources/source-tabs";
import { LeadsInPage } from "@/components/app/lead-sources/leads-in";
import { Callout } from "@/components/app/settings/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

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
    if (!lists.entitled) return <FeatureGateNotice guard={lists} featureLabel="Lead sources" description="Your lead vendors, what each list cost, and what is still untouched." />;
    if (agencyNarrow) return <RoleGateNotice reason="agency" featureLabel="Lead sources" detail="In an agency, the owner and admins handle vendors, lists and lead spend." />;
    return <RoleGateNotice featureLabel="Lead sources" detail="Only owners, producers and assistants can see lead lists; only owners and producers see vendors and spend." />;
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

export async function VendorBillsPage({ tab, open, vendor, guards }: { tab: VendorBillsTab; open?: string; vendor?: string; guards?: { money: Guard; returns: Guard } }) {
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

  const tabs: SourceTab[] = [];
  if (canInvoices) {
    const tenantId = money.context.tenantId;
    const loaded = await Promise.all([listInvoices(tenantId), invoiceSources(tenantId), listTemplates(tenantId)]).then(
      ([invoices, sources, templates]) => ({ invoices, sources, templates, problem: null }),
      (error: unknown) => {
        if (!(error instanceof InvoiceError)) throw error;
        return { invoices: null, sources: null, templates: null, problem: error.message };
      },
    );
    tabs.push({
      key: "invoices",
      label: "Invoices",
      panel: loaded.invoices && loaded.sources && loaded.templates
        ? <InvoicesBoard invoices={loaded.invoices} sources={loaded.sources} templates={loaded.templates} readOnly={money.entitlement.access === "read_only"} openId={open ?? null} />
        : <TableCard><EmptyState title="Not switched on yet" hint={loaded.problem ?? ""} /></TableCard>,
    });
  }
  if (canReturns) tabs.push({ key: "returns", label: "Returns", panel: <VendorReturnsWorkspace embedded initialVendorId={vendor && UUID.test(vendor) ? vendor : undefined} /> });
  const readOnly = (canInvoices ? money : returns).entitlement.access === "read_only";

  return (
    <>
      <div className="m-stagger flex flex-col gap-6">
        <PageHeader title="Vendor bills" description="What you paid for leads, and what vendors owe you back." />
        {readOnly && <Callout tone="warning" title={READ_ONLY_COPY} />}
        {canInvoices && <NeedsYou access={{ lists: false, claims: false, invoices: true, invoicesHref: "/app/vendor-bills?tab=invoices", campaignsHref: null }} only={["invoices"]} />}
        <SourceTabs label="Vendor bills" tabs={tabs} initialTab={tab} />
      </div>
    </>
  );
}
