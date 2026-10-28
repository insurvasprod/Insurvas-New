"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { cn } from "@/lib/utils";

/**
 * A date and time in the app's own look (owner, 2026-10-27: "a way better design … not the default"),
 * in place of the browser's datetime-local box. A month grid on the left, the times of day on the
 * right in 15-minute steps. The value is the same `YYYY-MM-DDTHH:mm` string a datetime-local input
 * gives, in the browser's time, so callers change nothing but the element.
 */

const WEEKDAY_HEADS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const pad = (value: number) => String(value).padStart(2, "0");

function parse(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
}
const format = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const clock = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  return `${hours % 12 || 12}:${pad(minutes % 60)} ${hours < 12 ? "AM" : "PM"}`;
};

export function DateTimePicker({ id, value, onChange, disabled = false }: { id: string; value: string; onChange: (next: string) => void; disabled?: boolean }) {
  const chosen = parse(value);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const base = chosen ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const timesRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  const minutesChosen = chosen ? chosen.getHours() * 60 + chosen.getMinutes() : null;

  // The month grid, Monday first, padded to whole weeks.
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1))];
  }, [month]);

  // Open on the chosen time, not on midnight.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => timesRef.current?.querySelector("[aria-selected='true']")?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  function pickDay(day: Date) {
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), chosen?.getHours() ?? 9, chosen?.getMinutes() ?? 0);
    onChange(format(at));
  }
  function pickTime(minutes: number) {
    const base = chosen ?? new Date();
    onChange(format(new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(minutes / 60), minutes % 60)));
  }

  const label = chosen
    ? `${chosen.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${clock(chosen.getHours() * 60 + chosen.getMinutes())}`
    : "Choose a date and time";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && chosen) setMonth(new Date(chosen.getFullYear(), chosen.getMonth(), 1));
      }}
    >
      <PopoverTrigger
        id={id}
        type="button"
        disabled={disabled}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--color-card)] px-3 text-left text-sm text-[var(--ink)] outline-none hover:border-[var(--accent-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <CalendarDays className="size-4 shrink-0 text-[var(--accent-ink)]" aria-hidden="true" />
        <span className={cn("min-w-0 flex-1 truncate", !chosen && "text-[var(--muted)]")}>{label}</span>
      </PopoverTrigger>
      <PopoverContent
          className="flex gap-3 border-[var(--border-strong)] text-[var(--ink)]"
        >
          <div className="w-[252px]">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" aria-label="Previous month" className="inline-flex size-8 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)]" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                <ChevronLeft className="size-4" aria-hidden="true" />
              </button>
              <span className="text-sm font-semibold">{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
              <button type="button" aria-label="Next month" className="inline-flex size-8 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)]" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}>
              {WEEKDAY_HEADS.map((head) => <span key={head} className="py-1 text-xs font-semibold text-[var(--muted)]">{head}</span>)}
              {cells.map((day, index) =>
                day ? (
                  <button
                    key={index}
                    type="button"
                    aria-pressed={chosen ? sameDay(day, chosen) : false}
                    aria-label={day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                    onClick={() => pickDay(day)}
                    className={cn(
                      "h-8 rounded-md text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      chosen && sameDay(day, chosen)
                        ? "bg-[var(--primary)] font-semibold text-[var(--on-primary)]"
                        : sameDay(day, today)
                          ? "border border-[var(--primary)] text-[var(--ink)] hover:bg-[var(--surface-alt)]"
                          : "text-[var(--body)] hover:bg-[var(--surface-alt)]",
                    )}
                  >
                    {day.getDate()}
                  </button>
                ) : (
                  <span key={index} />
                ),
              )}
            </div>
          </div>
          <div className="flex w-[128px] flex-col border-l border-[var(--border)] pl-3">
            <span className="mb-2 text-xs font-semibold text-[var(--muted)]">Time</span>
            <div ref={timesRef} role="listbox" aria-label="Time" className="flex max-h-[260px] flex-col gap-1 overflow-y-auto pr-1">
              {Array.from({ length: 96 }, (_, step) => step * 15).map((minutes) => {
                const on = minutesChosen === minutes;
                return (
                  <button
                    key={minutes}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => pickTime(minutes)}
                    className={cn(
                      "h-8 shrink-0 whitespace-nowrap rounded-md px-2 text-left text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "bg-[var(--primary)] font-semibold text-[var(--on-primary)]" : "text-[var(--body)] hover:bg-[var(--surface-alt)]",
                    )}
                  >
                    {clock(minutes)}
                  </button>
                );
              })}
            </div>
            <button type="button" className="mt-2 h-8 rounded-md bg-[var(--surface-alt)] text-sm font-semibold text-[var(--ink)] hover:bg-[var(--brand-50)]" onClick={() => setOpen(false)}>Done</button>
          </div>
        </PopoverContent>
    </Popover>
  );
}
