import Link from "next/link";
import type { ReactNode } from "react";

import { HomePanel } from "@/components/app/home/home-panel";
import { CountUp } from "@/components/ui/count-up";
import { GaugeRing, Ring } from "@/components/ui/ring";
import { StatStrip, StatTile, type MeterTone } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

/**
 * The dashboard's pieces (owner 2026-11-06, canvas page "Dashboards · by role", rounds 2–3): every view of
 * /app/dashboard is drawn from these, in one anatomy —
 *
 *   Needs you      a row of tiles, most urgent first, each opening its list already filtered
 *   main column    a big chart beside a ring or donut, then two working cards
 *   right column   the brand card, then a live list
 *
 * Every figure, row and tile is a link to the exact page behind it (owner rule 2026-11-06). The layout is a
 * fluid grid that takes the whole width the sidebar leaves; only the right column has a set width.
 */

export type DashTone = "danger" | "warning" | "good" | "info" | "neutral";

const INK: Record<DashTone, string> = {
  danger: "text-[var(--error-ink)]",
  warning: "text-[var(--warning-ink)]",
  good: "text-[var(--success-ink)]",
  info: "text-[var(--info)]",
  neutral: "text-foreground",
};
const GROUND: Record<DashTone, string> = {
  danger: "bg-[var(--error-surface)]",
  warning: "bg-[var(--warning-surface)]",
  good: "bg-[var(--success-surface)]",
  info: "bg-[color-mix(in_srgb,var(--info)_14%,transparent)]",
  neutral: "bg-[var(--surface-alt)]",
};
const CHIP: Record<DashTone, StatusTone> = { danger: "danger", warning: "warning", good: "good", info: "info", neutral: "neutral" };

/* ── Layout ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * The view's grid: full width, and from lg up exactly the screen's height (owner 2026-11-06: "only the full
 * height filled, no scroll"). The two main rows share the height; every card fills its cell and clips what
 * does not fit; the right column is the brand card, then the live list taking the rest. Below lg the cards
 * stack and the page scrolls as any other.
 */
export function DashLayout({ needs, big, side, left, right, hero, list }: {
  needs: ReactNode;
  big: ReactNode;
  side: ReactNode;
  left: ReactNode;
  right: ReactNode;
  hero: ReactNode;
  list: ReactNode;
}) {
  const fill = "lg:[&>*]:h-full lg:[&>*]:min-h-0 lg:[&>*]:overflow-hidden";
  const rows = [Boolean(big || side), Boolean(left || right)].filter(Boolean).length;
  return (
    // m-dash (§ Motion, 2026-11-09): the cards rise in one after another — Needs you, the right column, then the two rows.
    <div className="m-dash flex w-full min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1">
      {needs}
      <div className="grid min-w-0 grid-cols-1 items-stretch gap-4 lg:min-h-0 lg:flex-1 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:min-h-0", rows === 2 ? "lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]" : "lg:grid-rows-[minmax(0,1fr)]")}>
          {/* A row with one card (its pair had nothing to show) gives that card the whole width, never a blank half. */}
          {(big || side) && <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:min-h-0", fill, big && side && "lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]")}>{big}{side}</div>}
          {(left || right) && <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:min-h-0", fill, left && right && "lg:grid-cols-2")}>{left}{right}</div>}
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:[&>*:last-child]:min-h-0 lg:[&>*:last-child]:flex-1 lg:[&>*:last-child]:overflow-hidden">{hero}{list}</div>
      </div>
    </div>
  );
}

/* ── Needs you ──────────────────────────────────────────────────────────────────────────────── */

export type DashNeed = { key: string; count: number; label: string; detail?: string; tone: DashTone; href: string };

/**
 * Needs you: the standard figure strip every other page uses (StatStrip, owner 2026-11-06: "like any other
 * card that we had in other pages"), one tile per thing waiting, most urgent first, each opening its list.
 * Nothing waiting folds into one quiet line.
 */
