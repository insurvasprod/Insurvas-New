import { redirect } from "next/navigation";
import { resolvePartnerContext } from "@/lib/partnerAuth/requirePartner";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { PartnerPortalWorkspace, type PartnerPortalSection } from "@/components/partner/partner-portal-workspace";

export async function PartnerPortalSectionPage({ section }: { section: PartnerPortalSection }) {
  const context = await resolvePartnerContext();
  if (!context) redirect("/partner/login");
  if ((section === "team" || section === "team-review") && context.role !== "partner_admin") redirect("/partner");
  const agencyName = section === "submit"
    ? (await getSupabaseServiceClient().from("tenants").select("name").eq("id", context.tenantId).maybeSingle<{ name: string }>()).data?.name ?? null
    : null;
  const workspace = <PartnerPortalWorkspace agencyName={agencyName} role={context.role} partnerStatus={context.partnerStatus} partnerId={context.partnerId} partnerName={context.partnerName} partnerTimezone={context.partnerTimezone} section={section} />;
  return section === "messages" ? <div className="portal-partner-messages-page">{workspace}</div> : workspace;
}
