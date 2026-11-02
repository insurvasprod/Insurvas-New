import { PartnerPortalSectionPage } from "../section-page";

export default async function SubmitLeadPage({ searchParams }: { searchParams: Promise<{ draft_id?: string | string[] }> }) {
  const params = await searchParams;
  const draftId = typeof params.draft_id === "string" ? params.draft_id : null;
  return <div className="portal-partner-submit-page"><PartnerPortalSectionPage section="submit" initialDraftId={draftId} /></div>;
}
