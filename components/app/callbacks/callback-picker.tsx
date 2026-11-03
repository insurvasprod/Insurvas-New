"use client";

import { useMemo, useState } from "react";

import { MiniMonth, type YearMonth } from "@/components/app/calendar/mini-month";
import { cn } from "@/lib/utils";

/**
 * The callback's day and time (owner 2026-10-27: "like the calendar at Appointments"): the
 * Appointments month on the left, the times of that day on the right, both in the customer's time.
 * The value is the walk's `callback_local` ("YYYY-MM-DDTHH:mm" in the customer's zone); the server's
 * calling-window check stays the authority. Days and times already past are not offered.
 *
 * `slots` (the Dialer's Book an appointment, 2026-10-27): only these times are offered, each a
 * "YYYY-MM-DDTHH:mm" in `zone` — an agent's open slots. Days that have one carry the month's dot;
 * the others say there is nothing that day. Without `slots`, every half hour from 8:00 AM to 8:30 PM.
 */

type Ymd = { year: number; month: number; day: number };

/** 8:00 to 20:30, every half hour: the hours a callback is normally allowed. */
const TIMES = Array.from({ length: 26 }, (_, index) => 8 * 60 + index * 30);

const pad = (value: number) => String(value).padStart(2, "0");
const ymdKey = (d: Ymd) => d.year * 10000 + d.month * 100 + d.day;
const timeLabel = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
};

/** Today's date and minute of the day in `zone` (the browser's own zone when it is unknown). */
function nowIn(zone: string | null) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone ?? undefined, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { today: { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) }, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

function parse(local: string): { day: Ymd; minute: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  return { day: { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }, minute: Number(match[4]) * 60 + Number(match[5]) };
}

export function CallbackPicker({ value, onChange, zone, disabled, slots, label = "Callback time" }: { value: string; onChange: (local: string) => void; zone: string | null; disabled: boolean; slots?: readonly string[]; label?: string }) {
  const { today, minute: nowMinute } = useMemo(() => nowIn(zone), [zone]);
  const current = parse(value);
  // The offered times by day, when only some are bookable.
  const offered = useMemo(() => {
    if (!slots) return null;
    const byDay = new Map<number, number[]>();
    for (const slot of slots) {
      const at = parse(slot);
      if (!at) continue;
      byDay.set(ymdKey(at.day), [...(byDay.get(ymdKey(at.day)) ?? []), at.minute].sort((a, b) => a - b));
    }
    return byDay;
  }, [slots]);
  const firstOffered = slots?.length ? parse(slots[0]) : null;
  const [shown, setShown] = useState<YearMonth>(() => {
    const start = current?.day ?? firstOffered?.day ?? today;
    return { year: start.year, month: start.month };
  });
  const [day, setDay] = useState<Ymd | null>(current?.day ?? null);
  const picked = current?.day ?? day;
  const isToday = picked ? ymdKey(picked) === ymdKey(today) : false;
  const write = (d: Ymd, minutes: number) => onChange(`${d.year}-${pad(d.month)}-${pad(d.day)}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className={cn("w-full shrink-0 rounded-[12px] border border-[var(--border)] p-3 sm:w-[260px]", disabled && "pointer-events-none opacity-60")}>
        <MiniMonth
          shown={shown}
          onShown={setShown}
          picked={picked}
          today={today}
          busy={offered ? new Set([...offered.keys()].map((key) => `${Math.floor(key / 10000)}-${Math.floor(key / 100) % 100}-${key % 100}`)) : new Set()}
          onPick={(next) => {
            if (ymdKey(next) < ymdKey(today)) return;
            setDay(next);
            // Keep the time already chosen when only the day changes (and that time is offered that day).
            if (current && (!offered || offered.get(ymdKey(next))?.includes(current.minute))) write(next, current.minute); else onChange("");
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        {!picked ? (
          <p className="m-0 rounded-[12px] border border-dashed border-[var(--border-strong)] px-4 py-6 text-center text-sm text-[var(--muted)]">Pick a day, then a time.</p>
        ) : (
          offered && !(offered.get(ymdKey(picked))?.length) ? (
            <p className="m-0 rounded-[12px] border border-dashed border-[var(--border-strong)] px-4 py-6 text-center text-sm text-[var(--muted)]">No open times this day. The days with a dot have some.</p>
          ) : (
          <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {(offered ? offered.get(ymdKey(picked)) ?? [] : TIMES).map((minutes) => {
              const past = isToday && minutes <= nowMinute;
              const on = current !== null && ymdKey(current.day) === ymdKey(picked) && current.minute === minutes;
              return (
                <button
                  key={minutes}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled || past}
                  onClick={() => write(picked, minutes)}
                  className={cn(
                    "h-9 rounded-lg border text-sm font-semibold tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                    on ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "border-[var(--border-strong)] text-[var(--ink)] hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]",
                  )}
                >
                  {timeLabel(minutes)}
                </button>
              );
            })}
          </div>
          )
        )}
      </div>
    </div>
  );
}
