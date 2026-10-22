import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { VendorReturnsWorkspace } from "@/components/app/vendor-returns-workspace";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?vendor=<id>` opens the page filtered to one vendor — Vendors links its claimable line here. */
export default async function VendorReturnsPage({ searchParams }: { searchParams: Promise<{ vendor?: string | string[] }> }) {
  const { vendor } = await searchParams;
  const initialVendorId = typeof vendor === "string" && UUID.test(vendor) ? vendor : undefined;
  const guard = await guardPage("true_cpa");
  if (!guard.entitled) {
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Vendor returns"
        description="Claim returns from vendors and reconcile their credits."
      />
    );
  }
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) {
    return (
      <RoleGateNotice
        featureLabel="Vendor returns"
        detail="Owners, producers, and bookkeepers can review vendor return claims."
      />
    );
  }
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Vendor returns" detail="In an agency, the owner and admins handle vendor returns." />;
  // The header is drawn by the workspace, because its New claim action needs the claimable rows.
  return <VendorReturnsWorkspace initialVendorId={initialVendorId} />;
}
