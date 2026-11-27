import { createContext, useContext } from "react";

/**
 * What the bar and the shared states need to know about the session, apart from the session itself, so the kit
 * (components/ui.tsx) can read it without importing lib/session (which screens' tests replace wholesale):
 *
 *   offline   the last request got no answer (L4) — the bar's "Offline · 3 to send" mark
 *   toSend    notes, outcomes and answers waiting on the phone (lib/outbox.ts)
 *   readOnly  the agency is paused, suspended or read-only (M6), in the server's words where it said them —
 *             the bar's "Read only" mark, and write buttons are disabled
 *   role      who is looking: "You can fix it" for the owner, "Your agency owner can" for everyone else
 *
 * The agency session provides it (lib/session.tsx), the partner session its own (components/partner/session.tsx).
 * With no provider (a test that renders one screen) nothing is marked and nothing is disabled.
 */
export type BarState = {
  offline: boolean;
  toSend: number;
  readOnly: { code: string; message: string } | null;
  role: string | null;
};

export const NO_BAR_STATE: BarState = { offline: false, toSend: 0, readOnly: null, role: null };

export const BarStateContext = createContext<BarState>(NO_BAR_STATE);

export function useBarState(): BarState {
  return useContext(BarStateContext);
}

/** "Offline", "Offline · 3 to send" (board L4). */
export function offlineLabel(toSend: number): string {
  return toSend > 0 ? `Offline · ${toSend} to send` : "Offline";
}

/** The owner (or an agency admin) fixes billing; everyone else is told who can. */
export function ownsAgency(role: string | null): boolean {
  return role === "owner" || role === "admin";
}

/** M6: the words for a read-only agency the app learned about from /me (no refusal yet to quote). */
export const READ_ONLY_WORDS = "You can still read your leads, policies and pay, but not make changes.";
