import "server-only";

import type { ReactNode } from "react";

import { BarList, BarSeries, LineSeries, type ChartBar } from "@/components/ui/chart";
import type { AdminRole } from "@/lib/adminAuth/roles";
import {
  ageWords,
  countWords,
  coverageNote,
  DASH_PERIOD_LABELS,
  DASH_PERIODS,
  eventSeries,
  flowSeries,
  funnelView,
  lastYearLine,
  levelSeries,
  netMovementCents,
  pageLink,
  percentOf,
  periodBuckets,
  periodStartIso,
  signedDollars,
  tabLink,
  wholeDollars,
  type DashPeriod,
} from "@/lib/adminDashboard/series";
import {
  loginStats,
  metricsHistory,
  monthInvoiceTotals,
  paidInvoices,
  planNames,
  readNow,
  signInEvents,
  signupFunnel,
  snapshotFreshness,
  suspendedTenants,
  trialsNow,
} from "@/lib/adminDashboard/tabQueries";
import type { MetricsDay } from "@/lib/metrics/queries";

import { GraphCard, GraphCardError, GraphEmpty, settleCard } from "./ov-card";
import { ByPeriod } from "./ov-period";

/**
 * The Overview tab's graph cards (admin round 1, board section 1). Each is an async server component that
 * reads its own figures and fails on its own. The period switch (`?period=`) only chooses which drawing shows,
 * so every card draws all three periods here and `ByPeriod` picks one in the browser.
 *
 * Snapshot graphs (MRR, customers, trials, plans) read metrics_daily, whose nightly job stopped on production on
 * 2026-09-21: their figures are muted with their age, and a period with no snapshot day draws an honest empty
 * state, never a line of zeros. Payments and sign-ins are counted from their own rows, so they are current.
 */

export const OVERVIEW_FALLBACK: DashPeriod = "12m";
const PERIODS = DASH_PERIODS;
type Props = { role: AdminRole };

const n = (value: number) => value.toLocaleString("en-US");

function perPeriod(draw: (period: DashPeriod) => ReactNode) {
  const views: Partial<Record<DashPeriod, ReactNode>> = {};
  for (const period of PERIODS) views[period] = draw(period);
  return <ByPeriod views={views} periods={PERIODS} fallback={OVERVIEW_FALLBACK} />;
}

/** "▲ 4" in gold for a rise (gold is for rises), "▼ 2" in the warning ink for a fall. */
function Change({ value, suffix }: { value: number; suffix: string }) {
  if (value === 0) return <>no change {suffix}</>;
  return (
    <>
      <span className={value > 0 ? "font-semibold text-[var(--highlight-ink)]" : "font-semibold text-[var(--warning-ink)]"}>{value > 0 ? "▲" : "▼"} {n(Math.abs(value))}</span> {suffix}
    </>
  );
}

const joinLine = (...parts: (ReactNode | null | false | undefined)[]) => {
  const kept = parts.filter((part) => part !== null && part !== false && part !== undefined && part !== "");
  return kept.map((part, index) => (
    <span key={index}>
      {index > 0 && " · "}
      {part}
    </span>
  ));
};

async function snapshot() {
  const [days, fresh] = await Promise.all([metricsHistory(), snapshotFreshness()]);
  return { days, fresh, now: readNow() };
}

/** Too little history for a line: the honest empty state with the reason. */
function ShortHistory({ note }: { note: string | null }) {
  return <GraphEmpty title="Not enough figures to draw" hint={note ?? "There are not yet two points to draw a line between."} />;
}

/* ── MRR ──────────────────────────────────────────────────────────────────────────────────── */

export async function MrrGraph({ role }: Props) {
  const data = await settleCard("MRR", snapshot);
  if (!data) return <GraphCardError title="MRR" span />;
  const { days, fresh, now } = data;
  const latest = days.at(-1);
  const link = linkTo(tabLink(role, "money"), "Money");
  const pick = (day: MetricsDay) => day.mrr_cents;

  return perPeriod((period) => {
    const buckets = periodBuckets(period, now);
    const points = levelSeries(days, buckets, pick);
    const lastYear = lastYearLine(days, buckets, points, pick);
    const note = coverageNote(points, buckets, fresh.date);
    return (
      <GraphCard
        title="MRR"
        span
        link={link}
        value={latest ? wholeDollars(latest.mrr_cents) : "—"}
        stale={fresh.isStale}
        line={joinLine(fresh.isStale && ageWords(fresh.ageDays), latest ? `ARR ${wholeDollars(latest.arr_cents)}` : "no figures yet")}
        foot={points.length >= 2 ? [note, lastYear ? null : "Last year's line appears once there is a year of history."].filter(Boolean).join(" ") : null}
      >
        {points.length >= 2 ? (
          <LineSeries
            points={points}
            summary={`MRR over ${DASH_PERIOD_LABELS[period]}`}
            format={wholeDollars}
            minHeight={150}
            legend={lastYear ? { label: "This year" } : undefined}
            lines={lastYear ? [{ key: "last-year", label: "Last year", tone: "highlight", dashed: true, points: lastYear }] : undefined}
          />
        ) : (
          <ShortHistory note={note} />
        )}
      </GraphCard>
    );
  });
}

