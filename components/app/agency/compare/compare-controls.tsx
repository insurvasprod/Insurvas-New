"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, Columns3, Plus, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SelectMenu } from "@/components/ui/select-menu";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { DeltaChip } from "@/components/ui/stat";
import { NavPending, setParamsInPlace, useNavTransition } from "@/components/ui/nav-pending";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { followingB, PRESETS, type Preset, type Range } from "@/lib/dashboard/comparePeriods";
import { cn } from "@/lib/utils";

/**
 * Compare's controls (owner 2026-11-07, Compare mockups A and B). Every choice lives in the address, so a comparison
 * can be bookmarked or sent, and the server page reads it: ?preset=, ?af ?at ?bf ?bt (custom), ?person= (A), ?people=
 * (B, up to four), ?metric= (the chart), ?cols= (the people table).
 *
 * 2026-11-08 ("feel instant"): ?metric= and ?cols= only change what is drawn from figures already on the page, so they
 * switch in the page and the address follows in place (setParamsInPlace) — no server round trip. The periods and the
 * people are new figures from the server: they navigate in a transition, the page stays as it is and its content dims
 * until the new figures are in (useNavTransition, NavPending).
 */
function useParamsNav() {
  const path = usePathname();
  const params = useSearchParams();
  const [pending, navigate] = useNavTransition();
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    navigate(query ? `${path}?${query}` : path);
  };
  return [pending, go] as const;
}

/** The preset chips and the Custom… pop-up. The two periods in words sit on the title line (PeriodWords). */
export function PeriodControls({ preset, a, b }: { preset: Preset; a: Range; b: Range }) {
  const [pending, go] = useParamsNav();
  // The chip that was clicked is chosen at once; the figures follow from the server.
  const [asked, setAsked] = useState<{ from: Preset; to: Preset } | null>(null);
  const shown = asked && asked.from === preset ? asked.to : preset;
  const pick = (key: Preset, patch: Record<string, string | null>) => { setAsked({ from: preset, to: key }); go(patch); };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NavPending pending={pending} />
      <span className="text-xs font-semibold text-muted-foreground">Compare</span>
      <div role="radiogroup" aria-label="Periods compared" className="flex flex-wrap items-center gap-2">
        {PRESETS.map((option) => (
          <ToggleChip key={option.key} role="radio" selected={shown === option.key} onClick={() => pick(option.key, { preset: option.key === "month" ? null : option.key, af: null, at: null, bf: null, bt: null })}>
            {option.label}
          </ToggleChip>
        ))}
        <CustomRange preset={shown} a={a} b={b} onApply={(na, nb) => pick("custom", { preset: "custom", af: na.from, at: na.to, bf: nb.from, bt: nb.to })} />
      </div>
    </div>
  );
}

/** A period in words, in its line's colour: green this period, blue the one it is set against. */
export function PeriodPill({ tone, children }: { tone: "a" | "b"; children: ReactNode }) {
  return <StatusChip tone={tone === "a" ? "good" : "info"}>{children}</StatusChip>;
}

/** Custom…: the green period by hand, the blue one by a rule or by hand. */
function CustomRange({ preset, a, b, onApply }: { preset: Preset; a: Range; b: Range; onApply: (a: Range, b: Range) => void }) {
  const [open, setOpen] = useState(false);
  const [na, setA] = useState<Range>(a);
  const [nb, setB] = useState<Range>(b);
  const [rule, setRule] = useState<"month" | "year" | "before" | "hand">("month");
  const setFirst = (next: Range) => {
    setA(next);
    if (rule !== "hand" && next.from && next.to && next.from <= next.to) setB(followingB(next, rule));
  };
  const valid = Boolean(na.from && na.to && nb.from && nb.to && na.from <= na.to && nb.from <= nb.to);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* ToggleChip takes no trigger props, so it opens the panel itself and the anchor places it. */}
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <ToggleChip selected={preset === "custom"} onClick={() => { setA(a); setB(b); setOpen(true); }}><CalendarDays className="size-4" aria-hidden="true" />Custom…</ToggleChip>
        </span>
      </PopoverAnchor>
      <PopoverContent align="start" className="flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3">
        <span className="text-sm font-semibold text-foreground">The two periods</span>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2 rounded-full bg-[var(--primary)]" />This period</legend>
          <div className="grid grid-cols-2 gap-2">
            <input id="compare-a-from" type="date" aria-label="This period, from" className={toolbarControl} value={na.from} max={na.to || undefined} onChange={(event) => setFirst({ ...na, from: event.target.value })} />
            <input id="compare-a-to" type="date" aria-label="This period, to" className={toolbarControl} value={na.to} min={na.from || undefined} onChange={(event) => setFirst({ ...na, to: event.target.value })} />
          </div>
        </fieldset>
        <div role="radiogroup" aria-label="Compare it with" className="flex flex-wrap gap-1.5">
          {([["month", "Same days last month"], ["year", "Same days last year"], ["before", "The period before"], ["hand", "By hand"]] as const).map(([key, label]) => (
            <ToggleChip key={key} role="radio" selected={rule === key} onClick={() => { setRule(key); if (key !== "hand" && na.from && na.to && na.from <= na.to) setB(followingB(na, key)); }}>{label}</ToggleChip>
          ))}
        </div>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2 rounded-full bg-[var(--info)]" />Against</legend>
          <div className="grid grid-cols-2 gap-2">
            <input id="compare-b-from" type="date" aria-label="Against, from" className={toolbarControl} value={nb.from} disabled={rule !== "hand"} onChange={(event) => setB({ ...nb, from: event.target.value })} />
            <input id="compare-b-to" type="date" aria-label="Against, to" className={toolbarControl} value={nb.to} disabled={rule !== "hand"} onChange={(event) => setB({ ...nb, to: event.target.value })} />
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!valid} onClick={() => { onApply(na, nb); setOpen(false); }}>Compare</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type PersonOption = { id: string; name: string };

