import { redirect } from "next/navigation";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { visibleDashboardTiles } from "@/lib/dashboard/tiles";
import { setupChecklistForState } from "@/lib/dashboard/checklist";
import { getDashboardOnboardingState } from "@/lib/dashboard/service";
import { SetupChecklist } from "@/components/app/setup-checklist";
import { Card, CardContent } from "@/components/ui/card";
import { listDueCallbacks } from "@/lib/callbacks/service";
import { AppointmentCloseOutStrip } from "@/components/app/appointment-close-out-strip";
import Link from "next/link";
import { Suspense } from "react";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { getDashboardToday } from "@/lib/dashboard/today";
import { DashboardOverview, DashboardTodaySkeleton } from "@/components/app/dashboard-today";
import { DashboardMetrics } from "@/components/app/dashboard-metrics";
import type { TenantRole } from "@/lib/tenantAuth/roles";
import type { ReactNode } from "react";

import { LinkArrow } from "@/components/ui/link-arrow";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { SectionLoading } from "@/components/ui/page-states";

/**
 * The dashboard is a frame for registered module tiles. It does not know how to render a carrier,
 * appointment, retention or money module; those modules register data in `lib/dashboard/tiles`.
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
async function CallbacksCard({ tenantId }: { tenantId: string }) {
  const [callbacks, workspaceZone] = await Promise.all([
    listDueCallbacks(tenantId),
    getWorkspaceTimezone(tenantId).catch(() => null),
  ]);
  const agencyZone = workspaceZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  // eslint-disable-next-line react-hooks/purity -- a server render: "48 min overdue" is as of this request.
  const now = Date.now();
  return (
    <Card className="portal-dashboard-callbacks m-card h-full">
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-baseline justify-between gap-3 pb-3">
          <h2 className="text-sm font-semibold leading-normal tracking-[-0.01em]">Callbacks due today</h2>
          <LinkArrow href="/app/callbacks" className="shrink-0 text-xs">Open calendar</LinkArrow>
        </div>

        {callbacks.length > 0 ? (
          <div className="portal-dashboard-callback-list">
            {/* Four, deliberately. This is the nudge; the calendar is the list. */}
            {callbacks.slice(0, 4).map((callback, index) => (
              <Link
                key={callback.id}
                href="/app/callbacks"
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
          <div className="flex flex-1 flex-col items-center justify-center rounded-md border border-dashed border-border p-5 text-center">
            <p className="text-sm font-semibold">No callbacks are due today</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CallbacksCardSkeleton() {
  return (
    <Card className="portal-dashboard-callbacks m-card h-full">
      <CardContent className="p-5">
        <SectionLoading rows={4} columns={2} label="Loading callbacks" />
      </CardContent>
    </Card>
  );
}

/**
 * The overview (band, KPI strip, needs, analysis panels), streamed after the page: twenty-odd head
 * counts and one bounded read are cheap, but not free, and the page's first paint does not wait.
 */
async function TodaySection({ tenantId, userId, role, available, aside }: { tenantId: string; userId: string; role: TenantRole; available: string[]; aside?: ReactNode }) {
  // eslint-disable-next-line react-hooks/purity -- a server render: "today" is as of this request.
  const serverNow = Date.now();
  const today = await getDashboardToday({ tenantId, userId, role, available, now: serverNow }).catch(() => null);
  if (!today) return <>{aside}</>;
  return <DashboardOverview data={today} serverNow={serverNow} canDial={available.includes("outbound_dialing") && ["owner", "producer", "setter"].includes(role)} aside={aside} />;
}

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
  // Same shape as the callbacks gate above, and for the same reason: kill switches are consulted
  // before the entitlement. The close-out route admits owner and producer, so the strip does too —
  // recording whether somebody showed is the licensed agent's to do, never the setter being measured
  // by it.
  const closeOutAvailable =
    available.includes("outbound_dialing") && ["owner", "producer"].includes(context.role);

  // A producer has no team to rank, so the callbacks card sits beside the heatmap instead of the
  // standings; an owner gets it in the bottom row with the setup checklist. Streamed: the page shell
  // no longer waits on the due-callbacks read (one more database round trip) before its first paint.
  const callbacksCard = callbacksAvailable ? (
    <Suspense fallback={<CallbacksCardSkeleton />}>
      <CallbacksCard tenantId={context.tenantId} />
    </Suspense>
  ) : null;
  const isOwner = context.role === "owner";

  // m-stagger: the blocks arrive 32ms apart, capped at the eighth, then the rest land together.
  return (
    <div className="portal-dashboard m-stagger mx-auto flex w-full max-w-[1400px] flex-col gap-4">
      <PageHeader size="hero" title="Dashboard" />

      {/* Decision 12 puts this here and nowhere else: "anything with no activity goes to pending and
          appears in a short strip at the top of his dashboard the next morning: three appointments,
          three buttons each. Ten seconds." It was on Activity & scorecard, which is a screen you go
          to rather than one you land on — and an appointment nobody closes out drops out of the
          setter's show rate after three days, so the cost of not seeing it is somebody's pay.
          `hideWhenEmpty` because most mornings there is nothing, and a card that says so every day
          is one people stop reading. It stays on Activity as well, where the empty state is a fact
          worth stating. */}
      {closeOutAvailable && <AppointmentCloseOutStrip hideWhenEmpty />}

      {/* The lead: the band, the KPI strip, what needs you, then the analysis panels. The owner asked
          for a metrics dashboard — more numbers, compact, something worth watching — over the
          board's checklist-first layout. */}
      <Suspense fallback={<DashboardTodaySkeleton />}>
        <TodaySection tenantId={context.tenantId} userId={context.userId} role={context.role} available={[...available]} aside={isOwner ? undefined : callbacksCard} />
      </Suspense>

      {/* The registry's tiles as a metrics grid: every way in the old "Your workspace" grid gave,
          now led by its live number. */}
      {tiles.length > 0 ? (
        <DashboardMetrics tiles={tiles} tenantId={context.tenantId} />
      ) : (
        /* Two different empty states, because they have two different causes and two different
           answers. The entitlement genuinely granting nothing is the owner's problem to solve. A
           plan full of features with no tile for this role is ours, and telling that reader to go
           and ask their owner sends them after a fix the owner cannot make. */
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            {available.length === 0
              ? "No workspace feature is active yet — ask your account owner to activate one."
              : "No dashboard shortcuts for your role yet — use the sidebar to reach your screens."}
          </CardContent>
        </Card>
      )}

      {/* The owner's bottom row: callbacks due beside the setup checklist (which hides itself once
          setup is complete, leaving the callbacks card the full width). */}
      {isOwner && (callbacksCard || !checklist.complete) && (
        <div className={`grid gap-4 ${callbacksCard && !checklist.complete ? "xl:grid-cols-2" : ""}`}>
          {callbacksCard}
          <SetupChecklist checklist={checklist} />
        </div>
      )}
    </div>
  );
}
