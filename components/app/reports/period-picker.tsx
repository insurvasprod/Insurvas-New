"use client";

import { useState } from "react";

import { toolbarControl } from "@/components/ui/data-toolbar";
import { cn } from "@/lib/utils";

/**
 * The Reports views' one period control (foundation pass 2026-11-03, docs/reports/FOUNDATION-PASS.md):
 * a dropdown of the same windows on every view, and From / To dates beside it for "Custom dates". It sits
 * first in a list's toolbar. A window ends today; the value is plain `YYYY-MM-DD` days, the shared
 * `?from&to` (lib/reports/views.ts).
 */
export const PERIOD_PRESETS = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "180", label: "Last 6 months", days: 180 },
  { key: "365", label: "Last 12 months", days: 365 },
] as const;

export type Period = { from: string; to: string };

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The window of `days` days ending today (today counts as one). */
export function lastDays(days: number, today = new Date()): Period {
  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  return { from: localDay(from), to: localDay(today) };
}

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * Which preset a window is, or "custom". A window the server cut in the agency's time zone can end a day
 * before or after this browser's today; it is still "Last 90 days".
 */
export function presetOf(value: Period, today = new Date()) {
  const span = dayNumber(value.to) - dayNumber(value.from) + 1;
  const drift = Math.abs(dayNumber(value.to) - dayNumber(localDay(today)));
  return PERIOD_PRESETS.find((preset) => preset.days === span && drift <= 1)?.key ?? "custom";
}

export function PeriodPicker({ value, onChange, presets = PERIOD_PRESETS.map((p) => p.key), label = "Period" }: {
  value: Period;
  onChange: (next: Period) => void;
  /** The windows this view offers (a view whose data stops at 90 days leaves the longer ones out). */
  presets?: ReadonlyArray<(typeof PERIOD_PRESETS)[number]["key"]>;
  label?: string;
}) {
  const derived = presetOf(value);
  const [custom, setCustom] = useState(derived === "custom");
  const shown = custom ? "custom" : derived;
  const valid = (next: Period) => /^\d{4}-\d{2}-\d{2}$/.test(next.from) && /^\d{4}-\d{2}-\d{2}$/.test(next.to) && next.from <= next.to;
  return (
    <span className="inline-flex items-center gap-1.5">
      <select aria-label={label} className={toolbarControl} value={shown} onChange={(event) => {
        const key = event.target.value;
        if (key === "custom") { setCustom(true); return; }
        setCustom(false);
        const preset = PERIOD_PRESETS.find((p) => p.key === key);
        if (preset) onChange(lastDays(preset.days));
      }}>
        {PERIOD_PRESETS.filter((p) => presets.includes(p.key) || p.key === derived).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        <option value="custom">Custom dates</option>
      </select>
      {shown === "custom" && (
        <>
          <input type="date" aria-label="From" className={cn(toolbarControl, "w-[150px]")} value={value.from} max={value.to} onChange={(event) => { const next = { ...value, from: event.target.value }; if (valid(next)) onChange(next); }} />
          <span aria-hidden="true" className="text-sm text-muted-foreground">–</span>
          <input type="date" aria-label="To" className={cn(toolbarControl, "w-[150px]")} value={value.to} min={value.from} onChange={(event) => { const next = { ...value, to: event.target.value }; if (valid(next)) onChange(next); }} />
        </>
      )}
    </span>
  );
}