/* ── How MRR moved ────────────────────────────────────────────────────────────────────────── */

export async function MovementGraph({ role }: Props) {
  const data = await settleCard("How MRR moved", snapshot);
  if (!data) return <GraphCardError title="How MRR moved" span />;
  const { days, fresh, now } = data;
  const link = linkTo(tabLink(role, "money"), "Money");

  return perPeriod((period) => {
    const buckets = periodBuckets(period, now);
    const from = buckets[0].start;
    const inPeriod = days.filter((day) => day.date >= from);
    const gained = flowSeries(days, buckets, (day) => day.new_mrr_cents + day.expansion_mrr_cents);
    const newOnly = new Map(flowSeries(days, buckets, (day) => day.new_mrr_cents).map((point) => [point.key, point.value]));
    const lost = new Map(flowSeries(days, buckets, (day) => day.contraction_mrr_cents + day.churned_mrr_cents).map((point) => [point.key, point.value]));
    const bars: ChartBar[] = gained.map((point) => ({ key: point.key, label: point.label, value: point.value, accent: newOnly.get(point.key) ?? 0, below: lost.get(point.key) ?? 0 }));
    const net = inPeriod.reduce((sum, day) => sum + netMovementCents(day), 0);
    return (
      <GraphCard
        title="How MRR moved"
        span
        link={link}
        value={inPeriod.length ? signedDollars(net) : "—"}
        stale={fresh.isStale}
        line={joinLine(fresh.isStale && ageWords(fresh.ageDays), inPeriod.length ? `net over ${DASH_PERIOD_LABELS[period]}` : "no figures in this period")}
        foot={bars.length ? coverageNote(gained, buckets, fresh.date) : null}
      >
        {bars.length ? (
          <BarSeries
            bars={bars}
            summary={`MRR gained and lost over ${DASH_PERIOD_LABELS[period]}`}
            format={wholeDollars}
            minHeight={150}
            names={{ value: "Gained", accent: "New", below: "Lost" }}
            legend={[
              { key: "new", label: "New", tone: "strong" },
              { key: "expansion", label: "Expansion", tone: "faint" },
              { key: "lost", label: "Contraction & churned", tone: "warning" },
            ]}
          />
        ) : (
          <ShortHistory note={coverageNote(gained, buckets, fresh.date)} />
        )}
      </GraphCard>
    );
  });
}

/* ── Customers ────────────────────────────────────────────────────────────────────────────── */

export async function ActiveCustomersGraph({ role }: Props) {
  const data = await settleCard("Active customers", async () => ({ ...(await snapshot()), suspended: await suspendedTenants() }));
  if (!data) return <GraphCardError title="Active customers" />;
  const { days, fresh, now, suspended } = data;
  const latest = days.at(-1);
  const link = linkTo(tabLink(role, "customers"), "Customers");

  return perPeriod((period) => {
    const buckets = periodBuckets(period, now);
    const points = levelSeries(days, buckets, (day) => day.active_customers);
    const change = points.length >= 2 ? points.at(-1)!.value - points[0].value : null;
    return (
      <GraphCard
        title="Active customers"
        link={link}
        value={latest ? n(latest.active_customers) : "—"}
        stale={fresh.isStale}
        line={joinLine(fresh.isStale && ageWords(fresh.ageDays), change !== null && <Change value={change} suffix={`in ${DASH_PERIOD_LABELS[period]}`} />, `${n(suspended)} suspended`)}
      >
        {points.length >= 2 ? (
          <LineSeries points={points} summary={`Active customers over ${DASH_PERIOD_LABELS[period]}`} unit="customers" minHeight={110} />
        ) : (
          <ShortHistory note={coverageNote(points, buckets, fresh.date)} />
        )}
      </GraphCard>
    );
  });
}

