import { notFound } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { scopeFor } from "@/lib/agency/visibility";
import { leadListDetail } from "@/lib/leadLists/detail";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";
import { EARLIER } from "@/lib/campaigns/lists";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { LeadListAssignDrawer } from "@/components/app/lead-list-assign-drawer";
import { ListLeads } from "@/components/app/campaigns/list-leads";
import { LeadsInPage } from "@/components/app/lead-sources/leads-in";
import { StreamSection } from "@/components/ui/stream-section";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Source › a campaign › a list (board LirF2): its leads, filtered to what needs a fix, with the campaign's assign. */
export default async function CampaignListPage({ params }: { params: Promise<{ campaignId: string; listId: string }> }) {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled)
    return <FeatureGateNotice guard={guard} featureLabel="Vendors & campaigns" description="Track lead vendors, batch costs and cost per usable lead." />;
  if (!("owner" === guard.role || "producer" === guard.role))
    return <RoleGateNotice featureLabel="Vendors & campaigns" detail="Only owners and producers can see lead spend and vendor costs." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Vendors & campaigns" detail="In an agency, the owner and admins handle vendors and lead spend." />;
  const { campaignId, listId } = await params;
  if (!UUID.test(campaignId) || (listId !== EARLIER && !UUID.test(listId))) notFound();

  // Frame first (UI-CONSISTENCY §7a): the step's title and rail draw at once; the list's leads stream in under them.
  // The reads are the ones the page always made, started here and awaited in the block.
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const reads = Promise.all([guardPage("true_cpa"), isSoloWorkspace(tenantId)]).then(async ([trueCpa, solo]) => {
    const money = trueCpa.entitled && holdsAnyRole(guard.roles, ["owner", "producer"]);
    const detail = await leadListDetail(tenantId, guard.context.userId, campaignId, { money, readOnly: trueCpa.entitlement.access === "read_only" }).catch(() => null);
    return { solo, money, detail };
  });

  return (
    <LeadsInPage step="source" ownContinue>
      <StreamSection shape="table">
        <CampaignList read={reads} campaignId={campaignId} listId={listId} readOnly={readOnly} />
      </StreamSection>
    </LeadsInPage>
  );
}

/** The list's leads, once the campaign's detail is in (a campaign that is not this tenant's is not found). */
async function CampaignList({ read, campaignId, listId, readOnly }: {
  read: Promise<{ solo: boolean; money: boolean; detail: Awaited<ReturnType<typeof leadListDetail>> | null }>;
  campaignId: string;
  listId: string;
  readOnly: boolean;
}) {
  const { solo, money, detail } = await read;
  if (!detail) notFound();
  // Assigning hands out the campaign's pool (assign_lead_list): the same drawer the campaign page has.
  const canAssign = !solo && !readOnly && detail.assignable > 0;
  const perUsable = money && detail.costPerUsableCents !== null ? `$${(detail.costPerUsableCents / 100).toFixed(2)}` : null;

  return (
    <ListLeads
      campaignId={campaignId}
      listId={listId}
      campaignName={detail.campaignName}
      perUsable={perUsable}
      assign={canAssign ? <LeadListAssignDrawer campaignId={campaignId} listName={detail.campaignName} assignable={detail.assignable} label={`Assign the campaign's ${detail.assignable.toLocaleString("en-US")}`} /> : null}
    />
  );
}
