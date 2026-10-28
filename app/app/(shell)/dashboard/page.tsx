import { redirect } from "next/navigation";
import { after as afterResponse } from "next/server";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { tileFigureShown, visibleDashboardTiles } from "@/lib/dashboard/tiles";
import { setupChecklistForState } from "@/lib/dashboard/checklist";
import { loadSetupGuideState, loadSetupProfile, loadSetupProgress, recordSetupFinished } from "@/lib/dashboard/setupProgress";
import { getDashboardOnboardingState } from "@/lib/dashboard/service";
import { firstOpenable, HOME_MONEY, HOME_SECTIONS, moneyHref, resolveRoleHome, type HomeMoneyKey } from "@/lib/dashboard/roleHome";
import { roleMapKey } from "@/lib/dashboard/roleFlow";
import { greeting, longDate } from "@/lib/dashboard/todayMath";
import { scopeFor } from "@/lib/agency/visibility";
import { scopeWithSelf } from "@/lib/dashboard/scope";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { getDashboardToday, readFirstName, type DashboardToday } from "@/lib/dashboard/today";
import { getDashboardMoney, type DashboardMoney } from "@/lib/dashboard/money";
import type { TileViewer } from "@/lib/dashboard/summaries";
import { SetupCelebration } from "@/components/app/setup/setup-celebration";
import { NextCallback } from "@/components/app/dashboard-today";
import { loadRoleMap, RoleLeadTile, RoleMapLoading, RoleMapView, type FlowPeriod } from "@/components/app/home-map";
import {
  AppointmentsTile, BestHourTile, CallbacksTile, CloseOutRateTile, DialerTile, FloorTile, LapseTile, LicencesTile, ModuleTile, MoneyTile, OutcomesTile,
  PremiumTile, SetterWeekTile, SetupTile, TeamTile, UpgradeTile, WeekTile,
} from "@/components/app/home-tiles";
import { CloseOutTile, PendingTile } from "@/components/app/home-client-tiles";
import { DashTileLoading } from "@/components/ui/dash-tile";
import { Launchpad, type LaunchCell, type LaunchSpace } from "@/components/ui/launchpad";
import { LiveStamp } from "@/components/ui/live-stamp";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-states";

/**
 * The agent home (redesign 2026-10-25, owner: "the map to leads on top, not split; take dashboard C,
 * all of the tiles and the design that it is, copy the exact pattern; delete every other thing").
 *
 *   header      the greeting in the agency's clock, the live next callback, the role's actions
 *   map         this ROLE's map, full width (components/app/home-map, lib/dashboard/roleFlow): an
 *               owner's lead to money, a manager's team flow without money, a producer's own leads to
 *               their own premium, a setter's week, and a path for the assistant, bookkeeper and
 *               retention rep — every stop a link to where that step is done
 *   launchpad   Dashboard C (components/ui/launchpad): workspaces of tiles — Today, Money, Everything —
 *               numbered for 1–9, arranged per person. The first tile is the map's biggest leak or
 *               where to start.
 *
 * Nothing the old sections carried is lost; each is a tile now, under the same gates: what a role's
 * home shows is still `resolveRoleHome` (lib/dashboard/roleHome), section by section — the setup
 * checklist pinned until complete (LA-0.3), the close-out list (decision 12), pending cases (LA-3.15 /
 * 3.18 / 3.26), the upgrade tile (Sixteen #15), callbacks, the money and retention figures (LA-4.18),
 * and every module (LA-0.3's registry) in "Everything".
 *
 * AG-0.5 · producer isolation is unchanged: the session's producer scope (`scopeFor(context)`) goes to
 * every read — today (getDashboardToday), money (getDashboardMoney), callbacks (scope + self), the
 * map's funnel (loadDialFunnel), module figures (tileMetric's viewer); pending and close-out tiles
 * call routes that scope themselves.
 */

/** The live next-callback chip in the header: waits on the same "today" read as the tiles. */
async function NextCallbackSlot({ today, href, serverNow }: { today: Promise<DashboardToday | null>; href: string; serverNow: number }) {
  const data = await today;
  if (!data?.nextCallback) return null;
  return <NextCallback callback={data.nextCallback} serverNow={serverNow} href={href} />;
}