export async function NewLostGraph({ role }: Props) {
  const data = await settleCard("New vs lost customers", snapshot);
  if (!data) return <GraphCardError title="New vs lost customers" />;
  const { days, fresh, now } = data;
  const link = linkTo(tabLink(role, "customers"), "Customers");

  return perPeriod((period) => {
    const buckets = periodBuckets(period, now);
    const gained = flowSeries(days, buckets, (day) => day.new_customers);
    const lost = new Map(flowSeries(days, buckets, (day) => day.churned_customers).map((point) => [point.key, point.value]));
    const bars: ChartBar[] = gained.map((point) => ({ key: point.key, label: point.label, value: point.value, pair: lost.get(point.key) ?? 0 }));
    const totalNew = gained.reduce((sum, point) => sum + point.value, 0);
    const totalLost = [...lost.values()].reduce((sum, value) => sum + value, 0);
    return (
      <GraphCard
        title="New vs lost customers"
        link={link}
        value={bars.length ? `${n(totalNew)} · ${n(totalLost)}` : "—"}
        stale={fresh.isStale}
        line={joinLine(fresh.isStale && ageWords(fresh.ageDays), bars.length ? `new · lost in ${DASH_PERIOD_LABELS[period]}` : "no figures in this period")}
      >
        {bars.length ? (
          <BarSeries
            bars={bars}
            summary={`New and lost customers over ${DASH_PERIOD_LABELS[period]}`}
            unit="customers"
            minHeight={110}
            pairTone="warning"
            names={{ value: "New", pair: "Lost" }}
          />
        ) : (
          <ShortHistory note={coverageNote(gained, buckets, fresh.date)} />
        )}
      </GraphCard>
    );
  });
}

/* ── Collected ────────────────────────────────────────────────────────────────────────────── */

export async function CollectedGraph({ role }: Props) {
  const data = await settleCard("Collected", async () => {
    const now = readNow();
    const [payments, month] = await Promise.all([paidInvoices(periodStartIso("12m", now)), monthInvoiceTotals()]);
    return { payments, month, now };
  });
  if (!data) return <GraphCardError title="Collected" />;
  const { payments, month, now } = data;
  const link = linkTo(tabLink(role, "money"), "Money");

  return perPeriod((period) => {
    const points = eventSeries(payments, periodBuckets(period, now));
    return (
      <GraphCard
        title="Collected"
        link={link}
        value={wholeDollars(month.collectedCents)}
        line={month.invoicedCents > 0 ? `of ${wholeDollars(month.invoicedCents)} invoiced this month` : "nothing invoiced this month"}
      >
        <BarSeries
          bars={points.map((point) => ({ key: point.key, label: point.label, value: point.value }))}
          summary={`Payments collected over ${DASH_PERIOD_LABELS[period]}`}
          format={wholeDollars}
          minHeight={110}
          names={{ value: "Collected" }}
        />
      </GraphCard>
    );
  });
}

/* ── Trials ───────────────────────────────────────────────────────────────────────────────── */

export async function TrialsGraph({ role }: Props) {
  const data = await settleCard("Trials in flight", async () => ({ ...(await snapshot()), trials: await trialsNow() }));
  if (!data) return <GraphCardError title="Trials in flight" />;
  const { days, fresh, now, trials } = data;
  const link = linkTo(pageLink(role, "/admin/trials"), "Trials");

  return perPeriod((period) => {
    const buckets = periodBuckets(period, now);
    const points = levelSeries(days, buckets, (day) => day.trials_active);
    const note = coverageNote(points, buckets, fresh.date);
    return (
      <GraphCard
        title="Trials in flight"
        link={link}
        value={n(trials.inFlight)}
        line={`${n(trials.endingWithinTwoDays)} end within 2 days`}
        foot={points.length >= 2 ? ["The line is the nightly figure.", note].filter(Boolean).join(" ") : null}
      >
        {points.length >= 2 ? (
          <LineSeries points={points} summary={`Trials in flight over ${DASH_PERIOD_LABELS[period]}`} unit="trials" minHeight={110} />
        ) : (
          <ShortHistory note={note} />
        )}
      </GraphCard>
    );
  });
}

/* ── By plan ──────────────────────────────────────────────────────────────────────────────── */

