import { redirect } from "next/navigation";
import { after as afterResponse } from "next/server";
import Link from "next/link";
import { Suspense } from "react";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { setupChecklistForState } from "@/lib/dashboard/checklist";
import { loadSetupGuideState, loadSetupProfile, loadSetupProgress, recordSetupFinished } from "@/lib/dashboard/setupProgress";
import { getDashboardOnboardingState } from "@/lib/dashboard/service";
import { firstOpenable, HOME_SECTIONS, resolveRoleHome, type HomeMoneyKey } from "@/lib/dashboard/roleHome";
import { greeting } from "@/lib/dashboard/todayMath";
import { homeRole, type AttentionLinks } from "@/lib/dashboard/homeView";
import { dashboardViews, pickDashboardView, type DashboardViewKey } from "@/lib/dashboard/views";
import { scopeFor } from "@/lib/agency/visibility";
import { scopeWithSelf } from "@/lib/dashboard/scope";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { getDashboardToday, readFirstName, type DashboardToday } from "@/lib/dashboard/today";
import { getDashboardMoney, type DashboardMoney } from "@/lib/dashboard/money";
import { pendingSummary } from "@/lib/applications/pending";
import { loadSalesSnapshot } from "@/lib/dashboard/views/sales";
import { listDueCallbacks } from "@/lib/callbacks/service";
import { SetupCelebration } from "@/components/app/setup/setup-celebration";
import { NextCallback } from "@/components/app/dashboard-today";
import { HomeSetup } from "@/components/app/home/home-extras";
import { OverviewView } from "@/components/app/home/views/overview-view";
import { LeadsView } from "@/components/app/home/views/leads-view";
import { RetentionView } from "@/components/app/home/views/retention-view";
import { BookView } from "@/components/app/home/views/book-view";
import { AccountingView } from "@/components/app/home/views/accounting-view";
import { ComplianceView } from "@/components/app/home/views/compliance-view";
import type { DashViewProps } from "@/components/app/home/views/view-props";
import { PageLoading } from "@/components/ui/page-loading";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ViewTabs } from "@/components/ui/view-tabs";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-states";

/**
 * The agent dashboard (owner 2026-11-06, canvas "Dashboards · by role", rounds 2–3).
 *
 *   title line   the greeting, the views (Overview and one per module of the plan this role may open,
 *                kept in ?view=), the live next callback and the role's actions
 *   Overview     what waits on this person across modules, calls, today's rate, the plan's modules, the
 *                week or the team, the money card and today's schedule
 *   a module     that module's own needs, chart, figures, lists (components/app/home/views/*)
 *
 * Full width with the sidebar open or collapsed; every element opens the exact page behind it. What a
 * role's home may show is still `resolveRoleHome` (lib/dashboard/roleHome) and the menu's gates
 * (`firstOpenable`), so nothing appears that the reader cannot open. AG-0.5 producer isolation is
 * unchanged: the session's scope (`scopeFor`) goes to every read.
 */
