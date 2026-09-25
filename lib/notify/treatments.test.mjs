// Run with: npm test
//
// The product raises 194 distinct audited actions and had two ways of saying so: 165 green boxes
// and 238 red ones. A lead importing looked like a licence expiring; a validation typo looked like
// a database outage.
//
// These assertions are about the decisions, not the wiring. Each one is a choice that was made
// deliberately and would be easy to undo by accident, because undoing it makes the code shorter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AUDIBLE, AUDIBLE_BY_DEFAULT, shouldSound, setCallInProgress, MIN_GAP_MS } from "./sound.ts";

const root = process.cwd();
const read = (...p) => readFileSync(join(root, ...p), "utf8");

test("no sound during a live call, except a compliance block", () => {
  // The rule the whole design turns on. An agent is on the phone with a customer; a chime for
  // somebody else's sale is audible down the line. `block` is the exception because it is the only
  // class that means stop talking to this person — outside the window, DNC, no disclosure.
  setCallInProgress(true);
  try {
    assert.equal(shouldSound("win"), false, "a sale would chime into a live call");
    assert.equal(shouldSound("arrive"), false, "new work would ping into a live call");
    assert.equal(shouldSound("warn"), false, "a warning would sound into a live call");
    assert.equal(shouldSound("block"), true, "a compliance block was silenced — the agent must hear this one");
  } finally {
    setCallInProgress(false);
  }
});

test("outside a call, the audible treatments are audible again", () => {
  setCallInProgress(false);
  assert.equal(shouldSound("win"), true);
  assert.equal(shouldSound("arrive"), true);
});

test("routine success and infrastructure faults never sound", () => {
  // `done` is silent permanently: a chime for every save is a chime nobody hears, and then they
  // also miss the dropped transfer. `fail` is silent because a noise for a server fault teaches
  // people to feel responsible for infrastructure, and it fires in bursts on the worst days.
  assert.equal(AUDIBLE.includes("done"), false, "routine success started making a noise");
  assert.equal(AUDIBLE.includes("fail"), false, "server faults started making a noise");
  setCallInProgress(false);
  assert.equal(shouldSound("done"), false);
  assert.equal(shouldSound("fail"), false);
});

test("the defaults stay coherent with what can sound at all", () => {
  // Asserts properties, not the membership list. Which treatments are on by default is a product
  // decision that has already changed once — `block` was added on 2026-09-23 — and a guard that
  // pins the list simply fails the next time somebody decides something, teaching people to edit
  // the assertion rather than think about it.
  for (const treatment of AUDIBLE_BY_DEFAULT) {
    assert.ok(AUDIBLE.includes(treatment), `${treatment} is on by default but can never sound`);
  }
  assert.equal(AUDIBLE_BY_DEFAULT.includes("done"), false, "routine success became audible by default");
  assert.equal(AUDIBLE_BY_DEFAULT.includes("fail"), false, "server faults became audible by default");
});

test("a bulk action cannot machine-gun", () => {
  assert.ok(MIN_GAP_MS >= 1000, "the rate limit is short enough for a bulk action to become a burst");
});

test("the dialer tells the notifier when a call is open", () => {
  // Wired in step 1, before any sound exists, so sound cannot ship without the gate. If this goes,
  // `shouldSound` is still correct and never consulted — the failure would be inaudible in review
  // and very audible in a customer's ear.
  const dialer = read("components", "app", "dialer-workspace.tsx");
  assert.match(dialer, /setCallInProgress/, "the dialer no longer reports whether a call is open");
  assert.match(
    dialer,
    /setCallInProgress\(Boolean\(attempt\)\)/,
    "the call gate is no longer driven by whether an attempt is open",
  );
  assert.match(dialer, /return \(\) => setCallInProgress\(false\)/, "the gate is never released, so the tab stays silent forever");
});

test("the migrated screens route through the vocabulary, not raw toasts", () => {
  for (const file of [["components", "app", "dialer-workspace.tsx"], ["components", "app", "lead-import-workspace.tsx"]]) {
    const source = read(...file);
    assert.doesNotMatch(source, /toast\./, `${file.join("/")} still calls toast directly, so its events have no meaning attached`);
    assert.match(source, /from "@\/lib\/notify"/, `${file.join("/")} no longer imports the vocabulary`);
  }
});

test("the conversions are marked as wins and the refusals as blocks", () => {
  // The distinction the exercise exists for. If these collapse back to done/fail the file still
  // compiles, the tests still pass elsewhere, and the product goes back to two colours.
  const dialer = read("components", "app", "dialer-workspace.tsx");
  assert.match(dialer, /notify\.win\("Application submitted"\)/, "a submitted application is no longer a win");
  assert.match(dialer, /notify\.win\("Application started"/, "starting an application is no longer a win");
  assert.match(dialer, /notify\.win\("Appointment booked"/, "a booked appointment is no longer a win");
  assert.match(dialer, /notify\.block\("Dialing is blocked"/, "a compliance refusal is no longer a block");
});
