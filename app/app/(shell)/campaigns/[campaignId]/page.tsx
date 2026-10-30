import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { scopeFor } from "@/lib/agency/visibility";
import { getViewerTimezone } from "@/lib/users/viewerTimezone";
import { leadListDetail } from "@/lib/leadLists/detail";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CampaignWorkspace } from "@/components/app/campaign-workspace";
import { CampaignLists } from "@/components/app/campaigns/campaign-lists";
import { LeadListDetailView } from "@/components/app/lead-list-detail";
import { LeadListAssignDrawer } from "@/components/app/lead-list-assign-drawer";
import { LeadsInPage } from "@/components/app/lead-sources/leads-in";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Source › a campaign (manager 2026-10-29: "no standalone Lists page — open a campaign and see its
 * lists"; board LirF1). The campaign's figures, Edit and "+ Import a list" (CampaignWorkspace, focused),
 * then its lists, then what Lists used to show for it — removed at import, not being served, column
 * map, health, consent, claims and assigning — so nothing the Lists page did is lost.
 */
export default async function CampaignPage({ params, searchParams }: { params: Promise<{ campaignId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled)
    return <FeatureGateNotice guard={guard} featureLabel="Vendors & campaigns" description="Track lead vendors, batch costs and cost per usable lead." />;
  if (!("owner" === guard.role || "producer" === guard.role))
    return <RoleGateNotice featureLabel="Vendors & campaigns" detail="Only owners and producers can see lead spend and vendor costs." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Vendors & campaigns" detail="In an agency, the owner and admins handle vendors and lead spend." />;
  const [{ campaignId }, { tab }] = await Promise.all([params, searchParams]);
  if (!UUID.test(campaignId)) notFound();

  // The list sections are Lead import's, behind its own gate; what a list cost is True CPA's.
  const [lists, trueCpa, solo] = await Promise.all([guardPage("lead_import"), guardPage("true_cpa"), isSoloWorkspace(guard.context.tenantId)]);
  const canLists = lists.entitled && actAsPage(lists, ["owner", "producer", "assistant"]);
  const money = trueCpa.entitled && holdsAnyRole(guard.roles, ["owner", "producer"]);
  const manager = holdsAnyRole(guard.roles, ["owner", "producer"]) && !solo;
  const assignBlocked = guard.entitlement.access === "read_only" ? "Restore full access to your plan to assign leads — it is read-only." : null;
  const [detail, timeZone] = canLists
    ? await Promise.all([
      leadListDetail(guard.context.tenantId, guard.context.userId, campaignId, { money, readOnly: trueCpa.entitlement.access === "read_only" }).catch(() => null),
      getViewerTimezone(guard.context.tenantId, guard.context.userId).catch(() => null),
    ])
    : [null, null];

  return (
    <LeadsInPage step="source">
      <CampaignWorkspace embedded focusId={campaignId} initialTab={tab === "settings" || tab === "report" ? tab : "lists"}
        report={detail ? <LeadListDetailView
          inCampaign
          detail={detail}
          money={money}
          timeZone={timeZone}
          assign={{ manager, blocked: assignBlocked }}
          claimBlocked={trueCpa.entitlement.access === "read_only" ? "Restore full access to your plan to draft a claim — it is read-only." : null}
        /> : null} readOnly={guard.entitlement.access === "read_only"} owedCents={money && detail?.claims.supported ? detail.claims.unclaimedCents : null}
        assign={detail && manager && !assignBlocked && detail.assignable > 0 ? { count: detail.assignable, node: <LeadListAssignDrawer campaignId={campaignId} listName={detail.campaignName} assignable={detail.assignable} /> } : null}>
        <CampaignLists campaignId={campaignId} />
      </CampaignWorkspace>
    </LeadsInPage>
  );
}