/** A tile that reads: streamed in its own Suspense, a skeleton tile while it does. */
function streamed(title: string, node: ReactNode) {
  return <Suspense fallback={<DashTileLoading title={title} />}>{node}</Suspense>;
}

export default async function AgentDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [context, params] = await Promise.all([resolveTenantContext(), searchParams]);
  if (!context) redirect("/app/login");
  const period: FlowPeriod = params.flow === "7d" || params.flow === "30d" ? params.flow : "today";

  // One round trip for everything the frame needs (as before): the plan, setup state, kill switches,
  // the agency's zone, the reader's first name and the producer scope.
  const [entitlement, onboardingState, switches, setupProgress, setupProfile, setupGuide, workspaceZone, firstName, scope] = await Promise.all([
    getEntitlement(context.tenantId),
    getDashboardOnboardingState(context.tenantId),
    loadFeatureSwitches(),
    loadSetupProgress(context.tenantId),
    loadSetupProfile(context.tenantId),
    loadSetupGuideState(context.tenantId, context.userId),
    getWorkspaceTimezone(context.tenantId).catch(() => null),
    readFirstName(context.userId),
    scopeFor(context),
  ]);
  const available = applyKillSwitches(entitlement.features, switches, context.tenantId);
  const modules = visibleDashboardTiles(available, context.role);
  const checklist = setupChecklistForState(onboardingState, setupProgress, { features: available, profile: setupProfile, seats: entitlement.limits.max_seats, marks: setupGuide });
  // LA-0.3: the first render that finds every step done stamps it, after the response.
  if (checklist.complete && !setupProgress.finished) afterResponse(() => recordSetupFinished(context.tenantId));
  const home = resolveRoleHome(available, context.role, { code: entitlement.plan_code, features: entitlement.features, disabled: entitlement.disabled_features });
  // A profile with too few tiles skips the dashboard for the plan's primary working screen.
  if (home.landing) redirect(home.landing);

  const shown = new Set(home.sections);
  const open = (keys: readonly string[]) => firstOpenable(keys, available, context.role);
  const mapKey = roleMapKey(context.role, context.memberRole);
  // A manager leads a team and sees no money (owner, 2026-10-25: "they will not see all the money"):
  // no premium tile and no Money workspace, whatever the underlying role's home lists.
  const noMoney = mapKey === "manager";
  // eslint-disable-next-line react-hooks/purity -- a server render: "today" is as of this request.
  const serverNow = Date.now();
  const zone = workspaceZone ?? "America/New_York";

  // The money figures: the role's own line, plus what a retention rep's map reads (lapse, persistency).
  const wanted: Array<{ key: HomeMoneyKey; href: string }> = [...home.money];
  if (mapKey === "retention") {
    for (const key of ["lapse", "persistency"] as const) {
      const href = moneyHref(key, available, context.role);
      if (href && !wanted.some((item) => item.key === key)) wanted.push({ key, href });
    }
  }
  const money: Promise<DashboardMoney | null> | null = wanted.length > 0 || home.upgrade
    ? getDashboardMoney({ context, wanted, upgrade: Boolean(home.upgrade), scope }).catch(() => null)
    : null;

  // One "today" read for the tiles, the header chip and the map: only the groups this home uses.
  const today: Promise<DashboardToday | null> = getDashboardToday({ tenantId: context.tenantId, userId: context.userId, role: context.role, available: [...available], now: serverNow, reads: home.reads, scope }).catch(() => null);

  const map = loadRoleMap({ key: mapKey, tenantId: context.tenantId, scope, zone, serverNow, period, open, today, money }).catch(() => null);

  // ── The launchpad: Today, Money, Everything ────────────────────────────────────────────────────
  const todayCells: LaunchCell[] = [];
  const seen = new Set<string>();
  const add = (cell: LaunchCell | null) => {
    if (!cell || seen.has(cell.id)) return;
    seen.add(cell.id);
    todayCells.push(cell);
  };
  const needHref = (key: string) => home.needs.find((need) => need.key === key)?.href ?? null;
  const activityHref = open(HOME_SECTIONS.activity.opens);
  const dialerHref = open(["leads.dialer"]);
  const callbacksHref = home.nextCallbackHref;

  add({ id: "lead", title: "Start here", w: 1, h: 1, href: open(HOME_SECTIONS.flow.opens) ?? "/app/dashboard", node: streamed("Your next step", <RoleLeadTile map={map} />) });
  const setupOpen = shown.has("setup") && !checklist.complete && setupGuide.hiddenAt === null;
  if (setupOpen) add({ id: "setup", title: "Get set up", w: 2, h: 1, href: "/app/setup", node: <SetupTile checklist={checklist} /> });
  if (shown.has("upgrade") && home.upgrade && money) add({ id: "upgrade", title: "Chargeback radar", w: 1, h: 1, href: home.upgrade.featureHref, node: streamed("Chargeback radar", <UpgradeTile money={money} featureHref={home.upgrade.featureHref} rowsHref={home.upgrade.rowsHref} />) });

  for (const section of home.sections) {
    if (section === "closeOut" && activityHref) add({ id: "closeOut", title: "Appointment close-out", w: 2, h: 1, href: activityHref, node: <CloseOutTile href={activityHref} /> });
    if (section === "needs") {
      const transfers = needHref("transfers");
      if (transfers) add({ id: "floor", title: "Agent floor", w: 2, h: 1, href: transfers, node: streamed("Agent floor", <FloorTile today={today} href={transfers} />) });
      const callbacks = needHref("callbacks");
      if (callbacks && callbacksHref) add({ id: "callbacks", title: "Callbacks", w: 1, h: 2, href: callbacks, node: streamed("Callbacks", <CallbacksTile tenantId={context.tenantId} assigned={scopeWithSelf(scope, context.userId)} href={callbacks} />) });
      const lapse = needHref("lapse");
      if (lapse) add({ id: "lapse", title: "Lapse risk", w: 1, h: 1, href: lapse, node: streamed("Lapse risk", <LapseTile today={today} href={lapse} />) });
      const licences = needHref("licences");
      if (licences) add({ id: "licences", title: "Licences", w: 1, h: 1, href: licences, node: streamed("Licences", <LicencesTile today={today} href={licences} />) });
    }
    if (section === "figures") {
      for (const figure of home.figures) {
        if (["queue", "dials", "reached", "rate"].includes(figure.key)) add({ id: "dialer", title: "Dialer", w: 1, h: 1, href: dialerHref ?? figure.href, node: streamed("Dialer", <DialerTile today={today} href={dialerHref ?? figure.href} activityHref={activityHref} />) });
        if (figure.key === "appointments") add({ id: "appointments", title: "Appointments", w: 1, h: 1, href: figure.href, node: streamed("Appointments", <AppointmentsTile today={today} href={figure.href} />) });
        if (figure.key === "premium" && !noMoney) add({ id: "premium", title: "Premium · 30 days", w: 1, h: 1, href: figure.href, node: streamed("Premium · 30 days", <PremiumTile today={today} href={figure.href} />) });
        if (["booked", "shown", "showRate"].includes(figure.key)) add({ id: "setterWeek", title: "Your week", w: 1, h: 1, href: figure.href, node: streamed("Your week", <SetterWeekTile today={today} href={figure.href} />) });
        if (figure.key === "closeOut") add({ id: "closeOutRate", title: "Your close-out", w: 1, h: 1, href: figure.href, node: streamed("Your close-out · 30 days", <CloseOutRateTile today={today} href={figure.href} />) });
        if (figure.key === "dials7") add({ id: "week", title: "This week", w: 2, h: 1, href: figure.href, node: streamed("This week", <WeekTile today={today} href={figure.href} />) });
      }
    }
    if (section === "callbacks" && callbacksHref) add({ id: "callbacks", title: "Callbacks", w: 1, h: 2, href: callbacksHref, node: streamed("Callbacks", <CallbacksTile tenantId={context.tenantId} assigned={scopeWithSelf(scope, context.userId)} href={callbacksHref} />) });
    if (section === "appointments") {
      const href = open(HOME_SECTIONS.appointments.opens);
      if (href) add({ id: "appointments", title: "Appointments", w: 1, h: 1, href, node: streamed("Appointments", <AppointmentsTile today={today} href={href} />) });
    }
    if (section === "activity" && activityHref) {
      add({ id: "week", title: "This week", w: 2, h: 1, href: activityHref, node: streamed("This week", <WeekTile today={today} href={activityHref} />) });
      add({ id: "outcomes", title: "Call outcomes", w: 1, h: 1, href: activityHref, node: streamed("Call outcomes · 7 days", <OutcomesTile today={today} href={activityHref} />) });
      add({ id: "bestHour", title: "Best hour to call", w: 1, h: 1, href: activityHref, node: streamed("Best hour to call", <BestHourTile today={today} href={activityHref} />) });
    }
    if (section === "team" && activityHref) add({ id: "team", title: "Top dialers", w: 1, h: 1, href: activityHref, node: streamed("Top dialers · 7 days", <TeamTile today={today} href={activityHref} />) });
    if (section === "pending") add({ id: "pending", title: "Pending cases", w: 1, h: 1, href: "/app/pending", node: <PendingTile /> });
  }

  const moneyCells: LaunchCell[] = money && !noMoney ? home.money.map((item) => ({ id: `money-${item.key}`, title: HOME_MONEY[item.key].label, w: item.key === "owed" ? 2 : 1, h: 1, href: item.href, node: streamed(HOME_MONEY[item.key].label, <MoneyTile money={money} figureKey={item.key} />) })) : [];
  // On a money profile (the bookkeeper, a money-only plan) the money tiles ARE the day's work.
  if (home.moneyAs === "strip") moneyCells.forEach((cell) => add(cell));

  const viewer: TileViewer | undefined = scope !== null ? { userId: context.userId, scope } : undefined;
  const everything: LaunchCell[] = modules.map((tile) => ({
    id: `module-${tile.key}`,
    title: tile.label,
    w: 1,
    h: 1,
    href: tile.path,
    // A scope with no reader to scope by fails closed: the way in, without a number.
    node: streamed(tile.label, <ModuleTile tile={tile} tenantId={context.tenantId} viewer={viewer} figure={tileFigureShown(tile, context.role) && (scope === null || viewer !== undefined)} />),
  }));

  const spaces: LaunchSpace[] = [
    { key: "today", label: "Today", cells: todayCells },
    ...(home.moneyAs === "list" && moneyCells.length ? [{ key: "money", label: "Money", cells: moneyCells }] : []),
    ...(everything.length ? [{ key: "everything", label: "Everything", cells: everything }] : []),
  ];

  const [primary, ...secondary] = home.actions;
  const name = firstName ? `, ${firstName}` : "";

  return (
    <>
      <div className="portal-dashboard m-stagger mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        {/* The finish moment, when the last step was done somewhere other than the guide bar: this render stamps it. */}
        {shown.has("setup") && checklist.total > 0 && checklist.complete && !setupProgress.finished ? <SetupCelebration steps={checklist.total} done={checklist.completed} audience="owner" /> : null}
        <PageHeader
          size="hero"
          title={`${greeting(serverNow, zone)}${name}`}
          description={longDate(serverNow, zone)}
          actions={
            <>
              <LiveStamp updatedAt={serverNow} />
              {callbacksHref && (
                <Suspense fallback={null}>
                  <NextCallbackSlot today={today} href={callbacksHref} serverNow={serverNow} />
                </Suspense>
              )}
              {secondary.map((action) => (
                <Button key={action.href} asChild variant="outline"><Link href={action.href}>{action.label}</Link></Button>
              ))}
              {primary && <Button asChild><Link href={primary.href}>{primary.label}</Link></Button>}
            </>
          }
        />

        <Suspense fallback={<RoleMapLoading />}>
          <RoleMapView map={map} period={mapKey === "owner" || mapKey === "manager" || mapKey === "producer" ? period : null} />
        </Suspense>

        {spaces.some((space) => space.cells.length > 0) ? (
          <Launchpad storageKey={`insurvas:home:${context.userId}:${mapKey}`} spaces={spaces.filter((space) => space.cells.length > 0)} />
        ) : (
          // Two causes, two answers: a plan granting nothing is the owner's to fix; a role with no tile is ours.
          <Card>
            {available.length === 0
              ? <EmptyState title="No workspace feature is active yet" hint="Ask your account owner to activate one." />
              : <EmptyState title="No dashboard shortcuts for your role yet" hint="Use the sidebar to reach your screens." />}
          </Card>
        )}
      </div>
    </>
  );
}
