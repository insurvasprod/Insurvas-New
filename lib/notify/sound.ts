"use client";

import { AUDIBLE, AUDIBLE_BY_DEFAULT, type Treatment } from "./treatments.ts";

/**
 * The sound layer. Step 1 shipped this silent; step 2 fills it in.
 *
 * It is the single authority on whether the product makes a noise. That matters because there was
 * already a second one: PortalFeedbackBridge watches the DOM for toasts and plays a tone based on
 * the sonner `data-type`. It cannot honour the vocabulary, because `win` and `done` are both
 * `data-type="success"` and are therefore indistinguishable to it — one is the sale the floor
 * exists to make, the other is a field being saved. It also knows nothing about whether a call is
 * open.
 *
 * So toasts raised through `notify` carry NOTIFY_OWNED_CLASS and the bridge skips them. The bridge
 * keeps serving the partner plane and the call sites that have not been migrated yet, and its
 * responsibility shrinks as step 4 proceeds.
 *
 * The rules, decided 2026-09-23:
 *
 *   Silent during a live call, except `block`.   See setCallInProgress.
 *   Personal only.                               A sale chimes for the person who made it, not the
 *                                                floor. Team-wide is a later opt-in, not a default.
 *   `win`, `arrive` and `block` by default.       Only `warn` is opt-in.
 *   `done` and `fail` never sound.               Routine success and infrastructure faults.
 *   One sound per 2 seconds, at most.            A bulk action must not machine-gun.
 *   Never before the first interaction.          Browsers refuse autoplay; an unprimed context
 *                                                swallows the first sound and surprises with the
 *                                                second.
 */

// Re-exported rather than redeclared: the vocabulary is now also a database constraint and a
// server-side default, so it has exactly one home and this is not it.
export { AUDIBLE, AUDIBLE_BY_DEFAULT };
export type { Treatment };

/** No more than one sound in this many milliseconds. */
export const MIN_GAP_MS = 2000;

/**
 * Marks a toast as raised through `notify`, so the legacy DOM observer leaves it alone.
 *
 * Without this the two systems would both fire on every migrated screen: this one by rule, that one
 * by reading the colour off the DOM — and the second would sound for `done` and `fail`, and during
 * calls.
 */
export const NOTIFY_OWNED_CLASS = "notify-owned";

// A call attempt being open is a property of the whole tab, not of one component, so it lives here
// rather than in React state — the dialer sets it, and anything anywhere can be silenced by it.
let callInProgress = false;

export function setCallInProgress(open: boolean) {
  callInProgress = open;
}

export function isCallInProgress() {
  return callInProgress;
}

/* ------------------------------------------------------------------ the decision */

/**
 * Why a sound played, or did not. Returned rather than swallowed, so a silent product can be
 * asked why it is silent — the alternative is a chain of early returns nobody can see into.
 */
export type SoundDecision =
  | "play"
  | "not-audible"
  | "in-call"
  | "unprimed"
  | "muted"
  | "disabled"
  | "silent"
  | "rate-limited";

export type SoundContext = {
  /** Has a real user gesture opened the audio context yet. */
  primed: boolean;
  /** Is a call attempt open in this tab. */
  callOpen: boolean;
  /** User mute or server mute or do-not-disturb — any one of them. */
  muted: boolean;
  /** Has the user turned this particular treatment on. */
  enabled: boolean;
  /** 0-100, already reconciled between the local and server settings. */
  volume: number;
  /** Since the last sound that actually played. */
  msSinceLast: number;
};

/**
 * The whole policy, as one pure function.
 *
 * Every rule that decides whether the product makes a noise lives here and nowhere else, so the
 * policy can be read in one place and tested without a browser. Pulling it out of the player is
 * what makes the rules checkable at all: the player needs an AudioContext, and rules that need a
 * browser to verify are rules that stop being verified.
 *
 * The order is deliberate. The rate limit is LAST, so that a sound nobody was allowed to hear does
 * not consume the window and silence the next one that was allowed — otherwise a muted `win` could
 * swallow a compliance `block` two hundred milliseconds later.
 */
export function decideSound(treatment: Treatment, ctx: SoundContext): SoundDecision {
  if (!AUDIBLE.includes(treatment)) return "not-audible";
  // The rule that matters most. `block` is the exception because it is the only class that means
  // the agent should stop the conversation they are having.
  if (ctx.callOpen && treatment !== "block") return "in-call";
  if (!ctx.primed) return "unprimed";
  if (ctx.muted) return "muted";
  if (!ctx.enabled) return "disabled";
  if (ctx.volume <= 0) return "silent";
  if (ctx.msSinceLast < MIN_GAP_MS) return "rate-limited";
  return "play";
}

