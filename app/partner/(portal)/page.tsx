import { redirect } from "next/navigation";
import { resolvePartnerContext } from "@/lib/partnerAuth/requirePartner";
import { PartnerPortalWorkspace } from "@/components/partner/partner-portal-workspace";

export default async function PartnerPortalPage() {
  const context = await resolvePartnerContext();
  if (!context) redirect("/partner/login");
  return <PartnerPortalWorkspace role={context.role} partnerStatus={context.partnerStatus} />;
}
