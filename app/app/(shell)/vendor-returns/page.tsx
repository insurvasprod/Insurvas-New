import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { VendorReturnsWorkspace } from "@/components/app/vendor-returns-workspace";
import { guardPage } from "@/lib/entitlements/guardPage";
import { sectionForPath } from "@/lib/menu/definition";

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
        description="Prepare evidence-backed return claims and reconcile vendor credits without losing the source history."
        eyebrow={sectionForPath("/app/vendor-returns") ?? undefined}
      />
    );
  }
  if (!["owner", "producer", "bookkeeper"].includes(guard.role)) {
    return (
      <RoleGateNotice
        featureLabel="Vendor returns"
        detail="Owners, producers, and bookkeepers can review vendor return claims."
        eyebrow={sectionForPath("/app/vendor-returns") ?? undefined}
      />
    );
  }
  // The header is drawn by the workspace, because its New claim action needs the claimable rows.
  return <VendorReturnsWorkspace eyebrow={sectionForPath("/app/vendor-returns") ?? undefined} initialVendorId={initialVendorId} />;
}