/**
 * Whether a treatment could be heard right now, ignoring the user's own preferences.
 *
 * Answers "is this the right moment", not "does this person want it". Kept distinct because
 * collapsing the two would make the call-suppression rule impossible to check without a populated
 * preference store. Expressed through `decideSound` so there is still only one copy of the rule.
 */
export function shouldSound(treatment: Treatment): boolean {
  return (
    decideSound(treatment, {
      primed: true,
      callOpen: callInProgress,
      muted: false,
      enabled: true,
      volume: 100,
      msSinceLast: Number.POSITIVE_INFINITY,
    }) === "play"
  );
}

/* ------------------------------------------------------------------ preferences */

export type SoundPreferences = {
  /** Silences everything, including `block`. The one control that is allowed to. */
  muted: boolean;
  /** 0-100. Shared with the existing portal controls so one volume slider means one thing. */
  volume: number;
  /** Per-treatment opt in. Absent means the AUDIBLE_BY_DEFAULT answer. */
  enabled: Partial<Record<Treatment, boolean>>;
};

const PREFS_KEY = "insurvas.notify-sound.v1";

const DEFAULT_PREFS: SoundPreferences = { muted: false, volume: 70, enabled: {} };

function clampVolume(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 70;
}

export function getSoundPreferences(): SoundPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<SoundPreferences>;
    return {
      muted: raw.muted === true,
      volume: clampVolume(raw.volume),
      enabled: raw.enabled && typeof raw.enabled === "object" ? raw.enabled : {},
    };
  } catch {
    // A corrupt or unreadable store must not silence the product, nor throw inside a toast call.
    return DEFAULT_PREFS;
  }
}

export function saveSoundPreferences(next: SoundPreferences) {
  if (typeof window === "undefined") return;
  const clean = { ...next, volume: clampVolume(next.volume) };
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(clean));
    window.dispatchEvent(new CustomEvent("insurvas:notify-sound-settings", { detail: clean }));
  } catch {
    // Private browsing. The setting applies for this tab and is forgotten, which beats an exception.
  }
}

/**
 * The server-stored master switches, pushed in from the alert feed.
 *
 * Volume and do-not-disturb already live per user on `/api/app/notifications` and already have UI.
 * Reading them here means the existing controls are not lying about what they govern; step 3 adds
 * the per-treatment toggles beside them.
 */
let serverMute = false;
let serverVolume: number | null = null;

export function setServerSoundSettings(settings: {
  sound_muted?: boolean;
  do_not_disturb?: boolean;
  sound_volume?: number;
  sound_treatments?: Partial<Record<Treatment, boolean>>;
}, treatmentsAreAuthoritative = true) {
  serverMute = settings.sound_muted === true || settings.do_not_disturb === true;
  serverVolume = typeof settings.sound_volume === "number" ? clampVolume(settings.sound_volume) : null;

  // `getSoundPreferences` stays the ONE place anything reads a per-treatment choice from, including
  // the settings panel. The server writes into it rather than sitting beside it as a second
  // opinion, because two stores that can disagree about whether a sound is on is how a muted agent
  // hears a chime. It also means a sound raised before the first poll returns uses this person's
  // real settings rather than the defaults.
  //
  // `treatmentsAreAuthoritative` is false while the storage column is still a pending migration.
  // The server returns `{}` then — not because nobody chose anything, but because it has nowhere to
  // put it — and mirroring that would wipe the local choice on every poll, silently, every 2.5s.
  if (treatmentsAreAuthoritative && settings.sound_treatments) {
    const current = getSoundPreferences();
    saveSoundPreferences({ ...current, enabled: settings.sound_treatments });
  }
}

/** Whether the user has this treatment turned on, independent of context. */
export function isEnabled(treatment: Treatment, prefs = getSoundPreferences()): boolean {
  if (!AUDIBLE.includes(treatment)) return false;
  const explicit = prefs.enabled[treatment];
  return explicit === undefined ? AUDIBLE_BY_DEFAULT.includes(treatment) : explicit === true;
}

/* ------------------------------------------------------------------ the audio */

// One context for the tab. The old bridge built and closed one per sound, which on Safari leaks
// hardware contexts until playback stops working entirely.
let context: AudioContext | null = null;
let primed = false;
let lastPlayedAt = 0;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context) return context;
  const Candidate =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Candidate) return null;
  try {
    context = new Candidate();
  } catch {
    return null;
  }
  return context;
}

/**
 * Open the audio context on a real user gesture.
 *
 * Browsers refuse to start audio before one. Without this the first sound of a session is swallowed
 * and the second arrives unannounced — which reads as a bug and is how people end up muting the tab.
 */
export function primeAudio() {
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  primed = true;
}

