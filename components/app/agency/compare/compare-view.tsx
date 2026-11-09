import type { ReactNode } from "react";
import Link from "next/link";

import { DashBars, DashChart, type DashBar } from "@/components/app/home/dash/dash-kit";
import { HomePanel } from "@/components/app/home/home-panel";
import { LineSeries } from "@/components/ui/chart";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { DeltaChip } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import {
  addDays,
  change,
  changeBy,
  changeRead,
  contactRate,
  dailyFor,
  initials,
  daysIn,
  dialsByDay,
  EMPTY,
  figuresBy,
  placement,
  running,
  type CompareEvents,
  type Figures,
  type Metric,
  type PeriodPair,
} from "@/lib/dashboard/compare";
import { MetricCharts, MetricSwitch, PeopleTable, PeriodPill, PersonMark, type PeopleCell, type PeopleColumn, type PeopleRow } from "./compare-controls";

/**
 * Home › Agency › Compare, drawn as the Compare mockups (owner 2026-11-07, "Build A and B"). The server half: every
 * figure from `lib/dashboard/compare`, every element a link to the rows behind it. Money (premium) shows only to the
 * owner, admins and the bookkeeper; a manager sees counts for his reports.
 */
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const n = (value: number) => value.toLocaleString("en-US");
const short = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export type CompareLinks = { policies: string | null; applications: string | null; activity: string | null; producers: string | null };

/** The strip's tiles for one person or everyone: now, "was then", and the change. */
function strip(now: Figures, then: Figures, money: boolean, links: CompareLinks, pair: PeriodPair, label: string) {
  const policiesHref = links.policies ? `${links.policies}?from=${pair.a.from}&to=${pair.a.to}` : undefined;
  const activityHref = links.activity ? `${links.activity}?from=${pair.a.from}&to=${pair.a.to}` : undefined;
  // A count off a tiny base reads "new" or "12×" (critique #2); a rate keeps its points.
  const tile = (key: string, title: string, value: string, was: string, delta: number | null, href?: string, unit = "%", goodWhen: "up" | "down" = "up", raw?: [number, number]) => {
    const read = raw ? changeRead(raw[0], raw[1]) : null;
    const big = read && read.kind !== "pct" ? (read.kind === "new" ? "new" : read.text) : null;
    return <StatTile key={key} label={title} value={value} delta={!big && delta ? { value: delta, unit, goodWhen } : undefined} footnote={`was ${was}${big ? ` · ${big}` : ""}`} href={href} />;
  };
  const placeNow = placement(now);
  const placeThen = placement(then);
  const rateNow = contactRate(now);
  const rateThen = contactRate(then);
  const tiles: ReactNode[] = [];
  if (money) tiles.push(tile("premium", "Issued premium", usd(now.premiumCents), usd(then.premiumCents), change(now.premiumCents, then.premiumCents), policiesHref, "%", "up", [now.premiumCents, then.premiumCents]));
  tiles.push(tile("issued", "Policies issued", n(now.issued), n(then.issued), change(now.issued, then.issued), policiesHref, "%", "up", [now.issued, then.issued]));
  tiles.push(tile("apps", "Apps submitted", n(now.apps), n(then.apps), change(now.apps, then.apps), links.applications ?? undefined, "%", "up", [now.apps, then.apps]));
  tiles.push(tile("placement", "Placement rate", placeNow === null ? "—" : `${placeNow}%`, placeThen === null ? "—" : `${placeThen}%`, placeNow !== null && placeThen !== null ? placeNow - placeThen : null, links.applications ?? undefined, " pts"));
  tiles.push(tile("contact", "Contact rate", rateNow === null ? "—" : `${rateNow}%`, rateThen === null ? "—" : `${rateThen}%`, rateNow !== null && rateThen !== null ? rateNow - rateThen : null, activityHref, " pts"));
  tiles.push(tile("dials", "Dials", n(now.dials), n(then.dials), change(now.dials, then.dials), activityHref, "%", "up", [now.dials, then.dials]));
  return <StatStrip label={label}>{tiles}</StatStrip>;
}

