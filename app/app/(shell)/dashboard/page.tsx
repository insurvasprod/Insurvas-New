import { redirect } from "next/navigation";
import { after as afterResponse } from "next/server";
import Link from "next/link";
import { Suspense } from "react";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { tileFigureShown, visibleDashboardTiles, type DashboardTile } from "@/lib/dashboard/tiles";
import { setupChecklistForState } from "@/lib/dashboard/checklist";
import { loadSetupGuideState, loadSetupProfile, loadSetupProgress, recordSetupFinished } from "@/lib/dashboard/setupProgress";
import { getDashboardOnboardingState } from "@/lib/dashboard/service";
import { firstOpenable, HOME_SECTIONS, resolveRoleHome, type HomeMoneyKey } from "@/lib/dashboard/roleHome";
import { greeting, longDate } from "@/lib/dashboard/todayMath";
import { attentionItems, homeRole, kpiCards, type AttentionLinks, type HomeRole } from "@/lib/dashboard/homeView";
import { scopeFor } from "@/lib/agency/visibility";
import { scopeWithSelf } from "@/lib/dashboard/scope";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { getDashboardToday, readFirstName, type DashboardToday } from "@/lib/dashboard/today";
import { getDashboardMoney, type DashboardMoney } from "@/lib/dashboard/money";
import { tileMetric, type TileViewer } from "@/lib/dashboard/summaries";
import { listDueCallbacks } from "@/lib/callbacks/service";
import { SetupCelebration } from "@/components/app/setup/setup-celebration";
import { NextCallback } from "@/components/app/dashboard-today";
import { HomeAttention } from "@/components/app/home/home-attention";
import { HomeSetup, HomeShortcuts, ShortcutLink, moduleIcon } from "@/components/app/home/home-extras";
import { HomeKpis } from "@/components/app/home/home-kpis";
import { HomeMoneyCards } from "@/components/app/home/home-money-cards";
import { HomePanelLoading, KpiRowLoading } from "@/components/app/home/home-panel";
import { HomeLowerRow, HomeMainRow, type MainRowLinks } from "@/components/app/home/home-rows";
import { LiveStamp } from "@/components/ui/live-stamp";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-states";

/**
 * The agent home (redesign 2026-10-28, tasks/home-dashboard-plan.md): what needs a person, the
 * role's four figures, then the day in two rows — calls beside today's schedule, money beside the
 * team — and every module as a compact link. It replaces the launchpad's grid of look-alike tiles.
 *
 *   header       greeting in the agency's clock, the live next callback, the role's actions
 *   setup        the checklist as one slim row, pinned until complete (LA-0.3)
 *   needs you    transfers, callbacks, licences, lapse signals, close-outs, pending cases: counts > 0
 *   stat row     four glossy cards per role (UI-CONSISTENCY §4a); the money profile's money figures
 *   main row     calls over 14 days (8 of 12 columns) · today's appointments and callbacks (4)
 *   lower row    money and retention (LA-4.18) with the one upgrade line · top dialers (owner)
 *   jump to      the module registry (LA-0.3) with each figure this reader may see
 *
 * What a role's home shows is still `resolveRoleHome` (lib/dashboard/roleHome), section by section,
 * so nothing appears that the reader cannot open. AG-0.5 producer isolation is unchanged: the
 * session's scope (`scopeFor(context)`) goes to every read — today, money, callbacks (scope + self),
 * module figures (tileMetric's viewer); close-out and pending counts call routes that scope themselves.
 */
