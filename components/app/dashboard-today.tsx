"use client";

import { Fragment, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowDownRight, ArrowUpRight, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LinkArrow } from "@/components/ui/link-arrow";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { countdown, dayOnDay } from "@/lib/dashboard/todayMath";
import { hourLabel, periodChange } from "@/lib/dashboard/insights";
import { waitLabel } from "@/lib/dashboard/summaryText";
import { Ring } from "@/components/ui/ring";
import type { HomeFigureKey, HomeNeedKey, HomeSectionKey } from "@/lib/dashboard/roleHome";
import type { DashboardToday } from "@/lib/dashboard/today";

/**
 * The dashboard's streamed sections, in the order the reader's role home asks for
 * (lib/dashboard/roleHome.ts, 2026-10-09): the one strip of today's figures, what needs the reader
 * today, today's appointments, and the analysis panels — activity by day, the outcome mix, the best
 * hour to call and, for an owner, the team's standings. The "Your day" header (greeting, date, the
 * next callback, the role's actions) is the page's.
 *
 * Everything interactive answers hover and keyboard focus alike. The motion (figures counting up,
 * bars growing) runs once on arrival and stands still under prefers-reduced-motion. The server
 * renders the final numbers, so the page is right before this script has run; the animation only
 * replays them.
 */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** A figure that counts up from zero once, on arrival. */
function CountUp({ value, decimals = 0, prefix = "", suffix = "", compact = false }: { value: number; decimals?: number; prefix?: string; suffix?: string; compact?: boolean }) {
  const [shown, setShown] = useState(value);
  useIsoLayoutEffect(() => {
    // A hidden tab draws no frames, so a count-up started there would sit at zero until it was
    // looked at; it shows the real figure instead and simply does not animate. No "already ran"
    // guard: React runs this twice in development (mount, clean up, mount), and a guard made the
    // second mount skip after the cleanup had cancelled the first — leaving the figure at zero.
    if (value === 0 || document.visibilityState !== "visible" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); return; }
    const started = performance.now();
    const duration = 900;
    let frame = 0;
    const step = (at: number) => {
      const t = Math.min(1, (at - started) / duration);
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    setShown(0);
    frame = requestAnimationFrame(step);
    // Frames can stop without the page being hidden (a covered window, a throttled pane); the
    // figure must still end on the real number, so a timer lands it whatever the frames did.
    const settle = window.setTimeout(() => { cancelAnimationFrame(frame); setShown(value); }, duration + 150);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(settle); };
  }, [value]);
  const text = compact ? compactNumber(shown) : decimals ? shown.toFixed(decimals) : Math.round(shown).toLocaleString();
  return <>{prefix}{text}{suffix}</>;
}

/** 1,240 → "1.2k", 1,250,000 → "1.3M"; under a thousand as is. */
function compactNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 10_000) return `${Math.round(value / 1000)}k`;
  if (abs >= 1_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return Math.round(value).toLocaleString();
}

const pct = (part: number, whole: number) => (whole > 0 ? (Math.min(part, whole) / whole) * 100 : null);
const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
const toneInk = { good: "text-[var(--success-ink)]", warning: "text-[var(--warning-ink)]", danger: "text-[var(--error-ink)]", neutral: "text-muted-foreground" } as const;
type Tone = keyof typeof toneInk;
const cardClass = "rounded-xl border border-border bg-card";

/* ── Next callback: the live countdown in the "Your day" header ──────────── */

/**
 * One line, as tall as the header's buttons: who, and how long until (or how late). The customer's
 * own clock is in the hover text and the accessible name. The page renders it only for a reader who
 * can open the callbacks calendar it links to.
 */
