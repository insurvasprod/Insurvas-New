"use client";

/**
 * The reason sent with a reveal of an SSN or a bank / card number (audit 2026-10-16).
 *
 * Owner 2026-10-28: the agent is not asked why any more — Reveal shows the number, Hide masks it
 * again. The server still refuses a reveal without a reason (lib/applications/revealReason.ts) and
 * still writes the access record (who, when, which field), so every reveal goes with the same fixed
 * reason, REVEAL_REASON_ON_SCREEN.
 *
 *   const { ask, dialog } = useRevealReason();
 *   const reason = await ask("SSN");   // never null now; kept so callers need not change
 *   ...render {dialog} once in the component (renders nothing).
 */

import { useCallback, type ReactNode } from "react";

import { REVEAL_REASON_ON_SCREEN } from "@/lib/applications/revealReason";

export function useRevealReason(): { ask: (label: string) => Promise<string | null>; dialog: ReactNode } {
  // The label is no longer shown anywhere; callers still pass it.
  const ask = useCallback(async (): Promise<string | null> => REVEAL_REASON_ON_SCREEN, []);
  return { ask, dialog: null };
}
