import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { ContactWorkspace } from "@/components/app/contact-workspace";
import { LeadsInPage } from "@/components/app/lead-sources/leads-in";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";

export default async function DuplicatesPage() {
  const [guard, lists, outbound, returns] = await Promise.all([guardPage("duplicate_detection"), guardPage("lead_import"), guardPage("outbound_dialing"), guardPage("true_cpa")]);
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Duplicate check" description="Catch household duplicates before you pay twice." />;
  // The contact APIs admit these three roles; anyone else would reach a page whose every read 403s.
  if (!actAsPage(guard, ["owner", "producer", "assistant"])) {
    return <RoleGateNotice featureLabel="Duplicate check" detail="Only owners, producers and assistants can review and merge contacts." />;
  }
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Duplicate check" detail="In an agency, the owner and admins review and merge duplicate contacts." />;
  // List problems (owner 2026-10-29): Lists' own gates — GET /api/app/lead-lists admits these roles on
  // lead_import; the scrub is the owner's on outbound_dialing; claims open on true_cpa for owners and producers.
  const canLists = lists.entitled && holdsAnyRole(lists.roles, ["owner", "producer", "assistant"]);
  const listProblems = canLists ? {
    scrubPanel: outbound.entitled && holdsAnyRole(outbound.roles, ["owner", "producer"]),
    owner: outbound.entitled && holdsAnyRole(outbound.roles, ["owner"]),
    claim: returns.entitled && holdsAnyRole(lists.roles, ["owner", "producer"]),
    readOnly: lists.entitlement.access === "read_only",
  } : null;
  // Step 3 · Clean of the one Leads page (owner pick B, 2026-10-28).
  return <LeadsInPage step="clean"><ContactWorkspace readOnly={guard.entitlement.access !== "full"} listProblems={listProblems} /></LeadsInPage>;
}
