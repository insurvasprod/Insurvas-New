import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ActivityLogWorkspace } from "@/components/app/activity-log-workspace";
import { DashboardStage } from "@/components/ui/dashboard-stage";

/**
 * Enforcement point 2 of 3.
 *
 * This page had no guard — the only one in the shell without one. No data leaked, because
 * `/api/app/activity` and `/api/app/scorecard` both enforce the same feature and roles. What the
 * reader got instead was the full page chrome, then error toasts and permanently empty panels,
 * where every other gated page shows a notice explaining why.
 *
 * The roles below are the ones the two routes already enforce: `requireFeatureRole` on activity and
 * `requireTenant(SCORECARD_ROLES)` on the scorecard. Keep the three in step.
 */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled) {
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Team activity"
        description="Per-agent dialing activity, setter outcomes, and fresh-versus-recycled performance."
      />
    );
  }
  if (!actAsPage(guard, ["owner", "producer", "setter"])) {
    return (
      <RoleGateNotice
        featureLabel="Team activity"
        detail="Only owners, producers, and setters have a dialing scorecard."
      />
    );
  }
  // ?view= opens a tab (2026-10-26: Agents, Call log, Setters, To review). scorecard → Agents — the old
  // /app/scorecard route redirects here with it — integrity → To review, log → Call log.
  const { view } = await searchParams;
  const initialView = view === "integrity" ? "review" : view === "log" || view === "activity" ? "log" : view === "setters" ? "setters" : "agents";
  // The role decides only what the page offers (the zero-click review is owners' and producers');
  // /api/app/activity enforces the same rule on its own.
  return <DashboardStage ribbon><ActivityLogWorkspace initialView={initialView} role={guard.role} /></DashboardStage>;
}
