import { redirect } from "next/navigation";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { visibleDashboardTiles } from "@/lib/dashboard/tiles";
import { setupChecklistForState } from "@/lib/dashboard/checklist";
import { getDashboardOnboardingState } from "@/lib/dashboard/service";
import { DashboardTile } from "@/components/app/dashboard-tile";
import { SetupChecklist } from "@/components/app/setup-checklist";
import { Card, CardContent } from "@/components/ui/card";
import { listDueCallbacks } from "@/lib/callbacks/service";
import Link from "next/link";

import { LinkArrow } from "@/components/ui/link-arrow";
import { StatusChip } from "@/components/ui/status-chip";

/**
 * The dashboard is a frame for registered module tiles. It does not know how to render a carrier,
 * appointment, retention or money module; those modules register data in `lib/dashboard/tiles`.
 */
export default async function AgentDashboardPage() {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  // The kill-switch table is fetched here rather than inside `effectiveFeatures` because its query
  // depends on neither the entitlement nor the tenant — only applying the switches does. Awaiting
  // it afterwards cost a second serial round trip, ~170ms of ~340ms of data time on this page,
  // for a criterion ("loads in under 1 second") with no room to spare.
  const [entitlement, onboardingState, switches] = await Promise.all([
    getEntitlement(context.tenantId),
    getDashboardOnboardingState(context.tenantId),
    loadFeatureSwitches(),
  ]);
  const available = applyKillSwitches(entitlement.features, switches, context.tenantId);
  const tiles = visibleDashboardTiles(available, context.role);
  const checklist = setupChecklistForState(onboardingState);
  // `available`, not `entitlement.features`. Kill switches are consulted BEFORE the entitlement at
  // every enforcement point (SA-4.10), and `applyKillSwitches` on the line above is what applies
  // them. This read used `hasFeature(entitlement, …)`, which is the raw plan — so switching
  // `callback_calendar` off platform-wide hid the callbacks TILE and left this card rendering and
  // still querying due callbacks. The tile and the card are gated identically in every other
  // respect, which is exactly why the divergence was invisible.
  const callbacksAvailable =
    available.includes("callback_calendar") && ["owner", "producer", "assistant"].includes(context.role);
  const callbacks = callbacksAvailable ? await listDueCallbacks(context.tenantId) : [];

  return (
    <div className="portal-dashboard mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-[40px] font-semibold leading-[1.08] tracking-[-0.03em]">Dashboard</h1>
        <p className="mt-2 text-lg tracking-[-0.02em] text-muted-foreground">Your next steps, in one place.</p>
      </div>

      {context.role === "owner" && <SetupChecklist checklist={checklist} />}

      {callbacksAvailable && (
        <Card className="portal-dashboard-callbacks">
          <CardContent className="space-y-5 p-6 sm:p-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.02em]">Callbacks due today</h2>
                <p className="mt-1 text-sm text-muted-foreground">Follow up with these prospects and clients.</p>
              </div>
              <LinkArrow href="/app/callbacks">Open calendar</LinkArrow>
            </div>

            {callbacks.length > 0 ? (
              <div className="portal-dashboard-callback-list">
                {callbacks.slice(0, 4).map((callback) => (
                  <div key={callback.id} className="portal-dashboard-callback-row">
                    <span className="portal-dashboard-avatar" aria-hidden="true">
                      {callback.customerName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{callback.customerName}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {callback.customerTime} ({callback.customerTimezone})
                      </p>
                    </div>
                    <StatusChip tone={callback.isOverdue ? "danger" : "info"} dot>
                      {callback.isOverdue ? "Overdue" : "Due today"}
                    </StatusChip>
                    <Link href="/app/callbacks" className="portal-dashboard-call-action">Call now</Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border p-6 text-center">
                <p className="text-sm font-semibold">No callbacks are due today</p>
                <p className="mt-1 text-xs text-muted-foreground">Scheduled callbacks appear here on the day they are due.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tiles.length > 0 ? (
        <section aria-labelledby="dashboard-tiles-heading" className="space-y-3">
          <div>
            <h2 id="dashboard-tiles-heading" className="text-2xl font-semibold tracking-[-0.02em]">Your workspace</h2>
            <p className="mt-1 text-sm text-muted-foreground">Quick access to the tools you use most.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {tiles.map((tile) => <DashboardTile key={tile.key} tile={tile} />)}
          </div>
        </section>
      ) : (
        /* Two different empty states, because they have two different causes and two different
           answers. The entitlement genuinely granting nothing is the owner's problem to solve. A
           plan full of features with no tile for this role is ours, and telling that reader to go
           and ask their owner sends them after a fix the owner cannot make. */
        <Card>
          <CardContent className="space-y-2 py-8 text-center">
            {available.length === 0 ? (
              <>
                <h2 className="font-semibold">Your workspace is waiting for its first feature</h2>
                <p className="mx-auto max-w-[52ch] text-sm text-muted-foreground">
                  Ask your account owner to activate a workspace feature, then come back here to start using it.
                </p>
              </>
            ) : (
              <>
                <h2 className="font-semibold">Nothing pinned here yet</h2>
                <p className="mx-auto max-w-[52ch] text-sm text-muted-foreground">
                  Your plan is active and your workspace is open — this dashboard just has no shortcut
                  for your role yet. Use the sidebar to reach the screens you work in.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