/** The two periods as running totals laid over each other; hover shows both. */
function overlay({ events, pair, metric, who, money, links }: { events: CompareEvents; pair: PeriodPair; metric: Metric; who?: string; money: boolean; links: CompareLinks }) {
  const now = running(events, pair.a, metric, who);
  const then = running(events, pair.b, metric, who);
  const scale = metric === "premium" ? 100 : 1;
  const fmt = metric === "premium" ? (value: number) => `$${value.toLocaleString("en-US")}` : n;
  const title = metric === "premium" ? "Issued premium, day by day" : metric === "policies" ? "Policies issued, day by day" : "Dials, day by day";
  const lastNow = now[now.length - 1] ?? 0;
  const lastThen = then[then.length - 1] ?? 0;
  const gap = lastNow - lastThen;
  const daily = now.map((value, index) => value - (now[index - 1] ?? 0));
  const best = daily.indexOf(Math.max(...daily));
  const show = (cents: number) => fmt(Math.round(cents / scale));
  const read = changeRead(lastNow, lastThen);
  const facts = [
    { label: "This period", value: show(lastNow) },
    { label: "Last period", value: show(lastThen) },
    { label: "Change", value: read === null ? "—" : read.kind === "new" ? "new" : read.kind === "times" ? read.text : `${read.value > 0 ? "+" : "−"}${Math.abs(read.value)}%` },
    { label: best >= 0 && daily[best] > 0 ? `Best day · ${short(addDays(pair.a.from, best))}` : "Best day", value: best >= 0 && daily[best] > 0 ? show(daily[best]) : "—" },
  ];
  const base = metric === "dials" ? links.activity : links.policies;
  return (
    <DashChart
      title={title}
      total={`${gap >= 0 ? "Ahead by" : "Behind by"} ${show(Math.abs(gap))}`}
      totalLine={`against ${pair.bLabel}`}
      legend={[{ label: "This period", tone: "primary" }, { label: "Last period", tone: "info" }]}
      legendTop
    >
      <div className="mb-1"><MetricSwitch money={money} /></div>
      <LineSeries
        points={now.map((value, index) => ({ key: addDays(pair.a.from, index), label: short(addDays(pair.a.from, index)), value: Math.round(value / scale) }))}
        compare={{ points: then.map((value, index) => ({ key: addDays(pair.b.from, index), label: short(addDays(pair.b.from, index)), value: Math.round(value / scale) })), label: "Last period" }}
        summary={`${title}: this period against the last.`}
        format={fmt}
        unit="so far"
        minHeight={180}
        hrefFor={base ? (point) => `${base}?from=${pair.a.from}&to=${point.key}` : undefined}
      />
      <dl className="m-0 mt-2 grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0 overflow-hidden rounded-xl bg-[var(--surface-alt)] px-3 py-2">
            <dt className="truncate text-[0.6875rem] text-muted-foreground">{fact.label}</dt>
            <dd className="m-0 truncate text-[0.8125rem] font-semibold tabular-nums text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </DashChart>
  );
}

const COLUMNS: PeopleColumn[] = [
  { key: "dials", label: "Dials" },
  { key: "contacts", label: "Contacts" },
  { key: "quotes", label: "Quotes" },
  { key: "apps", label: "Apps" },
  { key: "issued", label: "Issued" },
  { key: "premium", label: "Premium", money: true },
  { key: "placement", label: "Placement" },
  { key: "rate", label: "Contact rate" },
];
const DEFAULT_COLUMNS = ["dials", "contacts", "quotes", "apps", "issued", "premium", "placement"];