export function DashNeeds({ items, max = 6 }: { items: readonly DashNeed[]; note?: string; max?: number }) {
  const rank: Record<DashTone, number> = { danger: 0, warning: 1, info: 2, good: 3, neutral: 4 };
  const shown = items.filter((item) => item.count > 0).sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, max);
  if (!shown.length) {
    return (
      <section aria-label="Needs you" className="m-glass flex items-center gap-3 rounded-lg border border-border px-4 py-3">
        <span className="grid size-7 place-items-center rounded-full bg-[var(--success-surface)] text-[var(--success-ink)]" aria-hidden="true">✓</span>
        <span className="text-sm font-semibold text-foreground">Nothing is waiting on you.</span>
      </section>
    );
  }
  return (
    <StatStrip label="Needs you">
      {shown.map((item) => (
        <StatTile key={item.key} label={item.label} value={item.count.toLocaleString("en-US")} valueTone={TILE_TONE[item.tone]} footnote={item.detail} reserveFootnote href={item.href} />
      ))}
    </StatStrip>
  );
}
const TILE_TONE: Record<DashTone, MeterTone | undefined> = { danger: "danger", warning: "warning", info: undefined, good: undefined, neutral: undefined };

/* ── Cards ──────────────────────────────────────────────────────────────────────────────────── */

/** The big chart card: title, the total with its change, then the chart. */
export function DashChart({ title, link, total, totalLine, change, legend, legendTop = false, children }: {
  title: string;
  link?: { label: string; href: string };
  total: string;
  totalLine?: string;
  change?: ReactNode;
  legend?: ReadonlyArray<{ label: string; tone: "primary" | "info" }>;
  /** The legend on the title line (the agency mockup), leaving the total its own line. */
  legendTop?: boolean;
  children: ReactNode;
}) {
  const key = legend && (
    <span className={cn("flex items-center gap-3", !legendTop && "ml-auto")}>
      {legend.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden="true" className={cn("size-2 rounded-full", item.tone === "primary" ? "bg-[var(--primary)]" : "bg-[var(--info)]")} />
          {item.label}
        </span>
      ))}
    </span>
  );
  return (
    <HomePanel title={title} link={link} badge={legendTop ? key : undefined}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="font-[family-name:var(--font-display)] text-[1.75rem] font-semibold leading-tight tabular-nums text-foreground"><CountUp text={total} fromZero /></span>
        {totalLine && <span className="text-sm text-muted-foreground">{totalLine}</span>}
        {change}
        {!legendTop && key}
      </div>
      <div className="mt-2 flex min-h-0 flex-1 flex-col [&>figure]:min-h-0 [&>figure]:flex-1 lg:[&>figure>div:first-of-type]:!min-h-[120px] [@media(max-height:860px)]:lg:[&>figure>div:first-of-type]:!min-h-[90px]">{children}</div>
    </HomePanel>
  );
}

export type DashLine = { label: string; value: string; href?: string };

/** One figure as a ring, with its few supporting lines under it, each a link. */
export function DashRing({ title, link, value, max = 100, center, label, lines, tone = "primary", size = 104 }: {
  title: string;
  link?: { label: string; href: string };
  value: number;
  max?: number;
  center: string;
  label: string;
  lines: readonly DashLine[];
  tone?: "primary" | "warning" | "danger";
  /** The ring's diameter: 104 by default; a card whose ring is the point (a goal) draws it larger. */
  size?: number;
}) {
  return (
    <HomePanel title={title} link={link} bodyClassName="items-center gap-2.5">
      <Ring value={value} max={max} size={size} tone={tone} label={label}>
        <RingCenter text={center} size={size} />
      </Ring>
      <div className="flex w-full min-h-0 flex-col flex-wrap content-start gap-1.5 overflow-hidden [&>*]:w-full">
        {lines.map((line) => <LineRow key={line.label} line={line} />)}
      </div>
    </HomePanel>
  );
}

