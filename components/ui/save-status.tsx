"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import { motionMs, reducedMotion } from "./motion-tokens";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** How long "Saved" stays before it fades (Tier 2 motion, 2026-11-17). */
const SAVED_HOLD_MS = 2000;

/**
 * The quiet line beside a form that saves as you go (Tier 2 motion, 2026-11-17): "Saving…", then "✓ Saved" with the
 * tick popping in (`m-pop`), and after 2s it fades away (--t-float-out). An error stays until the next save. The
 * live region is always in the page, so a screen reader hears each change.
 */
export function SaveStatus({ state, savedLabel = "Saved", errorLabel = "Not saved", className }: {
  state: SaveState;
  savedLabel?: string;
  errorLabel?: string;
  className?: string;
}) {
  const [seen, setSeen] = useState(state);
  const [phase, setPhase] = useState<"shown" | "fading" | "gone">("shown");
  if (seen !== state) {
    setSeen(state);
    setPhase("shown");
  }

  useEffect(() => {
    if (state !== "saved") return;
    // The hold is reading time, not motion, so it stays under reduced motion; only the fade is skipped.
    const fading = window.setTimeout(() => setPhase("fading"), SAVED_HOLD_MS);
    const gone = window.setTimeout(() => setPhase("gone"), SAVED_HOLD_MS + (reducedMotion() ? 0 : motionMs("--t-float-out", 120)));
    return () => { window.clearTimeout(fading); window.clearTimeout(gone); };
  }, [state]);

  const body = state === "saving" ? <span className="text-[var(--muted)]">Saving…</span>
    : state === "saved" && phase !== "gone" ? (
      <span className="inline-flex items-center gap-1 text-[var(--success-ink)]">
        <Check aria-hidden="true" className="m-pop size-3.5" strokeWidth={2.5} />{savedLabel}
      </span>
    )
      : state === "error" ? <span title={errorLabel} className="min-w-0 truncate text-[var(--error-ink)]">{errorLabel}</span>
        : null;

  return (
    <span
      role="status"
      aria-live="polite"
      data-save-status=""
      data-state={state === "saved" ? phase : undefined}
      className={cn("inline-flex min-h-5 min-w-0 items-center text-xs", className)}
    >
      {body}
    </span>
  );
}