/** A · "Whole agency" or one person. */
export function ScopePicker({ people, person }: { people: readonly PersonOption[]; person: string | null }) {
  const [pending, go] = useParamsNav();
  return (
    <>
    <NavPending pending={pending} />
    <SelectMenu
      label="Who is compared"
      value={person ?? "all"}
      defaultValue="all"
      icon={<UserRound className="size-4" aria-hidden="true" />}
      options={[{ value: "all", label: "Whole agency" }, ...people.map((p) => ({ value: p.id, label: p.name, group: "One person" }))]}
      onChange={(next) => go({ person: next === "all" ? null : next })}
      searchPlaceholder="Search people"
      className="w-56"
    />
    </>
  );
}

/**
 * The A chart, one per figure, all drawn by the server from figures already on the page: the switch only chooses
 * which one shows (client state; the address follows in place), so changing the figure is instant.
 */
const MetricContext = createContext<{ metric: string; choose: (metric: string) => void } | null>(null);

export function MetricCharts({ initial, charts }: { initial: string; charts: Partial<Record<string, ReactNode>> }) {
  const [metric, setMetric] = useState(charts[initial] ? initial : Object.keys(charts)[0]);
  const choose = (next: string) => {
    if (next === metric || !charts[next]) return;
    setMetric(next);
    setParamsInPlace({ metric: next });
  };
  return (
    <MetricContext.Provider value={{ metric, choose }}>
      {/* The chart keeps the panel's height; the figure's own line and numbers change in place. */}
      <div className="h-full min-w-0 [&>*]:h-full">{charts[metric]}</div>
    </MetricContext.Provider>
  );
}

/** The figure the A chart draws (inside MetricCharts). */
export function MetricSwitch({ money }: { money: boolean }) {
  const own = useContext(MetricContext);
  const metric = own?.metric ?? "";
  const go = (next: string) => own?.choose(next);
  const options = [...(money ? [{ key: "premium", label: "Premium" }] : []), { key: "policies", label: "Policies" }, { key: "dials", label: "Dials" }];
  return (
    <div role="radiogroup" aria-label="Figure on the chart" className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <ToggleChip key={option.key} role="radio" selected={metric === option.key} onClick={() => go(option.key)}>{option.label}</ToggleChip>
      ))}
    </div>
  );
}

/** B · the people compared (up to four), each removable, and + Add person. */
export function PeoplePicker({ people, chosen }: { people: readonly PersonOption[]; chosen: readonly string[] }) {
  const [pending, go] = useParamsNav();
  const set = (ids: string[]) => go({ people: ids.length ? ids.join(",") : null });
  const left = people.filter((p) => !chosen.includes(p.id));
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="People compared">
      <NavPending pending={pending} />
      <span className="text-xs font-semibold text-muted-foreground">Comparing</span>
      {chosen.map((id) => {
        const name = people.find((p) => p.id === id)?.name ?? "Someone";
        return <ToggleChip key={id} selected onRemove={() => set(chosen.filter((c) => c !== id))}>{name}</ToggleChip>;
      })}
      {chosen.length < 4 && left.length > 0 && (
        <SelectMenu
          label="Add a person"
          value={"add" as string}
          icon={<Plus className="size-4" aria-hidden="true" />}
          options={[{ value: "add", label: "Add person", disabled: true }, ...left.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={(next) => { if (next !== "add") set([...chosen, next]); }}
          searchPlaceholder="Search people"
          className="w-44"
        />
      )}
    </div>
  );
}

// ── the people table (A) ─────────────────────────────────────────────────────────────────────────

export type PeopleColumn = { key: string; label: string; money?: boolean };
/** `big` replaces the percentage when it would say nothing: "new" (from nothing) or "12×" (ten times or more). */
export type PeopleCell = { now: string; then: string | null; change: number | null; big?: string; unit?: string; goodWhen?: "up" | "down" };
/** `inactive`: nothing at all this period, kept out of the way under "Not active this period". */
export type PeopleRow = { id: string; name: string; initials: string; note: string; href: string; cells: Record<string, PeopleCell>; trend: readonly number[]; inactive: boolean };

/** A person's mark: their initials in a small round badge (the mockup's avatar). */
export function PersonMark({ text }: { text: string }) {
  return <span aria-hidden="true" className="inline-grid size-8 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-[0.6875rem] font-bold text-[var(--accent-ink)]">{text}</span>;
}

/** The period's daily figure as a small line, the last day marked (the table's Trend column). */
function Sparkline({ points, label }: { points: readonly number[]; label: string }) {
  if (points.length < 2 || !points.some((v) => v > 0)) return <span className="text-xs text-muted-foreground">—</span>;
  const top = Math.max(...points, 1);
  const x = (i: number) => (i / (points.length - 1)) * 70 + 1;
  const y = (v: number) => 21 - (v / top) * 18;
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 72 24" width="72" height="24" role="img" aria-label={label} className="m-reveal-x m-chart-tween inline-block">
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="2.5" fill="var(--primary)" />
    </svg>
  );
}

