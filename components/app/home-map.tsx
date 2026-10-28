import Link from "next/link";

import { loadDialFunnel } from "@/lib/dealFlow/dialFunnelLoader";
import { intakeLocalDate } from "@/lib/dealFlow/localDate";
import { flowRange, leadFlowView, priorRange } from "@/lib/dashboard/leadFlow";
import { funnelMap, pathMap, setterMap, type PathStop, type RoleMap, type RoleMapKey } from "@/lib/dashboard/roleFlow";
import type { DashboardToday } from "@/lib/dashboard/today";
import type { DashboardMoney } from "@/lib/dashboard/money";
import type { ProducerScope } from "@/lib/agency/visibilityCore";
import { LeadFlowMap } from "@/components/ui/lead-flow-map";
import { DashTile } from "@/components/ui/dash-tile";
import { LaunchEmpty } from "@/components/ui/launchpad";
import { SectionLoading } from "@/components/ui/page-states";
import { cn } from "@/lib/utils";

export type FlowPeriod = "today" | "7d" | "30d";
const PERIODS: ReadonlyArray<{ key: FlowPeriod; label: string; days: number }> = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
];

/** Opens a menu key for this reader (roleHome.firstOpenable, bound on the page). */
type Open = (keys: readonly string[]) => string | null;

const n = (value: number | null | undefined) => (value ?? 0).toLocaleString("en-US");

/**
 * The path a funnel role falls back to when the plan has no Daily deal flow, or nothing was worked
 * yet in the period: the day's own route, so the map still leads somewhere.
 */
function dayPath(key: RoleMapKey, today: DashboardToday | null, open: Open): RoleMap {
  const needs = today?.needs;
  const stops: PathStop[] = [
    { label: "Inbound transfers", href: open(["leads.inbound"]), figure: needs?.transfersWaiting != null ? n(needs.transfersWaiting) : null, count: needs?.transfersWaiting ?? 0, urgent: (needs?.slaBreaching ?? 0) > 0, note: needs?.slaBreaching ? `${n(needs.slaBreaching)} past the SLA` : "waiting to be claimed", next: "then" },
    { label: "Dialer", href: open(["leads.dialer"]), figure: today?.queueReady != null ? n(today.queueReady) : null, count: today?.queueReady ?? 0, urgent: false, note: "ready to dial", next: "then" },
    { label: "Callbacks", href: open(["sell.callbacks"]), figure: needs?.callbacksToday != null ? n((needs.callbacksToday ?? 0) + (needs.callbacksOverdue ?? 0)) : null, count: (needs?.callbacksToday ?? 0) + (needs?.callbacksOverdue ?? 0), urgent: (needs?.callbacksOverdue ?? 0) > 0, note: needs?.callbacksOverdue ? `${n(needs.callbacksOverdue)} late` : "due today", next: "then" },
    { label: "Applications", href: open(["sell.applications"]), figure: null, count: 0, urgent: false, note: "submit and track", next: "then" },
    { label: "Policies", href: open(["book.policies"]), figure: key === "manager" ? null : today?.policies30 ? n(today.policies30.count) : null, count: today?.policies30?.count ?? 0, urgent: false, note: "last 30 days", next: "" },
  ];
  return pathMap(key === "manager" ? "Your team's day" : "Your day", stops);
}

function moneyFigure(money: DashboardMoney | null, key: string) {
  return money?.figures.find((figure) => figure.key === key) ?? null;
}

/**
 * This reader's map: read once, shared by the map above the launchpad and its lead tile (both
 * await the same promise). Every read is the one the reader's own pages make, under the same scope;
 * a read that fails falls back to the role's path rather than leaving the top of the home empty.
 */
