"use client";

/**
 * Settings history · the date filter (board section 3): one chip naming the range, opening presets
 * (Today, Last 7 / 30 / 90 days, This month, All time) and "Pick dates" — a from and a to, applied
 * together. The chip is tinted whenever it narrows the list.
 */

import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { control } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MONTHS } from "@/lib/format/dates";
import { shiftDay } from "./parts";

export type RangeKey = "today" | "7d" | "30d" | "90d" | "month" | "all" | "custom";
export type DateRange = { key: RangeKey; from: string; to: string };

const PRESETS: ReadonlyArray<{ key: Exclude<RangeKey, "custom">; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
];

/** A preset's from/to, as calendar days, counted back from `today`. */
export function presetRange(key: Exclude<RangeKey, "custom">, today: string): DateRange {
  switch (key) {
    case "today": return { key, from: today, to: today };
    case "7d": return { key, from: shiftDay(today, -6), to: today };
    case "30d": return { key, from: shiftDay(today, -29), to: today };
    case "90d": return { key, from: shiftDay(today, -89), to: today };
    case "month": return { key, from: `${today.slice(0, 8)}01`, to: today };
    default: return { key: "all", from: "", to: "" };
  }
}

const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, label: `${MONTHS[m - 1]} ${d}` };
};

/** "Last 30 days", "Oct 1 – Nov 12", "Since Oct 1". */
export function rangeLabel(range: DateRange): string {
  const preset = PRESETS.find((p) => p.key === range.key);
  if (preset) return preset.label;
  if (range.from && range.to) return range.from === range.to ? day(range.from).label : `${day(range.from).label} – ${day(range.to).label}`;
  if (range.from) return `Since ${day(range.from).label}`;
  if (range.to) return `Until ${day(range.to).label}`;
  return "All time";
}

/** "in the last 30 days", "from Oct 1 to Nov 12", "" for all time — for the status line. */
export function rangePhrase(range: DateRange): string {
  switch (range.key) {
    case "today": return "today";
    case "7d": return "in the last 7 days";
    case "30d": return "in the last 30 days";
    case "90d": return "in the last 90 days";
    case "month": return "this month";
    case "all": return "";
    default: return range.from && range.to ? `from ${day(range.from).label} to ${day(range.to).label}` : rangeLabel(range).toLowerCase();
  }
}

export function DateRangeFilter({ value, today, defaultKey, onChange }: { value: DateRange; today: string; defaultKey: RangeKey; onChange: (next: DateRange) => void }) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const tinted = value.key !== defaultKey;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) { setPicking(value.key === "custom"); setFrom(value.from); setTo(value.to); }
  };
  const pick = (key: Exclude<RangeKey, "custom">) => { onChange(presetRange(key, today)); setOpen(false); };
  const apply = () => {
    const [a, b] = from && to && from > to ? [to, from] : [from, to];
    onChange({ key: "custom", from: a, to: b });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={`Dates: ${rangeLabel(value)}`}
          className={cn("font-normal", tinted && "border-transparent bg-[var(--primary-soft)] font-semibold text-[var(--accent-ink)] hover:bg-[var(--primary-soft)]")}
        >
          <CalendarDays aria-hidden="true" className={tinted ? "text-[var(--accent-ink)]" : "text-[var(--muted)]"} />
          {rangeLabel(value)}
          <ChevronDown aria-hidden="true" className={cn("text-[var(--muted)] transition-transform", open && "rotate-180")} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto max-w-[calc(100vw-2rem)] flex-col gap-3 p-2 sm:flex-row">
        <div role="listbox" aria-label="Date range" className="flex min-w-[150px] flex-col">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              role="option"
              aria-selected={value.key === preset.key}
              onClick={() => pick(preset.key)}
              className={cn("flex h-9 items-center rounded-md px-2.5 text-left text-sm outline-none hover:bg-[var(--surface-alt)] focus-visible:bg-[var(--surface-alt)]", value.key === preset.key ? "font-semibold text-[var(--accent-ink)]" : "text-[var(--body)]")}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            role="option"
            aria-selected={picking}
            onClick={() => setPicking(true)}
            className={cn("flex h-9 items-center rounded-md px-2.5 text-left text-sm outline-none hover:bg-[var(--surface-alt)] focus-visible:bg-[var(--surface-alt)]", picking ? "bg-[var(--surface-alt)] font-semibold text-[var(--ink)]" : "text-[var(--body)]")}
          >
            Pick dates
          </button>
        </div>
        {picking && (
          <div className="flex min-w-[240px] flex-col gap-2 border-t border-[var(--border)] pt-3 sm:border-t-0 sm:border-l sm:pt-1 sm:pl-3">
            <label className="text-xs font-semibold text-[var(--ink)]">
              From
              <input type="date" className={control} value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="text-xs font-semibold text-[var(--ink)]">
              To
              <input type="date" className={control} value={to} min={from || undefined} max={today} onChange={(event) => setTo(event.target.value)} />
            </label>
            <div className="mt-1 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="button" size="sm" disabled={!from && !to} onClick={apply}>Apply</Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
