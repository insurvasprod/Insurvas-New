import Link from "next/link";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { scopeFor } from "@/lib/agency/visibility";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";
import { loadTeamSetup } from "@/lib/dashboard/teamSetup";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AgencyPage } from "@/components/app/agency/agency-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { Meter } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";

const ROLE: Record<string, string> = { owner: "Owner", producer: "Producer", setter: "Setter", assistant: "Assistant", bookkeeper: "Bookkeeper", manager: "Manager", retention: "Retention", admin: "Admin" };

/**
 * Home › Agency › Team setup (owner, 2026-11-12/13): whether everyone has finished setting up Insurvas.
 * Opened from the Team setup button on the agency dashboard. One line a row: the agency's own setup first,
 * then each person, least done first, with their next guided step. Same gate as the dashboard.
 */
export default async function TeamSetupPage() {
  const guard = await guardPage("agency_dashboard");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Team setup" description="See who has finished setting up Insurvas." />;
  const manager = guard.context.memberRole === "manager";
  if (!(actAsPage(guard, ["owner", "bookkeeper"]) || manager)) {
    return <RoleGateNotice featureLabel="Team setup" detail="The owner, admins, managers and the bookkeeper see the team's setup." />;
  }
  const context = guard.context;
  const [profile, switches, scope, solo] = await Promise.all([
    getSupabaseServiceClient().from("agency" as never).select("legal_name, dba_name").eq("tenant_id", context.tenantId).maybeSingle<{ legal_name: string; dba_name: string | null }>(),
    loadFeatureSwitches(),
    scopeFor(context),
    isSoloWorkspace(context.tenantId),
  ]);
  const features = applyKillSwitches(guard.entitlement.features, switches, context.tenantId);
  const rows = await loadTeamSetup({
    tenantId: context.tenantId, features: [...features], seats: guard.entitlement.limits.max_seats, solo, scope,
    agencyName: profile.data?.dba_name ?? profile.data?.legal_name ?? "Your agency",
  });
  const people = rows.filter((row) => row.userId !== null);
  const finished = people.filter((row) => row.finished).length;

  return (
    <div className="flex w-full min-w-0 flex-col">
      <AgencyPage
        step="team-setup"
        info="Who has finished setting up Insurvas. Each person follows their own Get started, guided on the real pages."
        actions={<Button asChild variant="outline"><Link href="/app/agency">Back to the dashboard</Link></Button>}
      >
        <TableCard title={people.length ? `${finished} of ${people.length} people finished` : undefined}>
          {people.length === 0 && rows.length <= 1 ? (
            <EmptyState title="Nobody to show yet" hint="Invite your team from Settings › Team & access. Their setup shows here." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Person</th>
                  <th className="px-4 py-3 font-medium max-md:hidden">Role</th>
                  <th className="w-56 px-4 py-3 font-medium">Progress</th>
                  <th className="px-4 py-3 font-medium max-lg:hidden">Next step</th>
                  <th className="px-4 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.userId ?? "agency"} className="border-b border-border last:border-b-0">
                    <td className="max-w-0 truncate px-4 py-2.5 font-medium text-foreground">{row.name}</td>
                    <td className="px-4 text-muted-foreground max-md:hidden">{ROLE[row.role] ?? row.role}</td>
                    <td className="px-4">
                      <span className="flex items-center gap-3">
                        <Meter value={row.done} max={Math.max(row.total, 1)} tone="primary" label={`${row.done} of ${row.total} steps done`} className="w-28" />
                        <span className="text-xs text-muted-foreground tabular-nums">{row.done} of {row.total}</span>
                      </span>
                    </td>
                    <td className="max-w-0 truncate px-4 text-muted-foreground max-lg:hidden">{row.finished ? "—" : row.invited ? "Accept the invite" : row.next ?? "—"}</td>
                    <td className="px-4 text-right">
                      {row.finished ? <StatusChip tone="good">Finished</StatusChip> : row.invited ? <StatusChip tone="info">Invited</StatusChip> : row.done === 0 ? <StatusChip tone="warning">Not started</StatusChip> : <StatusChip tone="action">In progress</StatusChip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </AgencyPage>
    </div>
  );
}