export function NextCallback({ callback, serverNow, href }: { callback: NonNullable<DashboardToday["nextCallback"]>; serverNow: number; href: string }) {
  const [now, setNow] = useState(serverNow);
  const reduced = useReducedMotion();
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const target = Date.parse(callback.atUtc);
  const left = countdown(target, now);
  const theirs = new Intl.DateTimeFormat("en-US", { timeZone: callback.customerTimezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(target));
  const soon = !left.late && target - now < 15 * 60_000;
  return (
    <Link
      href={href}
      aria-label={`Next callback: ${callback.name}, ${left.text}, ${theirs} their time`}
      title={`${callback.name} · ${theirs} their time`}
      className="group inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-full border border-border bg-[var(--surface-alt)] px-3 text-sm text-inherit no-underline transition-colors hover:border-[var(--border-strong)]"
    >
      <span className={`size-2 shrink-0 rounded-full ${left.late ? "bg-[var(--error)]" : "bg-[var(--primary)]"} ${reduced ? "" : "m-live"}`} aria-hidden="true" />
      <span className="truncate text-muted-foreground">Next · <span className="font-semibold text-foreground">{callback.name}</span></span>
      <span className={`shrink-0 font-semibold tabular-nums ${left.late ? "text-[var(--error-ink)]" : soon ? "text-[var(--accent-ink)]" : "text-foreground"}`} aria-live="off">{left.text}</span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

/* ── Today's figures: the page's one strip ───────────────────────────────── */

type Figure = { label: string; value: ReactNode; foot?: string; tone?: Tone; trend?: "up" | "down" | null; spark?: Array<number | null>; tip?: string; ring?: { value: number; max: number; label: string } };

/**
 * The figures this reader's home lists, in its order, each only when its number was read: a figure
 * whose read failed (or that the plan does not include) is left out rather than shown as a zero.
 * At most six (UI-CONSISTENCY §4). Each links to the page it summarises.
 */
function HomeFigures({ data, figures }: { data: DashboardToday; figures: Array<{ key: HomeFigureKey; href: string }> }) {
  const series = data.series;
  const dials = series.map((day) => day.dials);
  const contacts = series.map((day) => day.contacts);
  const rates = series.map((day) => (day.dials ? pct(day.contacts ?? 0, day.dials) : null));
  const weekDials = sum(dials.slice(-7));
  const lastWeekDials = sum(dials.slice(0, 7));
  const weekContacts = sum(contacts.slice(-7));
  const weekRate = pct(weekContacts, weekDials);
  const change = data.dialsToday === null ? null : dayOnDay(data.dialsToday, data.dialsYesterday);
  const wow = periodChange(weekDials, lastWeekDials);
  const dialing = data.dialsToday !== null;

  const build: Record<HomeFigureKey, () => Figure | null> = {
    dials: () => data.dialsToday === null ? null : {
      label: "Dials today", value: <CountUp value={data.dialsToday} />, foot: change?.text ?? "none yesterday by now",
      tone: change?.tone === "warning" ? "warning" : change?.tone === "good" ? "good" : "neutral", trend: change?.tone === "good" ? "up" : change?.tone === "warning" ? "down" : null, spark: dials,
    },
    reached: () => !dialing || data.contactsToday === null ? null : { label: "Reached", value: <CountUp value={data.contactsToday} />, foot: "real conversations", spark: contacts },
    rate: () => !dialing ? null : {
      label: "Contact rate", value: data.contactRatePct === null ? "—" : <CountUp value={data.contactRatePct} decimals={1} suffix="%" />,
      foot: weekRate === null ? "no dials this week" : `7-day ${weekRate.toFixed(1)}%`,
      tone: data.contactRatePct === null || weekRate === null ? "neutral" : data.contactRatePct >= weekRate ? "good" : "warning",
      trend: data.contactRatePct === null || weekRate === null ? null : data.contactRatePct >= weekRate ? "up" : "down",
      spark: rates,
    },
    appointments: () => data.appointmentsToday === null ? null : { label: "Appointments today", value: <CountUp value={data.appointmentsToday} />, foot: data.appointmentsWeek === null ? "on today's diary" : `${data.appointmentsWeek.toLocaleString()} booked this week` },
    dials7: () => !dialing ? null : {
      label: "Dials · 7 days", value: <CountUp value={weekDials} />, foot: wow === null ? "no dials the week before" : `${wow >= 0 ? "+" : ""}${wow.toFixed(0)}% vs last week`,
      tone: wow === null ? "neutral" : wow >= 0 ? "good" : "warning", trend: wow === null ? null : wow >= 0 ? "up" : "down", spark: dials.slice(-7),
    },
    premium: () => !data.policies30 ? null : {
      label: "Premium · 30 days", value: <CountUp value={data.policies30.premiumCents / 100} prefix="$" compact />,
      foot: `${data.policies30.count.toLocaleString()} polic${data.policies30.count === 1 ? "y" : "ies"} written`, tone: data.policies30.count ? "good" : "neutral",
    },
    queue: () => data.queueReady === null ? null : { label: "Queue ready", value: <CountUp value={data.queueReady} />, foot: data.isolated ? "assigned to you" : data.scope === "you" ? "in the agency's pool" : "leads waiting to dial" },
    booked: () => {
      const week = data.setterWeek;
      if (!week) return null;
      return { label: "Booked · 7 days", value: <CountUp value={week.booked} />, foot: "booked by you" };
    },
    shown: () => {
      const week = data.setterWeek;
      if (!week) return null;
      return { label: "Shown · 7 days", value: <CountUp value={week.showed} />, foot: `${week.noShow.toLocaleString()} no-show${week.noShow === 1 ? "" : "s"}`, tone: week.showed ? "good" : "neutral" };
    },
    showRate: () => {
      const week = data.setterWeek;
      if (!week) return null;
      // Decision 12 / Sixteen #12: the show rate never travels without its coverage —
      // "62%, based on 31 of 38 closed out".
      const decided = week.showed + week.noShow;
      const showRate = pct(week.showed, decided);
      return {
        label: "Show rate · 7 days", value: showRate === null ? "—" : <CountUp value={showRate} suffix="%" />,
        foot: week.closeable ? `based on ${week.closedOut.toLocaleString()} of ${week.closeable.toLocaleString()} closed out` : "none to close out yet",
        ring: week.closeable ? { value: week.closedOut, max: week.closeable, label: `${week.closedOut} of ${week.closeable} appointments closed out` } : undefined,
        tip: "Show rate counts only appointments with a recorded outcome. Closed out is the share of your past appointments that have one.",
      };
    },
    closeOut: () => {
      const own = data.closeOut;
      if (!own) return null;
      // Sixteen #12: the reader's own close-out rate, with the show rate it covers beside it.
      const closed = own.showed + own.noShow;
      const closeable = closed + own.awaiting;
      const coverage = pct(closed, closeable);
      const showRate = pct(own.showed, closed);
      return {
        label: "Your close-out · 30 days", value: coverage === null ? "—" : <CountUp value={coverage} suffix="%" />,
        foot: closeable ? `${showRate === null ? "—" : `${showRate.toFixed(0)}%`} showed, based on ${closed.toLocaleString()} of ${closeable.toLocaleString()} closed out` : "nothing to close out yet",
        tone: own.awaiting ? "warning" : closeable ? "good" : "neutral",
        ring: closeable ? { value: closed, max: closeable, label: `${closed} of ${closeable} of your appointments closed out` } : undefined,
        tip: "Of the appointments on your calendar in the last 30 days that have started, the share with an outcome recorded.",
      };
    },
  };

  const cells = figures
    .map((figure) => ({ ...figure, cell: build[figure.key]() }))
    .filter((figure): figure is { key: HomeFigureKey; href: string; cell: Figure } => figure.cell !== null)
    .slice(0, 6);
  if (!cells.length) return null;
  return (
    <StatStrip label="Today's numbers">
      {cells.map(({ key, href, cell }) => (
        <StatTile
          key={key}
          label={cell.label}
          labelTitle={cell.tip}
          value={cell.value}
          trend={cell.spark ? { points: cell.spark.map((point) => point ?? 0), tone: cell.tone === "good" ? "good" : cell.tone === "warning" ? "warning" : "neutral" } : undefined}
          reserveFootnote
          footnote={cell.foot ? (
            <span className={`inline-flex items-center gap-1 ${toneInk[cell.tone ?? "neutral"]}`}>
              {cell.ring && <Ring value={cell.ring.value} max={cell.ring.max} size={18} tone="primary" label={cell.ring.label}><></></Ring>}
              {cell.trend === "up" && <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />}
              {cell.trend === "down" && <ArrowDownRight className="size-3.5 shrink-0" aria-hidden="true" />}
              {cell.foot}
            </span>
          ) : undefined}
          action={<Link href={href} aria-label={`Open ${cell.label.toLowerCase()}`} className="font-semibold text-foreground no-underline hover:underline">Open</Link>}
        />
      ))}
    </StatStrip>
  );
}

/* ── Today's appointments (LA-2.11-8) ────────────────────────────────────── */

const APPOINTMENT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  booked: { label: "Booked", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "good" },
  pending: { label: "Awaiting close-out", tone: "warning" },
  showed: { label: "Showed", tone: "good" },
  no_show: { label: "No-show", tone: "danger" },
};

function clockIn(iso: string, zone: string, withZone: boolean) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", ...(withZone ? { timeZoneName: "short" } : {}) }).format(new Date(iso));
  } catch {
    return "";
  }
}

