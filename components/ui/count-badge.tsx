"use client";

import { useEffect, useState } from "react";

import { CountUp } from "@/components/ui/count-up";
import { cn } from "@/lib/utils";

import { motionMs, reducedMotion, ROLL_MS } from "./motion-tokens";

function figure(n: number, max?: number, compact?: boolean) {
  if (max !== undefined && n > max) return `${max.toLocaleString("en-US")}+`;
  if (compact && n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return n.toLocaleString("en-US");
}

/**
 * A count on a rail step, a tab or the bell (Tier 1 motion, 2026-11-17; app-wide in Wave A): it pops in when it
 * appears after the page is up (a count that was already there on the first paint arrives with the calm cascade, not
 * with a pop of its own), its number rolls when the value changes (CountUp's ease-out, `changesOnly`, so it never
 * counts up on a page opening), and at 0 it shrinks away instead of vanishing. `label` names it for a screen reader:
 * "3 to do".
 *
 * `tone="warning"` is the rails' amber "waits on a person" badge; `tone="bare"` draws nothing of its own, for a badge
 * whose look is a class (the top bar's `portal-top-badge`). `max` caps the figure ("99+"); `compact` shortens a big
 * one ("12.8k") so a rail badge stays one short pill.
 */
export function CountBadge({ value, label, tone = "neutral", max, compact = false, className }: {
  value: number;
  label?: string;
  tone?: "neutral" | "action" | "danger" | "warning" | "bare";
  max?: number;
  compact?: boolean;
  className?: string;
}) {
  // The last count above 0, so the badge shrinks away still showing it.
  const [last, setLast] = useState(value);
  if (value > 0 && value !== last) setLast(value);
  const [gone, setGone] = useState(value <= 0);
  if (value > 0 && gone) setGone(false);
  // On screen since the first paint: it came in with the page, so it does not pop. Once it has left, it pops back.
  const [settled, setSettled] = useState(value > 0);
  if (value <= 0 && settled) setSettled(false);

  useEffect(() => {
    if (value > 0) return;
    const timer = window.setTimeout(() => setGone(true), reducedMotion() ? 0 : motionMs("--t-float-out", 120));
    return () => window.clearTimeout(timer);
  }, [value]);

  if (gone) return null;
  const leaving = value <= 0;
  return (
    <span
      data-count-badge=""
      data-state={leaving ? "leaving" : settled ? undefined : "entering"}
      aria-label={label}
      className={cn(
        tone !== "bare" && "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-badge px-1.5 text-xs leading-none tabular-nums",
        tone === "danger" ? "bg-[var(--error-surface)] text-[var(--error-ink)]"
          : tone === "action" ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]"
            : tone === "warning" ? "h-5 min-w-[22px] rounded-full px-[7px] font-bold bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-[var(--warning-ink)]"
              : tone === "neutral" ? "bg-[var(--surface-alt)] text-muted-foreground" : null,
        className,
      )}
    >
      <CountUp text={figure(leaving ? last : value, max, compact)} changesOnly duration={ROLL_MS} />
    </span>
  );
}
