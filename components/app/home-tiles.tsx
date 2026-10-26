import {
  Activity, BadgeDollarSign, BookOpen, BriefcaseBusiness, CalendarCheck, CalendarClock, ChartColumn, Clock3, ContactRound, Headset, ListChecks,
  PhoneCall, PhoneIncoming, PhoneOutgoing, RadioTower, Receipt, Route, ShieldCheck, SquareStack, TriangleAlert, Trophy, Wrench, type LucideIcon,
} from "lucide-react";

import { DashTile, type TileRow } from "@/components/ui/dash-tile";
import { LaunchEmpty } from "@/components/ui/launchpad";
import { listDueCallbacks } from "@/lib/callbacks/service";
import { hourLabel } from "@/lib/dashboard/insights";
import type { DashboardMoney } from "@/lib/dashboard/money";
import type { HomeMoneyKey } from "@/lib/dashboard/roleHome";
import type { SetupChecklist } from "@/lib/dashboard/checklist";
import { tileMetric, type TileViewer } from "@/lib/dashboard/summaries";
import type { DashboardTile } from "@/lib/dashboard/tiles";
import type { DashboardToday } from "@/lib/dashboard/today";
import type { ProducerScope } from "@/lib/agency/visibilityCore";

/*
 * The agent home's tiles (redesign 2026-10-25, owner: "take dashboard C, all of the tiles … copy the
 * exact pattern; delete every other thing"). Every block the home used to stack — the figure strip,
 * "Needs you today", callbacks, appointments, the activity panels, pending cases, money, the upgrade
 * prompt, setup, "Your modules" — is now one or more tiles in Dashboard C's shape (DashTile). Each
 * reads what its block read, under the same gates and scope (lib/dashboard/roleHome decides which
 * appear; the page passes only those), and a tile with nothing to say leaves the grid (LaunchEmpty).
 */

type Today = Promise<DashboardToday | null>;
const n = (value: number) => value.toLocaleString("en-US");
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const time = (utc: string, zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(utc));
const waited = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);

/** The floor: transfers waiting now, how many are past the SLA, the longest wait. */
export async function FloorTile({ today, href }: { today: Today; href: string }) {
  const needs = (await today)?.needs;
  if (!needs || needs.transfersWaiting === null) return <LaunchEmpty />;
  const rows: TileRow[] = [
    { label: needs.slaMinutes ? `Past the ${needs.slaMinutes}-minute SLA` : "Past the SLA", value: n(needs.slaBreaching ?? 0), tone: needs.slaBreaching ? "danger" : "good", href },
    { label: "Longest wait", value: needs.oldestWaitingSeconds !== null ? waited(needs.oldestWaitingSeconds) : "—", tone: needs.oldestWaitingSeconds ? "warning" : "default", href },
  ];
  return <DashTile title="Agent floor" icon={<PhoneIncoming />} live href={href} big={n(needs.transfersWaiting)} unit="transfers waiting" tone={needs.transfersWaiting ? "good" : "default"} rows={rows} cta={needs.transfersWaiting ? { label: "Claim the next", href } : undefined} />;
}

/** The dialer: what is ready, and today's dials, reach and contact rate against yesterday. */
export async function DialerTile({ today, href, activityHref }: { today: Today; href: string; activityHref: string | null }) {
  const data = await today;
  if (!data || (data.queueReady === null && data.dialsToday === null)) return <LaunchEmpty />;
  const rows: TileRow[] = [];
  if (data.dialsToday !== null) rows.push({ label: `Dials today${data.dialsYesterday !== null ? ` · ${n(data.dialsYesterday)} yesterday` : ""}`, value: n(data.dialsToday), href: activityHref ?? href });
  if (data.contactsToday !== null) rows.push({ label: "Reached today", value: n(data.contactsToday), tone: data.contactsToday ? "good" : "default", href: activityHref ?? href });
  if (data.contactRatePct !== null) rows.push({ label: "Contact rate", value: `${data.contactRatePct.toFixed(0)}%`, href: activityHref ?? href });
  return <DashTile title="Dialer" icon={<PhoneOutgoing />} href={href} big={data.queueReady !== null ? n(data.queueReady) : n(data.dialsToday ?? 0)} unit={data.queueReady !== null ? "ready to dial" : "dials today"} rows={rows} cta={{ label: "Start calling", href }} />;
}

