import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { LeadListDetailView } from "@/components/app/lead-list-detail";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
// LA-8.2: times show in the viewer's own display timezone, else the agency's.
import { getViewerTimezone } from "@/lib/users/viewerTimezone";
import { leadListDetail } from "@/lib/leadLists/detail";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LeadListDetailPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const guard = await guardPage("lead_import");
  if (!guard.entitled)
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Lead lists"
        description="What each bought list delivered, and what is still untouched."
      />
    );
  // The same roles as the index this opens from.
  if (!actAsPage(guard, ["owner", "producer", "assistant"]))
    return <RoleGateNotice featureLabel="Lead lists" detail="Only owners, producers and assistants can hand out leads." />;
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Lead lists" detail="In an agency, the owner and admins handle lead lists." />;

  const { campaignId } = await params;
  if (!UUID.test(campaignId)) notFound();

  // What a list turned into — issued policies and what each one cost — is True CPA's, under its
  // own feature, kill switch and roles. An assistant sees the inventory, never the economics.
  // Assigning goes through /api/app/assignments, which is Outbound dialing's and managers' only
  // (assign_lead_list refuses anyone else with ASSIGNMENT_MANAGER_REQUIRED).
  const [trueCpa, dialing, solo] = await Promise.all([guardPage("true_cpa"), guardPage("outbound_dialing"), isSoloWorkspace(guard.context.tenantId)]);
  const money = trueCpa.entitled && holdsAnyRole(guard.roles, ["owner", "producer"]);
  // Solo mode (owner 2026-10-29): an agent working alone has nobody to hand leads to.
  const manager = holdsAnyRole(guard.roles, ["owner", "producer"]) && !solo;
  const assignBlocked = !dialing.entitled
    ? "Add Outbound dialing to your plan to assign leads."
    : dialing.entitlement.access === "read_only"
      ? "Restore full access to your plan to assign leads — it is read-only."
      : null;
  const [detail, timeZone] = await Promise.all([
    leadListDetail(guard.context.tenantId, guard.context.userId, campaignId, {
      money,
      readOnly: trueCpa.entitlement.access === "read_only",
    }),
    getViewerTimezone(guard.context.tenantId, guard.context.userId).catch(() => null),
  ]);
  if (!detail) notFound();

  return (
    <LeadListDetailView
      detail={detail}
      money={money}
      timeZone={timeZone}
      assign={{ manager, blocked: assignBlocked }}
      claimBlocked={trueCpa.entitlement.access === "read_only" ? "Restore full access to your plan to draft a claim — it is read-only." : null}
    />
  );
}