export async function loadRoleMap(input: {
  key: RoleMapKey;
  tenantId: string;
  scope: ProducerScope;
  zone: string;
  serverNow: number;
  period: FlowPeriod;
  open: Open;
  today: Promise<DashboardToday | null> | null;
  money: Promise<DashboardMoney | null> | null;
}): Promise<(RoleMap & { period?: FlowPeriod }) | null> {
  const { key, open } = input;
  const today = input.today ? await input.today : null;

  if (key === "owner" || key === "manager" || key === "producer") {
    const flowHref = open(["sell.deal-flow"]);
    if (flowHref) {
      // The period asked for; when nothing was worked in it, the next longer one, so the owner's map
      // is lead to money whenever there is any money to show (the switch says which period it is).
      const tries = PERIODS.slice(PERIODS.findIndex((option) => option.key === input.period));
      for (const option of tries) {
        const range = flowRange(intakeLocalDate(input.zone, new Date(input.serverNow)), option.days);
        const funnel = await loadDialFunnel(input.tenantId, { ...range, timeZone: input.zone }, input.scope).catch(() => null);
        if (!funnel) break;
        const view = leadFlowView(funnel);
        if (view.empty) continue;
        // The same number of days before, for the change on each stop; a failed read just leaves it off.
        const before = await loadDialFunnel(input.tenantId, { ...priorRange(range), timeZone: input.zone }, input.scope).catch(() => null);
        return { ...funnelMap(key, view, flowHref, option.key === "today" ? "today" : option.label.toLowerCase(), before ? leadFlowView(before) : null), period: option.key };
      }
    }
    return dayPath(key, today, open);
  }

  if (key === "setter") {
    const series = today?.series ?? [];
    const dials = series.reduce((sum, day) => sum + (day.dials ?? 0), 0);
    const reached = series.reduce((sum, day) => sum + (day.contacts ?? 0), 0);
    const week = today?.setterWeek;
    return setterMap(
      { dials, reached, booked: week?.booked ?? 0, showed: week?.showed ?? 0 },
      { dialer: open(["leads.dialer"]), activity: open(["insight.activity"]), calendar: open(["sell.calendar"]) },
    );
  }

  if (key === "assistant") {
    const needs = today?.needs;
    return pathMap("Your day", [
      { label: "Inbound", href: open(["leads.inbound"]), figure: needs?.transfersWaiting != null ? n(needs.transfersWaiting) : null, count: needs?.transfersWaiting ?? 0, urgent: (needs?.slaBreaching ?? 0) > 0, note: needs?.slaBreaching ? `${n(needs.slaBreaching)} past the SLA` : "waiting to be claimed", next: "claim, then" },
      { label: "Callbacks", href: open(["sell.callbacks"]), figure: needs?.callbacksToday != null ? n((needs.callbacksToday ?? 0) + (needs.callbacksOverdue ?? 0)) : null, count: (needs?.callbacksToday ?? 0) + (needs?.callbacksOverdue ?? 0), urgent: (needs?.callbacksOverdue ?? 0) > 0, note: needs?.callbacksOverdue ? `${n(needs.callbacksOverdue)} late` : "due today", next: "call, then" },
      { label: "List import", href: open(["leads.import"]), figure: null, count: 0, urgent: false, note: "bring in new leads", next: "import, then" },
      { label: "Lead lists", href: open(["leads.lists"]), figure: null, count: 0, urgent: false, note: "check and tidy", next: "then" },
      { label: "Lead routing", href: open(["leads.assignments"]), figure: null, count: 0, urgent: false, note: "hand leads to agents", next: "" },
    ]);
  }

  const money = input.money ? await input.money : null;
  if (key === "bookkeeper") {
    const stop = (label: string, figureKey: string, menu: string, note: string, next: string): PathStop => {
      const figure = moneyFigure(money, figureKey);
      const count = figure ? Number(figure.value.replace(/[^0-9.]/g, "")) || 0 : 0;
      return { label, href: figure?.href ?? open([menu]), figure: figure?.value ?? null, count, urgent: figure?.tone === "warning" || figure?.tone === "danger", note: figure?.caption ?? note, next };
    };
    return pathMap("Statements to money", [
      stop("Statements", "statements", "book.statements", "to review", "read, then"),
      stop("Discrepancies", "discrepancies", "book.discrepancies", "found", "check, then"),
      stop("Owed to you", "owed", "book.discrepancies", "not paid", "claim, then"),
      stop("Chargeback exposure", "exposure", "book.ledger", "in the window", ""),
    ]);
  }

  // retention
  const lapse = moneyFigure(money, "lapse");
  const persistency = moneyFigure(money, "persistency");
  const lapsing = today?.needs.lapsing ?? null;
  return pathMap("Your book at risk", [
    { label: "Lapse risk", href: lapse?.href ?? open(["retention.lapse-risk"]), figure: lapse?.value ?? (lapsing !== null ? n(lapsing) : null), count: lapsing ?? 0, urgent: (lapsing ?? 0) > 0, note: lapse?.caption ?? "open signals", next: "work, then" },
    { label: "Save queue", href: open(["retention.save-queue"]), figure: null, count: 0, urgent: false, note: "your cases", next: "save, then" },
    { label: "Servicing", href: open(["retention.payment-repair"]), figure: null, count: 0, urgent: false, note: "fix the payment", next: "then" },
    { label: "Reinstatement", href: open(["retention.winback"]), figure: null, count: 0, urgent: false, note: "win back the lapsed", next: "then" },
    { label: "Persistency", href: persistency?.href ?? open(["retention.scorecard"]), figure: persistency?.value ?? null, count: 0, urgent: false, note: persistency?.caption ?? "your scorecard", next: "" },
  ]);
}

/** Today / 7 days, as links: the period is the page's `?flow=`, so a reload or a shared link keeps it. */
function PeriodSwitch({ period }: { period: FlowPeriod }) {
  return (
    <nav aria-label="Period" className="flex items-center gap-1 rounded-full border border-border p-0.5">
      {PERIODS.map((option) => (
        <Link
          key={option.key}
          href={option.key === "today" ? "/app/dashboard" : `/app/dashboard?flow=${option.key}`}
          scroll={false}
          aria-current={option.key === period ? "page" : undefined}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold leading-normal no-underline transition-colors",
            option.key === period ? "bg-[var(--primary)] text-[var(--on-primary)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}

/** The map, full width above the launchpad (owner: "the map to leads on top, not split"). */
export async function RoleMapView({ map, period }: { map: Promise<(RoleMap & { period?: FlowPeriod }) | null>; period: FlowPeriod | null }) {
  const view = await map;
  if (!view || view.stages.length < 2) return null;
  return (
    <LeadFlowMap
      label={view.label}
      mode={view.mode}
      hot={view.hot}
      stages={view.stages}
      drops={view.drops}
      worst={view.worst}
      facts={view.facts}
      aside={view.mode === "flow" && period ? <PeriodSwitch period={view.period ?? period} /> : undefined}
    />
  );
}

export function RoleMapLoading() {
  return (
    <section aria-label="Your map" className="m-glass rounded-xl border border-border px-4 pb-4 pt-3.5">
      <SectionLoading rows={3} columns={5} label="Drawing your map" />
    </section>
  );
}

/** The launchpad's first tile: the map's biggest leak, or where to start on a path. */
export async function RoleLeadTile({ map }: { map: Promise<RoleMap | null> }) {
  const view = await map;
  const lead = view?.lead;
  if (!lead) return <LaunchEmpty />;
  return <DashTile title={lead.title} href={lead.href} big={lead.big} unit={lead.unit} leak={lead.leak} rows={lead.rows} cta={lead.cta} />;
}