/** Callbacks due today and late, the first five by name, in the customer's clock. */
export async function CallbacksTile({ tenantId, assigned, href }: { tenantId: string; assigned: ProducerScope; href: string }) {
  const callbacks = await listDueCallbacks(tenantId, assigned).catch(() => null);
  if (!callbacks) return <LaunchEmpty />;
  const late = callbacks.filter((callback) => callback.isOverdue).length;
  const rows: TileRow[] = callbacks.slice(0, 6).map((callback) => ({
    label: callback.customerName,
    value: callback.isOverdue ? "late" : `${time(callback.scheduledAtUtc, callback.customerTimezone)} theirs`,
    tone: callback.isOverdue ? "warning" : "default",
    href,
  }));
  return <DashTile title="Callbacks" icon={<PhoneCall />} href={href} big={n(callbacks.length)} unit={late ? `due · ${n(late)} late` : "due today"} tone={late ? "warning" : "default"} rows={rows.length ? rows : [{ label: "Nothing due today", tone: "good" }]} cta={callbacks.length ? { label: "Call them in order", href } : undefined} ctaAtFoot />;
}

/** Today's appointments, earliest first. */
export async function AppointmentsTile({ today, href }: { today: Today; href: string }) {
  const data = await today;
  if (!data || data.appointmentsToday === null) return <LaunchEmpty />;
  const rows: TileRow[] = (data.appointmentsTodayList ?? []).slice(0, 4).map((item) => ({ label: `${item.customerName} · ${item.agentName}`, value: time(item.startsAtUtc, data.zone), href }));
  return <DashTile title="Appointments" icon={<CalendarCheck />} href={href} big={n(data.appointmentsToday)} unit={data.appointmentsWeek !== null ? `today · ${n(data.appointmentsWeek)} this week` : "today"} rows={rows.length ? rows : [{ label: "None booked for today" }]} />;
}

/** The week of dialling as C's bars: dials, and the reached share of each day. */
export async function WeekTile({ today, href }: { today: Today; href: string }) {
  const data = await today;
  if (!data?.series.length) return <LaunchEmpty />;
  const dials = data.series.reduce((sum, day) => sum + (day.dials ?? 0), 0);
  const reached = data.series.reduce((sum, day) => sum + (day.contacts ?? 0), 0);
  const bars = data.series.slice(-7).map((day) => ({ label: day.weekday.slice(0, 1), total: day.dials ?? 0, part: day.contacts ?? 0 }));
  return <DashTile title="This week" icon={<ChartColumn />} href={href} big={n(dials)} unit={`dials · ${n(reached)} reached`} bars={bars} />;
}

/** What the week's calls ended as, largest first. */
export async function OutcomesTile({ today, href }: { today: Today; href: string }) {
  const outcomes = (await today)?.insights?.outcomes;
  if (!outcomes?.length) return <LaunchEmpty />;
  const total = outcomes.reduce((sum, outcome) => sum + outcome.count, 0);
  const top = outcomes[0];
  return <DashTile title="Call outcomes · 7 days" icon={<Activity />} href={href} big={total ? `${Math.round((top.count / total) * 100)}%` : "—"} unit={top.label.toLowerCase()} rows={outcomes.slice(0, 4).map((outcome) => ({ label: outcome.label, value: n(outcome.count), tone: outcome.contact ? "good" : "default", href }))} />;
}

/** The hour with the best contact rate this week. */
export async function BestHourTile({ today, href }: { today: Today; href: string }) {
  const best = (await today)?.insights?.heat.best;
  if (!best) return <LaunchEmpty />;
  return <DashTile title="Best hour to call" icon={<Clock3 />} href={href} big={hourLabel(best.hour)} unit={`${best.rate.toFixed(0)}% reached`} rows={[{ label: "Dials in that hour this week", value: n(best.dials), href }]} />;
}

