import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PartnerPortalPage } from "@/lib/partnerAuth/portalAccess";
import { PartnerPortalWorkspace, type PartnerPortalSection } from "@/components/partner/partner-portal-workspace";

import { partnerPageContext } from "./page-gate";

/** The portal page each section belongs to, for the type-and-role rule (lib/partnerAuth/portalAccess.ts). */
const SECTION_PAGE: Record<PartnerPortalSection, PartnerPortalPage> = {
  overview: "overview",
  submit: "submit",
  pipeline: "pipeline",
  team: "team",
  "team-review": "team-review",
  messages: "messages",
  settings: "settings",
};

export async function PartnerPortalSectionPage({ section, initialDraftId }: { section: PartnerPortalSection; initialDraftId?: string | null }) {
  // Signed out → login; a page this partner's type or role does not get → home (the admin-only team
  // pages included, as before).
  const context = await partnerPageContext(SECTION_PAGE[section]);
  const agencyName = section === "submit"
    ? (await getSupabaseServiceClient().from("tenants").select("name").eq("id", context.tenantId).maybeSingle<{ name: string }>()).data?.name ?? null
    : null;
  const workspace = <PartnerPortalWorkspace agencyName={agencyName} role={context.role} partnerStatus={context.partnerStatus} partnerId={context.partnerId} partnerName={context.partnerName} partnerTimezone={context.partnerTimezone} partnerType={context.partnerType} section={section} initialDraftId={initialDraftId} />;
  // Messages is a chat, not a document: it fills the stage down to the page margin rather than
  // stopping at its content and leaving a band of empty page under it (owner, 30 Oct). The wrapper
  // only passes the stage's height down; it no longer restyles the page (the .portal-partner-
  // messages-page rules are gone — they also made this one page's buttons pills, against §5a).
  return section === "messages" ? <div className="flex min-h-0 flex-1 flex-col">{workspace}</div> : workspace;
}
