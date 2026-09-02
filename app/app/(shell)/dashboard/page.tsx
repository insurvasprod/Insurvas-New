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
import { listDueCallbacks } from "@/lib/callbacks/service";
import { hasFeature } from "@/lib/entitlements/types";
import Link from "next/link";

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
  const callbacks = hasFeature(entitlement, "callback_calendar") && ["owner", "producer", "assistant"].includes(context.role) ? await listDueCallbacks(context.tenantId) : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">Your next steps, in one place.</p>
      </div>

      {context.role === "owner" && <SetupChecklist checklist={checklist} />}

      {hasFeature(entitlement, "callback_calendar") && <Card><CardContent className="space-y-3 p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Callbacks due today</h2><p className="text-sm text-muted-foreground">{callbacks.length} due or overdue follow-up{callbacks.length === 1 ? "" : "s"}.</p></div><Link href="/app/callbacks" className="text-sm font-semibold underline">Open calendar</Link></div>{callbacks.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{callbacks.slice(0, 4).map((callback) => <div key={callback.id} className="rounded-md border p-3"><p className="font-medium">{callback.customerName}</p><p className="text-xs text-muted-foreground">{callback.isOverdue ? "Overdue" : "Due today"} · {callback.customerTime} ({callback.customerTimezone})</p></div>)}</div>}</CardContent></Card>}

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
