// Run with: npm test
//
// Step 2 gave the sound layer a voice. These assertions are about the rules that decide whether it
// uses it. Every one is a decision that would be easy to undo by accident — undoing most of them
// makes the code shorter — and whose failure is audible to a customer on a live call rather than
// visible in review.
//
// The policy is a pure function on purpose, so none of this needs a browser. Rules that need a
// browser to verify are rules that stop being verified.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  decideSound, shouldSound, isEnabled, getSoundPreferences, setCallInProgress,
  AUDIBLE, AUDIBLE_BY_DEFAULT, MIN_GAP_MS, NOTIFY_OWNED_CLASS,
} from "./sound.ts";

const root = process.cwd();
const read = (...p) => readFileSync(join(root, ...p), "utf8");

/** Everything permitting. Each test names only the one thing it is changing. */
const ALLOWED = {
  primed: true, callOpen: false, muted: false, enabled: true,
  volume: 70, msSinceLast: 10_000,
};
const decide = (treatment, patch = {}) => decideSound(treatment, { ...ALLOWED, ...patch });

test("a live call silences everything except a compliance block", () => {
  // The rule the whole design turns on. An agent is on the phone with a customer; a chime for
  // somebody else's sale is audible down the line. `block` is the exception because it is the only
  // class that means stop talking to this person — outside the window, DNC, no disclosure.
  assert.equal(decide("win", { callOpen: true }), "in-call", "a sale chimed into a live call");
  assert.equal(decide("arrive", { callOpen: true }), "in-call", "new work pinged into a live call");
  assert.equal(decide("warn", { callOpen: true }), "in-call", "a warning sounded into a live call");
  assert.equal(decide("block", { callOpen: true }), "play", "a compliance block was silenced — the agent must hear this one");
});

test("nothing sounds before the first user gesture", () => {
  // Browsers refuse autoplay. Without this the first sound of a session is swallowed and the second
  // arrives unexplained, which reads as a bug and is how a tab ends up muted for the rest of the day.
  assert.equal(decide("win", { primed: false }), "unprimed");
  assert.equal(decide("block", { primed: false }), "unprimed", "even a block cannot play through a closed context");
});

test("routine success and infrastructure faults never reach the audio", () => {
  // `done` is silent permanently: a chime for every save is a chime nobody hears, and then they
  // also miss the dropped transfer. `fail` is silent because a noise for a server fault teaches
  // people to feel responsible for infrastructure, and it fires in bursts on the worst days.
  assert.equal(AUDIBLE.includes("done"), false, "routine success started making a noise");
  assert.equal(AUDIBLE.includes("fail"), false, "server faults started making a noise");
  assert.equal(decide("done"), "not-audible");
  assert.equal(decide("fail"), "not-audible");
});

test("mute silences even a compliance block", () => {
  // The one control allowed to. A mute that quietly keeps playing one category is worse than no
  // mute at all: the person believes they are silent, and they are not.
  assert.equal(decide("block", { muted: true }), "muted");
  assert.equal(decide("win", { muted: true }), "muted");
});

test("zero volume is silence, not a quiet sound", () => {
  assert.equal(decide("win", { volume: 0 }), "silent");
});

test("a bulk action cannot machine-gun", () => {
  assert.ok(MIN_GAP_MS >= 1000, "the rate limit is short enough for a bulk action to become a burst");
  assert.equal(decide("win", { msSinceLast: 0 }), "rate-limited");
  assert.equal(decide("win", { msSinceLast: MIN_GAP_MS - 1 }), "rate-limited");
  assert.equal(decide("win", { msSinceLast: MIN_GAP_MS }), "play");
});

test("a suppressed sound never consumes the rate-limit window", () => {
  // The ordering of the gates, asserted directly. If the limiter ran first, a sound nobody was
  // allowed to hear would silence the next one that was — a muted `win` swallowing a compliance
  // `block` two hundred milliseconds later. Every suppression must out-rank the limiter.
  for (const [patch, expected] of [
    [{ callOpen: true }, "in-call"],
    [{ primed: false }, "unprimed"],
    [{ muted: true }, "muted"],
    [{ enabled: false }, "disabled"],
    [{ volume: 0 }, "silent"],
  ]) {
    assert.equal(
      decide("win", { ...patch, msSinceLast: 0 }),
      expected,
      `a suppressed sound reported as rate-limited, so it would have started the clock: ${JSON.stringify(patch)}`,
    );
  }
});

test("the one sound allowed through a live call is on by default", () => {
  // The two decisions have to agree. `block` survives an open call because it means stop talking to
  // this person — outside the window, DNC, no disclosure. If it is off by default that exception is
  // dead code: the single sound an agent most needs mid-conversation would be the one silenced.
  // It shipped opt-in on 2026-09-23 and was corrected the same day.
  const none = { muted: false, volume: 70, enabled: {} };
  assert.equal(isEnabled("block", none), true, "the compliance stop is silent by default, so the live-call exception never fires");
  assert.equal(shouldSound("block"), true);
});

