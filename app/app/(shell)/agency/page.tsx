import Link from "next/link";
import { Suspense } from "react";
import { GitCompareArrows, ListChecks, Plus } from "lucide-react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { scopeFor } from "@/lib/agency/visibility";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AgencyPage } from "@/components/app/agency/agency-page";
import { AgencyPeriodSelect } from "@/components/app/agency/period-select";
import { AgencyView } from "@/components/app/home/views/agency-view";
import type { DashViewProps } from "@/components/app/home/views/view-props";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/page-loading";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * AG-0.11 · the agency dashboard, Home › Agency, drawn as round 2 screens 1–2 of the canvas "Dashboards · by role"
 * (owner 2026-11-06: "exactly how the mockups are"). The month is kept in ?period=; the cards are
 * components/app/home/views/agency-view. Owner, admin, bookkeeper; a manager sees his reports and no agency money;
 * a producer never. Full width; a little scroll below the fold is fine (owner, second pass).
 */
export default async function AgencyDashboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const guard = await guardPage("agency_dashboard");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Agency dashboard" description="Which of your producers is actually making you money." />;
  const manager = guard.context.memberRole === "manager";
  if (!(actAsPage(guard, ["owner", "bookkeeper"]) || manager)) {
    return <RoleGateNotice featureLabel="Agency dashboard" detail="The owner, admins, managers and the bookkeeper see the agency dashboard." />;
  }
  const context = guard.context;
  const [{ period: asked }, profile, switches, scope, solo, zone] = await Promise.all([
    searchParams,
    getSupabaseServiceClient().from("agency" as never).select("legal_name, dba_name").eq("tenant_id", context.tenantId).maybeSingle<{ legal_name: string; dba_name: string | null }>(),
    loadFeatureSwitches(),
    scopeFor(context),
    isSoloWorkspace(context.tenantId),
    getWorkspaceTimezone(context.tenantId).catch(() => null),
  ]);
  const period = asked === "last" ? "last" : "this";
  const agencyName = profile.data?.dba_name ?? profile.data?.legal_name ?? "Your agency";
  const available = applyKillSwitches(guard.entitlement.features, switches, context.tenantId);
  const canInvite = guard.role === "owner" && guard.entitlement.access !== "read_only";
  // eslint-disable-next-line react-hooks/purity -- a server render: "today" is as of this request.
  const now = Date.now();
  const props: DashViewProps = { context, available: [...available], scope, solo, zone: zone ?? "America/New_York", now, noMoney: manager };

  return (
    // Owner 2026-11-06 (second pass): "a bit of scroll" is fine here, so each card has room to say more.
    <div className="flex w-full min-w-0 flex-col">
      <AgencyPage
        step="overview"
        info={manager ? "Your reports: what they wrote, what it is worth, and what is at risk." : "Which of your producers is actually making the agency money."}
        actions={
          <>
            <AgencyPeriodSelect value={period} />
            <span className="inline-flex h-9 max-w-56 items-center truncate rounded-[10px] border border-border px-3 text-[0.8125rem] font-semibold text-foreground">{agencyName}</span>
            <Button asChild variant="outline"><Link href="/app/agency/compare"><GitCompareArrows className="size-4" aria-hidden="true" />Compare</Link></Button>
            {/* Team setup (owner, 2026-11-13): who has finished setting up Insurvas, its own sub-page. */}
            <Button asChild variant="outline"><Link href="/app/agency/team-setup"><ListChecks className="size-4" aria-hidden="true" />Team setup</Link></Button>
            {canInvite && <Button asChild><Link href="/app/producers/invite"><Plus className="size-4" aria-hidden="true" />Invite producer</Link></Button>}
          </>
        }
      >
        <Suspense key={period} fallback={<PageLoading />}>
          <AgencyView props={props} period={period} />
        </Suspense>
      </AgencyPage>
    </div>
  );
}