/** The team's standings, most dials first (agency scope only). */
export async function TeamTile({ today, href }: { today: Today; href: string }) {
  const leaders = (await today)?.insights?.leaders;
  if (!leaders?.length) return <LaunchEmpty />;
  return <DashTile title="Top dialers · 7 days" icon={<Trophy />} href={href} big={n(leaders.length)} unit="dialling this week" rows={leaders.slice(0, 4).map((leader, index) => ({ label: leader.name, value: `${n(leader.dials)} dials`, tone: index === 0 ? "good" : "default", href }))} />;
}

/** Premium written in the last 30 days (owner and producer: a money figure). */
export async function PremiumTile({ today, href }: { today: Today; href: string }) {
  const policies = (await today)?.policies30;
  if (!policies) return <LaunchEmpty />;
  return <DashTile title="Premium · 30 days" icon={<BadgeDollarSign />} href={href} big={usd(policies.premiumCents)} unit={`${n(policies.count)} ${policies.count === 1 ? "policy" : "policies"} written`} tone={policies.count ? "good" : "default"} rows={[{ label: "Policies written", value: n(policies.count), href }]} />;
}

/** The setter's own week: booked, showed, and the show rate with its coverage (LA-2.12). */
export async function SetterWeekTile({ today, href }: { today: Today; href: string }) {
  const week = (await today)?.setterWeek;
  if (!week) return <LaunchEmpty />;
  const rate = week.booked ? Math.round((week.showed / week.booked) * 100) : null;
  return (
    <DashTile
      title="Your week"
      icon={<CalendarClock />}
      href={href}
      big={n(week.booked)}
      unit="booked · 7 days"
      rows={[
        { label: "Showed", value: n(week.showed), tone: "good", href },
        { label: "No-show", value: n(week.noShow), tone: week.noShow ? "warning" : "default", href },
        { label: "Show rate", value: rate === null ? "—" : `${rate}%`, href },
        // A show rate never travels without its coverage (Sixteen #12).
        { label: "Closed out", value: `${n(week.closedOut)} of ${n(week.closeable)}`, tone: week.closedOut < week.closeable ? "warning" : "good", href },
      ]}
    />
  );
}

/** The reader's own close-out over 30 days (Sixteen #12). */
export async function CloseOutRateTile({ today, href }: { today: Today; href: string }) {
  const closeOut = (await today)?.closeOut;
  if (!closeOut) return <LaunchEmpty />;
  const total = closeOut.showed + closeOut.noShow + closeOut.awaiting;
  const done = closeOut.showed + closeOut.noShow;
  return <DashTile title="Your close-out · 30 days" icon={<ListChecks />} href={href} big={total ? `${Math.round((done / total) * 100)}%` : "—"} unit={`${n(done)} of ${n(total)} closed`} tone={closeOut.awaiting ? "warning" : "good"} rows={[{ label: "Showed", value: n(closeOut.showed), tone: "good", href }, { label: "No-show", value: n(closeOut.noShow), href }, { label: "Still need an outcome", value: n(closeOut.awaiting), tone: closeOut.awaiting ? "warning" : "default", href }]} />;
}

/** Licences expired and expiring in 30 days, with their states. */
export async function LicencesTile({ today, href }: { today: Today; href: string }) {
  const licences = (await today)?.needs.licences;
  if (!licences) return <LaunchEmpty />;
  const bad = licences.expired + licences.expiring;
  return (
    <DashTile
      title="Licences"
      icon={<ShieldCheck />}
      href={href}
      big={n(bad)}
      unit={bad ? "need action" : "none expiring in 30 days"}
      tone={licences.expired ? "danger" : bad ? "warning" : "good"}
      rows={[
        { label: "Expired", value: n(licences.expired), tone: licences.expired ? "danger" : "default", href },
        { label: "Expiring in 30 days", value: n(licences.expiring), tone: licences.expiring ? "warning" : "default", href },
        ...(licences.states.length ? [{ label: licences.states.slice(0, 6).join(", "), href }] : []),
      ]}
    />
  );
}

/** The agency's open lapse signals. */
export async function LapseTile({ today, href }: { today: Today; href: string }) {
  const lapsing = (await today)?.needs.lapsing;
  if (lapsing === null || lapsing === undefined) return <LaunchEmpty />;
  return <DashTile title="Lapse risk" icon={<TriangleAlert />} href={href} big={n(lapsing)} unit="policies at risk" tone={lapsing ? "warning" : "good"} rows={[{ label: lapsing ? "Work them before the draft date" : "No open lapse signal", tone: lapsing ? "warning" : "good", href }]} cta={lapsing ? { label: "Open the signals", href } : undefined} />;
}

