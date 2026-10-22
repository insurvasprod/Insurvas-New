import Link from "next/link";
import { ListPlus } from "lucide-react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { LeadListWorkspace } from "@/components/app/lead-list-workspace";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

export default async function LeadListsPage() {
  const guard = await guardPage("lead_import");
  if (!guard.entitled)
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Lead lists"
        description="What each bought list delivered, and what is still untouched."
      />
    );
  // A setter works the queue they are given; deciding which list to work through, and who gets it,
  // is the licensed agent's call. Same roles as the assignment screen this hands off to.
  if (!actAsPage(guard, ["owner", "producer", "assistant"]))
    return <RoleGateNotice featureLabel="Lead lists" detail="Only owners, producers and assistants can hand out leads." />;
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Lead lists" detail="In an agency, the owner and admins handle lead lists." />;

  return (
    <div className="m-stagger space-y-6">
      <PageHeader
        title="Lead lists"
        actions={
          <>
            {/* Offered only to people Vendor returns will open for — its own feature and roles —
                so the button never leads to a locked door. */}
            {guard.entitlement.features.includes("true_cpa") && holdsAnyRole(guard.roles, ["owner", "producer"]) && (
              <Button asChild type="button" variant="outline">
                <Link href="/app/vendor-returns">Claim credits</Link>
              </Button>
            )}
            <Button asChild type="button">
              <Link href="/app/import"><ListPlus aria-hidden="true" />Import a list</Link>
            </Button>
          </>
        }
      />
      <LeadListWorkspace />
    </div>
  );
}
