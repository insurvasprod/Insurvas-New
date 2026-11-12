import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { InviteProducerForm } from "@/components/app/agency/invite-producer-form";
import { AgencyPage } from "@/components/app/agency/agency-page";

/**
 * AG-0.6 · Agency › Producers › Invite producer. Opened from inside the app it is a panel from the right over the page
 * it was opened from (owner 2026-11-12; app/app/(shell)/@sheet/(.)producers/invite); this full page is what a refresh
 * or a shared link opens. The owner and admins invite; only the account owner may invite an admin or upgrade a full
 * band. `?invite=1` on the roster (older links) is this page.
 */
export default async function InviteProducerPage() {
  const guard = await guardPage("team_hierarchy");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producers" description="Everyone who writes business under your contracts." />;
  if (!actAsPage(guard, ["owner"]) || guard.entitlement.access === "read_only") return <RoleGateNotice featureLabel="Invite producer" detail="The owner and admins invite producers." />;
  return (
    <AgencyPage step="producers" title="Invite producer" facts="One link, valid for 7 days. Active and suspended members use a seat; invited ones do not.">
      <InviteProducerForm isAccountOwner={guard.context.memberRole !== "admin"} />
    </AgencyPage>
  );
}
