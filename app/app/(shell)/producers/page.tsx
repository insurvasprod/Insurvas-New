import { Suspense } from "react";
import { redirect } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ProducersRoster } from "@/components/app/agency/producers-roster";
import { PageLoading } from "@/components/ui/page-loading";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { needsUpgrade } from "@/lib/agency/upgradeStore";

/**
 * AG-1.1 · Team › Producers. The owner, an admin and the bookkeeper see everyone; a manager his reports. A producer
 * opening it lands on his OWN record instead of a roster.
 */
export default async function ProducersPage() {
  const guard = await guardPage("team_hierarchy");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producers" description="Everyone who writes business under your contracts." />;
  const manager = guard.context.memberRole === "manager";
  if (guard.role === "producer" && !manager) {
    const { data } = await getSupabaseServiceClient().from("producer" as never).select("id").eq("tenant_id", guard.context.tenantId).eq("user_id", guard.context.userId).maybeSingle<{ id: string }>();
    if (data) redirect(`/app/producers/${data.id}`);
    return <RoleGateNotice featureLabel="Producers" detail="Your producer record is set up when you accept your invitation." />;
  }
  if (!(["owner", "bookkeeper"].includes(guard.role) || manager)) return <RoleGateNotice featureLabel="Producers" detail="The owner, admins, managers and the bookkeeper see the roster." />;
  const accountOwner = guard.role === "owner" && guard.context.memberRole !== "admin";
  return (
    <Suspense fallback={<PageLoading />}>
      <ProducersRoster isAccountOwner={accountOwner} canManage={guard.role === "owner"} needsUpgrade={guard.role === "owner" && (await needsUpgrade(guard.context.tenantId))} />
    </Suspense>
  );
}
