"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CallbackView } from "@/lib/callbacks/service";
import { dayTitle, localParts, longTime, shortTime } from "./time";
import { cardSurface } from "@/components/ui/card";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";

/**
 * Callbacks C, "Day plan" (owner pick 2026-10-25, canvas M2 · Calendar, Cb4C): a numbered "do this
 * next" column on the left and the chosen day as a timeline on the right. Clicking anyone opens the
 * person panel. The full table (filters, saved views, bulk export) is the List view beside it.
 *
 * 2026-10-28 (owner: "not filling the whole page"): the timeline shows only the hours that have a
 * callback, plus the current hour on today; the quiet hours between fold into one thin line. Under
 * it, the next callbacks after this day, so a nearly empty day still says what comes next. The left
 * column is one card instead of three.
 */
export type ChipTone = "neutral" | "success" | "warning" | "error" | "accent";
export type RowState = { label: string; tone: ChipTone };

const TONE: Record<ChipTone, StatusTone> = { neutral: "neutral", success: "good", warning: "warning", error: "danger", accent: "action" };

/** A callback's state as the shared chip (foundation v3), in this page's tone names. */
export function Chip({ tone, children, dot = true }: { tone: ChipTone; children: ReactNode; dot?: boolean }) {
  return <StatusChip tone={TONE[tone]} dot={dot}>{children}</StatusChip>;
}

