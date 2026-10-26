import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { LeadSourcesPage } from "@/components/app/lead-sources/pages";

/** Vendors & campaigns is a tab of Lead sources (2026-10-26); this address opens that tab, behind its own gate. */
export default async function CampaignsPage() {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled)
    return <FeatureGateNotice guard={guard} featureLabel="Vendors & campaigns" description="Track lead vendors, batch costs and cost per usable lead." />;
  // Owner and producer only, matching the routes this screen reads. The page shows spend and cost
  // per lead, so the gate here has to be the same one the API enforces — a screen that renders for
  // a role the API refuses is just a page of error toasts.
  if (!("owner" === guard.role || "producer" === guard.role))
    return <RoleGateNotice featureLabel="Vendors & campaigns" detail="Only owners and producers can see lead spend and vendor costs." />;
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Vendors & campaigns" detail="In an agency, the owner and admins handle vendors and lead spend." />;
  return <LeadSourcesPage tab="campaigns" />;
}