export default async function AgentDashboardPage() {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  // One round trip for everything the frame needs: the plan, setup state, kill switches, the
  // agency's zone, the reader's first name and the producer scope.
  const [entitlement, onboardingState, switches, setupProgress, setupProfile, setupGuide, workspaceZone, firstName, scope, solo] = await Promise.all([
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
  const modules = visibleDashboardTiles(available, context.role, { solo });
  const checklist = setupChecklistForState(onboardingState, setupProgress, { features: available, profile: setupProfile, seats: entitlement.limits.max_seats, marks: setupGuide, solo });
  // LA-0.3: the first render that finds every step done stamps it, after the response.
  if (checklist.complete && !setupProgress.finished) afterResponse(() => recordSetupFinished(context.tenantId));
  const home = resolveRoleHome(available, context.role, { code: entitlement.plan_code, features: entitlement.features, disabled: entitlement.disabled_features }, { solo });
  // A profile with too few tiles skips the dashboard for the plan's primary working screen.
  if (home.landing) redirect(home.landing);

  const shown = new Set(home.sections);
  const open = (keys: readonly string[]) => firstOpenable(keys, available, context.role, solo);
  const role = homeRole(context.role, context.memberRole);
  // A manager leads a team and sees no money (owner, 2026-10-25: "they will not see all the money").
  const noMoney = role === "manager";
  // eslint-disable-next-line react-hooks/purity -- a server render: "today" is as of this request.
  const serverNow = Date.now();
  const zone = workspaceZone ?? "America/New_York";

  const wanted: Array<{ key: HomeMoneyKey; href: string }> = noMoney ? [] : [...home.money];
  const money: Promise<DashboardMoney | null> | null = wanted.length > 0 || home.upgrade
    ? getDashboardMoney({ context, wanted, upgrade: Boolean(home.upgrade), scope }).catch(() => null)
    : null;
  // One "today" read for every section and the header chip: only the groups this home uses.
  const today: Promise<DashboardToday | null> = getDashboardToday({ tenantId: context.tenantId, userId: context.userId, role: context.role, available: [...available], now: serverNow, reads: home.reads, scope }).catch(() => null);

  const needHref = (key: string) => home.needs.find((need) => need.key === key)?.href ?? null;
  const activityHref = open(HOME_SECTIONS.activity.opens);
  const calendarHref = open(HOME_SECTIONS.appointments.opens);
  const callbacksHref = home.nextCallbackHref;
  const attentionLinks: AttentionLinks = { transfers: needHref("transfers"), callbacks: needHref("callbacks"), lapse: needHref("lapse"), licences: needHref("licences") };
  const mainLinks: MainRowLinks = {
    activity: shown.has("activity") ? activityHref : null,
    appointments: shown.has("appointments") || home.figures.some((figure) => figure.key === "appointments") ? calendarHref : null,
    callbacks: (shown.has("callbacks") || needHref("callbacks")) && callbacksHref ? callbacksHref : null,
    calendar: calendarHref,
  };
  const assigned = scopeWithSelf(scope, context.userId);
  const callbacks = mainLinks.callbacks ? listDueCallbacks(context.tenantId, assigned).catch(() => null) : Promise.resolve(null);
  const upgrade = shown.has("upgrade") ? home.upgrade : null;
  const viewer: TileViewer | undefined = scope !== null ? { userId: context.userId, scope } : undefined;
  const setupOpen = shown.has("setup") && !checklist.complete && setupGuide.hiddenAt === null;
  const moneyProfile = home.moneyAs === "strip";

  const [primary, ...secondary] = home.actions;
  const name = firstName ? `, ${firstName}` : "";
  const nothing = !moneyProfile && home.figures.length === 0 && home.needs.length === 0 && !mainLinks.activity && !mainLinks.appointments && !mainLinks.callbacks && modules.length === 0 && !money;

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

        {setupOpen && <HomeSetup checklist={checklist} />}

        {moneyProfile ? (
          money && <Suspense fallback={<KpiRowLoading />}><MoneyCardsSlot money={money} /></Suspense>
        ) : (
          <>
            <Suspense fallback={<div aria-hidden="true" className="h-9" />}>
              <AttentionSlot today={today} links={attentionLinks} pendingHref={shown.has("pending") ? "/app/pending" : null} closeOutHref={shown.has("closeOut") ? activityHref : null} />
            </Suspense>
            {home.figures.length > 0 && (
              <Suspense fallback={<KpiRowLoading count={Math.min(4, home.figures.length)} />}>
                <KpiSlot today={today} figures={home.figures} role={role} />
              </Suspense>
            )}
          </>
        )}

        {(mainLinks.activity || mainLinks.appointments || mainLinks.callbacks) && (
          <Suspense fallback={<MainRowLoading activity={Boolean(mainLinks.activity)} />}>
            <MainRowSlot today={today} callbacks={callbacks} links={mainLinks} agencyView={role === "owner"} />
          </Suspense>
        )}

        {!moneyProfile && (money || shown.has("team")) && (
          <Suspense fallback={null}>
            <LowerRowSlot money={noMoney ? null : money} today={today} team={shown.has("team")} teamHref={activityHref} upgrade={upgrade} />
          </Suspense>
        )}

        {modules.length > 0 && (
          <HomeShortcuts>
            {modules.map((tile) => {
              const figure = tileFigureShown(tile, context.role) && (scope === null || viewer !== undefined);
              const link = <ShortcutLink icon={moduleIcon(tile.icon)} label={tile.label} href={tile.path} />;
              return figure ? <Suspense key={tile.key} fallback={link}><ShortcutSlot tile={tile} tenantId={context.tenantId} viewer={viewer} /></Suspense> : <ShortcutLink key={tile.key} icon={moduleIcon(tile.icon)} label={tile.label} href={tile.path} />;
            })}
          </HomeShortcuts>
        )}

        {nothing && (
          // Two causes, two answers: a plan granting nothing is the owner's to fix; a role with nothing is ours.
          <Card>
            {available.length === 0
              ? <EmptyState title="No workspace feature is active yet" hint="Ask your account owner to activate one." />
              : <EmptyState title="No dashboard figures for your role yet" hint="Use the sidebar to reach your screens." />}
          </Card>
        )}
      </div>
    </>
  );
}

/* ── Streamed slots: each waits on its own read, so the header never waits ────────────────────── */

/** The live next-callback chip in the header: waits on the same "today" read as the sections. */
async function NextCallbackSlot({ today, href, serverNow }: { today: Promise<DashboardToday | null>; href: string; serverNow: number }) {
  const data = await today;
  if (!data?.nextCallback) return null;
  return <NextCallback callback={data.nextCallback} serverNow={serverNow} href={href} />;
}

async function AttentionSlot({ today, links, pendingHref, closeOutHref }: { today: Promise<DashboardToday | null>; links: AttentionLinks; pendingHref: string | null; closeOutHref: string | null }) {
  const data = await today;
  return <HomeAttention items={attentionItems(data, links)} pendingHref={pendingHref} closeOutHref={closeOutHref} />;
}

async function KpiSlot({ today, figures, role }: { today: Promise<DashboardToday | null>; figures: Parameters<typeof kpiCards>[1]; role: HomeRole }) {
  return <HomeKpis cards={kpiCards(await today, figures, role)} />;
}

async function MoneyCardsSlot({ money }: { money: Promise<DashboardMoney | null> }) {
  const data = await money;
  return <HomeMoneyCards figures={data?.figures ?? []} />;
}

async function MainRowSlot({ today, callbacks, links, agencyView }: { today: Promise<DashboardToday | null>; callbacks: Promise<Awaited<ReturnType<typeof listDueCallbacks>> | null>; links: MainRowLinks; agencyView: boolean }) {
  const [data, due] = await Promise.all([today, callbacks]);
  return <HomeMainRow today={data} callbacks={due} links={links} showActivity={Boolean(links.activity)} agencyView={agencyView} />;
}

async function LowerRowSlot({ money, today, team, teamHref, upgrade }: {
  money: Promise<DashboardMoney | null> | null;
  today: Promise<DashboardToday | null>;
  team: boolean;
  teamHref: string | null;
  upgrade: { featureHref: string; rowsHref: string } | null;
}) {
  const [moneyData, data] = await Promise.all([money ?? Promise.resolve(null), team ? today : Promise.resolve(null)]);
  // Sixteen #15's one upgrade line: only when the agency's own data makes the case (a count above zero).
  const exposed = upgrade && moneyData?.exposurePolicies ? { policies: moneyData.exposurePolicies, ...upgrade } : null;
  return <HomeLowerRow money={moneyData?.figures ?? null} upgrade={exposed} leaders={data?.insights?.leaders ?? null} teamHref={teamHref} />;
}

/** One module link with its live figure, where this reader may read it at that scope. */
async function ShortcutSlot({ tile, tenantId, viewer }: { tile: DashboardTile; tenantId: string; viewer: TileViewer | undefined }) {
  const metric = await tileMetric(tile.key, tenantId, viewer).catch(() => null);
  return (
    <ShortcutLink
      icon={moduleIcon(tile.icon)}
      label={tile.label}
      href={tile.path}
      figure={metric ? metric.display ?? metric.value.toLocaleString("en-US") : undefined}
      caption={metric?.caption}
      tone={metric?.tone}
    />
  );
}

function MainRowLoading({ activity }: { activity: boolean }) {
  return (
    <div className="@container"><div className="grid grid-cols-1 gap-3 @3xl:grid-cols-12">
      {activity && <HomePanelLoading title="Calls" tall className="@3xl:col-span-7 @6xl:col-span-8" />}
      <HomePanelLoading title="Today" lines={5} className={activity ? "@3xl:col-span-5 @6xl:col-span-4" : "@3xl:col-span-12"} />
    </div></div>
  );
}
