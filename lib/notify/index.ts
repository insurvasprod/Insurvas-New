"use client";

import { createElement, Fragment } from "react";
import { Check, CircleAlert, Inbox, Sparkles, TriangleAlert, X } from "lucide-react";
import { sileo, type SileoOptions, type SileoState } from "sileo";

import { playFor, setCallInProgress } from "./sound";
import { detailFor } from "./suggest.ts";
import type { Treatment } from "./treatments.ts";

/**
 * Six treatments, not one per event.
 *
 * The product raises 194 distinct audited actions and had two ways of saying so: a green box and a
 * red one. A lead importing looked like a licence expiring; a validation typo looked like a
 * database outage. This is the vocabulary that tells them apart.
 *
 * Sound is deliberately NOT decided here. This file names what happened; `./sound` owns every rule
 * about whether that makes a noise — silent during a live call, rate limited, primed after the
 * first interaction, off unless this person asked for it. Keeping the two apart is why a treatment
 * can be renamed or added without anyone reasoning about audio, and why the audio rules can be
 * tested without a browser.
 *
 * The scarce resource is the agent's attention, not screen space. Most things that happen get
 * `done`, which is silent by design and always will be: a chime for every save is a chime nobody
 * hears, and then they also miss the dropped transfer.
 */

export type { Treatment };

export type NotifyOptions = {
  /** One sentence under the title. What happened, or what to do about it. */
  detail?: string;
  /** A way to act on it. A toast that reports a problem and offers nothing is half a message. */
  action?: { label: string; onClick: () => void };
  /** Overrides the treatment's duration. Rarely the right call — the durations are the design. */
  durationMs?: number;
};

// How long each stays. Longer for anything the reader has to act on, because dismissing a blocker
// before it has been read is the same as never showing it.
const DURATION: Record<Treatment, number> = {
  win: 6000,
  arrive: 6000,
  done: 3000,
  warn: 8000,
  block: 10000,
  fail: 10000,
};

// 2026-10-28: drawn by Sileo (components/ui/toaster.tsx), owner pick. Six treatments onto Sileo's
// states; `win` and `arrive` get their own icon (and `win` the brand green, app/globals.css) so a
// sale never looks like a save and new work never looks like a heads-up.
const LOOK: Record<Treatment, { state: SileoState; Icon: typeof Check; label: string }> = {
  win: { state: "success", Icon: Sparkles, label: "Success" },
  arrive: { state: "info", Icon: Inbox, label: "New work" },
  done: { state: "success", Icon: Check, label: "Done" },
  warn: { state: "warning", Icon: CircleAlert, label: "Heads up" },
  block: { state: "error", Icon: X, label: "Not allowed" },
  fail: { state: "error", Icon: TriangleAlert, label: "Something went wrong" },
};

// The pill holds one line, about this many characters at Sileo's 350px. A longer title moves into
// the opened body, in full, and the pill shows the treatment's label instead of a clipped sentence.
const PILL_CHARS = 42;

// Sileo keeps one toast per id and morphs it into the next one. That is the look for routine
// saves, so every `done` shares an id. Anything else gets its own, so a save a second later cannot
// morph a blocker away before it has been read.
let sequence = 0;

// `into` is passed only by `promise`, to morph its own loading toast into the outcome.
function show(treatment: Treatment, title: string, options: NotifyOptions = {}, into?: string) {
  playFor(treatment);
  const look = LOOK[treatment];
  const duration = options.durationMs ?? DURATION[treatment];
  // A problem always says what to do next: the caller's detail, else a suggestion read from the
  // title (./suggest).
  const detail = detailFor(treatment, title, options.detail);
  const id = into ?? (treatment === "done" ? "notify-done" : `notify-${treatment}-${++sequence}`);
  const long = title.length > PILL_CHARS;
  const body = long || detail
    ? createElement(Fragment, null, long ? createElement("strong", null, title) : null, detail ?? null)
    : undefined;
  const tone = treatment === "win" ? "notify-win" : undefined;
  const opts: SileoOptions & { id: string } = {
    id,
    title: long ? look.label : title,
    description: body,
    duration,
    // Opens at once and closes a second before it leaves, so a 3 s `done` shows its detail for 2 s.
    autopilot: { expand: 150, collapse: Math.max(0, duration - 1000) },
    // The label is for a screen reader: the badge's colour and glyph say it to everyone else.
    icon: createElement(Fragment, null, createElement(look.Icon, { "aria-hidden": true, className: "size-3.5", strokeWidth: 2.5 }), createElement("span", { className: "sr-only" }, `${look.label}: `)),
    styles: tone ? { badge: tone, title: tone, button: tone } : undefined,
    button: options.action
      ? { title: options.action.label, onClick: () => { options.action?.onClick(); sileo.dismiss(id); } }
      : undefined,
  };
  sileo.show({ ...opts, type: look.state });
}

