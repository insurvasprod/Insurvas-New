import { redirect } from "next/navigation";
import { after as afterResponse } from "next/server";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { visibleDashboardTiles } from "@/lib/dashboard/tiles";
import { setupChecklistForState } from "@/lib/dashboard/checklist";
import { loadSetupProgress, recordSetupFinished } from "@/lib/dashboard/setupProgress";
import { getDashboardOnboardingState } from "@/lib/dashboard/service";
import { resolveRoleHome, splitHomeSections, type HomeSectionKey, type ResolvedHome } from "@/lib/dashboard/roleHome";
import { greeting, longDate } from "@/lib/dashboard/todayMath";
import { SetupChecklist } from "@/components/app/setup-checklist";
import { Card } from "@/components/ui/card";
import { listDueCallbacks } from "@/lib/callbacks/service";
import { AppointmentCloseOutStrip } from "@/components/app/appointment-close-out-strip";
import { PendingSummaryCard } from "@/components/app/applications/pending-summary-card";
import Link from "next/link";
import { Fragment, Suspense } from "react";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { getDashboardToday, readFirstName, type DashboardToday } from "@/lib/dashboard/today";
import { DashboardStreamed, DashboardTodaySkeleton, NextCallback } from "@/components/app/dashboard-today";
import { DashboardMetrics } from "@/components/app/dashboard-metrics";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { LinkArrow } from "@/components/ui/link-arrow";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * The dashboard is a frame for registered module tiles. It does not know how to render a carrier,
 * appointment, retention or money module; those modules register data in `lib/dashboard/tiles`.
 *
 * What it shows, and in what order, is the reader's role home (`lib/dashboard/roleHome`,
 * 2026-10-09): a setter lands on the queue and their bookings, a producer on transfers and
 * callbacks, an assistant on the inbound queue, a bookkeeper on statements and money, an owner on
 * the team. Every section is gated by the menu entry of the page it opens, so nobody sees a tile
 * for a screen they cannot open.
 */
