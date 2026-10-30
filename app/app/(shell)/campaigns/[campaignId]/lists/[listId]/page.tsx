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

  const [trueCpa, solo] = await Promise.all([guardPage("true_cpa"), isSoloWorkspace(guard.context.tenantId)]);
  const money = trueCpa.entitled && holdsAnyRole(guard.roles, ["owner", "producer"]);
  const detail = await leadListDetail(guard.context.tenantId, guard.context.userId, campaignId, { money, readOnly: trueCpa.entitlement.access === "read_only" }).catch(() => null);
  if (!detail) notFound();
  // Assigning hands out the campaign's pool (assign_lead_list): the same drawer the campaign page has.
  const canAssign = !solo && guard.entitlement.access !== "read_only" && detail.assignable > 0;
  const perUsable = money && detail.costPerUsableCents !== null ? `$${(detail.costPerUsableCents / 100).toFixed(2)}` : null;

  return (
    <LeadsInPage step="source" ownContinue>
      <ListLeads
        campaignId={campaignId}
        listId={listId}
        campaignName={detail.campaignName}
        perUsable={perUsable}
        assign={canAssign ? <LeadListAssignDrawer campaignId={campaignId} listName={detail.campaignName} assignable={detail.assignable} label={`Assign the campaign's ${detail.assignable.toLocaleString("en-US")}`} /> : null}
      />
    </LeadsInPage>
  );
}