/** "On the phone today" (round 2, screen 4): the gauge left, today's steps as captioned bars right, three facts under. */
export function DashPhone({ title, link, badge, gauge, bars, facts }: {
  title: string;
  link?: { label: string; href: string };
  badge?: { tone: DashTone; label: string };
  gauge: { value: number; max: number; caption: string; label: string; href?: string };
  bars: readonly DashBar[];
  facts: readonly DashLine[];
}) {
  const top = Math.max(1, ...bars.map((bar) => bar.value));
  const fill: Record<DashTone, string> = { danger: "bg-[var(--error)]", warning: "bg-[var(--warning)]", good: "bg-[var(--primary)]", info: "bg-[var(--info)]", neutral: "bg-[var(--muted)]" };
  const ring = <GaugeRing value={gauge.value} max={gauge.max} size={132} label={gauge.label} caption={gauge.caption} />;
  return (
    // Whole blocks only: on a short screen the facts wrap out of sight rather than being cut.
    <HomePanel title={title} badge={badge ? <DashChip tone={badge.tone}>{badge.label}</DashChip> : undefined} link={link} roundLink bodyClassName="flex-wrap content-start gap-3 overflow-hidden [&>*]:w-full">
      <div className="flex items-center gap-5">
        {gauge.href ? <Link href={gauge.href} className="shrink-0 rounded-full no-underline transition-opacity hover:opacity-80" aria-label={gauge.label}>{ring}</Link> : ring}
        <ul className="m-0 flex min-w-0 flex-1 list-none flex-col gap-2 p-0">
          {bars.map((bar) => {
            const body = (
              <>
                <span className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
                  <span className="truncate text-muted-foreground">{bar.label}</span>
                  <span className="font-semibold tabular-nums text-foreground">{bar.shown}</span>
                </span>
                <span className="block h-1.5 rounded-full bg-[var(--surface-alt)]" aria-hidden="true">
                  <span className={cn("m-bar-x m-chart-tween block h-full rounded-full", fill[bar.tone ?? "good"])} style={{ width: `${Math.round((bar.value / top) * 100)}%` }} />
                </span>
                {bar.note && <span className="truncate text-[0.6875rem] text-muted-foreground">{bar.note}</span>}
              </>
            );
            const cls = "flex flex-col gap-1 rounded-md no-underline";
            return <li key={bar.key}>{bar.href ? <Link href={bar.href} className={cn(cls, "hover:bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]")}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
          })}
        </ul>
      </div>
      {facts.length > 0 && (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${facts.length}, minmax(0, 1fr))` }}>
          {facts.map((fact) => {
            const body = (
              <>
                <span className="truncate text-[0.6875rem] text-muted-foreground">{fact.label}</span>
                <span className="truncate text-[0.8125rem] font-semibold tabular-nums text-foreground">{fact.value}</span>
              </>
            );
            const cls = "flex min-w-0 flex-col gap-0.5 rounded-xl border border-border px-3 py-2 no-underline";
            return fact.href
              ? <Link key={fact.label} href={fact.href} className={cn(cls, "transition-colors hover:bg-[var(--surface-alt)]")}>{body}</Link>
              : <div key={fact.label} className={cls}>{body}</div>;
          })}
        </div>
      )}
    </HomePanel>
  );
}

/* ── Agency dashboard cards (round 2 screens 1–2) ────────────────────────────────────────────── */

/**
 * "Lead to policy" as columns: each step's share of the first on top, its bar, its name and count. Two faint bars
 * after each step step down toward the next, so the drop between steps reads at a glance. Each column opens its page.
 */
export function DashColumns({ title, sub, rate, change, steps, link }: { title: string; sub?: string; rate: string; change?: ReactNode; steps: readonly DashStep[]; link?: { label: string; href: string } }) {
  const top = Math.max(1, ...steps.map((step) => step.count));
  const height = (count: number) => `${Math.max(4, Math.round((count / top) * 100))}%`;
  return (
    <HomePanel
      title={title}
      sub={sub}
      link={link}
      roundLink
      badge={<span className="flex shrink-0 items-center gap-2"><span className="font-[family-name:var(--font-display)] text-[1.375rem] font-bold tabular-nums text-foreground">{rate}</span>{change}</span>}
    >
      <ul className="m-0 flex min-h-0 flex-1 list-none gap-2.5 p-0">
        {steps.map((step) => {
          const body = (
            <>
              <span className="text-xs font-semibold tabular-nums text-foreground">{step.pct < 10 && step.pct % 1 ? step.pct.toFixed(1) : Math.round(step.pct)}%</span>
              <span className="relative flex min-h-0 flex-1 items-end overflow-hidden rounded-[6px] bg-[var(--surface-alt)]" aria-hidden="true">
                <span className="m-bar-rise m-chart-tween w-full rounded-[6px] bg-[var(--primary)]" style={{ height: height(step.count) }} />
              </span>
              <span className="truncate text-xs text-muted-foreground">{step.label}</span>
              <span className="text-[0.8125rem] font-semibold tabular-nums text-foreground">{step.count.toLocaleString("en-US")}</span>
            </>
          );
          const cls = "flex h-full min-w-0 flex-col gap-1.5 rounded-md no-underline";
          return <li key={step.key} className="flex min-w-0 flex-1 flex-col">{step.href ? <Link href={step.href} className={cn(cls, "hover:bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]")}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
        })}
      </ul>
    </HomePanel>
  );
}

/** One producer's goal: a small ring of the share reached, who, the time left, and the figure against the goal. */
export type DashGoal = { key: string; name: string; note: string; value: string; of: string; share: number; href?: string };

export function DashGoals({ title, sub, link, rows, empty = "Nothing yet." }: { title: string; sub?: string; link?: { label: string; href: string }; rows: readonly DashGoal[]; empty?: string }) {
  return (
    <HomePanel title={title} sub={sub} link={link} roundLink>
      {rows.length === 0 ? <p className="m-0 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col flex-wrap content-start overflow-hidden p-0 [&>li]:w-full">
          {rows.map((row) => {
            const body = (
              <>
                <Ring value={Math.round(row.share * 100)} max={100} size={46} label={`${row.name}: ${Math.round(row.share * 100)}% of goal`} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">{row.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{row.note}</span>
                </span>
                <span className="ml-auto flex shrink-0 flex-col items-end">
                  <span className="text-sm font-semibold tabular-nums">{row.value}</span>
                  <span className="text-[0.6875rem] text-muted-foreground">{row.of}</span>
                </span>
              </>
            );
            const cls = "flex items-center gap-3 border-b border-border py-2 text-foreground no-underline";
            return <li key={row.key} className="[&:last-child>*]:border-b-0">{row.href ? <Link href={row.href} className={cn(cls, "hover:bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]")}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
          })}
        </ul>
      )}
    </HomePanel>
  );
}

/** "Premium by state": state, policies with an arrow against last month, the premium. */
export type DashStateRow = { key: string; label: string; policies: string; trend: "up" | "down" | "flat"; value: string; href?: string };

const TREND_MARK = {
  up: <span className="font-bold text-[var(--success-ink)]" aria-label="up on last month">↑</span>,
  down: <span className="font-bold text-[var(--error-ink)]" aria-label="down on last month">↓</span>,
  flat: null,
};

export function DashStates({ title, sub, link, heads, rows, empty = "Nothing yet." }: { title: string; sub?: string; link?: { label: string; href: string }; heads: readonly [string, string, string]; rows: readonly DashStateRow[]; empty?: string }) {
  const cols = "grid grid-cols-[minmax(0,1fr)_4.5rem_6rem] items-center";
  return (
    <HomePanel title={title} sub={sub} link={link} roundLink>
      <div className={cn(cols, "border-b border-border pb-2 text-[0.6875rem] text-muted-foreground")}>
        <span>{heads[0]}</span><span className="text-right">{heads[1]}</span><span className="text-right">{heads[2]}</span>
      </div>
      {rows.length === 0 ? <p className="m-0 py-4 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col flex-wrap content-start overflow-hidden p-0 [&>li]:w-full">
          {rows.map((row) => {
            const body = (
              <>
                <span className="truncate">{row.label}</span>
                <span className="text-right tabular-nums">{row.policies} {TREND_MARK[row.trend]}</span>
                <span className="text-right font-semibold tabular-nums">{row.value}</span>
              </>
            );
            const cls = cn(cols, "border-b border-border py-2 text-[0.8125rem] text-foreground no-underline");
            return <li key={row.key} className="[&:last-child>*]:border-b-0">{row.href ? <Link href={row.href} className={cn(cls, "hover:bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]")}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
          })}
        </ul>
      )}
    </HomePanel>
  );
}

/** "Received vs expected": twelve segments filled to the share received, the figures, and what is short. */
export function DashReceived({ title, received, expected, pct, short, href }: { title: string; received: string; expected: string; pct: number; short?: { text: string; href?: string }; href?: string }) {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * 12);
  const head = <span className="text-sm font-semibold text-foreground">{title}</span>;
  return (
    <section aria-label={title} data-size="panel" className="m-glass flex min-w-0 shrink-0 flex-col gap-2.5 rounded-lg border border-border px-4 py-3.5">
      {href ? <Link href={href} className="no-underline hover:underline">{head}</Link> : head}
      <span className="flex gap-1" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <span key={index} className={cn("h-2 flex-1 rounded-full", index < filled ? "bg-[var(--primary)]" : "bg-[var(--surface-alt)]")} />)}
      </span>
      <span className="flex items-baseline text-xs text-muted-foreground">
        <span><b className="font-semibold tabular-nums text-foreground">{received}</b> of {expected}</span>
        <span className="ml-auto font-semibold tabular-nums text-foreground">{pct}%</span>
      </span>
      {short && (short.href
        ? <Link href={short.href} className="text-xs font-semibold text-[var(--warning-ink)] no-underline hover:underline">{short.text} ›</Link>
        : <span className="text-xs font-semibold text-[var(--warning-ink)]">{short.text}</span>)}
    </section>
  );
}

/** One row of "My recent business": who, what, the premium and where it stands. */
export type DashDeal = { key: string; title: string; detail: string; value: string; chip: { tone: DashTone; label: string }; href: string };

/** "My recent business" (round 2): the cases worked lately, each opening its case. Only whole rows show. */
export function DashRecent({ title, sub, link, rows, empty = "Nothing yet." }: { title: string; sub?: string; link?: { label: string; href: string }; rows: readonly DashDeal[]; empty?: string }) {
  return (
    <HomePanel title={title} sub={sub} link={link} roundLink>
      {rows.length === 0 ? <p className="m-0 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col flex-wrap content-start overflow-hidden p-0 [&>li]:w-full">
          {rows.map((row) => (
            <li key={row.key}>
              <Link href={row.href} className="grid grid-cols-[minmax(0,1fr)_auto_7.5rem] items-center gap-3 border-b border-border py-2.5 text-foreground no-underline hover:bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[0.8125rem] font-semibold">{row.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{row.detail}</span>
                </span>
                <span className="text-right text-[0.8125rem] font-semibold tabular-nums">{row.value}</span>
                <span className="flex justify-end"><DashChip tone={row.chip.tone}>{row.chip.label}</DashChip></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </HomePanel>
  );
}

/**
 * The words in a ring's middle, sized to stay inside it ("3 of 3 saved" must not spill over the stroke): the
 * longer the text and the smaller the ring, the smaller the type; past a few words it wraps onto two lines.
 */
function RingCenter({ text, size }: { text: string; size: number }) {
  const room = (size - 28) / Math.max(1, text.length);
  const type = room >= 17 ? "text-[1.75rem]" : room >= 13 ? "text-xl" : room >= 10 ? "text-base" : "text-sm";
  return <span className={cn("block max-w-full px-3 text-center font-[family-name:var(--font-display)] font-semibold leading-tight", type)} style={{ maxWidth: size - 24 }}>{text}</span>;
}

function LineRow({ line }: { line: DashLine }) {
  const body = (
    <>
      <span className="text-muted-foreground">{line.label}</span>
      <span className="font-semibold tabular-nums text-foreground">{line.value}</span>
    </>
  );
  const cls = "flex w-full items-center justify-between gap-3 rounded-xl bg-[var(--surface-alt)] px-3 py-2 text-xs no-underline";
  return line.href
    ? <Link href={line.href} className={cn(cls, "transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface-alt))]")}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

export type DashBar = { key: string; label: string; value: number; shown: string; tone?: DashTone; href?: string; /** A muted line under the bar: "24% of dials". */ note?: string };

/** A list of labelled bars on one scale (why policies are at risk, where the money went). */
export function DashBars({ title, period, sub, link, rows, max }: { title: string; period?: string; /** A muted line under the title: what the bars mean. */ sub?: string; link?: { label: string; href: string }; rows: readonly DashBar[]; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((row) => row.value));
  const fill: Record<DashTone, string> = { danger: "bg-[var(--error)]", warning: "bg-[var(--warning)]", good: "bg-[var(--primary)]", info: "bg-[var(--info)]", neutral: "bg-[var(--muted)]" };
  return (
    <HomePanel title={title} period={period} sub={sub} link={link}>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((row) => {
          const body = (
            <>
              <span className="truncate">{row.label}</span>
              <span className="h-2.5 rounded-full bg-[var(--surface-alt)]" aria-hidden="true">
                <span className={cn("m-bar-x m-chart-tween block h-full rounded-full", fill[row.tone ?? "good"])} style={{ width: `${Math.round((row.value / top) * 100)}%` }} />
              </span>
              <span className="text-right font-semibold tabular-nums">{row.shown}</span>
            </>
          );
          const cls = "grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm text-foreground no-underline";
          return <li key={row.key}>{row.href ? <Link href={row.href} className={cn(cls, "rounded-md hover:bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]")}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
        })}
      </ul>
    </HomePanel>
  );
}

export type DashStep = { key: string; label: string; count: number; pct: number; href?: string };

/** Steps from first to last (lead → issued), each a tall bar with its share and count. */
export function DashFunnel({ title, period, link, rate, change, steps }: { title: string; period?: string; link?: { label: string; href: string }; rate: string; change?: ReactNode; steps: readonly DashStep[] }) {
  return (
    <HomePanel title={title} period={period} link={link}>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="font-[family-name:var(--font-display)] text-[1.375rem] font-semibold tabular-nums text-foreground">{rate}</span>
        {change}
      </div>
      <ol className="m-0 grid min-h-0 flex-1 list-none items-stretch gap-3 overflow-hidden p-0" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step) => {
          // A bar is measured against the biggest step, so it never climbs out of the card.
          const top = Math.max(1, ...steps.map((each) => each.count));
          const body = (
            <>
              <span className="text-xs font-semibold tabular-nums text-foreground">{step.pct < 10 && step.pct % 1 ? step.pct.toFixed(1) : Math.round(step.pct)}%</span>
              <span className="flex min-h-12 flex-1 items-end gap-0.5 overflow-hidden" aria-hidden="true">
                <span className="m-bar-rise m-chart-tween w-full rounded-t-md bg-[var(--primary)]" style={{ height: `${Math.max(4, Math.min(100, (step.count / top) * 100))}%` }} />
              </span>
              <span className="truncate text-xs text-muted-foreground">{step.label}</span>
              <span className="text-sm font-semibold tabular-nums text-foreground">{step.count.toLocaleString("en-US")}</span>
            </>
          );
          const cls = "flex h-full min-w-0 flex-col gap-1.5 no-underline";
          return <li key={step.key} className="min-h-0 min-w-0">{step.href ? <Link href={step.href} className={cn(cls, "rounded-md hover:bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]")}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
        })}
      </ol>
    </HomePanel>
  );
}

export type DashRow = { key: string; cells: readonly ReactNode[]; href?: string };

/** A short table; the first column names the row, the rest right-aligned; each row opens its record. */
export function DashTable({ title, period, link, heads, rows, empty = "Nothing here yet." }: { title: string; period?: string; link?: { label: string; href: string }; heads: readonly string[]; rows: readonly DashRow[]; empty?: string }) {
  const cols = `minmax(0,1.4fr) ${heads.slice(1).map(() => "minmax(0,1fr)").join(" ")}`;
  return (
    <HomePanel title={title} period={period} link={link}>
      <div className="grid border-b border-border pb-2 text-xs text-muted-foreground" style={{ gridTemplateColumns: cols }}>
        {heads.map((head, index) => <span key={head} className={index ? "text-right" : ""}>{head}</span>)}
      </div>
      {rows.length === 0 ? <p className="m-0 py-4 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col flex-wrap content-start overflow-hidden p-0 [&>li]:w-full">
          {rows.map((row) => {
            const body = row.cells.map((cell, index) => <span key={index} className={cn("min-w-0 truncate", index ? "text-right tabular-nums" : "font-semibold")}>{cell}</span>);
            const cls = "grid items-center border-b border-border py-2.5 text-sm text-foreground no-underline last:border-b-0";
            return <li key={row.key}>{row.href ? <Link href={row.href} className={cn(cls, "hover:bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]")} style={{ gridTemplateColumns: cols }}>{body}</Link> : <div className={cls} style={{ gridTemplateColumns: cols }}>{body}</div>}</li>;
          })}
        </ul>
      )}
    </HomePanel>
  );
}

/** The brand card at the top of the right column: one money or state figure, two facts under it. */
export function DashHero({ kicker, value, line, facts, href }: { kicker: string; value: string; line?: string; facts?: ReadonlyArray<{ label: string; value: string }>; href: string }) {
  return (
    <Link
      href={href}
      className="relative flex min-h-40 flex-col gap-1.5 overflow-hidden rounded-[18px] bg-[var(--brand-700)] p-[18px] text-[var(--on-dark)] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
    >
      <svg aria-hidden="true" viewBox="0 0 260 140" className="m-reveal-x pointer-events-none absolute -bottom-6 -right-8 h-[130px] w-[240px] opacity-55" fill="none" stroke="var(--primary)" strokeWidth="10" strokeLinecap="round"><path d="M10 110 C 60 20, 90 140, 140 60 S 220 40, 250 90" /></svg>
      <span className="text-xs font-semibold tracking-[0.04em] opacity-80">{kicker}</span>
      <span className="font-[family-name:var(--font-display)] text-[1.75rem] font-semibold leading-tight tabular-nums"><CountUp text={value} fromZero /></span>
      {line && <span className="text-xs opacity-85">{line}</span>}
      {facts && facts.length > 0 && (
        <span className="relative mt-auto flex flex-wrap gap-x-5 gap-y-1 pt-3 text-xs">
          {facts.map((fact) => <span key={fact.label}>{fact.label} <b className="font-semibold">{fact.value}</b></span>)}
        </span>
      )}
    </Link>
  );
}

export type DashItem = { key: string; mark: string; tone: DashTone; title: string; detail?: string; value?: string; when?: string; href: string };

/** The right column's live list: the newest or most urgent few, each opening its record. */
export function DashList({ title, period, link, items, empty = "Nothing yet." }: { title: string; period?: string; link?: { label: string; href: string }; items: readonly DashItem[]; empty?: string }) {
  return (
    <HomePanel title={title} period={period} link={link}>
      {items.length === 0 ? <p className="m-0 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col flex-wrap content-start gap-2 overflow-hidden p-0 [&>li]:w-full">
          {items.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className="flex items-center gap-2.5 rounded-xl bg-[var(--surface-alt)] p-2 text-foreground no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface-alt))]">
                <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-xl text-sm font-semibold", GROUND[item.tone], INK[item.tone])}>{item.mark}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[0.8125rem] font-semibold">{item.title}</span>
                  {item.detail && <span className="truncate text-xs text-muted-foreground">{item.detail}</span>}
                </span>
                <span className="ml-auto flex shrink-0 flex-col items-end">
                  {item.value && <span className={cn("text-[0.8125rem] font-semibold tabular-nums", item.tone === "danger" ? INK.danger : "")}>{item.value}</span>}
                  {item.when && <span className="text-xs text-muted-foreground">{item.when}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </HomePanel>
  );
}

/** A status chip in a dashboard tone. */
export function DashChip({ tone, children }: { tone: DashTone; children: ReactNode }) {
  return <StatusChip tone={CHIP[tone]}>{children}</StatusChip>;
}

/** A tile of "Your modules" (Overview): the module, its one figure, a line; the tile opens the module. */
export function DashModules({ modules }: { modules: ReadonlyArray<{ key: string; label: string; figure: string; line: string; href: string; icon: ReactNode }> }) {
  return (
    // A narrow card (beside the chart on a laptop screen) keeps two columns and drops each tile's icon and line.
    <HomePanel title="Your modules" period="from your plan" bodyClassName="@container">
      <ul className="m-0 grid min-h-0 list-none auto-rows-min grid-cols-2 gap-1.5 overflow-hidden p-0 @[22rem]:gap-2">
        {modules.map((module) => (
          <li key={module.key} className="min-w-0">
            <Link href={module.href} className="flex min-w-0 items-center gap-2.5 overflow-hidden rounded-xl bg-[var(--surface-alt)] px-2.5 py-1.5 text-foreground no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface-alt))] @[22rem]:px-3 @[22rem]:py-2">
              <span aria-hidden="true" className="hidden size-8 shrink-0 place-items-center rounded-[10px] bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[var(--accent-ink)] @[22rem]:grid">{module.icon}</span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs text-muted-foreground">{module.label}</span>
                <span className="truncate font-[family-name:var(--font-display)] text-sm font-semibold tabular-nums @[22rem]:text-base">{module.figure}</span>
                <span className="hidden truncate text-xs text-muted-foreground @[22rem]:block">{module.line}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </HomePanel>
  );
}
