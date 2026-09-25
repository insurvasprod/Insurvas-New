import Link from "next/link";
import { ListPlus } from "lucide-react";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { LeadListWorkspace } from "@/components/app/lead-list-workspace";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { sectionForPath } from "@/lib/menu/definition";

export default async function LeadListsPage() {
  const guard = await guardPage("lead_import");
  if (!guard.entitled)
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Lead lists"
        description="What you bought from each vendor, how much of it arrived, and how much of it nobody has touched."
      />
    );
  // A setter works the queue they are given; deciding which list to work through, and who gets it,
  // is the licensed agent's call. Same roles as the assignment screen this hands off to.
  if (!["owner", "producer", "assistant"].includes(guard.role))
    return <RoleGateNotice featureLabel="Lead lists" detail="Only owners, producers and assistants can hand out leads." />;

  return (
    <div className="m-stagger space-y-6">
      <PageHeader
        eyebrow={sectionForPath("/app/lead-lists") ?? undefined}
        title="Lead lists"
        description="Every list you bought: what survived the scrub, what you cannot legally sell to, and how far through it you are."
        actions={
          <>
            {/* Offered only to people Vendor returns will open for — its own feature and roles —
                so the button never leads to a locked door. */}
            {guard.entitlement.features.includes("true_cpa") && ["owner", "producer"].includes(guard.role) && (
              <Button asChild type="button" variant="outline" className="h-11 border-[var(--border-strong)] px-4">
                <Link href="/app/vendor-returns">Claim credits</Link>
              </Button>
            )}
            <Button asChild type="button" className="h-11 px-4">
              <Link href="/app/import"><ListPlus aria-hidden="true" />Import a list</Link>
            </Button>
          </>
        }
      />
      <LeadListWorkspace />
    </div>
  );
}
