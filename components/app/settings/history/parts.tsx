"use client";

/**
 * Settings round 8 · Settings history — the small shared parts of the list and the change sheet:
 * the gold avatar, the one kind chip a row carries, the "before → after" sentence, dates in words,
 * and the section names from the Settings registry.
 */

import type { ReactNode } from "react";

import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { MONTHS, clockTime, zonedParts } from "@/lib/format/dates";
import { SETTINGS_SECTIONS } from "@/lib/settings/sections";
import { KIND_LABEL, KIND_TONE, initials, type ChangeKind, type DescribedChange } from "@/lib/settingsAudit/describe";

/** The Settings registry's own name for a section id, for lib/settingsAudit/describe. */
export const registryLabel = (id: string) => SETTINGS_SECTIONS.find((section) => section.id === id)?.label;

/** People are gold (brand rule): two letters on the highlight ground. */
export function Avatar({ name, size = "xs" }: { name: string; size?: "xs" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-[var(--highlight-soft)] font-semibold text-[var(--highlight-ink)]",
        size === "xs" ? "size-[22px] text-xs" : "size-7 text-xs",
      )}
    >
      {initials(name)}
    </span>
  );
}

/** The row's one chip: Changed / Added / Removed / Reset. */
export function KindChip({ kind }: { kind: ChangeKind }) {
  return <StatusChip tone={KIND_TONE[kind]} dot={kind !== "changed"}>{KIND_LABEL[kind]}</StatusChip>;
}

/** "Price band max $14.50 → $15.00", the label in ink and the values in body text. */
export function ChangeWords({ change, short = true }: { change: DescribedChange; short?: boolean }) {
  const cut = (text: string | null) => (text && short ? shortText(text) : text);
  let rest: ReactNode;
  if (change.phrase) rest = <span>{cut(change.phrase)}</span>;
  else rest = <span>{cut(change.before) ?? "nothing"}<span aria-hidden="true" className="mx-1.5 text-[var(--muted)]">→</span><span className="sr-only"> to </span>{cut(change.after) ?? "nothing"}</span>;
  return <><span className="font-medium text-[var(--ink)]">{change.label}</span> {rest}</>;
}

function shortText(text: string, max = 56) {
  if (text.length <= max) return text;
  const quoted = text.startsWith("“") && text.endsWith("”");
  const inner = quoted ? text.slice(1, -1) : text;
  const cut = `${inner.slice(0, max - 2).trimEnd()}…`;
  return quoted ? `“${cut}”` : cut;
}

/* ── dates ──────────────────────────────────────────────────────────────── */

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** "2026-11-12" in the viewer's zone. */
export function dayKey(value: string | Date, zone: string): string {
  const p = zonedParts(value, zone);
  return p ? `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}` : "";
}

const shiftDay = (key: string, days: number) => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export { shiftDay };

/** "Nov 12" (with the year when it is not this year). */
export function shortDate(value: string, zone: string, now = new Date()): string {
  const p = zonedParts(value, zone);
  if (!p) return "";
  const thisYear = zonedParts(now, zone)?.year;
  return `${MONTHS[p.month - 1]} ${p.day}${p.year !== thisYear ? `, ${p.year}` : ""}`;
}

/** The day line over a day's rows: "Today · Thursday, Nov 12", "Tuesday, Nov 10". */
export function dayHeading(key: string, zone: string, now = new Date()): string {
  const today = dayKey(now, zone);
  const p = zonedParts(key, "UTC");
  if (!p) return key;
  const thisYear = zonedParts(now, zone)?.year;
  const name = `${WEEKDAY_LONG[p.weekday]}, ${MONTHS[p.month - 1]} ${p.day}${p.year !== thisYear ? `, ${p.year}` : ""}`;
  if (key === today) return `Today · ${name}`;
  if (key === shiftDay(today, -1)) return `Yesterday · ${name}`;
  return name;
}

/** "2:18 PM". */
export const clock = (value: string, zone: string) => clockTime(value, zone, "12h");

/** "today at 2:18 PM", "yesterday at 4:52 PM", "Nov 10 at 2:15 PM". */
export function whenWords(value: string, zone: string, now = new Date()): string {
  const key = dayKey(value, zone);
  const today = dayKey(now, zone);
  const day = key === today ? "today" : key === shiftDay(today, -1) ? "yesterday" : shortDate(value, zone, now);
  return `${day} at ${clock(value, zone)}`;
}

/** "Thursday, Nov 12, 2026 at 2:18 PM". */
export function fullWhen(value: string, zone: string): string {
  const p = zonedParts(value, zone);
  if (!p) return "";
  return `${WEEKDAY_LONG[p.weekday]}, ${MONTHS[p.month - 1]} ${p.day}, ${p.year} at ${clock(value, zone)}`;
}

/** "12 minutes ago", "3 hours ago", "2 days ago". */
export function agoWords(value: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
