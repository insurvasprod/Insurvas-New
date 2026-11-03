import Link from "next/link";
import { redirect } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { FinishSetupButton, ProducersRoster } from "@/components/app/agency/producers-roster";
import { rosterFilterOf } from "@/lib/agency/rosterFilter";
import { AgencyPage } from "@/components/app/agency/agency-page";
import { Button } from "@/components/ui/button";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { needsUpgrade } from "@/lib/agency/upgradeStore";

/**
 * AG-1.1 · Agency › Producers, the second step of Home › Agency (2026-11-03). The owner, an admin and the bookkeeper
 * see everyone; a manager his reports. A producer opening it lands on his OWN record instead of a roster. On the
 * title line: Invite producer (a page, /app/producers/invite) and, until it is done, Finish agency setup.
 * `?status=` opens a filter (a strip figure's rows; `blocked` = working producers who cannot submit yet).
 */
export default async function ProducersPage({ searchParams }: { searchParams: Promise<{ status?: string; invite?: string }> }) {
  const guard = await guardPage("team_hierarchy");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producers" description="Everyone who writes business under your contracts." />;
  const manager = guard.context.memberRole === "manager";
  if (guard.role === "producer" && !manager) {
    const { data } = await getSupabaseServiceClient().from("producer" as never).select("id").eq("tenant_id", guard.context.tenantId).eq("user_id", guard.context.userId).maybeSingle<{ id: string }>();
    if (data) redirect(`/app/producers/${data.id}`);
    return <RoleGateNotice featureLabel="Producers" detail="Your producer record is set up when you accept your invitation." />;
  }
  if (!(actAsPage(guard, ["owner", "bookkeeper"]) || manager)) return <RoleGateNotice featureLabel="Producers" detail="The owner, admins, managers and the bookkeeper see the roster." />;
  const canManage = guard.role === "owner" && guard.entitlement.access !== "read_only";
  const accountOwner = guard.role === "owner" && guard.context.memberRole !== "admin";
  const [{ status, invite }, upgrade] = await Promise.all([searchParams, accountOwner ? needsUpgrade(guard.context.tenantId) : Promise.resolve(false)]);
  // The roster's old invite pop-up address (the agency dashboard, bookmarks) is the invite page now.
  if (invite === "1" && canManage) redirect("/app/producers/invite");
  return (
    <AgencyPage
      step="producers"
      info="Everyone who writes business under your agency's contracts: their status, this month's production, what they are owed and whether they may submit yet. A pending invite is a row from the moment it is sent; offboarded producers stay behind the filter."
      actions={<>
        {canManage && upgrade && <FinishSetupButton />}
        {canManage && <Button asChild><Link href="/app/producers/invite">Invite producer</Link></Button>}
      </>}
    >
      <ProducersRoster initialFilter={rosterFilterOf(status)} />
    </AgencyPage>
  );
}