/** A · Periods: the agency (or one person) this period against the last. */
export function ComparePeriods({ events, names, pair, person, metric, money, links, cols }: {
  events: CompareEvents;
  names: Map<string, string>;
  pair: PeriodPair;
  person: string | null;
  metric: Metric;
  money: boolean;
  links: CompareLinks;
  cols: readonly string[] | null;
}) {
  const now = figuresBy(events, pair.a);
  const then = figuresBy(events, pair.b);
  const focusNow = person ? now.by.get(person) ?? EMPTY : now.total;
  const focusThen = person ? then.by.get(person) ?? EMPTY : then.total;
  const who = person ? names.get(person) ?? "This person" : "The agency";
  const chartMetric: Metric = !money && metric === "premium" ? "policies" : metric;

  // Where the change came from: each person's change in issued premium (counts for a manager).
  const moved = money
    ? changeBy(now.by, then.by)
    : [...new Set([...now.by.keys(), ...then.by.keys()].filter(Boolean))].map((id) => ({ who: id, cents: (now.by.get(id)?.issued ?? 0) - (then.by.get(id)?.issued ?? 0) })).filter((row) => row.cents !== 0).sort((x, y) => y.cents - x.cents);
  const bars: DashBar[] = moved.slice(0, 8).map((row) => ({
    key: row.who,
    label: names.get(row.who) ?? "Someone",
    value: Math.abs(row.cents),
    shown: `${row.cents >= 0 ? "+" : "−"}${money ? usd(Math.abs(row.cents)) : n(Math.abs(row.cents))}`,
    tone: row.cents >= 0 ? "good" : "danger",
    href: links.policies ? `${links.policies}?agent=${encodeURIComponent(row.who)}&from=${pair.a.from}&to=${pair.a.to}` : undefined,
  }));

  // Every person on the same pair.
  const ids = [...new Set([...now.by.keys(), ...then.by.keys()].filter(Boolean))];
  const columns = COLUMNS.filter((column) => money || !column.money);
  const shown = (cols?.length ? cols : DEFAULT_COLUMNS).filter((key) => columns.some((column) => column.key === key));
  const rows: PeopleRow[] = ids
    .map((id) => ({ id, a: now.by.get(id) ?? EMPTY, b: then.by.get(id) ?? EMPTY }))
    .sort((x, y) => (money ? y.a.premiumCents - x.a.premiumCents : y.a.issued - x.a.issued) || y.a.dials - x.a.dials)
    .map(({ id, a, b }) => {
      const big = (now_: number, then_: number): Partial<PeopleCell> => {
        const read = changeRead(now_, then_);
        return read && read.kind !== "pct" ? { big: read.kind === "new" ? "new" : read.text } : {};
      };
      const count = (now_: number, then_: number): PeopleCell => ({ now: n(now_), then: n(then_), change: change(now_, then_), ...big(now_, then_) });
      const pa = placement(a);
      const pb = placement(b);
      const ra = contactRate(a);
      const rb = contactRate(b);
      const name = names.get(id) ?? "Someone";
      return {
        id,
        name,
        initials: initials(name),
        inactive: !a.dials && !a.quotes && !a.apps && !a.issued,
        trend: dailyFor(events, pair.a, money ? "premium" : "policies", id),
        note: a.issued ? `${n(a.issued)} ${a.issued === 1 ? "policy" : "policies"} this period` : "No policy this period yet",
        href: links.policies ? `${links.policies}?agent=${encodeURIComponent(id)}&from=${pair.a.from}&to=${pair.a.to}` : "#",
        cells: {
          dials: count(a.dials, b.dials),
          contacts: count(a.contacts, b.contacts),
          quotes: count(a.quotes, b.quotes),
          apps: count(a.apps, b.apps),
          issued: count(a.issued, b.issued),
          premium: { now: usd(a.premiumCents), then: usd(b.premiumCents), change: change(a.premiumCents, b.premiumCents), ...big(a.premiumCents, b.premiumCents) },
          placement: { now: pa === null ? "—" : `${pa}%`, then: pb === null ? null : `${pb}%`, change: pa !== null && pb !== null ? pa - pb : null, unit: " pts" },
          rate: { now: ra === null ? "—" : `${ra}%`, then: rb === null ? null : `${rb}%`, change: ra !== null && rb !== null ? ra - rb : null, unit: " pts" },
        },
      };
    });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {strip(focusNow, focusThen, money, links, pair, `${who}: ${pair.aLabel} against ${pair.bLabel}`)}
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 [&>*]:h-full">
          {/* All three figures are drawn here from the events already read; the switch only chooses one (instant). */}
          <MetricCharts
            initial={chartMetric}
            charts={Object.fromEntries((money ? (["premium", "policies", "dials"] as const) : (["policies", "dials"] as const)).map((key) => [key, overlay({ events, pair, metric: key, who: person ?? undefined, money, links })]))}
          />
        </div>
        <div className="min-w-0 [&>*]:h-full">
          {bars.length
            ? <DashBars title="Where the change came from" sub={`Each person's share of the change in ${money ? "issued premium" : "policies issued"}. Green added, red took away.`} link={links.producers ? { label: "Producers", href: links.producers } : undefined} rows={bars} />
            : <HomePanel title="Where the change came from"><p className="m-0 text-sm text-muted-foreground">No one&apos;s figures moved between the two periods.</p></HomePanel>}
        </div>
      </div>
      <HomePanel title="Every person, this period against last" sub="Click a row to focus the strip and the chart on them; a name opens their policies.">
        {rows.length
          ? <PeopleTable columns={columns} rows={rows} shown={shown} focused={person} trendLabel={`${money ? "issued premium" : "policies"} each day of ${pair.aLabel}`} />
          : <p className="m-0 text-sm text-muted-foreground">No one has a call, quote, application or policy in either period.</p>}
      </HomePanel>
    </div>
  );
}