/** "4:30 PM CT" — a time with the zone it is in, as the board's callback rows read. */
function shortTime(utc: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(utc));
}
function shortTimeNoZone(utc: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(utc));
}
/** "48 min overdue", "2h 18m overdue" */
function overdueLabel(utc: string, now: number) {
  const minutes = Math.max(1, Math.round((now - Date.parse(utc)) / 60_000));
  if (minutes < 60) return `${minutes} min overdue`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m overdue` : `${Math.floor(hours / 24)}d overdue`;
}

/** "Callbacks due today": its own streamed block, so the page does not wait on this read. */
async function CallbacksCard({ tenantId, href }: { tenantId: string; href: string }) {
  const [callbacks, workspaceZone] = await Promise.all([
    listDueCallbacks(tenantId),
    getWorkspaceTimezone(tenantId).catch(() => null),
  ]);
  const agencyZone = workspaceZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  // eslint-disable-next-line react-hooks/purity -- a server render: "48 min overdue" is as of this request.
  const now = Date.now();
  return (
    <TableCard title="Callbacks due today" action={<LinkArrow href={href} className="shrink-0 text-xs">Open calendar</LinkArrow>} className="portal-dashboard-callbacks m-card h-full">
      {callbacks.length > 0 ? (
        <div className="portal-dashboard-callback-list mx-4 mb-4">
          {/* Four, deliberately. This is the nudge; the calendar is the list. */}
          {callbacks.slice(0, 4).map((callback, index) => (
            <Link
              key={callback.id}
              href={href}
              aria-label={`Open the callback for ${callback.customerName}`}
              className={`m-row flex items-center gap-3 px-3 py-2 text-inherit no-underline ${index ? "border-t border-border" : ""}`}
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold" aria-hidden="true">
                {callback.customerName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{callback.customerName}</span>
                {/* Their clock first, then yours. An agent who reads only the first half
                    still calls at a time that is civil where the customer is. */}
                <span className="block truncate text-xs tabular-nums text-muted-foreground">
                  {shortTime(callback.scheduledAtUtc, callback.customerTimezone)} · {shortTimeNoZone(callback.scheduledAtUtc, agencyZone)} yours
                </span>
              </span>
              <StatusChip tone={callback.isOverdue ? "danger" : "neutral"} dot>
                {callback.isOverdue ? overdueLabel(callback.scheduledAtUtc, now) : "Scheduled"}
              </StatusChip>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No callbacks due today" hint="Callbacks you schedule show here." action={<Button asChild variant="outline"><Link href={href}>Open calendar</Link></Button>} />
      )}
    </TableCard>
  );
}

function CallbacksCardSkeleton() {
  return (
    <TableCard title="Callbacks due today" className="portal-dashboard-callbacks m-card h-full">
      <SectionLoading rows={4} columns={2} label="Loading callbacks" />
    </TableCard>
  );
}

/** The live next-callback chip in the header: waits on the same "today" read as the sections. */
async function NextCallbackSlot({ today, href, serverNow }: { today: Promise<DashboardToday | null>; href: string; serverNow: number }) {
  const data = await today;
  if (!data?.nextCallback) return null;
  return <NextCallback callback={data.nextCallback} serverNow={serverNow} href={href} />;
}

/**
 * The sections that read the "today" data, streamed after the page: twenty-odd head counts and one
 * bounded read are cheap, but not free, and the page's first paint does not wait. If the read
 * fails, the data sections are simply absent and the rest of the run still renders.
 */
async function TodaySection({ today, home, sections, slots }: { today: Promise<DashboardToday | null>; home: ResolvedHome; sections: HomeSectionKey[]; slots: Partial<Record<HomeSectionKey, ReactNode>> }) {
  const data = await today;
  if (!data) return <>{sections.map((key) => <Fragment key={key}>{slots[key] ?? null}</Fragment>)}</>;
  return <DashboardStreamed data={data} sections={sections} figures={home.figures} needs={home.needs} slots={slots} />;
}

/**
 * A run of sections that render on their own. Callbacks directly followed by the setup checklist
 * share a row: the checklist hides itself once setup is complete or the owner hides it in this
 * browser, which only the client knows — so the two columns follow the card being there (`has-`),
 * not the server's guess. (The owner's checklist now leads the page, LA-0.3, so no role pairs them
 * today; the pairing stays for a layout that puts them together.)
 */
function Run({ keys, slots, setupOpen }: { keys: HomeSectionKey[]; slots: Partial<Record<HomeSectionKey, ReactNode>>; setupOpen: boolean }) {
  const out: ReactNode[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === "callbacks" && keys[index + 1] === "setup") {
      if (slots.callbacks || setupOpen) {
        out.push(
          <div key="callbacks-setup" className={`grid gap-4 ${slots.callbacks && setupOpen ? "xl:has-[>[data-setup-checklist]]:grid-cols-2" : ""}`}>
            {slots.callbacks}
            {slots.setup}
          </div>,
        );
      }
      index += 1;
      continue;
    }
    out.push(<Fragment key={key}>{slots[key] ?? null}</Fragment>);
  }
  return <>{out}</>;
}

export default async function AgentDashboardPage() {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  // The kill-switch table is fetched here rather than inside `effectiveFeatures` because its query
  // depends on neither the entitlement nor the tenant — only applying the switches does. Awaiting
  // it afterwards cost a second serial round trip, ~170ms of ~340ms of data time on this page,
  // for a criterion ("loads in under 1 second") with no room to spare. The greeting's two reads
  // (the agency's zone, the reader's first name) ride in the same round trip.
  const [entitlement, onboardingState, switches, setupProgress, workspaceZone, firstName] = await Promise.all([
    getEntitlement(context.tenantId),
    getDashboardOnboardingState(context.tenantId),
    loadFeatureSwitches(),
    loadSetupProgress(context.tenantId),
    getWorkspaceTimezone(context.tenantId).catch(() => null),
    readFirstName(context.userId),
  ]);
  const available = applyKillSwitches(entitlement.features, switches, context.tenantId);
  const tiles = visibleDashboardTiles(available, context.role);
  const checklist = setupChecklistForState(onboardingState, setupProgress);
  // LA-0.3: the first render that finds every step done stamps it, so the checklist never returns.
  // After the response, so the stamp never holds up the page.
  if (checklist.complete && !setupProgress.finished) afterResponse(() => recordSetupFinished(context.tenantId));
  // `available`, not `entitlement.features`. Kill switches are consulted BEFORE the entitlement at
  // every enforcement point (SA-4.10), and `applyKillSwitches` on the line above is what applies
  // them. The callbacks card once read `hasFeature(entitlement, …)`, which is the raw plan — so
  // switching `callback_calendar` off platform-wide hid the callbacks TILE and left the card
  // rendering and still querying due callbacks. Every section below is now decided from
  // `available` by the role home, the same way the tiles are.
  const home = resolveRoleHome(available, context.role);
  const { before, streamed, after } = splitHomeSections(home.sections);
  const shown = new Set(home.sections);

  // eslint-disable-next-line react-hooks/purity -- a server render: "today" is as of this request.
  const serverNow = Date.now();
  const zone = workspaceZone ?? "America/New_York";
  // One "today" read, shared by the streamed sections and the header's next-callback chip. It only
  // runs the reads this home shows (`home.reads`), and a failure is null — sections hidden, page up.
  const today: Promise<DashboardToday | null> | null = streamed.length > 0 || home.nextCallbackHref
    ? getDashboardToday({ tenantId: context.tenantId, userId: context.userId, role: context.role, available: [...available], now: serverNow, reads: home.reads }).catch(() => null)
    : null;

  const callbacksHref = home.nextCallbackHref;
  const slots: Partial<Record<HomeSectionKey, ReactNode>> = {
    // Decision 12 puts this here and nowhere else: "anything with no activity goes to pending and
    // appears in a short strip at the top of his dashboard the next morning: three appointments,
    // three buttons each. Ten seconds." It was on Activity & scorecard, which is a screen you go
    // to rather than one you land on — and an appointment nobody closes out drops out of the
    // setter's show rate after three days, so the cost of not seeing it is somebody's pay.
    // `hideWhenEmpty` because most mornings there is nothing, and a card that says so every day
    // is one people stop reading. It stays on Activity as well, where the empty state is a fact
    // worth stating. Owner and producer only (the close-out route's roles): recording whether
    // somebody showed is the licensed agent's to do, never the setter being measured by it.
    closeOut: shown.has("closeOut") ? <AppointmentCloseOutStrip hideWhenEmpty /> : null,
    // LA-3.15 / 3.18 / 3.26 · awaiting a policy number, waiting on the client, counteroffers about
    // to expire. It fetches its own counts and hides itself when there is nothing, or no access.
    pending: shown.has("pending") ? <PendingSummaryCard /> : null,
    // Streamed: the page shell does not wait on the due-callbacks read before its first paint.
    callbacks: shown.has("callbacks") && callbacksHref ? (
      <Suspense fallback={<CallbacksCardSkeleton />}>
        <CallbacksCard tenantId={context.tenantId} href={callbacksHref} />
      </Suspense>
    ) : null,
    // The registry's tiles as a metrics grid: every way in the old "Your workspace" grid gave, now
    // led by its live number.
    shortcuts: tiles.length > 0 ? (
      <DashboardMetrics tiles={tiles} tenantId={context.tenantId} />
    ) : (
      /* Two different empty states, because they have two different causes and two different
         answers. The entitlement genuinely granting nothing is the owner's problem to solve. A
         plan full of features with no tile for this role is ours, and telling that reader to go
         and ask their owner sends them after a fix the owner cannot make. */
      <Card>
        {available.length === 0
          ? <EmptyState title="No workspace feature is active yet" hint="Ask your account owner to activate one." />
          : <EmptyState title="No dashboard shortcuts for your role yet" hint="Use the sidebar to reach your screens." />}
      </Card>
    ),
    setup: shown.has("setup") ? <SetupChecklist checklist={checklist} /> : null,
  };

  // The "Your day" header: a greeting in the agency's clock, the date, the live next callback, and
  // the role's one to three actions — secondary first, the primary (the role's first thing) last.
  const [primary, ...secondary] = home.actions;
  const name = firstName ? `, ${firstName}` : "";

  // m-stagger: the blocks arrive 32ms apart, capped at the eighth, then the rest land together.
  return (
    <div className="portal-dashboard m-stagger mx-auto flex w-full max-w-[1400px] flex-col gap-4">
      <PageHeader
        size="hero"
        title={`${greeting(serverNow, zone)}${name}`}
        description={longDate(serverNow, zone)}
        actions={(today && callbacksHref) || primary ? (
          <>
            {today && callbacksHref && (
              <Suspense fallback={null}>
                <NextCallbackSlot today={today} href={callbacksHref} serverNow={serverNow} />
              </Suspense>
            )}
            {secondary.map((action) => (
              <Button key={action.href} asChild variant="outline"><Link href={action.href}>{action.label}</Link></Button>
            ))}
            {primary && <Button asChild><Link href={primary.href}>{primary.label}</Link></Button>}
          </>
        ) : undefined}
      />

      <Run keys={before} slots={slots} setupOpen={shown.has("setup") && !checklist.complete} />

      {today && streamed.length > 0 && (
        <Suspense fallback={<DashboardTodaySkeleton strip={streamed.includes("figures")} panels={streamed.includes("activity")} />}>
          <TodaySection today={today} home={home} sections={streamed} slots={slots} />
        </Suspense>
      )}

      <Run keys={after} slots={slots} setupOpen={shown.has("setup") && !checklist.complete} />
    </div>
  );
}
