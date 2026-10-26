"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CallbackView } from "@/lib/callbacks/service";
import { dayTitle, localParts, shortTime } from "./time";

/**
 * Callbacks C, "Day plan" (owner pick 2026-10-25, canvas M2 · Calendar, Cb4C): a numbered "do this
 * next" column on the left and the chosen day as a timeline on the right. Clicking anyone opens the
 * person panel. The full table (filters, saved views, bulk export) is the List view beside it.
 */
export type ChipTone = "neutral" | "success" | "warning" | "error" | "accent";
export type RowState = { label: string; tone: ChipTone };

export function Chip({ tone, children, dot = true }: { tone: ChipTone; children: ReactNode; dot?: boolean }) {
  return <span className={`portal-status-chip is-${tone}`}>{dot && <span aria-hidden="true" />}{children}</span>;
}

// m-glass: frosted over the page's moving ribbon, like the other redesigned pages.
const CARD = "m-glass rounded-xl border border-border";

function hourLabel(hour: number) {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return hour === 0 || hour === 12 || hour === 9 ? `${twelve} ${hour < 12 ? "AM" : "PM"}` : String(twelve);
}

/** "9:30" in the agent's own clock, without am/pm (the hour column already says it). */
function clock(utc: string, zone: string) {
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
  const theirs = callback.customerTimezone !== yourZone ? ` · ${shortTime(callback.scheduledAtUtc, callback.customerTimezone, false)} their time` : "";
  const facts = [callback.productName, callback.state].filter(Boolean).join(" · ") + theirs;
  return (
    <li
      onClick={onSelect}
      className={cn(
        "m-row flex min-w-0 cursor-pointer items-center gap-4 rounded-xl border px-4 py-2.5",
        late ? "border-[color-mix(in_srgb,var(--error-ink)_40%,transparent)] bg-[var(--error-surface)]" : "border-border bg-[var(--surface-alt)]",
        selected && "ring-2 ring-[var(--primary)]",
        settled && "opacity-70",
      )}
    >
      <strong className="w-12 shrink-0 text-sm tabular-nums">{clock(callback.scheduledAtUtc, yourZone)}</strong>
      <button type="button" onClick={(event) => { event.stopPropagation(); onSelect(); }} className="min-w-0 flex-1 text-left" aria-pressed={selected}>
        <span className={cn("block truncate text-sm font-semibold text-[var(--ink)]", settled && "line-through")}>{callback.customerName}</span>
        <span className="block truncate text-xs text-muted-foreground">{facts}</span>
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

export function DayTimeline({ day, today, yourZone, items, stateOf, settledOf, selectedId, onSelect, onDay, onToday, callHrefOf }: {
  day: string;
  today: string;
  yourZone: string;
  /** The day's callbacks, any status, soonest first. */
  items: CallbackView[];
  stateOf: (callback: CallbackView) => RowState;
  settledOf: (callback: CallbackView) => boolean;
  selectedId: string | null;
  onSelect: (callback: CallbackView) => void;
  onDay: (delta: number) => void;
  onToday: () => void;
  callHrefOf: (callback: CallbackView) => string | null;
}) {
  const byHour = new Map<number, CallbackView[]>();
  for (const item of items) {
    const hour = Number(localParts(item.scheduledAtUtc, yourZone).time.slice(0, 2));
    byHour.set(hour, [...(byHour.get(hour) ?? []), item]);
  }
  const hours = [...byHour.keys()];
  const first = Math.min(9, ...hours);
  const last = Math.max(17, ...hours);
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: yourZone, timeZoneName: "long" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value;
  return (
    <section className={cn(CARD, "flex min-w-0 flex-1 flex-col")} aria-label="Callbacks by hour">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <span className="flex items-center gap-2">
          <Button type="button" size="icon-sm" variant="outline" aria-label="Previous day" onClick={() => onDay(-1)}><ChevronLeft aria-hidden="true" /></Button>
          <h2 className="m-0 text-base font-semibold tracking-[-0.015em]">{dayTitle(day)}</h2>
          <Button type="button" size="icon-sm" variant="outline" aria-label="Next day" onClick={() => onDay(1)}><ChevronRight aria-hidden="true" /></Button>
          {day !== today && <Button type="button" size="sm" variant="ghost" onClick={onToday}>Today</Button>}
        </span>
        <span className="text-sm text-muted-foreground">Your time{zone ? ` (${zone})` : ""} · their time on each call</span>
      </div>
      <ol className="m-0 list-none px-5 pb-3">
        {Array.from({ length: last - first + 1 }, (_, index) => first + index).map((hour) => (
          <li key={hour} className="flex min-h-12 items-start gap-4 border-t border-border py-1.5">
            <span className="w-12 shrink-0 pt-2.5 text-right text-xs text-muted-foreground tabular-nums">{hourLabel(hour)}</span>
            <ul className="m-0 flex min-w-0 flex-1 list-none flex-col gap-1.5 p-0">
              {(byHour.get(hour) ?? []).map((callback) => (
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
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {items.length === 0 && <p className="m-0 border-t border-border px-5 py-6 text-sm text-muted-foreground">No callbacks on this day.</p>}
    </section>
  );
}

export type PlanStep = { label: string; count: number; tone: "error" | "accent" | "warning"; onClick?: () => void };

const STEP_TONE: Record<PlanStep["tone"], string> = {
  error: "bg-[var(--error-surface)] text-[var(--error-ink)]",
  accent: "bg-[var(--primary-soft)] text-[var(--accent-ink)]",
  warning: "bg-[var(--warning-surface)] text-[var(--warning-ink)]",
};

/** The left column: how much of today is left, three numbered steps, and the callbacks from earlier days. */
export function PlanColumn({ className, title, left, total, steps, earlier, moreEarlier, onSelect, onMoreEarlier, callHrefOf, stateOf, footer }: {
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
  footer?: ReactNode;
}) {
  const done = Math.max(0, total - left);
  return (
    <div className={cn("flex w-full shrink-0 flex-col gap-4 xl:w-[300px]", className)}>
      <section className={cn(CARD, "flex flex-col gap-3 p-5")}>
        <span className="text-xs font-semibold text-muted-foreground">{title}</span>
        <span className="flex items-baseline gap-2"><strong className="text-2xl tracking-[-0.02em]">{left} left</strong><span className="text-sm text-muted-foreground">of {total}</span></span>
        <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Callbacks done today">
          <span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </span>
      </section>
      <section className={cn(CARD, "py-2")} aria-label="What to do next">
        <ol className="m-0 list-none p-0">
          {steps.map((step, index) => (
            <li key={step.label}>
              <button type="button" disabled={!step.onClick || step.count === 0} onClick={step.onClick} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-[var(--surface-alt)] disabled:cursor-default disabled:hover:bg-transparent">
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold", step.count ? STEP_TONE[step.tone] : "bg-[var(--surface-alt)] text-muted-foreground")}>{index + 1}</span>
                <span className={cn("flex-1 text-sm", step.count === 0 && "text-muted-foreground line-through")}>{step.label}</span>
                <span className="text-sm text-muted-foreground tabular-nums">{step.count}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
      {earlier.length > 0 && (
        <section className={cn(CARD, "flex flex-col gap-2 p-4")} aria-label="From earlier days">
          <span className="text-xs font-semibold text-[var(--error-ink)]">From earlier</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {earlier.map((callback) => {
              const href = callHrefOf(callback);
              return (
                <li key={callback.id} className="flex items-center gap-2">
                  <button type="button" onClick={() => onSelect(callback)} className="min-w-0 flex-1 rounded-md py-1 text-left hover:underline">
                    <span className="block truncate text-sm font-semibold text-[var(--ink)]">{callback.customerName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{stateOf(callback).label}{callback.productName ? ` · ${callback.productName}` : ""}</span>
                  </button>
                  {href && <Button asChild size="sm" variant="outline"><Link href={href}>Call now</Link></Button>}
                </li>
              );
            })}
          </ul>
          {moreEarlier > 0 && <button type="button" onClick={onMoreEarlier} className="self-start text-sm font-semibold text-[var(--accent-ink)] hover:underline">{moreEarlier} more overdue</button>}
        </section>
      )}
      {footer}
    </div>
  );
}