/**
 * The diary for today, earliest first: the agency's clock, and the customer's when it differs.
 * Hidden when the diary could not be read; an empty day says so and offers the calendar.
 */
function TodayAppointments({ data }: { data: DashboardToday }) {
  const list = data.appointmentsTodayList;
  if (!list) return null;
  const more = (data.appointmentsToday ?? list.length) - list.length;
  return (
    <TableCard
      title="Today's appointments"
      action={<LinkArrow href="/app/calendar" className="text-xs">{more > 0 ? `${more} more · Calendar` : "Calendar"}</LinkArrow>}
    >
      {list.length === 0 ? (
        <EmptyState title="No appointments today" hint="Booked appointments for today show here." action={<Button asChild variant="outline"><Link href="/app/calendar">Open calendar</Link></Button>} />
      ) : (
        <ul className="m-0 list-none divide-y divide-border border-t border-border p-0">
          {list.map((item) => {
            const status = APPOINTMENT_STATUS[item.status] ?? APPOINTMENT_STATUS.booked;
            const theirs = item.customerTimezone && item.customerTimezone !== data.zone ? clockIn(item.startsAtUtc, item.customerTimezone, true) : "";
            return (
              <li key={item.id}>
                <Link href={`/app/calendar?appointment=${item.id}`} className="m-row flex items-center gap-3 px-4 py-2 text-inherit no-underline">
                  <span className="w-[72px] shrink-0 text-sm font-semibold tabular-nums text-foreground">{clockIn(item.startsAtUtc, data.zone, false)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{item.customerName}</span>
                    <span className="block truncate text-xs text-muted-foreground">with {item.agentName}{theirs ? ` · ${theirs} their time` : ""}</span>
                  </span>
                  <StatusChip tone={status.tone}>{status.label}</StatusChip>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </TableCard>
  );
}

/* ── Needs you today ─────────────────────────────────────────────────────── */

const NEED_DOT = { danger: "bg-[var(--error)]", warning: "bg-[var(--warning)]", good: "bg-[var(--success)]" } as const;

type NeedRow ={ key: HomeNeedKey; label: string; value: number; sentence: string; href: string; tone: "danger" | "warning" | "good" };

/** The rows this reader's home lists, each only when it was read; links go where the role can act. */
function NeedsList({ needs, rows: wanted }: { needs: DashboardToday["needs"]; rows: Array<{ key: HomeNeedKey; href: string }> }) {
  const build: Record<HomeNeedKey, (href: string) => NeedRow | null> = {
    transfers: (href) => needs.transfersWaiting === null ? null : {
      key: "transfers", label: "Transfers waiting", value: needs.transfersWaiting, href,
      // The SLA, and how long the longest one has waited (the queue SLA ladder's own read).
      sentence: `${needs.slaBreaching ? `${needs.slaBreaching} past the ${needs.slaMinutes ?? 15}m SLA` : needs.transfersWaiting ? "None past the SLA" : "Nobody waiting"}${needs.transfersWaiting && needs.oldestWaitingSeconds !== null ? ` · longest ${waitLabel(needs.oldestWaitingSeconds)}` : ""}`,
      tone: needs.slaBreaching ? "danger" : needs.transfersWaiting ? "warning" : "good",
    },
    callbacks: (href) => needs.callbacksOverdue === null ? null : { key: "callbacks", label: "Callbacks overdue", value: needs.callbacksOverdue, sentence: needs.callbacksToday ? `${needs.callbacksToday} more due later today` : "Nothing else due today", href, tone: needs.callbacksOverdue ? "warning" : "good" },
    lapse: (href) => needs.lapsing === null ? null : { key: "lapse", label: "Lapse risk", value: needs.lapsing, sentence: needs.lapsing ? "Policies with an open lapse signal" : "No open lapse signal", href, tone: needs.lapsing ? "warning" : "good" },
    licences: (href) => {
      if (needs.licences === null) return null;
      const bad = needs.licences.expired + needs.licences.expiring;
      return { key: "licences", label: "Licences", value: bad, sentence: bad ? `${needs.licences.expired ? `${needs.licences.expired} expired` : ""}${needs.licences.expired && needs.licences.expiring ? ", " : ""}${needs.licences.expiring ? `${needs.licences.expiring} expiring` : ""} · ${needs.licences.states.join(", ")}` : "None expiring in 30 days", href, tone: needs.licences.expired ? "danger" : bad ? "warning" : "good" };
    },
  };
  const rows = wanted.map((row) => build[row.key](row.href)).filter((row): row is NeedRow => row !== null);
  if (!rows.length) return null;
  const attention = rows.filter((row) => row.value > 0).length;
  return (
    <TableCard
      title="Needs you today"
      action={<StatusChip tone={attention ? "danger" : "good"} dot>{attention ? `${attention} need attention` : "All clear"}</StatusChip>}
    >
      <ul className="m-0 grid list-none grid-cols-1 gap-px overflow-hidden border-t border-border bg-border p-0 sm:grid-cols-2 xl:grid-flow-col xl:auto-cols-fr xl:grid-cols-none">
        {rows.map((row) => (
          <li key={row.key} className="bg-card">
            <Link href={row.href} className="m-row group flex items-center gap-3 px-4 py-3 text-inherit no-underline">
              <span className={`text-2xl font-semibold leading-none tracking-[-0.03em] tabular-nums ${row.tone === "danger" && row.value ? "text-[var(--error-ink)]" : "text-foreground"}`}><CountUp value={row.value} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5"><span className={`size-[7px] shrink-0 rounded-full ${NEED_DOT[row.tone]}`} aria-hidden="true" /><span className="truncate text-xs font-semibold text-foreground">{row.label}</span></span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{row.sentence}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </TableCard>
  );
}

/* ── Activity: fourteen days, three lenses ───────────────────────────────── */

type Lens = "dials" | "contacts" | "rate";
const LENSES: Array<{ key: Lens; label: string }> = [{ key: "dials", label: "Dials" }, { key: "contacts", label: "Reached" }, { key: "rate", label: "Contact rate" }];

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ key: T; label: string }>; onChange: (next: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-[var(--surface-alt)] p-0.5">
      {options.map((option) => (
        <button key={option.key} type="button" role="radio" aria-checked={value === option.key} onClick={() => onChange(option.key)}
          className={`h-7 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === option.key ? "bg-card text-foreground shadow-[var(--shadow-rest)]" : "text-muted-foreground hover:text-foreground"}`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ActivityPanel({ data }: { data: DashboardToday }) {
  const [lens, setLens] = useState<Lens>("dials");
  const [active, setActive] = useState<number | null>(null);
  const series = data.series;
  const valueOf = (day: DashboardToday["series"][number]) => lens === "dials" ? day.dials ?? 0 : lens === "contacts" ? day.contacts ?? 0 : pct(day.contacts ?? 0, day.dials ?? 0) ?? 0;
  const values = series.map(valueOf);
  const max = lens === "rate" ? 100 : Math.max(4, ...values);
  const withDials = series.filter((day) => (day.dials ?? 0) > 0);
  const average = lens === "rate"
    ? pct(sum(series.map((day) => day.contacts)), sum(series.map((day) => day.dials))) ?? 0
    : values.reduce((total, value) => total + value, 0) / series.length;
  const format = (value: number) => lens === "rate" ? `${value.toFixed(1)}%` : Math.round(value).toLocaleString();
  const shown = active === null ? null : series[active];
  const totalDials = sum(series.map((day) => day.dials));
  const totalContacts = sum(series.map((day) => day.contacts));
  return (
    <section className={`${cardClass} flex min-w-0 flex-col p-5`} aria-labelledby="activity-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="activity-heading" className="text-sm font-semibold leading-normal tracking-[-0.01em] text-foreground">Activity · last 14 days</h2>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {shown
              ? <><strong className="font-semibold text-foreground">{shown.weekday} {shown.label}</strong> · {shown.dials ?? 0} dials · {shown.contacts ?? 0} reached · {pct(shown.contacts ?? 0, shown.dials ?? 0)?.toFixed(0) ?? "—"}%</>
              : <>{totalDials.toLocaleString()} dials · {totalContacts.toLocaleString()} reached · {withDials.length} active day{withDials.length === 1 ? "" : "s"}{data.scope === "you" ? " · yours" : ""}</>}
          </p>
        </div>
        <Segmented value={lens} options={LENSES} onChange={setLens} label="Chart measure" />
      </div>
      <div className="relative mt-4 flex flex-1 flex-col">
        {/* Gridlines at a quarter, a half and three quarters, with the scale on the right. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-6 top-0" aria-hidden="true">
          {[0.25, 0.5, 0.75, 1].map((step) => (
            <div key={step} className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${step * 100}%` }}>
              <span className="absolute -top-2 right-0 bg-card pl-1 text-xs leading-none tabular-nums text-muted-foreground">{lens === "rate" ? `${Math.round(max * step)}%` : format(max * step)}</span>
            </div>
          ))}
          {average > 0 && (
            <div className="absolute inset-x-0 border-t-2 border-[color-mix(in_srgb,var(--primary)_55%,transparent)]" style={{ bottom: `${(average / max) * 100}%` }}>
              <span className="absolute -top-[9px] left-0 rounded bg-[var(--primary)] px-1 text-xs font-semibold leading-[16px] text-[var(--on-primary)]">avg {format(average)}</span>
            </div>
          )}
        </div>
        <div className="relative flex min-h-[168px] flex-1 items-end gap-1 pr-8 sm:gap-1.5" role="img" aria-label={`${LENSES.find((item) => item.key === lens)?.label} per day over the last 14 days.`}>
          {series.map((day, index) => {
            const value = values[index];
            const height = value ? Math.max(4, (value / max) * 100) : 1.5;
            const isActive = active === index;
            return (
              <button
                key={day.key}
                type="button"
                aria-label={`${day.weekday} ${day.label}: ${day.dials ?? 0} dials, ${day.contacts ?? 0} reached`}
                onClick={() => setActive(index)} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}
                className="group relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {isActive && (
                  <span className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-semibold leading-[16px] text-background shadow-[var(--shadow-overlay)]" style={{ bottom: `calc(${height}% + 6px)` }}>
                    {format(value)}
                  </span>
                )}
                <span
                  className={`m-bar relative block w-full overflow-hidden rounded-t-[4px] rounded-b-[2px] transition-colors ${day.isToday ? "bg-[var(--primary)]" : isActive ? "bg-[color-mix(in_srgb,var(--primary)_70%,transparent)]" : "bg-[color-mix(in_srgb,var(--primary)_28%,var(--surface-alt))]"}`}
                  style={{ height: `${height}%`, animationDelay: `${80 + index * 30}ms` }}
                >
                  {lens === "dials" && (day.contacts ?? 0) > 0 && (day.dials ?? 0) > 0 && (
                    <span className={`absolute inset-x-0 bottom-0 block ${day.isToday ? "bg-[color-mix(in_srgb,var(--foreground)_28%,var(--primary))]" : "bg-[var(--primary)]"}`} style={{ height: `${pct(day.contacts ?? 0, day.dials ?? 0)}%` }} />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 flex h-[18px] gap-1 pr-8 sm:gap-1.5" aria-hidden="true">
          {series.map((day, index) => <span key={day.key} className={`min-w-0 flex-1 text-center text-xs leading-[1.5] ${day.isToday || active === index ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{day.isToday ? "Today" : day.weekday.slice(0, 1)}</span>)}
        </div>
      </div>
      {lens === "dials" && (
        <p className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[var(--primary)]" aria-hidden="true" />Reached</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[color-mix(in_srgb,var(--primary)_28%,var(--surface-alt))]" aria-hidden="true" />Dialled</span>
        </p>
      )}
    </section>
  );
}

/* ── Outcomes: the week's dispositions as a ring ─────────────────────────── */

// One brand palette: conversations in the brand's greens, everything else in neutrals.
// Mid-range shades only: brand-700/800 all but vanish on the dark card, brand-100/200 on the light one.
const CONTACT_SHADES = ["var(--brand-600)", "var(--brand-400)", "var(--brand-300)", "var(--brand-500)", "color-mix(in srgb, var(--brand-400) 55%, var(--brand-200))"];
const OTHER_SHADES = [75, 58, 44, 32, 24].map((mix) => `color-mix(in srgb, var(--color-muted-foreground) ${mix}%, var(--color-card))`);

function OutcomesPanel({ insights, sampled }: { insights: NonNullable<DashboardToday["insights"]>; sampled: boolean }) {
  const [active, setActive] = useState<string | null>(null);
  const total = insights.outcomes.reduce((all, item) => all + item.count, 0);
  const reached = insights.outcomes.filter((item) => item.contact).reduce((all, item) => all + item.count, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const slices = insights.outcomes.map((item, index, all) => {
    const before = all.slice(0, index);
    const shade = before.filter((other) => other.contact === item.contact).length;
    return {
      ...item,
      color: item.contact ? CONTACT_SHADES[shade % CONTACT_SHADES.length] : OTHER_SHADES[shade % OTHER_SHADES.length],
      length: total ? (item.count / total) * circumference : 0,
      offset: total ? (before.reduce((all2, other) => all2 + other.count, 0) / total) * circumference : 0,
    };
  });
  const focus = slices.find((item) => item.key === active) ?? null;
  return (
    <section className={`${cardClass} flex min-w-0 flex-col p-5`} aria-labelledby="outcomes-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="outcomes-heading" className="text-sm font-semibold leading-normal tracking-[-0.01em] text-foreground">Outcomes · 7 days</h2>
        <Link href="/app/activity" className="text-xs font-semibold text-muted-foreground no-underline hover:text-foreground">Details</Link>
      </div>
      {total === 0 ? (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm font-semibold">No calls in the last 7 days</p>
          <p className="mt-1 text-xs text-muted-foreground">Outcomes appear here as calls are dispositioned.</p>
        </div>
      ) : (
        <div className="mt-3 flex flex-1 flex-col items-center gap-4 sm:flex-row lg:flex-col 2xl:flex-row">
          <div className="relative size-[148px] shrink-0">
            <svg viewBox="0 0 100 100" className="m-sweep size-full -rotate-90" aria-hidden="true">
              <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--surface-alt)" strokeWidth="11" />
              {slices.map((slice) => {
                const gap = slices.length > 1 ? Math.min(1.2, slice.length / 3) : 0;
                return (
                  <circle key={slice.key} cx="50" cy="50" r={radius} fill="none" stroke={slice.color} strokeWidth={active === slice.key ? 14 : 11}
                    strokeDasharray={`${Math.max(0, slice.length - gap)} ${circumference}`} strokeDashoffset={-slice.offset}
                    className="cursor-pointer transition-[stroke-width,opacity] duration-150" opacity={active && active !== slice.key ? 0.35 : 1}
                    onMouseEnter={() => setActive(slice.key)} onMouseLeave={() => setActive(null)} />
                );
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" aria-live="polite">
              <span className="text-2xl font-semibold leading-none tracking-[-0.03em] tabular-nums text-foreground">{focus ? `${((focus.count / total) * 100).toFixed(0)}%` : `${((reached / total) * 100).toFixed(0)}%`}</span>
              <span className="mt-1 max-w-[92px] truncate text-xs leading-[1.3] text-muted-foreground">{focus ? focus.label : "reached"}</span>
            </div>
          </div>
          <ul className="w-full min-w-0 space-y-0.5">
            {slices.map((slice) => (
              <li key={slice.key}>
                <button type="button" onClick={() => setActive(slice.key)} onMouseEnter={() => setActive(slice.key)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(slice.key)} onBlur={() => setActive(null)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active === slice.key ? "bg-[var(--surface-alt)]" : ""}`}>
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: slice.color }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{slice.label}</span>
                  <span className="tabular-nums text-muted-foreground">{slice.count.toLocaleString()}</span>
                  <span className="w-9 text-right font-semibold tabular-nums text-foreground">{((slice.count / total) * 100).toFixed(0)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {sampled && <p className="mt-3 text-xs text-muted-foreground">From the latest 5,000 calls this week.</p>}
    </section>
  );
}

/* ── Best time to call ───────────────────────────────────────────────────── */

function HeatmapPanel({ heat, zone }: { heat: NonNullable<DashboardToday["insights"]>["heat"]; zone: string }) {
  const [active, setActive] = useState<{ day: number; hour: number } | null>(null);
  const zoneLabel = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value ?? zone;
  const cell = active ? heat.days[active.day]?.cells[active.hour] : null;
  const activeHour = active ? heat.hours[active.hour] : null;
  const hourTotals = heat.hours.map((_, index) => heat.days.reduce((all, day) => all + (day.cells[index]?.dials ?? 0), 0));
  const hourMax = Math.max(1, ...hourTotals);
  return (
    <section className={`${cardClass} min-w-0 p-5`} aria-labelledby="heat-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="heat-heading" className="text-sm font-semibold leading-normal tracking-[-0.01em] text-foreground">When calls happen · 7 days</h2>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {active && cell
              ? <><strong className="font-semibold text-foreground">{heat.days[active.day].weekday} {hourLabel(activeHour ?? 0)}</strong> · {cell.dials} dial{cell.dials === 1 ? "" : "s"} · {cell.contacts} reached{cell.dials ? ` · ${((cell.contacts / cell.dials) * 100).toFixed(0)}%` : ""}</>
              : <>Dials by hour, {zoneLabel}</>}
          </p>
        </div>
        {heat.best ? (
          <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))] px-3 py-1.5">
            <span className="text-xs text-muted-foreground">Best hour</span>
            <span className="text-sm font-semibold text-foreground">{hourLabel(heat.best.hour)}</span>
            <span className="text-xs font-semibold text-[var(--accent-ink)]">{heat.best.rate.toFixed(0)}% reached</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Best hour shows after 3+ dials in an hour</span>
        )}
      </div>
      <div className="-mx-1 mt-3 overflow-x-auto overflow-y-hidden px-1 py-1">
        <div className="min-w-[520px]" onMouseLeave={() => setActive(null)}>
          {/* Hour totals as a thin bar row over the grid: the busiest hours at a glance. */}
          <div className="grid items-end gap-[3px]" style={{ gridTemplateColumns: `36px repeat(${heat.hours.length}, minmax(0, 1fr))` }} aria-hidden="true">
            <span />
            {hourTotals.map((total, index) => (
              <span key={heat.hours[index]} className="flex h-6 items-end">
                <span className="m-bar block w-full rounded-t-[2px] bg-[color-mix(in_srgb,var(--primary)_45%,var(--surface-alt))]" style={{ height: `${total ? Math.max(8, (total / hourMax) * 100) : 0}%`, animationDelay: `${index * 20}ms` }} />
              </span>
            ))}
          </div>
          <div className="mt-1 space-y-[3px]" role="grid" aria-label="Dials by day and hour">
            {heat.days.map((day, dayIndex) => (
              <div key={day.key} role="row" className="grid gap-[3px]" style={{ gridTemplateColumns: `36px repeat(${heat.hours.length}, minmax(0, 1fr))` }}>
                <span role="rowheader" className="self-center text-xs leading-none text-muted-foreground">{day.weekday}</span>
                {day.cells.map((value, hourIndex) => {
                  const strength = heat.maxDials ? value.dials / heat.maxDials : 0;
                  const isActive = active?.day === dayIndex && active.hour === hourIndex;
                  return (
                    <button
                      key={hourIndex}
                      type="button"
                      role="gridcell"
                      aria-label={`${day.weekday} ${hourLabel(heat.hours[hourIndex])}: ${value.dials} dials, ${value.contacts} reached`}
                      onClick={() => setActive({ day: dayIndex, hour: hourIndex })}
                      onMouseEnter={() => setActive({ day: dayIndex, hour: hourIndex })}
                      onFocus={() => setActive({ day: dayIndex, hour: hourIndex })}
                      className={`h-6 rounded-[4px] outline-none transition-transform duration-100 focus-visible:ring-2 focus-visible:ring-ring ${isActive ? "scale-110 ring-2 ring-[var(--primary)]" : ""}`}
                      style={{ background: value.dials ? `color-mix(in srgb, var(--primary) ${Math.round(18 + strength * 82)}%, var(--surface-alt))` : "var(--surface-alt)" }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-1.5 grid gap-[3px]" style={{ gridTemplateColumns: `36px repeat(${heat.hours.length}, minmax(0, 1fr))` }} aria-hidden="true">
            <span />
            {heat.hours.map((hour, index) => <span key={hour} className={`text-center text-xs leading-none ${active?.hour === index ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{index % 2 === 0 ? hourLabel(hour).replace(" ", "").toLowerCase() : ""}</span>)}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Team standings ──────────────────────────────────────────────────────── */

function LeadersPanel({ leaders }: { leaders: NonNullable<NonNullable<DashboardToday["insights"]>["leaders"]> }) {
  const max = Math.max(1, ...leaders.map((leader) => leader.dials));
  return (
    <section className={`${cardClass} flex min-w-0 flex-col p-5`} aria-labelledby="leaders-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="leaders-heading" className="text-sm font-semibold leading-normal tracking-[-0.01em] text-foreground">Top dialers · 7 days</h2>
        <Link href="/app/activity?view=scorecard" className="text-xs font-semibold text-muted-foreground no-underline hover:text-foreground">Scorecard</Link>
      </div>
      {leaders.length === 0 ? (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm font-semibold">Nobody has dialled this week</p>
          <p className="mt-1 text-xs text-muted-foreground">Standings fill in as the team makes calls.</p>
        </div>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {leaders.map((leader, index) => {
            const rate = pct(leader.contacts, leader.dials);
            return (
              <li key={leader.userId} className="flex items-center gap-3">
                <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${index === 0 ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[var(--surface-alt)] text-foreground"}`} aria-label={`Rank ${index + 1}`}>
                  {index === 0 ? <Trophy className="size-3.5" aria-hidden="true" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{leader.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground"><strong className="font-semibold text-foreground">{leader.dials.toLocaleString()}</strong> dials · {rate === null ? "—" : `${rate.toFixed(0)}%`}</span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                    <span className="m-bar-x relative block h-full rounded-full bg-[color-mix(in_srgb,var(--primary)_35%,var(--surface-alt))]" style={{ width: `${(leader.dials / max) * 100}%`, animationDelay: `${150 + index * 80}ms` }}>
                      <span className="absolute inset-y-0 left-0 block rounded-full bg-[var(--primary)]" style={{ width: `${rate ?? 0}%` }} />
                    </span>
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}


/* ── The analysis panels ─────────────────────────────────────────────────── */

/**
 * Activity beside the outcome mix, then the best hour — with the team's standings beside it when the
 * home has a team to rank (the owner's). Nothing when the reader's plan or role has no dialling.
 */
function AnalysisPanels({ data, team }: { data: DashboardToday; team: boolean }) {
  const insights = data.insights;
  if (data.dialsToday === null) return null;
  const side = team && insights?.leaders ? <LeadersPanel leaders={insights.leaders} /> : null;
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <ActivityPanel data={data} />
        {insights ? <OutcomesPanel insights={insights} sampled={insights.sampled} /> : <div className={`${cardClass} p-5 text-sm text-muted-foreground`}>Outcomes could not be read just now.</div>}
      </div>
      {insights && (
        <div className={`grid gap-4 ${side ? "lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]" : ""}`}>
          <HeatmapPanel heat={insights.heat} zone={data.zone} />
          {side}
        </div>
      )}
    </>
  );
}

/* ── The streamed sections, in the role's order ──────────────────────────── */

/**
 * Renders `sections` in order. The data sections draw from `data`; any other section in the run
 * (the callbacks list between "needs" and the diary, say) is passed in rendered, as a slot. `team`
 * is not a block of its own: it puts the standings beside the best-hour panel.
 */
export function DashboardStreamed({ data, sections, figures, needs, slots }: {
  data: DashboardToday;
  sections: HomeSectionKey[];
  figures: Array<{ key: HomeFigureKey; href: string }>;
  needs: Array<{ key: HomeNeedKey; href: string }>;
  slots: Partial<Record<HomeSectionKey, ReactNode>>;
}) {
  const team = sections.includes("team");
  const render = (key: HomeSectionKey): ReactNode => {
    switch (key) {
      case "figures": return <HomeFigures data={data} figures={figures} />;
      case "needs": return <NeedsList needs={data.needs} rows={needs} />;
      case "appointments": return <TodayAppointments data={data} />;
      case "activity": return <AnalysisPanels data={data} team={team} />;
      case "team": return null;
      default: return slots[key] ?? null;
    }
  };
  return <>{sections.map((key) => <Fragment key={key}>{render(key)}</Fragment>)}</>;
}

/** Held while the streamed sections' reads finish — the header and the rest have already rendered. */
export function DashboardTodaySkeleton({ strip = true, panels = true }: { strip?: boolean; panels?: boolean }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading today">
      {strip && <div className={`${cardClass} grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 xl:grid-cols-6`}>{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="m-skel h-[92px] rounded" />)}</div>}
      {panels
        ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]"><div className="m-skel h-[260px] rounded-xl" /><div className="m-skel h-[260px] rounded-xl" /></div>
        : <div className="m-skel h-[160px] rounded-xl" />}
    </div>
  );
}
