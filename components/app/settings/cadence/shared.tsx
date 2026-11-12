"use client";

/**
 * Settings › Dialing cadence (round 8, board A) — the small parts the page, the call popover and the
 * campaign sheet share: the joined segmented switch, the max-calls stepper, the status line, the call
 * dot, and the calling windows the timeline shades (read from /api/app/calling-windows, never edited
 * here: Calling windows owns them).
 */

import { useEffect, useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SWITCH_FRAME, switchOption } from "@/components/ui/view-tabs";
import { FEDERAL_MINUTES, campaignMinutes, minuteLabel, toMinutes, type CallingWindowSettings } from "@/lib/callingWindow/engine";
import type { CallingRules } from "@/lib/cadence/timeline";
import { cn } from "@/lib/utils";

/* ── segmented switch (the board's .seg) ───────────────────────────────── */

export function Seg<K extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  className,
}: {
  label: string;
  options: ReadonlyArray<{ key: K; label: string; title?: string; disabled?: boolean }>;
  value: K | null;
  onChange: (key: K) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn(SWITCH_FRAME, "max-w-full overflow-x-auto", className)}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={value === option.key}
          title={option.title}
          disabled={disabled || option.disabled}
          onClick={() => onChange(option.key)}
          className={switchOption(value === option.key, "h-8 shrink-0 px-3 text-sm font-medium")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ── stepper (− value +) ───────────────────────────────────────────────── */

export function Stepper({
  id,
  label,
  value,
  min,
  max,
  onChange,
  disabled = false,
  title,
  invalid = false,
  placeholder,
  text,
  onText,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  title?: string;
  invalid?: boolean;
  placeholder?: string;
  /** The typed text, when the field may be blank (max calls: blank = inherit). */
  text?: string;
  onText?: (text: string) => void;
}) {
  return (
    <span title={title} className={cn("inline-flex h-9 shrink-0 items-center overflow-hidden rounded-md border bg-card", invalid ? "border-[var(--error-ink)]" : "border-border")}>
      <Button type="button" variant="ghost" size="icon-sm" className="rounded-none" aria-label={`Fewer: ${label}`} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus aria-hidden="true" />
      </Button>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={text ?? String(value)}
        onChange={(event) => (onText ? onText(event.target.value) : onChange(Number(event.target.value) || min))}
        className="h-full w-11 border-x border-border bg-transparent text-center text-sm font-semibold text-[var(--ink)] tabular-nums outline-none [appearance:textfield] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <Button type="button" variant="ghost" size="icon-sm" className="rounded-none" aria-label={`More: ${label}`} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus aria-hidden="true" />
      </Button>
    </span>
  );
}

/* ── status line (no notice cards: owner rule 2026-11-02) ───────────────── */

export type StatusTone = "good" | "warning" | "danger" | "neutral";
const DOT: Record<StatusTone, string> = {
  good: "bg-[var(--success)]",
  warning: "bg-[var(--warning)]",
  danger: "bg-[var(--error)]",
  neutral: "bg-[var(--muted)]",
};

export function StatusLine({ tone, children, action }: { tone: StatusTone; children: ReactNode; action?: ReactNode }) {
  return (
    <p role="status" className={cn("m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-[1.5]", tone === "danger" ? "text-[var(--error-ink)]" : "text-[var(--muted)]")}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} />
      <span className="min-w-0">{children}</span>
      {action}
    </p>
  );
}

/* ── a call on the timeline ────────────────────────────────────────────── */

export type DotLook = "call" | "moved" | "ghost" | "own";

