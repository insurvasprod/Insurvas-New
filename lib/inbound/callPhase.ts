/**
 * Inbound's five steps (owner 2026-10-28), shared by the server page, the step bar and the top bar's
 * crumb, so a plain module (no "use client"): 1 Incoming calls (on /app/inbound), then on
 * /app/inbound/call/<id> 2 Caller profile, 3 Verification, 4 Application and 5 Finish the call.
 * Renamed the same day from Take a caller, Transfer check and Underwriting (owner); the `?phase=`
 * names stay as they were, so links keep working.
 */
export const INBOUND_STEPS = ["Incoming calls", "Caller profile", "Verification", "Application", "Finish the call"] as const;

/** The call page's steps, as `?phase=` names them (the application inside keeps its own `?step=`). */
export const CALL_PHASES = ["check", "verify", "underwriting", "finish"] as const;
export type CallPhase = (typeof CALL_PHASES)[number];

/** The phase an address asks for: `?phase=`, or the older `?step=finish`; Transfer check by default. */
export function phaseOf(search: { phase?: string | null; step?: string | null }): CallPhase {
  const phase = search.phase ?? null;
  if ((CALL_PHASES as readonly string[]).includes(phase ?? "")) return phase as CallPhase;
  return search.step === "finish" ? "finish" : "check";
}

/** The step bar's index for a phase (Take a caller is 0). */
export const phaseIndex = (phase: CallPhase) => CALL_PHASES.indexOf(phase) + 1;

/** The top bar's crumb for the call page (Inbound › Caller profile). */
export const phaseLabel = (phase: CallPhase) => INBOUND_STEPS[phaseIndex(phase)];
