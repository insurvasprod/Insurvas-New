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
  // Messages is a chat, not a document: it fills the stage down to the page margin rather than
  // stopping at its content and leaving a band of empty page under it (owner, 30 Oct). The wrapper
  // only passes the stage's height down; it no longer restyles the page (the .portal-partner-
  // messages-page rules are gone — they also made this one page's buttons pills, against §5a).
  return section === "messages" ? <div className="flex min-h-0 flex-1 flex-col">{workspace}</div> : workspace;
}