export function dotClass(look: DotLook, size: "md" | "sm" = "md", selected = false) {
  return cn(
    "relative inline-grid shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums",
    size === "md" ? "size-7" : "size-[22px]",
    look === "ghost"
      ? "border-[1.5px] border-dashed border-[var(--border-strong)] bg-transparent text-[var(--muted)]"
      : look === "own"
        ? "bg-[var(--info-surface)] text-[var(--info-ink)] shadow-[0_0_0_3px_var(--surface)]"
        : "bg-[var(--primary)] text-[var(--on-primary)] shadow-[0_0_0_3px_var(--surface)]",
    look === "moved" && "shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--warning)]",
    selected && "shadow-[0_0_0_3px_var(--surface),0_0_0_5px_var(--ring-color)]",
  );
}

/** The no-call stripe (the board's .blk), drawn from tokens. */
export const STRIPE = { backgroundImage: "repeating-linear-gradient(135deg, var(--surface-alt) 0 6px, transparent 6px 12px)" } as const;
/** Outside one campaign's hours (the board's .part). */
export const PART_STRIPE = { backgroundImage: "repeating-linear-gradient(135deg, var(--warning-surface) 0 6px, transparent 6px 12px)" } as const;

/* ── calling windows, read only ────────────────────────────────────────── */

export type CallingSettings = CallingWindowSettings & { canEdit?: boolean };

/** Loaded once per page; null while loading, "error" when it could not be read. */
export function useCallingWindows(): CallingSettings | null | "error" {
  const [settings, setSettings] = useState<CallingSettings | null | "error">(null);
  useEffect(() => {
    let live = true;
    fetch("/api/app/calling-windows", { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as CallingSettings) : Promise.reject(new Error("unavailable"))))
      .then((body) => live && setSettings(body))
      .catch(() => live && setSettings("error"));
    return () => {
      live = false;
    };
  }, []);
  return settings;
}

/**
 * The rules the example lead is held to: the agency's hours (federal 8am–9pm when it has none), a
 * campaign's narrowing while campaigns may narrow, no Sundays and no federal holidays when switched
 * on. State statutes are left out on purpose: they depend on the lead's state.
 */
export function callingRules(settings: CallingSettings | null | "error", campaignId: string | null): CallingRules & { campaignWindow: { start: number; end: number } | null } {
  if (!settings || settings === "error")
    return { window: { ...FEDERAL_MINUTES }, noSunday: false, noHolidays: false, holidays: {}, campaignWindow: null };
  let window = settings.tenant ? toMinutes(settings.tenant) : { ...FEDERAL_MINUTES };
  window = { start: Math.max(window.start, FEDERAL_MINUTES.start), end: Math.min(window.end, FEDERAL_MINUTES.end) };
  let campaignWindow: { start: number; end: number } | null = null;
  const campaign = campaignId && settings.options.campaignOverrides ? settings.campaigns.find((entry) => entry.id === campaignId) : undefined;
  const narrowing = campaign ? campaignMinutes(campaign) : null;
  if (narrowing) {
    campaignWindow = { start: Math.max(window.start, narrowing.start ?? window.start), end: Math.min(window.end, narrowing.end ?? window.end) };
    window = campaignWindow;
  }
  const holidays: Record<string, string> = {};
  for (const holiday of settings.federalHolidays ?? []) holidays[holiday.date] = holiday.name;
  return { window, noSunday: settings.options.noSunday, noHolidays: settings.options.noFederalHolidays, holidays, campaignWindow };
}

/** "9am–8pm, no Sundays, no federal holidays" */
export function windowWords(rules: CallingRules): string {
  const hours = `${compact(rules.window.start)}–${compact(rules.window.end)}`;
  const days = [rules.noSunday ? "no Sundays" : null, rules.noHolidays ? "no federal holidays" : null].filter(Boolean);
  return [hours, ...days].join(", ");
}

export function compact(minutes: number) {
  return minuteLabel(minutes).replace(" ", "").replace(":00", "");
}

/** The example's first day: the next Monday after `today` (local date), as YYYY-MM-DD. */
export function nextMonday(today: Date): string {
  const date = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const add = ((8 - date.getUTCDay()) % 7) || 7;
  date.setUTCDate(date.getUTCDate() + add);
  return date.toISOString().slice(0, 10);
}
