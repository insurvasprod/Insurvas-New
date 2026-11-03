"use client";

import type { ReactNode } from "react";
import { Archive, Check, Pause, Pencil, Radio, ShieldCheck, Upload } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A campaign's way to serving leads, as icons (owner /ui-taste critique, 2026-10-29): its list in,
 * scrubbed, live. A done step is a green tick, the step in hand is highlighted, the ones to come are
 * muted. A paused or exhausted campaign adds a dimmed fourth state after the track.
 */
export type LifecycleStep = { key: string; label: string; icon: ReactNode };
/** How the step in hand is going: a scrub that is running, stalled, or stopped by an outage. */
export type StepTone = "busy" | "warning" | "danger" | null;
export type LifecycleOff = "paused" | "exhausted" | null;

export const CAMPAIGN_STEPS: LifecycleStep[] = [
  { key: "list", label: "List in", icon: <Upload aria-hidden="true" /> },
  { key: "scrub", label: "Scrubbed", icon: <ShieldCheck aria-hidden="true" /> },
  { key: "live", label: "Live", icon: <Radio aria-hidden="true" /> },
];
/** The New campaign dialog: the draft it creates comes first. */
export const NEW_CAMPAIGN_STEPS: LifecycleStep[] = [{ key: "draft", label: "Draft", icon: <Pencil aria-hidden="true" /> }, ...CAMPAIGN_STEPS];

const CURRENT: Record<"default" | Exclude<StepTone, null>, string> = {
  default: "border-[var(--accent-ink)] bg-[var(--primary-soft)] text-[var(--accent-ink)]",
  busy: "border-[var(--info-ink)] bg-[var(--info-surface)] text-[var(--info-ink)]",
  warning: "border-[var(--warning-ink)] bg-[var(--warning-surface)] text-[var(--warning-ink)]",
  danger: "border-[var(--error-ink)] bg-[var(--error-surface)] text-[var(--error-ink)]",
};

/**
 * `current`: the index of the step in hand, or `steps.length` when every step is done. `labels`
 * draws each step's name beside its icon (the panel and the dialog); the table row keeps icons only,
 * with the names as titles and for screen readers.
 */
export function LifecycleTrack({ steps = CAMPAIGN_STEPS, current, tone = null, off = null, labels = false, className }: {
  steps?: LifecycleStep[];
  current: number;
  tone?: StepTone;
  off?: LifecycleOff;
  labels?: boolean;
  className?: string;
}) {
  return <ol aria-label="Campaign stage" className={cn("m-0 flex list-none flex-wrap items-center gap-1 p-0", className)}>
    {steps.map((step, index) => {
      const state = index < current ? "done" : index === current ? "current" : "upcoming";
      const said = state === "done" ? "done" : state === "current" ? "next" : "to come";
      return <li key={step.key} className="flex items-center gap-1" aria-current={state === "current" ? "step" : undefined}>
        {index > 0 && <span aria-hidden="true" className={cn("h-px w-2", index <= current ? "bg-[var(--success-ink)]" : "bg-[var(--border-strong)]")} />}
        <span
          title={`${step.label} · ${said}`}
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full border [&_svg]:size-3.5",
            state === "done" ? "border-transparent bg-[var(--success-surface)] text-[var(--success-ink)]"
              : state === "current" ? CURRENT[tone ?? "default"]
                : "border-dashed border-[var(--border-strong)] text-[var(--muted)]",
            state === "current" && tone === "busy" && "[&_svg]:motion-safe:animate-pulse",
          )}
        >
          {state === "done" ? <Check aria-hidden="true" /> : step.icon}
        </span>
        {labels
          ? <span className={cn("text-xs", state === "upcoming" ? "text-[var(--muted)]" : state === "current" ? "font-semibold text-[var(--ink)]" : "text-[var(--body)]")}>{step.label}<span className="sr-only"> · {said}</span></span>
          : <span className="sr-only">{step.label}: {said}</span>}
      </li>;
    })}
    {off && <li className="ml-1 flex items-center gap-1 opacity-60">
      <span title={off === "paused" ? "Paused" : "Exhausted"} className="grid size-6 shrink-0 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-alt)] text-[var(--body)] [&_svg]:size-3.5">
        {off === "paused" ? <Pause aria-hidden="true" /> : <Archive aria-hidden="true" />}
      </span>
      {labels ? <span className="text-xs text-[var(--body)]">{off === "paused" ? "Paused" : "Exhausted"}</span> : <span className="sr-only">{off === "paused" ? "Paused" : "Exhausted"}</span>}
    </li>}
  </ol>;
}
