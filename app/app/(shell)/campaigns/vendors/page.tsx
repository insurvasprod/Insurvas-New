import { guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CampaignWorkspace } from "@/components/app/campaign-workspace";
import { LeadsInPage } from "@/components/app/lead-sources/leads-in";

/**
 * Source › Vendors (owner 2026-10-30): every vendor in one table, with "Add a vendor" as the page's one
 * primary, and each row's edit (its Settings tab) and delete. A row opens the vendor's own page.
 * Same gate as Vendors & campaigns.
 */
export default async function VendorsPage() {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled)
    return <FeatureGateNotice guard={guard} featureLabel="Vendors & campaigns" description="Track lead vendors, batch costs and cost per usable lead." />;
  if (!("owner" === guard.role || "producer" === guard.role))
    return <RoleGateNotice featureLabel="Vendors & campaigns" detail="Only owners and producers can see lead spend and vendor costs." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Vendors & campaigns" detail="In an agency, the owner and admins handle vendors and lead spend." />;
  return (
    <LeadsInPage step="source" ownContinue>
      <CampaignWorkspace embedded vendorsPage readOnly={guard.entitlement.access === "read_only"} />
    </LeadsInPage>
  );
}