export async function PlansGraph({ role }: Props) {
  const data = await settleCard("Customers & MRR by plan", async () => ({ ...(await snapshot()), names: await planNames() }));
  if (!data) return <GraphCardError title="Customers & MRR by plan" span />;
  const { days, fresh, names } = data;
  const latest = days.at(-1);
  const rows = Object.entries(latest?.plan_breakdown ?? {}).sort((a, b) => b[1].mrr_cents - a[1].mrr_cents);

  return (
    <GraphCard
      title="Customers & MRR by plan"
      span
      link={linkTo(tabLink(role, "money"), "Money")}
      value={rows.length ? countWords(rows.length, "plan", "plans") : "—"}
      stale={fresh.isStale}
      line={joinLine(fresh.isStale && ageWords(fresh.ageDays), "customers and MRR per plan")}
    >
      {rows.length ? (
        <BarList
          rows={rows.map(([code, stats]) => ({
            key: code,
            label: names.get(code) ?? code,
            value: stats.mrr_cents,
            figure: wholeDollars(stats.mrr_cents),
            caption: countWords(stats.customers, "customer", "customers"),
          }))}
          summary="MRR and customers per plan, from the newest nightly figures"
          format={wholeDollars}
          labelWidth="10rem"
        />
      ) : (
        <GraphEmpty title="No revenue to split yet" hint="It fills in once a subscription has billed at least once." />
      )}
    </GraphCard>
  );
}

/* ── Sign-up funnel ───────────────────────────────────────────────────────────────────────── */

const FUNNEL_DAYS: Record<DashPeriod, number> = { "30d": 30, "90d": 90, "12m": 365 };

export async function FunnelGraph({ role }: Props) {
  const data = await settleCard("Sign-up funnel", async () => {
    const [d30, d90, d365] = await Promise.all([signupFunnel(30), signupFunnel(90), signupFunnel(365)]);
    return { "30d": d30, "90d": d90, "12m": d365 } as Record<DashPeriod, Awaited<ReturnType<typeof signupFunnel>>>;
  });
  if (!data) return <GraphCardError title="Sign-up funnel" />;

  return perPeriod((period) => {
    const view = funnelView(data[period]);
    const signedUp = view.rows[0]?.count ?? 0;
    const paid = view.rows.find((row) => row.label === "Became paid")?.count ?? null;
    const share = paid !== null ? percentOf(paid, signedUp) : null;
    const link = linkTo(tabLink(role, "customers", period === "12m" ? undefined : `period=${period}`), "Customers");
    return (
      <GraphCard
        title="Sign-up funnel"
        link={link}
        value={share !== null ? `${share}%` : "—"}
        line={`sign-up to paid · ${FUNNEL_DAYS[period]} days`}
      >
        {signedUp > 0 ? (
          <BarList
            rows={view.rows.map((row) => ({
              key: row.label,
              label: row.label,
              value: row.count ?? 0,
              figure: row.measured && row.count !== null ? n(row.count) : "—",
              tone: row.drop ? "warning" : undefined,
            }))}
            summary={`Sign-up funnel over ${FUNNEL_DAYS[period]} days${view.dropWords ? `. ${view.dropWords}` : ""}`}
            unit="customers"
            labelWidth="7.5rem"
          />
        ) : (
          <GraphEmpty title="No sign-ups yet" hint={`Nobody signed up in the last ${FUNNEL_DAYS[period]} days.`} />
        )}
      </GraphCard>
    );
  });
}

/* ── Sign-ins ─────────────────────────────────────────────────────────────────────────────── */

const SIGN_IN_TITLE: Record<DashPeriod, string> = { "30d": "Sign-ins per day", "90d": "Sign-ins per week", "12m": "Sign-ins per month" };

export async function SignInsGraph({ role }: Props) {
  const data = await settleCard("Sign-ins", async () => {
    const now = readNow();
    const [events, stats] = await Promise.all([signInEvents(periodStartIso("12m", now), role === "super_admin"), loginStats()]);
    return { ...events, stats, now };
  });
  if (!data) return <GraphCardError title="Sign-ins per day" />;
  const { events, capped, stats, now } = data;
  const link = linkTo(tabLink(role, "security") ?? pageLink(role, "/admin/activity"), "Security");
  const today = eventSeries(events, periodBuckets("30d", now)).at(-1)?.value ?? 0;

  return perPeriod((period) => {
    const points = eventSeries(events, periodBuckets(period, now));
    return (
      <GraphCard
        title={SIGN_IN_TITLE[period]}
        link={link}
        value={n(today)}
        line={`today · ${n(stats.failed_today)} failed`}
        foot={capped ? "Only the newest 50,000 sign-ins are counted." : role === "super_admin" ? null : "Customer sign-ins; staff sign-ins are shown to super admins only."}
      >
        <LineSeries points={points} summary={`${SIGN_IN_TITLE[period]} over ${DASH_PERIOD_LABELS[period]}`} unit="sign-ins" minHeight={110} />
      </GraphCard>
    );
  });
}

function linkTo(href: string | null, label: string) {
  return href ? { href, label } : null;
}
