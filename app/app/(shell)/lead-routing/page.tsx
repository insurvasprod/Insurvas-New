import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AssignmentWorkspace } from "@/components/app/assignment-workspace";
import { UnassignedPool } from "@/components/app/agency/unassigned-pool";
import { hasFeature } from "@/lib/entitlements/types";
import { LeadsInPage } from "@/components/app/lead-sources/leads-in";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";

/**
 * AG-0.10 · Team › Lead routing. Not a new lead system: LA-2.24's rule chain (state, language, campaign, product,
 * round robin, fewest open, best recent placement), which in an agency routes only to working producers appointed
 * in the lead's state — plus the unassigned pool with an age on every lead. Owner and admin only.
 */
export default async function LeadRoutingPage() {
  const guard = await guardPage("lead_assignment");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead routing" description="Give every lead to a producer who can write it." />;
  // Solo mode (owner 2026-10-29): nobody to route to. (Lead routing's feature is an agency plan's, so this is a backstop.)
  if (await isSoloWorkspace(guard.context.tenantId)) return <RoleGateNotice reason="solo" featureLabel="Lead routing" detail="You work alone, so new leads go straight to your dialer." action={{ href: "/app/dialer", label: "Open the dialer" }} />;
  if (guard.role !== "owner") return <RoleGateNotice featureLabel="Lead routing" detail="In an agency the owner or an admin routes leads. Your assigned leads are in your queue." />;
  // The same page as /app/assignments (2026-10-26), the pool a view on it. Without dialing there is no rule
  // chain to show, only the pool, filling the step; the frame draws the one title (a second one doubled it).
  return (
    <LeadsInPage step="route">
      {hasFeature(guard.entitlement, "outbound_dialing")
        ? <AssignmentWorkspace canManage pool />
        : <div className="m-stagger flex w-full min-w-0 flex-col lg:min-h-0 lg:flex-1"><UnassignedPool fill /></div>}
    </LeadsInPage>
  );
}
