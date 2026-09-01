import { redirect } from "next/navigation";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { effectiveFeatures } from "@/lib/features/killSwitch";
import { visibleDashboardTiles } from "@/lib/dashboard/tiles";
import { setupChecklistForState } from "@/lib/dashboard/checklist";
import { getDashboardOnboardingState } from "@/lib/dashboard/service";
import { DashboardTile } from "@/components/app/dashboard-tile";
import { SetupChecklist } from "@/components/app/setup-checklist";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The dashboard is a frame for registered module tiles. It does not know how to render a carrier,
 * appointment, retention or money module; those modules register data in `lib/dashboard/tiles`.
 */
export default async function AgentDashboardPage() {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  const [entitlement, onboardingState] = await Promise.all([
    getEntitlement(context.tenantId),
    getDashboardOnboardingState(context.tenantId),
  ]);
  const available = await effectiveFeatures(entitlement.features, context.tenantId);
  const tiles = visibleDashboardTiles(available, context.role);
  const checklist = setupChecklistForState(onboardingState);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">Your next steps, in one place.</p>
      </div>

      {context.role === "owner" && <SetupChecklist checklist={checklist} />}

      {tiles.length > 0 ? (
        <section aria-labelledby="dashboard-tiles-heading" className="space-y-3">
          <div>
            <h2 id="dashboard-tiles-heading" className="text-sm font-bold uppercase tracking-wide text-[var(--color-accent-ink)]">Your workspace</h2>
            <p className="mt-1 text-sm text-muted-foreground">Start with the information your account is ready to use.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {tiles.map((tile) => <DashboardTile key={tile.key} tile={tile} />)}
          </div>
        </section>
      ) : (
        <Card>
          <CardContent className="space-y-2 py-8 text-center">
            <h2 className="font-semibold">Your workspace is waiting for its first feature</h2>
            <p className="mx-auto max-w-[52ch] text-sm text-muted-foreground">
              Ask your account owner to activate a workspace feature, then come back here to start using it.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
