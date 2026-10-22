"use client";

import { useEffect, useRef } from "react";
import { CircleAlert, CircleCheck, Inbox, OctagonX, Sparkles, TriangleAlert, X } from "lucide-react";

import type { Treatment } from "./treatments.ts";

/**
 * The notification card (redesign 2026-10-22, owner: "fix the notifications to look better").
 *
 * One card for all six treatments, told apart by a tinted icon tile and a thin countdown bar in the
 * same tone: an icon tile reads at a glance from the corner of the eye, where a whole coloured box
 * (the old look) only said "green" or "red". The title is the news; the line under it is what to do
 * (lib/notify/suggest.ts writes one for a problem when the caller did not). Hovering pauses the
 * countdown, as sonner pauses the timer.
 */
type Tone = { tile: string; ink: string; bar: string; Icon: typeof CircleCheck; label: string };

const TONES: Record<Treatment, Tone> = {
  win: { tile: "bg-[color-mix(in_srgb,var(--primary)_18%,transparent)]", ink: "text-[var(--accent-ink)]", bar: "bg-[var(--primary)]", Icon: Sparkles, label: "Success" },
  arrive: { tile: "bg-[var(--info-surface)]", ink: "text-[var(--info-ink)]", bar: "bg-[var(--info)]", Icon: Inbox, label: "New work" },
  done: { tile: "bg-[var(--success-surface)]", ink: "text-[var(--success-ink)]", bar: "bg-[var(--success)]", Icon: CircleCheck, label: "Done" },
  warn: { tile: "bg-[var(--warning-surface)]", ink: "text-[var(--warning-ink)]", bar: "bg-[var(--warning)]", Icon: TriangleAlert, label: "Heads up" },
  block: { tile: "bg-[var(--error-surface)]", ink: "text-[var(--error-ink)]", bar: "bg-[var(--error)]", Icon: OctagonX, label: "Not allowed" },
  fail: { tile: "bg-[var(--error-surface)]", ink: "text-[var(--error-ink)]", bar: "bg-[var(--error)]", Icon: CircleAlert, label: "Something went wrong" },
};

export type ToastCardProps = {
  /** Closes this toast (index.ts passes sonner's dismiss: only the vocabulary module imports sonner). */
  onDismiss: () => void;
  treatment: Treatment;
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
  durationMs: number;
};

export function ToastCard({ onDismiss, treatment, title, detail, action, durationMs }: ToastCardProps) {
  const tone = TONES[treatment];
  const bar = useRef<HTMLSpanElement>(null);
  const animation = useRef<Animation | null>(null);
  const problem = treatment === "warn" || treatment === "block" || treatment === "fail";

  useEffect(() => {
    const element = bar.current;
    if (!element || typeof element.animate !== "function" || !Number.isFinite(durationMs)) return;
    animation.current = element.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: durationMs, easing: "linear", fill: "forwards" });
    return () => animation.current?.cancel();
  }, [durationMs]);

  return (
    <div
      role={problem ? "alert" : "status"}
      onMouseEnter={() => animation.current?.pause()}
      onMouseLeave={() => animation.current?.play()}
      className="relative flex w-[360px] max-w-[calc(100vw-32px)] items-start gap-3 overflow-hidden rounded-xl border border-border bg-[var(--color-card)] py-3 pr-2 pl-3 text-foreground shadow-[0_12px_32px_-12px_rgba(16,20,26,.35),0_2px_6px_rgba(16,20,26,.08)]"
    >
      <span aria-hidden="true" className={`mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${tone.tile} ${tone.ink}`}>
        <tone.Icon className="size-4" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <span className="sr-only">{tone.label}: </span>
        <p className="text-sm font-semibold leading-snug tracking-[-0.01em]">{title}</p>
        {detail ? <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{detail}</p> : null}
        {action ? (
          <button
            type="button"
            onClick={() => { action.onClick(); onDismiss(); }}
            className={`mt-2 inline-flex h-8 items-center rounded-full px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone.tile} ${tone.ink} hover:brightness-95`}
          >
            {action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-[var(--surface-alt)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" />
      </button>
      <span ref={bar} aria-hidden="true" className={`absolute inset-x-0 bottom-0 h-[3px] origin-left opacity-70 ${tone.bar}`} />
    </div>
  );
}