/** B · People: up to four people on one pair — a card each, a race, dials by day. */
export function ComparePeople({ events, names, pair, chosen, money, links }: {
  events: CompareEvents;
  names: Map<string, string>;
  pair: PeriodPair;
  chosen: readonly string[];
  money: boolean;
  links: CompareLinks;
}) {
  const now = figuresBy(events, pair.a);
  const then = figuresBy(events, pair.b);
  const metric: Metric = money ? "premium" : "policies";
  const scale = metric === "premium" ? 100 : 1;
  const fmt = metric === "premium" ? (value: number) => `$${value.toLocaleString("en-US")}` : n;
  const rank = [...chosen].sort((x, y) => (money ? (now.by.get(y)?.premiumCents ?? 0) - (now.by.get(x)?.premiumCents ?? 0) : (now.by.get(y)?.issued ?? 0) - (now.by.get(x)?.issued ?? 0)));
  const rankThen = [...chosen].sort((x, y) => (money ? (then.by.get(y)?.premiumCents ?? 0) - (then.by.get(x)?.premiumCents ?? 0) : (then.by.get(y)?.issued ?? 0) - (then.by.get(x)?.issued ?? 0)));
  const value = (f: Figures) => (money ? f.premiumCents : f.issued);
  const top = Math.max(1, ...chosen.map((id) => Math.max(value(now.by.get(id) ?? EMPTY), value(then.by.get(id) ?? EMPTY))));
  const days = daysIn(pair.a);


  if (!chosen.length) return <HomePanel title="Compare people"><p className="m-0 text-sm text-muted-foreground">Add up to four people to compare them on {pair.aLabel} against {pair.bLabel}.</p></HomePanel>;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {chosen.map((id) => {
          const a = now.by.get(id) ?? EMPTY;
          const b = then.by.get(id) ?? EMPTY;
          const place = rank.indexOf(id) + 1;
          const before = rankThen.indexOf(id) + 1;
          // A count off a tiny base reads "new" or "12×", as in the table (critique #2).
          const read = (x: number, y: number) => { const r = changeRead(x, y); return r && r.kind !== "pct" ? (r.kind === "new" ? "new" : r.text) : null; };
          const lines = [
            ...(money ? [{ label: "Issued premium", now: usd(a.premiumCents), delta: change(a.premiumCents, b.premiumCents), big: read(a.premiumCents, b.premiumCents), unit: "%" }] : []),
            { label: "Policies", now: n(a.issued), delta: change(a.issued, b.issued), big: read(a.issued, b.issued), unit: "%" },
            { label: "Dials", now: n(a.dials), delta: change(a.dials, b.dials), big: read(a.dials, b.dials), unit: "%" },
            { label: "Contact rate", now: contactRate(a) === null ? "—" : `${contactRate(a)}%`, delta: contactRate(a) !== null && contactRate(b) !== null ? (contactRate(a) as number) - (contactRate(b) as number) : null, big: null, unit: " pts" },
          ];
          const href = links.policies ? `${links.policies}?agent=${encodeURIComponent(id)}&from=${pair.a.from}&to=${pair.a.to}` : undefined;
          return (
            <HomePanel key={id} icon={<PersonMark text={initials(names.get(id) ?? "Someone")} />} title={names.get(id) ?? "Someone"} sub={`#${place} of ${chosen.length}${before && before !== place ? ` · ${before > place ? "up" : "down"} from #${before}` : ""}`} link={href ? { label: "Their policies", href } : undefined} roundLink>
              <LineSeries
                points={running(events, pair.a, metric, id).map((v, index) => ({ key: addDays(pair.a.from, index), label: short(addDays(pair.a.from, index)), value: Math.round(v / scale) }))}
                compare={{ points: running(events, pair.b, metric, id).map((v, index) => ({ key: addDays(pair.b.from, index), label: short(addDays(pair.b.from, index)), value: Math.round(v / scale) })), label: "Last period" }}
                summary={`${names.get(id) ?? "This person"}: ${metric === "premium" ? "issued premium" : "policies"} this period against the last.`}
                format={fmt}
                unit="so far"
                minHeight={96}
              />
              <dl className="m-0 mt-3 flex flex-col gap-1.5">
                {lines.map((line) => (
                  <div key={line.label} className="flex items-center gap-2 rounded-xl bg-[var(--surface-alt)] px-3 py-1.5 text-xs">
                    <dt className="text-muted-foreground">{line.label}</dt>
                    <dd className="m-0 ml-auto font-semibold tabular-nums text-foreground">{line.now}</dd>
                    {line.big ? <StatusChip tone="good">{line.big}</StatusChip> : line.delta ? <DeltaChip value={line.delta} unit={line.unit} /> : null}
                  </div>
                ))}
              </dl>
            </HomePanel>
          );
        })}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <HomePanel title={money ? "Issued premium" : "Policies issued"} sub={`${pair.aLabel} · dashed: ${pair.bLabel}`} link={links.policies ? { label: "Policies", href: `${links.policies}?from=${pair.a.from}&to=${pair.a.to}` } : undefined} roundLink>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {rank.map((id) => {
              const a = value(now.by.get(id) ?? EMPTY);
              const b = value(then.by.get(id) ?? EMPTY);
              return (
                <li key={id} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_6rem] items-center gap-3 text-sm">
                  <span className="truncate font-semibold">{names.get(id) ?? "Someone"}</span>
                  <span className="relative h-3.5 rounded-full bg-[var(--surface-alt)]" aria-hidden="true">
                    {b > 0 && <span className="m-chart-tween absolute inset-y-0 left-0 rounded-full border-[1.5px] border-dashed border-[var(--info)]" style={{ width: `${(b / top) * 100}%` }} />}
                    <span className="m-bar-x m-chart-tween absolute inset-y-[2px] left-0 rounded-full bg-[var(--primary)]" style={{ width: `${(a / top) * 100}%` }} />
                  </span>
                  <span className="text-right font-semibold tabular-nums">{money ? usd(a) : n(a)}</span>
                </li>
              );
            })}
          </ul>
        </HomePanel>

        <HomePanel title="Dials by day" sub="The number is the day's dials; darker is a bigger day for that person · each day opens the activity" link={links.activity ? { label: "Activity", href: `${links.activity}?from=${pair.a.from}&to=${pair.a.to}` } : undefined} roundLink>
          <div className="min-w-0 overflow-x-auto">
            <div className="grid min-w-max gap-[3px] text-[0.6875rem] text-muted-foreground" style={{ gridTemplateColumns: `minmax(7rem, 9rem) repeat(${days}, minmax(1.25rem, 1fr))` }}>
              <span />
              {Array.from({ length: days }, (_, index) => {
                const day = addDays(pair.a.from, index);
                const weekday = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
                return <span key={index} className="flex flex-col items-center leading-tight tabular-nums">{days <= 14 || index % Math.ceil(days / 10) === 0 ? <><span>{weekday}</span><span>{Number(day.slice(8, 10))}</span></> : null}</span>;
              })}
              {chosen.map((id) => {
                const row = dialsByDay(events, pair.a, id);
                // Each person's busiest day is the darkest: one heavy dialler no longer pales everyone else.
                const rowTop = Math.max(1, ...row);
                return [
                  <span key={`${id}-name`} className="self-center truncate text-xs font-semibold text-foreground">{names.get(id) ?? "Someone"}</span>,
                  ...row.map((count, index) => {
                    const day = addDays(pair.a.from, index);
                    const share = count / rowTop;
                    const cell = (
                      <span className={cn("grid h-7 place-items-center rounded-[5px] text-[0.6875rem] font-semibold tabular-nums", share > 0.55 ? "text-[var(--on-dark)]" : count ? "text-foreground" : "text-muted-foreground")} style={{ background: `color-mix(in srgb, var(--primary) ${Math.round(share * 85)}%, var(--surface-alt))` }}>
                        {count || "·"}
                      </span>
                    );
                    return links.activity
                      ? <Link key={`${id}-${day}`} href={`${links.activity}?from=${day}&to=${day}`} title={`${names.get(id) ?? "Someone"} · ${short(day)} · ${n(count)} dials`} className={cn("block rounded-[5px] no-underline hover:outline hover:outline-1 hover:outline-[var(--primary)]")}>{cell}</Link>
                      : <span key={`${id}-${day}`} title={`${short(day)} · ${n(count)} dials`}>{cell}</span>;
                  }),
                ];
              })}
            </div>
          </div>
        </HomePanel>
      </div>
    </div>
  );
}

/** The two periods in words, for the title line. */
export function PeriodWords({ pair }: { pair: PeriodPair }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <PeriodPill tone="a">{pair.aLabel}</PeriodPill>
      <span className="text-muted-foreground">against</span>
      <PeriodPill tone="b">{pair.bLabel}</PeriodPill>
    </span>
  );
}