function hourLabel(hour: number) {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${hour < 12 ? "AM" : "PM"}`;
}

/** "9:30" in the agent's own clock, without am/pm (the hour column already says it). */
function clock(utc: string | Date, zone: string) {
  return shortTime(utc, zone, false).replace(/ (am|pm)$/, "");
}

type PersonLineProps = {
  callback: CallbackView;
  yourZone: string;
  state: RowState;
  settled: boolean;
  selected: boolean;
  callHref: string | null;
  onSelect: () => void;
};

/** One callback on the timeline: time, who, what and their own time, its state, Call now. */
function PersonLine({ callback, yourZone, state, settled, selected, callHref, onSelect }: PersonLineProps) {
  const late = state.tone === "error" && !settled;
  const theirs = callback.customerTimezone !== yourZone ? `${shortTime(callback.scheduledAtUtc, callback.customerTimezone, false)} their time` : null;
  const facts = [callback.productName, callback.state, theirs].filter(Boolean).join(" · ");
  return (
    <li
      onClick={onSelect}
      className={cn(
        "flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 sm:gap-4 sm:px-4 transition-[border-color,background-color,box-shadow] duration-150",
        late ? "border-[color-mix(in_srgb,var(--error-ink)_40%,transparent)] bg-[var(--error-surface)]" : "border-border bg-[var(--surface-alt)] hover:border-[var(--border-strong)]",
        selected && "ring-2 ring-[var(--primary)]",
        settled && "opacity-70",
      )}
    >
      <strong className="w-10 shrink-0 text-sm sm:w-12 text-[var(--ink)] tabular-nums">{clock(callback.scheduledAtUtc, yourZone)}</strong>
      <button type="button" onClick={(event) => { event.stopPropagation(); onSelect(); }} className="min-w-0 flex-1 text-left" aria-pressed={selected}>
        <span className={cn("block truncate text-sm font-semibold text-[var(--ink)]", settled && "line-through")}>{callback.customerName}</span>
        {facts && <span className="block truncate text-xs text-[var(--body)]">{facts}</span>}
      </button>
      <span className="hidden shrink-0 sm:inline-flex"><Chip tone={state.tone}>{state.label}</Chip></span>
      {callHref && !settled && (
        <Button asChild size="sm" variant={late ? "default" : "outline"} onClick={(event) => event.stopPropagation()}>
          <Link href={callHref}>{late ? "Call now" : "Call"}</Link>
        </Button>
      )}
    </li>
  );
}

/** The current time on today's timeline, between the callbacks before it and after it. */
function NowLine({ at, zone }: { at: number; zone: string }) {
  return (
    <li aria-label={`Now, ${shortTime(new Date(at), zone, false)}`} className="flex items-center gap-2 py-0.5">
      <span className="size-2 shrink-0 rounded-full bg-[var(--primary)]" />
      <span className="m-meter h-px flex-1 bg-[var(--primary)]"><span /></span>
      <span className="text-xs font-semibold text-[var(--accent-ink)] tabular-nums">Now {clock(new Date(at), zone)}</span>
    </li>
  );
}

type Block = { kind: "hour"; hour: number } | { kind: "gap"; hours: number; key: string };

/**
 * The hours worth a row: those with a callback and, on today, the current one. Runs of hours with
 * nothing in them between two of those become one "gap" line rather than a row each.
 */
export function timelineBlocks(hours: number[]): Block[] {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const blocks: Block[] = [];
  sorted.forEach((hour, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && hour - previous > 1) blocks.push({ kind: "gap", hours: hour - previous - 1, key: `gap-${previous}-${hour}` });
    blocks.push({ kind: "hour", hour });
  });
  return blocks;
}

export function DayTimeline({ day, today, now, yourZone, items, comingUp, stateOf, settledOf, selectedId, onSelect, onDay, onToday, callHrefOf, onAdd }: {
  day: string;
  today: string;
  now: number;
  yourZone: string;
  /** The day's callbacks, any status, soonest first. */
  items: CallbackView[];
  /** The next open callbacks after this day, soonest first. */
  comingUp: CallbackView[];
  stateOf: (callback: CallbackView) => RowState;
  settledOf: (callback: CallbackView) => boolean;
  selectedId: string | null;
  onSelect: (callback: CallbackView) => void;
  onDay: (delta: number) => void;
  onToday: () => void;
  callHrefOf: (callback: CallbackView) => string | null;
  /** Add callback, or null when the page is read-only. */
  onAdd: (() => void) | null;
}) {
  const hourOf = (utc: string | Date) => Number(localParts(utc, yourZone).time.slice(0, 2));
  const byHour = new Map<number, CallbackView[]>();
  for (const item of items) byHour.set(hourOf(item.scheduledAtUtc), [...(byHour.get(hourOf(item.scheduledAtUtc)) ?? []), item]);
  const isToday = day === today;
  const nowHour = hourOf(new Date(now));
  const blocks = items.length ? timelineBlocks([...byHour.keys(), ...(isToday ? [nowHour] : [])]) : [];
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: yourZone, timeZoneName: "short" }).formatToParts(new Date(now)).find((part) => part.type === "timeZoneName")?.value;
  const line = (callback: CallbackView) => (
    <PersonLine
      key={callback.id}
      callback={callback}
      yourZone={yourZone}
      state={stateOf(callback)}
      settled={settledOf(callback)}
      selected={callback.id === selectedId}
      callHref={callHrefOf(callback)}
      onSelect={() => onSelect(callback)}
    />
  );
  return (
    <section className={cn(cardSurface, "flex min-w-0 flex-1 flex-col")} aria-label="Callbacks by hour">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <span className="flex items-center gap-2">
          <Button type="button" size="icon-sm" variant="outline" aria-label="Previous day" onClick={() => onDay(-1)}><ChevronLeft aria-hidden="true" /></Button>
          <h2 className="m-0 min-w-0 text-base font-semibold tracking-[-0.015em] text-[var(--ink)]">{dayTitle(day)}</h2>
          <Button type="button" size="icon-sm" variant="outline" aria-label="Next day" onClick={() => onDay(1)}><ChevronRight aria-hidden="true" /></Button>
          {!isToday && <Button type="button" size="sm" variant="ghost" onClick={onToday}>Today</Button>}
        </span>
        <span className="text-xs text-[var(--body)]">Your time{zone ? ` (${zone})` : ""}</span>
      </div>

      {items.length === 0 ? (
        <div key={day} className="m-in flex flex-col items-start gap-3 border-t border-border px-5 py-6">
          <p className="m-0 text-sm text-[var(--ink)]">Nothing booked {isToday ? "for the rest of today" : `on ${dayTitle(day)}`}.</p>
          {onAdd && <Button type="button" size="sm" variant="outline" onClick={onAdd}><Plus aria-hidden="true" />Add callback</Button>}
        </div>
      ) : (
        <ol key={day} className="m-seq m-0 list-none px-3 pb-3 sm:px-5">
          {blocks.map((block) => block.kind === "gap" ? (
            <li key={block.key} className="flex items-center gap-2 border-t border-dashed border-border py-1.5 sm:gap-4" aria-hidden="true">
              <span className="w-10 shrink-0 sm:w-12" />
              <span className="text-xs text-[var(--muted)]">{block.hours === 1 ? "1 free hour" : `${block.hours} free hours`}</span>
            </li>
          ) : (
            <li key={block.hour} className="flex items-start gap-2 border-t border-border py-2 sm:gap-4">
              <span className="w-10 shrink-0 pt-2.5 text-right sm:w-12 text-xs text-[var(--body)] tabular-nums">{hourLabel(block.hour)}</span>
              <ul className="m-0 flex min-w-0 flex-1 list-none flex-col gap-1.5 p-0">
                {(() => {
                  const here = byHour.get(block.hour) ?? [];
                  if (!isToday || block.hour !== nowHour) return here.map(line);
                  const before = here.filter((item) => new Date(item.scheduledAtUtc).getTime() <= now);
                  const after = here.filter((item) => new Date(item.scheduledAtUtc).getTime() > now);
                  return <>{before.map(line)}<NowLine at={now} zone={yourZone} />{after.map(line)}</>;
                })()}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {comingUp.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border px-5 py-4">
          <h3 className="m-0 mb-1 text-xs font-semibold text-[var(--body)]">Coming up</h3>
          <ul className="m-seq m-0 flex list-none flex-col p-0">
            {comingUp.map((callback) => (
              <li key={callback.id}>
                <button type="button" onClick={() => onSelect(callback)} aria-pressed={callback.id === selectedId} className={cn("-mx-2 flex w-[calc(100%+1rem)] items-center gap-4 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--surface-alt)]", callback.id === selectedId && "bg-[var(--primary-soft)]")}>
                  <span className="w-32 shrink-0 text-sm text-[var(--ink)] tabular-nums">{longTime(callback.scheduledAtUtc, yourZone).replace(/ [A-Z]{2,5}$/, "")}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]">{callback.customerName}</span>
                  <span className="hidden shrink-0 truncate text-xs text-[var(--body)] sm:block">{[callback.productName, callback.state].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export type PlanStep = { label: string; count: number; tone: "error" | "accent" | "warning"; onClick?: () => void };

const STEP_TONE: Record<PlanStep["tone"], string> = {
  error: "bg-[var(--error-surface)] text-[var(--error-ink)]",
  accent: "bg-[var(--primary-soft)] text-[var(--accent-ink)]",
  warning: "bg-[var(--warning-surface)] text-[var(--warning-ink)]",
};

/**
 * The left column, one card: how much of today is left, three numbered steps, and the callbacks
 * from earlier days. A step with nothing to do shows a tick instead of a count.
 */
export function PlanColumn({ className, title, left, total, steps, earlier, moreEarlier, onSelect, onMoreEarlier, callHrefOf, stateOf }: {
  className?: string;
  title: string;
  left: number;
  total: number;
  steps: PlanStep[];
  earlier: CallbackView[];
  moreEarlier: number;
  onSelect: (callback: CallbackView) => void;
  onMoreEarlier: () => void;
  callHrefOf: (callback: CallbackView) => string | null;
  stateOf: (callback: CallbackView) => RowState;
}) {
  const done = Math.max(0, total - left);
  return (
    <aside className={cn(cardSurface, "flex w-full shrink-0 flex-col gap-5 p-5 xl:w-[300px]", className)} aria-label="Today's plan">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-[var(--body)]">{title}</span>
        <span className="flex items-baseline gap-2">
          <strong className="text-2xl tracking-[-0.02em] text-[var(--ink)] tabular-nums">{total === 0 ? "Clear" : left === 0 ? "All done" : `${left} left`}</strong>
          {total > 0 && <span className="text-sm text-[var(--body)]">of {total} today</span>}
        </span>
        <span className="m-meter block h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Callbacks done today">
          <span className="block h-full rounded-full bg-[var(--primary)] transition-[width] duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </span>
      </div>

      <ol className="-mx-2 m-0 flex list-none flex-col p-0" aria-label="What to do next">
        {steps.map((step, index) => (
          <li key={step.label}>
            <button type="button" disabled={!step.onClick || step.count === 0} onClick={step.onClick} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--surface-alt)] disabled:cursor-default disabled:hover:bg-transparent">
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold", step.count ? STEP_TONE[step.tone] : "bg-[var(--surface-alt)] text-[var(--muted)]")}>
                {step.count ? index + 1 : <Check className="size-3.5" aria-hidden="true" />}
              </span>
              <span className={cn("flex-1 text-sm", step.count ? "text-[var(--ink)]" : "text-[var(--muted)]")}>{step.label}</span>
              {step.count > 0 && <span className="text-sm font-semibold text-[var(--ink)] tabular-nums">{step.count}</span>}
            </button>
          </li>
        ))}
      </ol>

      {earlier.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-border pt-4" aria-label="From earlier days">
          <span className="text-xs font-semibold text-[var(--error-ink)]">From earlier</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {earlier.map((callback) => {
              const href = callHrefOf(callback);
              return (
                <li key={callback.id} className="flex items-center gap-2">
                  <button type="button" onClick={() => onSelect(callback)} className="min-w-0 flex-1 rounded-md py-1 text-left hover:underline">
                    <span className="block truncate text-sm font-semibold text-[var(--ink)]">{callback.customerName}</span>
                    <span className="block truncate text-xs text-[var(--body)]">{stateOf(callback).label}{callback.productName ? ` · ${callback.productName}` : ""}</span>
                  </button>
                  {href && <Button asChild size="sm" variant="outline"><Link href={href}>Call now</Link></Button>}
                </li>
              );
            })}
          </ul>
          {moreEarlier > 0 && <button type="button" onClick={onMoreEarlier} className="self-start text-sm font-semibold text-[var(--accent-ink)] hover:underline">{moreEarlier} more overdue</button>}
        </section>
      )}
    </aside>
  );
}