/** One money and retention figure (LA-4.18), opening the view that holds its rows. */
export async function MoneyTile({ money, figureKey }: { money: Promise<DashboardMoney | null>; figureKey: HomeMoneyKey }) {
  const figure = (await money)?.figures.find((item) => item.key === figureKey);
  if (!figure) return <LaunchEmpty />;
  const icon = { statements: <Receipt />, discrepancies: <TriangleAlert />, owed: <BadgeDollarSign />, exposure: <ShieldCheck />, lapse: <TriangleAlert />, persistency: <BookOpen /> }[figure.key];
  return <DashTile title={figure.label} icon={icon} href={figure.href} big={figure.value} unit={figure.ring?.label} tone={figure.tone ?? "default"} rows={[{ label: figure.caption, tone: figure.tone ?? "default", href: figure.href }]} />;
}

/** Sixteen #15's one upgrade tile: only when the agent's own data makes the case. */
export async function UpgradeTile({ money, featureHref, rowsHref }: { money: Promise<DashboardMoney | null>; featureHref: string; rowsHref: string }) {
  const exposure = (await money)?.exposurePolicies;
  if (!exposure) return <LaunchEmpty />;
  return (
    <DashTile
      title="Chargeback radar"
      icon={<RadioTower />}
      href={featureHref}
      big={n(exposure)}
      unit={`${exposure === 1 ? "policy" : "policies"} inside the chargeback window`}
      rows={[{ label: `See the ${n(exposure)}`, href: rowsHref }, { label: "Lapse risk would flag these before they lapse", href: featureHref }]}
      cta={{ label: "What Lapse risk adds", href: featureHref }}
    />
  );
}

/** The setup checklist, pinned first until it is complete (LA-0.3). */
export function SetupTile({ checklist }: { checklist: SetupChecklist }) {
  const next = checklist.steps.filter((step) => !step.complete && !step.skipped).slice(0, 4);
  return (
    <DashTile
      title="Get set up"
      icon={<Wrench />}
      href="/app/setup"
      big={`${checklist.completed} of ${checklist.total}`}
      unit="steps done"
      rows={next.map((step) => ({ label: step.label, value: step.minutes ? `${step.minutes} min` : undefined, href: `${step.path}${step.path.includes("?") ? "&" : "?"}guide=${encodeURIComponent(step.key)}` }))}
      cta={{ label: "Continue setup", href: "/app/setup" }}
      ctaAtFoot
    />
  );
}

const MODULE_ICONS: Record<string, LucideIcon> = {
  "briefcase-business": BriefcaseBusiness,
  "calendar-check": CalendarCheck,
  "phone-incoming": PhoneIncoming,
  "radio-tower": RadioTower,
  "phone-outgoing": PhoneOutgoing,
  route: Route,
  "list-checks": ListChecks,
  "contact-round": ContactRound,
  "book-open": BookOpen,
  receipt: Receipt,
  "triangle-alert": TriangleAlert,
  headset: Headset,
};

/**
 * One registered module (lib/dashboard/tiles.ts): every way in, in the "Everything" workspace, with
 * its live figure where this reader may read it at that scope (tileFigureShown + the viewer).
 */
export async function ModuleTile({ tile, tenantId, viewer, figure }: { tile: DashboardTile; tenantId: string; viewer: TileViewer | undefined; figure: boolean }) {
  const Icon = MODULE_ICONS[tile.icon] ?? SquareStack;
  const metric = figure ? await tileMetric(tile.key, tenantId, viewer) : null;
  const shown = metric ? metric.display ?? n(metric.value) : undefined;
  return (
    <DashTile
      title={tile.label}
      icon={<Icon />}
      href={tile.path}
      big={shown}
      unit={metric?.caption}
      tone={metric?.tone ?? "default"}
      rows={[{ label: metric?.detail ?? tile.hint, href: tile.path }]}
      cta={{ label: tile.action_label, href: tile.path }}
      ctaAtFoot
    />
  );
}
