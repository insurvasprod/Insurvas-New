import { PartnerPortalWorkspace } from "@/components/partner/partner-portal-workspace";

import { partnerPageContext } from "./page-gate";

export default async function PartnerPortalPage() {
  const context = await partnerPageContext("overview");
  return (
    <div className="portal-partner-dashboard-page">
      {/* The home follows the partner's type (roles board P1–P3): partner-type-overview.tsx. */}
      <PartnerPortalWorkspace role={context.role} partnerStatus={context.partnerStatus} partnerId={context.partnerId} partnerName={context.partnerName} partnerType={context.partnerType} />
    </div>
  );
}
