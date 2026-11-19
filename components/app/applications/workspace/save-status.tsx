"use client";

/**
 * The one-line save state a step shows beside its work, on the kit's SaveStatus (Wave B, 2026-11-18): "Saving…"
 * while anything is in flight, then "✓ Saved" with the tick popping, gone after 2s; the server's error when the last
 * save failed (what was typed stays on screen, and the line stays until the next save). Reads the workspace's shared
 * `saving` / `saveError`.
 */

import { cn } from "@/lib/utils";
import { SaveStatus as KitSaveStatus, type SaveState } from "@/components/ui/save-status";

import { useWorkspace } from "./context";

export function SaveStatus({ touched, pendingNote, className }: {
  /** This step has sent something; before that, nothing is shown. */
  touched: boolean;
  /** Shown instead of "Saved" when the step is holding a change it cannot send yet. */
  pendingNote?: string | null;
  className?: string;
}) {
  const { saving, saveError } = useWorkspace();
  // A held change is not a save state: it stays, in the warning ink, until the step can send it.
  if (!saving && !(saveError && (touched || pendingNote)) && pendingNote) {
    return <span role="status" aria-live="polite" title={pendingNote} className={cn("min-w-0 truncate text-xs text-[var(--warning-ink)]", className)}>{pendingNote}</span>;
  }
  const state: SaveState = saving ? "saving" : saveError && (touched || pendingNote) ? "error" : touched ? "saved" : "idle";
  return <KitSaveStatus state={state} errorLabel={saveError ?? undefined} className={className} />;
}