test("a default is only ever a treatment that can sound", () => {
  const none = { muted: false, volume: 70, enabled: {} };
  for (const treatment of AUDIBLE_BY_DEFAULT) {
    assert.ok(AUDIBLE.includes(treatment), `${treatment} is on by default but can never sound`);
    assert.equal(isEnabled(treatment, none), true, `${treatment} is listed as a default but reads as off`);
  }
  assert.equal(isEnabled("done", none), false, "a permanently silent treatment reported as enabled");
  assert.equal(isEnabled("fail", none), false, "a permanently silent treatment reported as enabled");
});

test("an explicit preference beats the default, in both directions", () => {
  const prefs = { muted: false, volume: 70, enabled: { win: false, warn: true } };
  assert.equal(isEnabled("win", prefs), false, "turning a default-on sound off did not take");
  assert.equal(isEnabled("warn", prefs), true, "turning a default-off sound on did not take");
  assert.equal(isEnabled("arrive", prefs), true, "an untouched treatment lost its default");
});

test("the preference store degrades to silence-free defaults, never to an exception", () => {
  // getSoundPreferences runs inside every toast call. A throw here would take down the message it
  // belongs to — the notification would vanish because its sound could not be looked up.
  const prefs = getSoundPreferences();
  assert.equal(typeof prefs.muted, "boolean");
  assert.equal(typeof prefs.volume, "number");
  assert.equal(typeof prefs.enabled, "object");
});

test("shouldSound stays preference-free", () => {
  // It answers "is this the right moment", not "does this person want it". Collapsing the two is
  // tempting and would make the call-suppression rule untestable without a populated store.
  setCallInProgress(false);
  assert.equal(shouldSound("win"), true);
  setCallInProgress(true);
  try {
    assert.equal(shouldSound("win"), false);
    assert.equal(shouldSound("block"), true);
  } finally {
    setCallInProgress(false);
  }
});

test("the legacy DOM observer stands aside for notify's own toasts", () => {
  // Two systems, one decision. PortalFeedbackBridge reads `data-type` off the DOM, where `win` and
  // `done` are both "success" — so left alone it chimes for every routine save, and during calls,
  // and never for `arrive`. If this guard goes, the product grows a second contradictory sound
  // system without a line of code looking wrong.
  const bridge = read("components", "portal", "portal-feedback-bridge.tsx");
  assert.match(bridge, /NOTIFY_OWNED_CLASS/, "the bridge no longer knows about notify's toasts");
  assert.match(
    bridge,
    /classList\.contains\(NOTIFY_OWNED_CLASS\)\)\s*continue/,
    "the bridge sees notify's toasts but no longer skips them",
  );
  const index = read("lib", "notify", "index.ts");
  assert.match(index, /className: NOTIFY_OWNED_CLASS/, "notify stopped marking its toasts, so the bridge cannot skip them");
  assert.ok(typeof NOTIFY_OWNED_CLASS === "string" && NOTIFY_OWNED_CLASS.length > 0);
});

test("the audio context is opened on a gesture, once, and mounted where it can be", () => {
  const primer = read("components", "app", "notify-sound-primer.tsx");
  assert.match(primer, /primeAudio/, "the primer no longer primes");
  assert.match(primer, /once: true/, "the primer listens forever, on every interaction of the session");
  assert.match(primer, /removeEventListener/, "the primer leaks its listeners");
  const layout = read("app", "app", "(shell)", "layout.tsx");
  assert.match(layout, /<NotifySoundPrimer \/>/, "the primer is not mounted, so no sound can ever play");
});

test("the player asks the policy rather than re-deriving it", () => {
  // The policy is only worth testing if the thing that makes the noise actually consults it.
  const source = read("lib", "notify", "sound.ts");
  assert.match(source, /const decision = decideSound\(treatment, \{/, "playFor no longer routes through the policy");
  assert.match(source, /if \(decision !== "play"\) return decision;/, "playFor reaches the audio without checking the decision");
  assert.match(source, /export function playFor/, "playFor is gone");
});

test("the per-user server settings govern the whole product, not just the alert centre", () => {
  // Do-not-disturb and volume already existed, stored per user, with UI. If the feed stops handing
  // them over, a muted agent still hears the dialer and the control silently means less than it says.
  const feed = read("lib", "agentAlerts", "useAgentAlertFeed.ts");
  assert.match(feed, /setServerSoundSettings\(response\.settings[,)]/, "the stored mute and volume no longer reach the sound layer");
});

test("win is the only sound that may feel like a reward", () => {
  // The product has one moment worth celebrating. If a second sound acquires the same brightness,
  // the first one stops meaning anything — which is the whole failure this exercise is fixing.
  const source = read("lib", "notify", "sound.ts");
  const voices = source.slice(source.indexOf("const VOICES"), source.indexOf("function strike"));
  const hz = [...voices.matchAll(/hz: ([\d.]+)/g)].map((m) => Number(m[1]));
  const winHz = hz.slice(0, 2);
  const others = hz.slice(2);
  assert.ok(winHz.every((f) => f > 1000), "win stopped being the bright one");
  assert.ok(others.every((f) => f < Math.min(...winHz)), "another treatment is now as bright as a win");
  assert.ok(voices.includes("partial: 2.76"), "win lost the partial that makes it read as a bell rather than a beep");
});
