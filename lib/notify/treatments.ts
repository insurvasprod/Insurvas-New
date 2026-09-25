/**
 * The vocabulary itself: no React, no sonner, no Web Audio, no `server-only`.
 *
 * Deliberately importable from anywhere. The treatment list is now a fact the database validates
 * and the server persists, as well as one the browser plays sounds for — and the moment a server
 * module needs it, importing from `./sound` (which is `"use client"`) would compile cleanly under
 * `tsc` and fail only at `next build`. That trap has already been sprung once in this codebase.
 */

export type Treatment = "win" | "arrive" | "done" | "warn" | "block" | "fail";

/** Every treatment, in the order they are presented to a reader: best news first. */
export const TREATMENTS: readonly Treatment[] = ["win", "arrive", "done", "warn", "block", "fail"];

/**
 * Which treatments will ever make a noise.
 *
 * `done` and `fail` are absent deliberately and permanently. A chime for every routine save is a
 * chime nobody hears, and then they also miss the dropped transfer; a noise for a server fault
 * teaches people to feel responsible for infrastructure and fires in bursts on the worst days.
 */
export const AUDIBLE: readonly Treatment[] = ["win", "arrive", "warn", "block"];

/**
 * On by default. `warn` is the only audible treatment left opt-in.
 *
 * `block` was added 2026-09-23. It is the one class allowed through a live call, because it means
 * stop talking to this person — outside the calling window, on a DNC list, no disclosure read. That
 * exception is worthless if nobody has the sound switched on, which is what shipping it opt-in
 * amounted to: the single sound an agent most needs to hear mid-conversation was the one silenced
 * by default.
 */
export const AUDIBLE_BY_DEFAULT: readonly Treatment[] = ["win", "arrive", "block"];

/** What each treatment means, for anywhere a person is choosing between them. */
export const TREATMENT_LABELS: Record<Treatment, { label: string; hint: string }> = {
  win: { label: "Sales and conversions", hint: "An application submitted, an appointment booked, a policy issued." },
  arrive: { label: "Work arriving", hint: "A lead assigned to you, a handoff offered, a callback due." },
  done: { label: "Routine success", hint: "Saved, updated, imported. Never makes a sound." },
  warn: { label: "Worked, with a caveat", hint: "It went through, and there is something you should know." },
  block: { label: "Compliance and refusals", hint: "Outside the calling window, on a DNC list, missing a disclosure." },
  fail: { label: "System faults", hint: "Something broke and it was not your doing. Never makes a sound." },
};
