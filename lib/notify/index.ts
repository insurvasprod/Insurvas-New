"use client";

import { toast } from "sonner";

import { NOTIFY_OWNED_CLASS, playFor, setCallInProgress } from "./sound";
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

type Kind = "success" | "info" | "warning" | "error";

const KIND: Record<Treatment, Kind> = {
  win: "success",
  arrive: "info",
  done: "success",
  warn: "warning",
  block: "error",
  fail: "error",
};

function show(treatment: Treatment, title: string, options: NotifyOptions = {}) {
  playFor(treatment);
  toast[KIND[treatment]](title, {
    description: options.detail,
    duration: options.durationMs ?? DURATION[treatment],
    action: options.action ? { label: options.action.label, onClick: options.action.onClick } : undefined,
    // Claims this toast for the sound layer above. PortalFeedbackBridge watches the DOM and would
    // otherwise play a second, contradictory sound off the `data-type` — which cannot tell a `win`
    // from a `done`, and does not know whether a call is open. One authority, marked in the markup.
    className: NOTIFY_OWNED_CLASS,
  });
}

export const notify = {
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
   * connection. Never sounds: a noise for infrastructure teaches people to feel responsible for
   * it, and it would fire in bursts on exactly the days that is least welcome.
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
