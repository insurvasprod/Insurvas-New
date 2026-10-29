import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { LeadImportWorkspace } from "@/components/app/lead-import-workspace";
import { LeadsInPage } from "@/components/app/lead-sources/leads-in";

/** List import is step 2 of the one Leads page (owner pick B, 2026-10-28); its review, /app/import/review/[batchId], is step 3 · Clean. */
export default async function LeadImportPage() {
  const guard = await guardPage("lead_import");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="List import" description="Import vendor lead lists, scrubbed before anyone dials." />;
  if (!("owner" === guard.role || "producer" === guard.role || "assistant" === guard.role)) return <RoleGateNotice featureLabel="List import" detail="Only owners, producers and assistants can import leads." />;
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="List import" detail="In an agency, the owner and admins handle list import." />;
  return <LeadsInPage step="import" ownContinue><LeadImportWorkspace embedded readOnly={guard.entitlement.access === "read_only"} /></LeadsInPage>;
}
