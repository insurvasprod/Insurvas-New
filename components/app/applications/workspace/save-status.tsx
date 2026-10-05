"use client";

/**
 * The one-line save state a step shows beside its work: "Saving…" while anything is in flight, the
 * server's error when the last save failed (what was typed stays on screen), and "Saved" once this
 * step has saved something. Reads the workspace's shared `saving` / `saveError`.
 */

import { cn } from "@/lib/utils";

import { useWorkspace } from "./context";

export function SaveStatus({ touched, pendingNote, className }: {
  /** This step has sent something; before that, nothing is shown. */
  touched: boolean;
  /** Shown instead of "Saved" when the step is holding a change it cannot send yet. */
  pendingNote?: string | null;
  className?: string;
}) {
  const { saving, saveError } = useWorkspace();
  let text: string | null = null;
  let tone = "text-muted-foreground";
  if (saving) text = "Saving…";
  else if (saveError && (touched || pendingNote)) { text = saveError; tone = "text-[var(--error-ink)]"; }
  else if (pendingNote) { text = pendingNote; tone = "text-[var(--warning-ink)]"; }
  else if (touched) text = "Saved";
  if (!text) return null;
  return (
    <span role="status" aria-live="polite" title={text} className={cn("min-w-0 truncate text-sm", tone, className)}>
      {text}
    </span>
  );
}