export default async function AgentDashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  const [{ view: asked }, entitlement, onboardingState, switches, setupProgress, setupProfile, setupGuide, workspaceZone, firstName, scope, solo] = await Promise.all([
    searchParams,
    getEntitlement(context.tenantId),
    getDashboardOnboardingState(context.tenantId),
    loadFeatureSwitches(),
    loadSetupProgress(context.tenantId),
    loadSetupProfile(context.tenantId),
    loadSetupGuideState(context.tenantId, context.userId),
    getWorkspaceTimezone(context.tenantId).catch(() => null),
    readFirstName(context.userId),
    scopeFor(context),
    // Solo mode: an individual agent with no other caller does not see the team-only tiles, step or action.
    isSoloWorkspace(context.tenantId),
  ]);
  const available = applyKillSwitches(entitlement.features, switches, context.tenantId);
  const checklist = setupChecklistForState(onboardingState, setupProgress, { features: available, profile: setupProfile, seats: entitlement.limits.max_seats, marks: setupGuide, solo });
  // LA-0.3: the first render that finds every step done stamps it, after the response.
  if (checklist.complete && !setupProgress.finished) afterResponse(() => recordSetupFinished(context.tenantId));
  const home = resolveRoleHome(available, context.role, { code: entitlement.plan_code, features: entitlement.features, disabled: entitlement.disabled_features }, { solo });
  // A profile with too few tiles skips the dashboard for the plan's primary working screen.
  if (home.landing) redirect(home.landing);

  const views = dashboardViews(available, context.role, solo);
  const view: DashboardViewKey = pickDashboardView(asked, views);
  const shown = new Set(home.sections);
  const open = (keys: readonly string[]) => firstOpenable(keys, available, context.role, solo);
  const role = homeRole(context.role, context.memberRole);
  // A manager leads a team and sees no money (owner, 2026-10-25: "they will not see all the money").
  const noMoney = role === "manager";
  // eslint-disable-next-line react-hooks/purity -- a server render: "today" is as of this request.
  const serverNow = Date.now();
  const zone = workspaceZone ?? "America/New_York";
  const callbacksHref = home.nextCallbackHref;
  const [primary, ...secondary] = home.actions;
  const name = firstName ? `, ${firstName}` : "";

  // One "today" read: the header's next callback and the Overview share it.
  const today: Promise<DashboardToday | null> = getDashboardToday({ tenantId: context.tenantId, userId: context.userId, role: context.role, available: [...available], now: serverNow, reads: home.reads, scope }).catch(() => null);

  const header = (
    <PageHeader
      title={`${greeting(serverNow, zone)}${name}`}
      tabs={views.length > 1 ? <ViewTabs label="Dashboard view" value={view} tabs={views.map((item) => ({ key: item.key, label: item.label, href: item.href }))} /> : undefined}
      actions={
        <>
          {callbacksHref && (
            <Suspense fallback={null}>
              <NextCallbackSlot today={today} href={callbacksHref} serverNow={serverNow} />
            </Suspense>
          )}
          {secondary.map((action) => (
            // The page's one gold feature button (the third brand colour, 2026-11-12): getting on the phone.
            <Button key={action.href} asChild variant={/^start calling$/i.test(action.label) ? "highlight" : "outline"}><Link href={action.href}>{action.label}</Link></Button>
          ))}
          {primary && <Button asChild><Link href={primary.href}>{primary.label}</Link></Button>}
        </>
      }
    />
  );

  const viewProps: DashViewProps = { context, available: [...available], scope, solo, zone, now: serverNow, noMoney };
  if (view !== "overview") {
    return (
      <div className="portal-dashboard flex w-full min-w-0 flex-col gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-56px)] lg:overflow-hidden">
        {header}
        <Suspense key={view} fallback={<PageLoading />}>
          {view === "leads" && <LeadsView {...viewProps} />}
          {view === "retention" && <RetentionView {...viewProps} />}
          {view === "book" && <BookView {...viewProps} />}
          {view === "accounting" && <AccountingView {...viewProps} />}
          {view === "compliance" && <ComplianceView {...viewProps} />}
        </Suspense>
      </div>
    );
  }

  // ── Overview: the reads the home already made, under the same rules ─────────────────────────────
  const wanted: Array<{ key: HomeMoneyKey; href: string }> = noMoney ? [] : [...home.money];
  // Sixteen #15's one upgrade line rides on the money read: only when the agency's own data makes the case.
  const upgrade = shown.has("upgrade") ? home.upgrade : null;
  const money: Promise<DashboardMoney | null> | null = wanted.length > 0 || upgrade ? getDashboardMoney({ context, wanted, upgrade: Boolean(upgrade), scope }).catch(() => null) : null;
  const needHref = (key: string) => home.needs.find((need) => need.key === key)?.href ?? null;
  const activityHref = open(HOME_SECTIONS.activity.opens);
  const calendarHref = open(HOME_SECTIONS.appointments.opens);
  const attentionLinks: AttentionLinks = { transfers: needHref("transfers"), callbacks: needHref("callbacks"), lapse: needHref("lapse"), licences: needHref("licences") };
  const leadsHref = open(["leads.workspace"]);
  const dialerHref = open(["leads.dialer"]);
  const assigned = scopeWithSelf(scope, context.userId);
  const callbacks = callbacksHref ? listDueCallbacks(context.tenantId, assigned).catch(() => null) : Promise.resolve(null);
  // Sales has no view of its own: "Your modules" shows its pending cases and "My recent business" its cases,
  // when the reader may open applications.
  const salesHref = open(["sell.applications"]);
  const sales = salesHref ? { href: salesHref, pending: pendingSummary(context.tenantId, scope).catch(() => null), snapshot: loadSalesSnapshot(context.tenantId, scope).catch(() => null) } : null;
  const setupOpen = shown.has("setup") && !checklist.complete && setupGuide.hiddenAt === null;
  const nothing = available.length === 0;

  // The Overview may scroll a little (owner 2026-11-06, second pass); the module views still fit the screen.
  return (
    <div className="portal-dashboard flex w-full min-w-0 flex-col gap-4">
      {/* The finish moment, when the last step was done somewhere other than the guide bar: this render stamps it. */}
      {shown.has("setup") && checklist.total > 0 && checklist.complete && !setupProgress.finished ? <SetupCelebration steps={checklist.total} done={checklist.completed} audience="owner" /> : null}
      {header}
      {setupOpen && <HomeSetup checklist={checklist} />}
      {nothing ? (
        // A plan granting nothing is the owner's to fix.
        <Card><EmptyState title="No workspace feature is active yet" hint="Ask your account owner to activate one." /></Card>
      ) : (
        <Suspense fallback={<PageLoading />}>
          <OverviewView
            today={today}
            money={money}
            callbacks={callbacks}
            links={attentionLinks}
            pendingHref={shown.has("pending") ? "/app/pending" : null}
            closeOutHref={shown.has("closeOut") ? activityHref : null}
            activityHref={shown.has("activity") || shown.has("figures") ? activityHref : null}
            calendarHref={calendarHref}
            callbacksHref={callbacksHref}
            dialerHref={dialerHref}
            leadHref={(leadId) => (leadsHref ? `/app/leads/${leadId}` : null)}
            upgrade={upgrade}
            zone={zone}
            views={views.map((item) => item.key)}
            viewProps={viewProps}
            sales={sales}
          />
        </Suspense>
      )}
    </div>
  );
}

/** The live next-callback chip in the header: waits on the same "today" read as the Overview. */
async function NextCallbackSlot({ today, href, serverNow }: { today: Promise<DashboardToday | null>; href: string; serverNow: number }) {
  const data = await today;
  if (!data?.nextCallback) return null;
  return <NextCallback callback={data.nextCallback} serverNow={serverNow} href={href} />;
}
