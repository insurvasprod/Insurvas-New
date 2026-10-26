"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Calendar B's month (owner pick 2026-10-25, canvas M2 · Calendar, Cal4B): the month around the day
 * on show, Monday first. Picking a date moves the calendar there; a dot marks a day with bookings.
 */
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HEAD = ["M", "T", "W", "T", "F", "S", "S"];

export type YearMonth = { year: number; month: number };
type Ymd = { year: number; month: number; day: number };

export function MiniMonth({ shown, onShown, picked, today, busy, onPick }: {
  /** The month drawn (its arrows move this, not the calendar). */
  shown: YearMonth;
  onShown: (next: YearMonth) => void;
  picked: Ymd | null;
  today: Ymd | null;
  /** "YYYY-M-D" keys of days with bookings. */
  busy: Set<string>;
  onPick: (day: Ymd) => void;
}) {
  const first = new Date(Date.UTC(shown.year, shown.month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(shown.year, shown.month, 0)).getUTCDate();
  const step = (delta: number) => {
    const at = new Date(Date.UTC(shown.year, shown.month - 1 + delta, 1));
    onShown({ year: at.getUTCFullYear(), month: at.getUTCMonth() + 1 });
  };
  const same = (a: Ymd | null, day: number) => Boolean(a && a.year === shown.year && a.month === shown.month && a.day === day);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <strong className="text-sm">{MONTH_LONG[shown.month - 1]} {shown.year}</strong>
        <span className="flex gap-1">
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Previous month" onClick={() => step(-1)}><ChevronLeft aria-hidden="true" /></Button>
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Next month" onClick={() => step(1)}><ChevronRight aria-hidden="true" /></Button>
        </span>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs text-muted-foreground" aria-hidden="true">
        {HEAD.map((letter, index) => <span key={index} className="py-1">{letter}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: lead }, (_, index) => <span key={`gap-${index}`} />)}
        {Array.from({ length }, (_, index) => index + 1).map((day) => {
          const on = same(picked, day);
          const isToday = same(today, day);
          const dot = busy.has(`${shown.year}-${shown.month}-${day}`);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              aria-label={`${day} ${MONTH_LONG[shown.month - 1]}${dot ? ", has bookings" : ""}`}
              onClick={() => onPick({ year: shown.year, month: shown.month, day })}
              className={cn(
                "relative grid h-8 place-items-center rounded-md text-xs tabular-nums",
                on ? "bg-primary font-bold text-primary-foreground" : "text-[var(--ink)] hover:bg-[var(--surface-alt)]",
                isToday && !on && "font-bold text-[var(--accent-ink)]",
              )}
            >
              {day}
              {dot && !on && <span className="absolute bottom-1 size-1 rounded-full bg-[var(--primary)]" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