/** How a `promise` toast ends: a title, or a title with the usual options and a treatment. */
export type NotifyOutcome<K extends Treatment> = string | ({ title: string; treatment?: K } & NotifyOptions);

export type NotifyPromiseOptions<T> = {
  /** Shown while it runs, with Sileo's spinner: "Importing 50 leads…". */
  loading: string;
  /** Defaults to `done`; a sale says `treatment: "win"`, one that worked with a catch `"warn"`. */
  done: NotifyOutcome<"done" | "win" | "warn"> | ((data: T) => NotifyOutcome<"done" | "win" | "warn">);
  /**
   * Defaults to `fail`; a refusal the reader can fix says `treatment: "block"`, a partial one
   * `"warn"`. Left out, it is "Something went wrong" with the usual suggested next step. `null`: the
   * spinner just goes, for a form that shows the error beside the field to fix (UI-CONSISTENCY §11:
   * never a toast for an error the user must fix).
   */
  fail?: NotifyOutcome<"warn" | "block" | "fail"> | null | ((error: unknown) => NotifyOutcome<"warn" | "block" | "fail"> | null);
};

/**
 * One toast for work that takes a while (2026-10-28, owner request): a spinner while it runs, then
 * the same toast morphs into the outcome, so the reader sees one thing finish instead of a
 * "saving…" line and a second toast. The outcome goes through `show`, so it keeps every rule above:
 * its treatment's sound, duration, icon and suggested next step.
 *
 * Returns the work's own promise, unchanged: it still rejects, so the caller's error handling
 * stays the caller's. Not Sileo's `promise`, which can only end in success or error and has no
 * `warn` or `block`.
 */
function promise<T>(work: Promise<T> | (() => Promise<T>), options: NotifyPromiseOptions<T>): Promise<T> {
  const id = `notify-promise-${++sequence}`;
  sileo.show({ id, title: options.loading, type: "loading", duration: null } as SileoOptions & { id: string });
  const end = <K extends Treatment>(fallback: K, outcome: NotifyOutcome<K> | null) => {
    if (outcome === null) return sileo.dismiss(id);
    const { title, treatment, ...rest } = typeof outcome === "string" ? { title: outcome } : outcome;
    show(treatment ?? fallback, title, rest, id);
  };
  // A caller's mapping function that throws must not leave the spinner up for good.
  const settle = (run: () => void) => { try { run(); } catch { show("fail", "Something went wrong", {}, id); } };
  const running = typeof work === "function" ? work() : work;
  running.then(
    (data) => settle(() => end("done", typeof options.done === "function" ? options.done(data) : options.done)),
    (error: unknown) => settle(() => end("fail", typeof options.fail === "function" ? options.fail(error) : options.fail === undefined ? "Something went wrong" : options.fail)),
  );
  return running;
}

export const notify = {
  /**
   * A spinner while `work` runs, then the outcome in the same toast. For imports, uploads and saves
   * that take long enough to wonder about; an instant save is still `done`.
   */
  promise,

  /** Money or a conversion. The only treatment that will ever sound like a reward. */
  win: (title: string, options?: NotifyOptions) => show("win", title, options),

  /** Work has landed and someone has to pick it up. */
  arrive: (title: string, options?: NotifyOptions) => show("arrive", title, options),

  /** Routine success — saved, updated, imported. Silent, permanently. */
  done: (title: string, options?: NotifyOptions) => show("done", title, options),

  /** It worked, and there is something the reader needs to know about how. */
  warn: (title: string, options?: NotifyOptions) => show("warn", title, options),

  /** Refused, and the reader has to do something. Say what, in `detail`. */
  block: (title: string, options?: NotifyOptions) => show("block", title, options),

  /**
   * Something broke and it is not the reader's fault — a 5xx, an RPC that is down, a dropped
   * connection. Since 2026-10-22 it plays the softest tone in the set (owner request), still capped
   * by the rate limit so an outage cannot fire in bursts, and still silent during a live call.
   */
  fail: (title: string, options?: NotifyOptions) => show("fail", title, options),
};

/**
 * Tell the notifier a call attempt is open or closed.
 *
 * While it is open every treatment except `block` is silenced. An agent is on the phone with a
 * customer; a chime for a colleague's sale, audible down the line, is worse than no notification
 * at all. `block` survives because it is the one class that means *stop talking to this person* —
 * outside the calling window, DNC, no disclosure.
 *
 * Exported from here rather than from `sound` so a caller never has to know the sound layer exists.
 */
export { setCallInProgress };
