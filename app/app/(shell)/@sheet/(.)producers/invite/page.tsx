import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { InviteProducerForm } from "@/components/app/agency/invite-producer-form";
import { RouteSheet } from "@/components/app/route-sheet";

/**
 * Invite producer, opened from inside the app (owner 2026-11-12): a panel from the right over the page it was opened
 * from (components/app/route-sheet.tsx). The full page (app/app/(shell)/producers/invite) stays for a refresh or a
 * shared link; the same gate as that page.
 */
export default async function InviteProducerSheet() {
  const guard = await guardPage("team_hierarchy");
  if (!guard.entitled) return <RouteSheet title="Invite producer"><FeatureGateNotice guard={guard} featureLabel="Producers" description="Everyone who writes business under your contracts." /></RouteSheet>;
  if (!actAsPage(guard, ["owner"]) || guard.entitlement.access === "read_only") return <RouteSheet title="Invite producer"><RoleGateNotice featureLabel="Invite producer" detail="The owner and admins invite producers." /></RouteSheet>;
  return (
    <RouteSheet title="Invite producer" subtitle="One link, valid for 7 days. Active and suspended members use a seat; invited ones do not.">
      <InviteProducerForm isAccountOwner={guard.context.memberRole !== "admin"} />
    </RouteSheet>
  );
}
