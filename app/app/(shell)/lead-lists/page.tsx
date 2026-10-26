import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { LeadSourcesPage } from "@/components/app/lead-sources/pages";

/**
 * Lead lists is a tab of Lead sources (2026-10-26). Rendered here rather than redirected, so the
 * per-lead view's `/app/lead-lists#<campaignId>` links (global search, the list page) keep their hash.
 */
export default async function LeadListsPage() {
  const guard = await guardPage("lead_import");
  if (!guard.entitled)
    return <FeatureGateNotice guard={guard} featureLabel="Lead lists" description="What each bought list delivered, and what is still untouched." />;
  // A setter works the queue they are given; deciding which list to work through, and who gets it,
  // is the licensed agent's call. Same roles as the assignment screen this hands off to.
  if (!actAsPage(guard, ["owner", "producer", "assistant"]))
    return <RoleGateNotice featureLabel="Lead lists" detail="Only owners, producers and assistants can hand out leads." />;
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Lead lists" detail="In an agency, the owner and admins handle lead lists." />;
  return <LeadSourcesPage tab="lists" />;
}