/** Every person on the same two periods; Figures ▾ picks the columns; a row focuses the page on that person. */
export function PeopleTable({ columns, rows, shown: initialShown, focused, trendLabel }: { columns: readonly PeopleColumn[]; rows: readonly PeopleRow[]; shown: readonly string[]; focused: string | null; trendLabel: string }) {
  const [pending, go] = useParamsNav();
  const [showIdle, setShowIdle] = useState(false);
  // Every row carries every column's figures, so Figures ▾ only changes what is drawn: in the page, the address in place.
  const [shown, setShown] = useState<readonly string[]>(initialShown);
  const setColumns = (keys: string[]) => { setShown(keys); setParamsInPlace({ cols: keys.join(",") }); };
  const visible = columns.filter((column) => shown.includes(column.key));
  const active = rows.filter((row) => !row.inactive);
  const idle = rows.filter((row) => row.inactive);
  const line = (row: PeopleRow) => (
    <TableRow key={row.id} aria-selected={focused === row.id} className={cn("cursor-pointer", focused === row.id && "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]", row.inactive && "opacity-80")} onClick={() => go({ person: focused === row.id ? null : row.id })}>
      <TableCell>
        <span className="flex min-w-0 items-center gap-2.5">
          <PersonMark text={row.initials} />
          <span className="flex min-w-0 flex-col">
            <Link href={row.href} onClick={(event) => event.stopPropagation()} className="truncate font-semibold text-foreground no-underline hover:underline">{row.name}</Link>
            <span className="truncate text-xs text-muted-foreground">{row.note}</span>
          </span>
        </span>
      </TableCell>
      {visible.map((column) => {
        const cell = row.cells[column.key];
        return (
          <TableCell key={column.key} className="text-right">
            {cell ? (
              <span className="inline-flex flex-col items-end gap-0.5">
                <span className="font-semibold tabular-nums">{cell.now}</span>
                {/* The second line is last period's figure, said in words (critique #1). */}
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                  {cell.then === null ? "—" : `was ${cell.then}`}
                  {cell.big
                    ? <StatusChip tone="good">{cell.big}</StatusChip>
                    : cell.change !== null && cell.change !== 0 ? <DeltaChip value={cell.change} unit={cell.unit ?? "%"} goodWhen={cell.goodWhen ?? "up"} /> : null}
                </span>
              </span>
            ) : "—"}
          </TableCell>
        );
      })}
      <TableCell className="text-right"><Sparkline points={row.trend} label={`${row.name}: ${trendLabel}`} /></TableCell>
    </TableRow>
  );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <NavPending pending={pending} />
      <div className="flex items-center justify-end">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline"><Columns3 className="size-4" aria-hidden="true" />Figures</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-64 flex-col gap-1">
            <span className="px-1 pb-1 text-sm font-semibold text-foreground">Columns</span>
            {columns.map((column) => {
              const on = shown.includes(column.key);
              return (
                <label key={column.key} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-alt)]">
                  <input
                    id={`compare-col-${column.key}`}
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    checked={on}
                    disabled={on && shown.length === 1}
                    onChange={() => setColumns(on ? shown.filter((key) => key !== column.key) : columns.map((c) => c.key).filter((key) => key === column.key || shown.includes(key)))}
                  />
                  {column.label}
                </label>
              );
            })}
          </PopoverContent>
        </Popover>
      </div>
      <div className="min-w-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              {visible.map((column) => <TableHead key={column.key} className="text-right">{column.label}</TableHead>)}
              <TableHead className="text-right">Trend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.map(line)}
            {/* People with nothing this period wait in one closed group (critique #3), not a run of red rows. */}
            {idle.length > 0 && (
              <TableRow>
                <TableCell colSpan={visible.length + 2}>
                  <Button variant="ghost" size="sm" aria-expanded={showIdle} onClick={() => setShowIdle((open) => !open)}>
                    {showIdle ? "Hide" : "Show"} not active this period ({idle.length})
                  </Button>
                </TableCell>
              </TableRow>
            )}
            {showIdle && idle.map(line)}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