export function isPrimed() {
  return primed;
}

type Strike = {
  /** Hz. */
  hz: number;
  /** Seconds from the start of the sound. */
  at: number;
  /** Seconds. */
  decay: number;
  type: OscillatorType;
  /** Relative loudness within the sound, 0-1. */
  level: number;
  /** A metallic partial above the fundamental, which is what makes a bell sound like a bell. */
  partial?: number;
};

/**
 * Four sounds, written to be told apart with a headset on in a noisy room.
 *
 * `win` is the "ching-ching" that was asked for: two bright strikes with a high partial, the only
 * sound in the product that is allowed to feel like a reward. Everything else is deliberately
 * plainer than it, so that it stays the one that makes someone look up.
 */
const VOICES: Record<"win" | "arrive" | "warn" | "block", Strike[]> = {
  // Two bell strikes, up a fourth. Bright, short, unmistakably a till.
  win: [
    { hz: 1318.51, at: 0, decay: 0.34, type: "sine", level: 1, partial: 2.76 },
    { hz: 1760.0, at: 0.11, decay: 0.42, type: "sine", level: 1, partial: 2.76 },
  ],
  // Gentle, rising, low enough not to read as a reward. Work has landed; nothing has been won.
  arrive: [
    { hz: 523.25, at: 0, decay: 0.16, type: "sine", level: 0.7 },
    { hz: 783.99, at: 0.1, decay: 0.22, type: "sine", level: 0.7 },
  ],
  // Falling a semitone: the shape of something being questioned rather than refused.
  warn: [
    { hz: 493.88, at: 0, decay: 0.18, type: "triangle", level: 0.75 },
    { hz: 466.16, at: 0.13, decay: 0.3, type: "triangle", level: 0.75 },
  ],
  // Low, firm, falling. The one sound that survives a live call, so it must read as "stop" against
  // a voice in the same ear rather than as a notification.
  block: [
    { hz: 261.63, at: 0, decay: 0.2, type: "triangle", level: 0.95 },
    { hz: 196.0, at: 0.15, decay: 0.38, type: "triangle", level: 0.95 },
  ],
};

function strike(ctx: AudioContext, spec: Strike, gainCeiling: number, startAt: number) {
  const partials = spec.partial ? [1, spec.partial] : [1];
  partials.forEach((ratio, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = startAt + spec.at;
    // The partial sits well under the fundamental; above about a third it stops sounding like a
    // bell and starts sounding like a fault tone.
    const level = Math.max(0.0002, gainCeiling * spec.level * (index === 0 ? 1 : 0.28));
    oscillator.type = spec.type;
    oscillator.frequency.value = spec.hz * ratio;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.decay);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + spec.decay + 0.02);
  });
}

function render(treatment: Treatment, volume: number) {
  const voice = VOICES[treatment as keyof typeof VOICES];
  if (!voice) return;
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  // Capped well below 1: this plays in an office, over a headset, next to a customer.
  const ceiling = Math.min(0.09, (volume / 100) * 0.09);
  if (ceiling <= 0) return;
  try {
    const startAt = ctx.currentTime + 0.01;
    voice.forEach((spec) => strike(ctx, spec, ceiling, startAt));
  } catch {
    // An audio failure is never allowed to take down the toast it belongs to.
  }
}

/**
 * Play the sound for a treatment, if the policy allows it.
 *
 * Gathers the current state, asks `decideSound`, and renders only on "play". Returns the decision
 * rather than nothing, so "why did that not make a noise" has an answer at the call site instead of
 * requiring someone to re-derive it from six early returns.
 */
export function playFor(treatment: Treatment): SoundDecision {
  if (typeof window === "undefined") return "unprimed";

  const prefs = getSoundPreferences();
  const volume = serverVolume === null ? prefs.volume : Math.min(prefs.volume, serverVolume);
  const decision = decideSound(treatment, {
    primed,
    callOpen: callInProgress,
    muted: prefs.muted || serverMute,
    enabled: isEnabled(treatment, prefs),
    volume,
    msSinceLast: Date.now() - lastPlayedAt,
  });
  if (decision !== "play") return decision;

  lastPlayedAt = Date.now();
  render(treatment, volume);
  return decision;
}

/**
 * Play a treatment regardless of preference, context or rate limit.
 *
 * Only for a "test sound" control: someone auditioning a sound has by definition just interacted,
 * and refusing to play the thing they clicked because it is currently switched off is the kind of
 * dead control that makes people distrust the whole panel.
 */
export function previewTreatment(treatment: Treatment) {
  primeAudio();
  const prefs = getSoundPreferences();
  render(treatment, serverVolume === null ? prefs.volume : Math.min(prefs.volume, serverVolume));
}
